import { AppError, badRequest, notFound } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { aiPhotoBatches, type AiPhotoBatchRow, type PhotoBatchStatus } from "../../schema";
import type { AiService } from "../../service";
import type { AiImageType } from "../../types";
import { checkImage } from "../b-common";
import { addHsn, markExisting, mergeDrafts, MAX_PHOTOS, PHOTO_CREDITS_HINT, readCataloguePhoto, type ExistingFinder, type ProductDraft } from "./photos";

/** The job that reads one batch of photos (run by the job queue; defined in the API kit). */
export const CATALOGUE_PHOTOS_JOB = "ai.catalogue-photos";
const STOP_CODES = ["ai_off", "ai_feature_off", "ai_credits_exhausted", "ai_disabled", "ai_unavailable", "ai_not_available"];

export interface PhotoJobPayload {
  tenantId: string;
  userId: string | null;
  batchId: string;
  /** Base64 photos. Dropped with the job: nothing here is stored in the database. */
  images: { mediaType: AiImageType; data: string }[];
}

export interface PhotoBatchDeps {
  db: Db;
  ai: AiService;
  ports: {
    categories(tenantId: string): Promise<{ id: string; name: string }[]>;
    trade(tenantId: string): Promise<string | null>;
    existing: ExistingFinder;
  };
  /** Puts the batch on the job queue; omit to read inline (tests). */
  enqueue?: (payload: PhotoJobPayload) => Promise<void>;
  log?: { warn(o: object, m?: string): void };
}

export interface PhotoEstimate {
  count: number;
  credits: number;
  perPhoto: number;
  remaining: number | null;
  enough: boolean;
}

export interface PhotoBatchView {
  id: string;
  status: PhotoBatchStatus;
  total: number;
  done: number;
  failed: number;
  credits: number;
  drafts: ProductDraft[];
  problems: { photo: number; code: string }[];
  error: string | null;
  updatedAt: Date;
}

const view = (r: AiPhotoBatchRow): PhotoBatchView => ({
  id: r.id,
  status: r.status,
  total: r.total,
  done: r.done,
  failed: r.failed,
  credits: r.credits,
  drafts: r.drafts as ProductDraft[],
  problems: r.problems,
  error: r.error,
  updatedAt: r.updatedAt,
});

/** "Add products from photos": reads up to 20 photos in the background, shows progress, and leaves checked drafts for the review grid. */
export class PhotoBatchService {
  constructor(private readonly d: PhotoBatchDeps) {}

  async estimate(tenantId: string, count: number): Promise<PhotoEstimate> {
    if (!Number.isInteger(count) || count < 1) throw badRequest("Add at least one photo");
    if (count > MAX_PHOTOS) throw badRequest(`Add at most ${MAX_PHOTOS} photos at a time`);
    const credits = count * PHOTO_CREDITS_HINT;
    const remaining = (await this.d.ai.balance(tenantId)).remaining;
    return { count, credits, perPhoto: PHOTO_CREDITS_HINT, remaining, enough: remaining === null || remaining >= credits };
  }

  /** Checks the photos, refuses a batch the credits cannot pay for, creates the batch and queues the job. */
  async start(tenantId: string, userId: string | null, images: { mediaType: string; data: string }[]) {
    if (images.length === 0) throw badRequest("Add at least one photo");
    const checked = images.map(checkImage);
    const est = await this.estimate(tenantId, checked.length);
    if (!est.enough)
      throw new AppError(402, "ai_credits_exhausted", "You do not have enough AI credits for these photos. Use fewer photos or add a credit pack.", { needed: est.credits, remaining: est.remaining });
    const id = randomUUID();
    await this.d.db.insert(aiPhotoBatches).values({ id, tenantId, kind: "catalogue-photos", status: "queued", total: checked.length, createdBy: userId });
    const payload: PhotoJobPayload = { tenantId, userId, batchId: id, images: checked };
    if (this.d.enqueue) await this.d.enqueue(payload);
    else await this.process(payload);
    return { batchId: id, estimate: est };
  }

  private async set(id: string, tenantId: string, set: Partial<typeof aiPhotoBatches.$inferInsert>) {
    await this.d.db.update(aiPhotoBatches).set({ ...set, updatedAt: new Date() }).where(and(eq(aiPhotoBatches.id, id), eq(aiPhotoBatches.tenantId, tenantId)));
  }

  /** The job body. One photo failing does not stop the rest; switch / credit errors end the batch. */
  async process(p: PhotoJobPayload): Promise<{ products: number; failed: number }> {
    const { tenantId, userId, batchId } = p;
    await this.set(batchId, tenantId, { status: "running" });
    const categories = await this.d.ports.categories(tenantId).catch(() => []);
    const trade = await this.d.ports.trade(tenantId).catch(() => null);
    const all: ProductDraft[] = [];
    const problems: { photo: number; code: string }[] = [];
    let credits = 0;
    let done = 0;
    let failed = 0;
    let stop: string | null = null;
    for (const [i, image] of p.images.entries()) {
      if (stop) {
        problems.push({ photo: i, code: stop });
        failed++;
        continue;
      }
      try {
        const r = await readCataloguePhoto(this.d.ai, { tenantId, userId, image, categories, trade, photo: i });
        credits += r.credits;
        all.push(...r.drafts);
        if (r.ignoredInstructions) problems.push({ photo: i, code: "ignored_instructions" });
        done++;
      } catch (e) {
        const code = e instanceof AppError ? e.code : "ai_failed";
        if (STOP_CODES.includes(code)) stop = code;
        problems.push({ photo: i, code });
        failed++;
        this.d.log?.warn({ tenantId, batchId, photo: i, code }, "ai: catalogue photo failed");
      }
      // Progress: the grid can already show what has been read.
      await this.set(batchId, tenantId, { done: done + failed, failed, credits, drafts: mergeDrafts(all) as unknown[], problems });
    }
    const merged = mergeDrafts(all);
    try {
      await markExisting(tenantId, merged, this.d.ports.existing);
      credits += await addHsn(this.d.ai, tenantId, userId, merged, { skipExisting: true });
    } catch (e) {
      this.d.log?.warn({ tenantId, batchId, err: String(e) }, "ai: catalogue photo post-processing failed");
    }
    const ok = merged.length > 0;
    await this.set(batchId, tenantId, {
      status: ok || failed < p.images.length ? "done" : "failed",
      done: done + failed,
      failed,
      credits,
      drafts: merged as unknown[],
      problems,
      error: ok ? null : (stop ?? problems[0]?.code ?? "ai_unreadable_image"),
    });
    return { products: merged.length, failed };
  }

  async get(tenantId: string, id: string): Promise<PhotoBatchView> {
    const [row] = await this.d.db.select().from(aiPhotoBatches).where(and(eq(aiPhotoBatches.tenantId, tenantId), eq(aiPhotoBatches.id, id))).limit(1);
    if (!row) throw notFound("Photo batch not found");
    return view(row);
  }

  /** The shop's recent batches without their drafts (a "continue where you left off" list). */
  async recent(tenantId: string, limit = 5) {
    const rows = await this.d.db.select().from(aiPhotoBatches).where(eq(aiPhotoBatches.tenantId, tenantId)).orderBy(desc(aiPhotoBatches.createdAt)).limit(limit);
    return rows.map((r) => ({ ...view(r), drafts: [] as ProductDraft[], productCount: r.drafts.length }));
  }
}
