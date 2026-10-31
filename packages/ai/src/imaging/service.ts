import { AppError, badRequest, notFound } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { aiImageCleanups, aiTryons, type AiImageCleanupRow, type AiTryonRow, type CleanupStatus } from "../schema";
import type { AiService } from "../service";
import { cleanupImage } from "./cleanup";
import { FESTIVE_BACKDROPS, normaliseHex, type CleanupStyle } from "./layout";
import type { Segmenter } from "./segment";
import { defaultAnchors, guessKind, parseTryonInput, type TryonAnchors, type TryonKind } from "./tryon";

export const IMAGE_CLEANUP_FEATURE = "image-cleanup";
export const AR_TRYON_FEATURE = "ar-tryon";
/** The job that cleans one photo (run by the job queue; defined in the API kit). */
export const IMAGE_CLEANUP_JOB = "ai.image-cleanup";
export const MAX_CLEANUP_ITEMS = 500;
export const STYLES = ["white", "shadow", "color"] as const;

/** What the host provides: reading and writing images and the product's image list. */
export interface ImagingPorts {
  /** The photo's bytes; throws an AppError when it is not this shop's stored image. */
  loadImage(tenantId: string, url: string): Promise<Buffer>;
  /** Stores a generated image in the shop's uploads and returns its public url. */
  store(tenantId: string, f: { filename: string; contentType: "image/webp" | "image/png"; body: Buffer }): Promise<{ url: string }>;
  product(tenantId: string, id: string): Promise<{ id: string; name: string; images: { url: string; alt?: string | null }[] } | null>;
  setImages(tenantId: string, id: string, images: { url: string; alt?: string | null }[]): Promise<void>;
  /** True when the url is one of this shop's own stored images (try-on images must be). */
  isOwnImage(tenantId: string, url: string): boolean;
}

export interface ImagingDeps {
  db: Db;
  ai: AiService;
  ports: ImagingPorts;
  /** The segmenter, or null when the model weights are not installed. */
  segmenter: () => Segmenter | null;
  /** Model name for the "not installed" message and the run record. */
  modelId: () => string;
  /** Puts one photo on the job queue; omit to run inline (tests). */
  enqueue?: (payload: CleanupJobPayload) => Promise<void>;
  log?: { warn(o: object, m?: string): void };
}

export interface CleanupJobPayload {
  tenantId: string;
  userId: string | null;
  id: string;
}

export interface CleanupStartInput {
  items: { productId: string; imageUrl?: string }[];
  style: CleanupStyle;
  color?: string | null;
}

export interface CleanupView {
  id: string;
  batchId: string;
  productId: string;
  status: CleanupStatus;
  originalUrl: string;
  cleanedUrl: string | null;
  cutoutUrl: string | null;
  style: string;
  color: string | null;
  reasons: string[];
  needsCheck: boolean;
  credits: number;
  ms: number | null;
  error: string | null;
  updatedAt: Date;
}

const view = (r: AiImageCleanupRow): CleanupView => ({
  id: r.id,
  batchId: r.batchId,
  productId: r.productId,
  status: r.status,
  originalUrl: r.originalUrl,
  cleanedUrl: r.cleanedUrl,
  cutoutUrl: r.cutoutUrl,
  style: r.style,
  color: r.color,
  reasons: r.reasons,
  needsCheck: r.status === "check",
  credits: r.credits,
  ms: r.ms,
  error: r.error,
  updatedAt: r.updatedAt,
});

const STOP_CODES = ["ai_off", "ai_feature_off", "ai_credits_exhausted", "ai_not_available"];

export const modelMissing = (model: string) =>
  new AppError(503, "image_model_missing", "Photo cleanup is not installed on this server yet. Ask your administrator to install the image model.", { model });

/** Photo cleanup (background removal, tidy, save as proposals) and the try-on setup of products. */
export class ImagingService {
  constructor(private readonly d: ImagingDeps) {}

  async status(tenantId: string) {
    const seg = this.d.segmenter();
    return { installed: seg !== null, model: this.d.modelId(), creditsPerImage: await this.d.ai.localPrice(tenantId, IMAGE_CLEANUP_FEATURE), festive: FESTIVE_BACKDROPS };
  }

  /** Creates one queued row per photo and queues a job for each; returns the batch id for progress polling. */
  async start(tenantId: string, userId: string | null, input: CleanupStartInput) {
    if (!this.d.segmenter()) throw modelMissing(this.d.modelId());
    if (input.items.length === 0) throw badRequest("Choose at least one photo");
    if (input.items.length > MAX_CLEANUP_ITEMS) throw badRequest(`Clean at most ${MAX_CLEANUP_ITEMS} photos at a time`);
    const color = input.style === "color" ? (normaliseHex(input.color ?? "") ?? FESTIVE_BACKDROPS.diwali) : null;
    const price = await this.d.ai.localPrice(tenantId, IMAGE_CLEANUP_FEATURE);

    const rows: (typeof aiImageCleanups.$inferInsert)[] = [];
    const batchId = randomUUID();
    const seen = new Set<string>();
    const products = new Map<string, Awaited<ReturnType<ImagingPorts["product"]>>>();
    for (const it of input.items) {
      if (!products.has(it.productId)) products.set(it.productId, await this.d.ports.product(tenantId, it.productId));
      const p = products.get(it.productId);
      if (!p) throw notFound("Product");
      const url = it.imageUrl ?? p.images[0]?.url;
      if (!url || !p.images.some((i) => i.url === url)) continue; // no photo, or not one of the product's photos
      const key = `${p.id}|${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ id: randomUUID(), tenantId, batchId, productId: p.id, originalUrl: url, style: input.style, color, status: "queued", createdBy: userId });
    }
    if (rows.length === 0) throw badRequest("None of the chosen products has a photo to clean");
    if (price > 0) {
      const remaining = (await this.d.ai.balance(tenantId)).remaining;
      if (remaining !== null && remaining < price * rows.length)
        throw new AppError(402, "ai_credits_exhausted", "You do not have enough AI credits for these photos. Choose fewer photos or add a credit pack.", { needed: price * rows.length, remaining });
    }
    await this.d.db.insert(aiImageCleanups).values(rows);
    for (const r of rows) {
      const payload: CleanupJobPayload = { tenantId, userId, id: r.id! };
      if (this.d.enqueue) await this.d.enqueue(payload);
      else await this.process(payload);
    }
    return { batchId, count: rows.length, creditsPerImage: price };
  }

  private async set(id: string, tenantId: string, set: Partial<typeof aiImageCleanups.$inferInsert>) {
    await this.d.db.update(aiImageCleanups).set({ ...set, updatedAt: new Date() }).where(and(eq(aiImageCleanups.id, id), eq(aiImageCleanups.tenantId, tenantId)));
  }

  /** The job body for one photo. Never throws for a bad photo: the row ends `failed` with a code. */
  async process(p: CleanupJobPayload): Promise<CleanupStatus> {
    const { tenantId, userId, id } = p;
    const [row] = await this.d.db.select().from(aiImageCleanups).where(and(eq(aiImageCleanups.id, id), eq(aiImageCleanups.tenantId, tenantId))).limit(1);
    if (!row || row.status !== "queued") return row?.status ?? "failed";
    await this.set(id, tenantId, { status: "running" });
    const seg = this.d.segmenter();
    if (!seg) {
      await this.set(id, tenantId, { status: "failed", error: "image_model_missing" });
      return "failed";
    }
    try {
      const style = row.style as CleanupStyle;
      const run = await this.d.ai.runLocal({ tenantId, userId, feature: IMAGE_CLEANUP_FEATURE, model: `local:${seg.id}` }, async () => {
        const src = await this.d.ports.loadImage(tenantId, row.originalUrl);
        const r = await cleanupImage(src, seg, { style, color: row.color });
        let cleanedUrl: string | null = null;
        if (r.image) cleanedUrl = (await this.d.ports.store(tenantId, { filename: `cleaned-${id.slice(0, 8)}.webp`, contentType: "image/webp", body: r.image })).url;
        return { r, cleanedUrl };
      });
      const { r, cleanedUrl } = run.output;
      if (!cleanedUrl) {
        await this.set(id, tenantId, { status: "failed", error: "no_product_found", reasons: r.verdict.reasons, model: seg.id, ms: r.ms, credits: run.credits });
        return "failed";
      }
      const status: CleanupStatus = r.verdict.ok ? "ready" : "check";
      const { fgRatio, confidence, edgeTouch } = r.verdict.stats;
      await this.set(id, tenantId, { status, cleanedUrl, reasons: r.verdict.reasons, stats: { fgRatio, confidence, edgeTouch }, model: seg.id, ms: r.ms, credits: run.credits, error: null });
      return status;
    } catch (e) {
      const code = e instanceof AppError ? e.code : "cleanup_failed";
      this.d.log?.warn({ tenantId, id, code, err: e instanceof Error ? e.message : String(e) }, "image cleanup failed");
      await this.set(id, tenantId, { status: "failed", error: STOP_CODES.includes(code) || e instanceof AppError ? code : "cleanup_failed" });
      return "failed";
    }
  }

  /** Progress and results of a batch. */
  async batch(tenantId: string, batchId: string) {
    const rows = await this.d.db.select().from(aiImageCleanups).where(and(eq(aiImageCleanups.tenantId, tenantId), eq(aiImageCleanups.batchId, batchId))).orderBy(asc(aiImageCleanups.createdAt), asc(aiImageCleanups.id));
    if (rows.length === 0) throw notFound("Cleanup batch");
    const count = (s: CleanupStatus[]) => rows.filter((r) => s.includes(r.status)).length;
    const waiting = count(["queued", "running"]);
    return {
      batchId,
      total: rows.length,
      done: rows.length - waiting,
      waiting,
      ready: count(["ready"]),
      check: count(["check"]),
      failed: count(["failed"]),
      applied: count(["applied"]),
      finished: waiting === 0,
      credits: rows.reduce((n, r) => n + r.credits, 0),
      items: rows.map(view),
    };
  }

  /** The cleanups of one product (newest first), for the product page. */
  async forProduct(tenantId: string, productId: string, limit = 20): Promise<CleanupView[]> {
    const rows = await this.d.db.select().from(aiImageCleanups).where(and(eq(aiImageCleanups.tenantId, tenantId), eq(aiImageCleanups.productId, productId))).orderBy(desc(aiImageCleanups.createdAt)).limit(limit);
    return rows.map(view);
  }

  private async row(tenantId: string, id: string): Promise<AiImageCleanupRow> {
    const [row] = await this.d.db.select().from(aiImageCleanups).where(and(eq(aiImageCleanups.tenantId, tenantId), eq(aiImageCleanups.id, id))).limit(1);
    if (!row) throw notFound("Cleaned photo");
    return row;
  }

  /**
   * Use the cleaned photo: replaces the original in the product's image list (`replace`), or puts it first and keeps the
   * original after it (`add`). The original file is never deleted; "use the original again" (`revert`) undoes it.
   */
  async apply(tenantId: string, id: string, mode: "replace" | "add" = "replace") {
    const row = await this.row(tenantId, id);
    if (row.status !== "ready" && row.status !== "check") throw new AppError(409, "cleanup_not_ready", "This photo is not ready to use.");
    if (!row.cleanedUrl) throw new AppError(409, "cleanup_not_ready", "This photo has no cleaned copy.");
    const p = await this.d.ports.product(tenantId, row.productId);
    if (!p) throw notFound("Product");
    const idx = p.images.findIndex((i) => i.url === row.originalUrl);
    if (idx < 0) throw new AppError(409, "cleanup_photo_changed", "The product's photos have changed since this was cleaned. Clean the photo again.");
    const alt = p.images[idx]!.alt ?? p.name;
    const images =
      mode === "add"
        ? [{ url: row.cleanedUrl, alt }, ...p.images]
        : p.images.map((i, n) => (n === idx ? { url: row.cleanedUrl!, alt: i.alt ?? p.name } : i));
    await this.d.ports.setImages(tenantId, row.productId, images);
    await this.set(id, tenantId, { status: "applied", appliedAt: new Date() });
    return { ok: true as const, images: images.map((i) => ({ url: i.url, alt: i.alt ?? null })) };
  }

  /** Puts the original back (undo of `apply`). */
  async revert(tenantId: string, id: string) {
    const row = await this.row(tenantId, id);
    if (row.status !== "applied" || !row.cleanedUrl) throw new AppError(409, "cleanup_not_applied", "This photo is not in use on the product.");
    const p = await this.d.ports.product(tenantId, row.productId);
    if (!p) throw notFound("Product");
    let found = false;
    let images = p.images.map((i) => {
      if (i.url !== row.cleanedUrl) return i;
      found = true;
      return { url: row.originalUrl, alt: i.alt ?? p.name };
    });
    if (found && images.filter((i) => i.url === row.originalUrl).length > 1) images = images.filter((i, n, a) => i.url !== row.originalUrl || a.findIndex((x) => x.url === i.url) === n);
    if (!found) throw new AppError(409, "cleanup_photo_changed", "The cleaned photo is no longer on the product.");
    await this.d.ports.setImages(tenantId, row.productId, images);
    await this.set(id, tenantId, { status: "ready", appliedAt: null });
    return { ok: true as const, images: images.map((i) => ({ url: i.url, alt: i.alt ?? null })) };
  }

  /** Throws the proposal away (the original stays; the cleaned file stays in uploads and can be deleted there). */
  async discard(tenantId: string, id: string) {
    const row = await this.row(tenantId, id);
    if (row.status === "applied") throw new AppError(409, "cleanup_applied", "Use the original again first.");
    await this.set(id, tenantId, { status: "discarded" });
    return { ok: true as const };
  }

  /** Applies every `ready` (not `check`) result of a batch in one go; returns how many were used and how many failed to apply. */
  async applyAllReady(tenantId: string, batchId: string) {
    const rows = await this.d.db.select().from(aiImageCleanups).where(and(eq(aiImageCleanups.tenantId, tenantId), eq(aiImageCleanups.batchId, batchId), inArray(aiImageCleanups.status, ["ready"])));
    let applied = 0;
    let skipped = 0;
    for (const r of rows) {
      try {
        await this.apply(tenantId, r.id);
        applied++;
      } catch {
        skipped++;
      }
    }
    return { applied, skipped };
  }

  // ------------------------------------------------------------------ try-on

  async tryon(tenantId: string, productId: string) {
    const [r] = await this.d.db.select().from(aiTryons).where(and(eq(aiTryons.tenantId, tenantId), eq(aiTryons.productId, productId))).limit(1);
    return r ? tryonView(r) : null;
  }

  async saveTryon(tenantId: string, userId: string | null, productId: string, body: unknown) {
    const parsed = parseTryonInput(body);
    if (!parsed.ok) throw badRequest(parsed.message);
    if (!this.d.ports.isOwnImage(tenantId, parsed.value.imageUrl)) throw badRequest("Use an image from this shop's uploads");
    if (!(await this.d.ports.product(tenantId, productId))) throw notFound("Product");
    const kind: TryonKind = parsed.value.anchors.kind;
    const [r] = await this.d.db
      .insert(aiTryons)
      .values({ tenantId, productId, kind, imageUrl: parsed.value.imageUrl, anchors: parsed.value.anchors, updatedBy: userId })
      .onConflictDoUpdate({ target: [aiTryons.tenantId, aiTryons.productId], set: { kind, imageUrl: parsed.value.imageUrl, anchors: parsed.value.anchors, updatedBy: userId, updatedAt: new Date() } })
      .returning();
    return tryonView(r!);
  }

  /**
   * Cuts the product out of an ordinary photo and stores the transparent PNG as the try-on image. Returns the new image url,
   * a guessed kind and starting anchors for the owner to adjust. Nothing is saved on the product until `saveTryon`.
   */
  async prepareTryonImage(tenantId: string, userId: string | null, productId: string, imageUrl: string, kind?: TryonKind) {
    const seg = this.d.segmenter();
    if (!seg) throw modelMissing(this.d.modelId());
    if (!this.d.ports.isOwnImage(tenantId, imageUrl)) throw badRequest("Use a photo from this shop's uploads");
    const p = await this.d.ports.product(tenantId, productId);
    if (!p) throw notFound("Product");
    const run = await this.d.ai.runLocal({ tenantId, userId, feature: IMAGE_CLEANUP_FEATURE, model: `local:${seg.id}` }, async () => {
      const src = await this.d.ports.loadImage(tenantId, imageUrl);
      const r = await cleanupImage(src, seg, { style: "white", cutout: true });
      if (!r.cutout) throw new AppError(422, "no_product_found", "No product was found in that photo. Use a clear photo of the item on a plain background.");
      const stored = await this.d.ports.store(tenantId, { filename: `tryon-${productId.slice(0, 8)}.png`, contentType: "image/png", body: r.cutout });
      return { url: stored.url, reasons: r.verdict.reasons, ok: r.verdict.ok };
    });
    const k = kind ?? guessKind(p.name) ?? "glasses";
    return { imageUrl: run.output.url, kind: k, anchors: defaultAnchors(k), needsCheck: !run.output.ok, reasons: run.output.reasons, credits: run.credits };
  }

  async removeTryon(tenantId: string, productId: string) {
    await this.d.db.delete(aiTryons).where(and(eq(aiTryons.tenantId, tenantId), eq(aiTryons.productId, productId)));
    return { ok: true as const };
  }

  /** What the store page needs: only when the shop switched the helper on. Public (shoppers); no personal data. */
  async publicTryon(tenantId: string, productId: string, switchedOn: boolean) {
    if (!switchedOn) return null;
    return this.tryon(tenantId, productId);
  }
}

export interface TryonView {
  productId: string;
  kind: TryonKind;
  imageUrl: string;
  anchors: TryonAnchors;
  updatedAt: Date;
}
const tryonView = (r: AiTryonRow): TryonView => ({ productId: r.productId, kind: r.kind as TryonKind, imageUrl: r.imageUrl, anchors: r.anchors as TryonAnchors, updatedAt: r.updatedAt });
