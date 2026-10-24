import { AppError, badRequest, notFound } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { aiProductTags, type AiProductTagRow, type ProductTagStatus } from "../../schema";
import type { AiService } from "../../service";
import type { AiImageType } from "../../types";
import { applyChoices, MAX_TAG_BATCH, planFields, readProductTags, TAG_CREDITS_HINT, TAG_FIELDS, type ApplyChoice, type ApplyResult, type FieldPlan, type TagField, type TagProposal } from "./tags";

/** The job that drafts the tags of one batch (run by the job queue; defined in the API kit). */
export const TAGS_JOB = "ai.product-tags";
const STOP_CODES = ["ai_off", "ai_feature_off", "ai_credits_exhausted", "ai_disabled", "ai_unavailable", "ai_not_available"];

export interface TagProduct {
  id: string;
  name: string;
  categoryName: string | null;
  /** The first product photo. */
  imageUrl: string | null;
  tags: string[];
  attributes: Record<string, string>;
}

export interface TagDeps {
  db: Db;
  ai: AiService;
  ports: {
    products(tenantId: string, ids: string[]): Promise<TagProduct[]>;
    /** The shop's colour option values (every value of an option called Colour / Color across its products). */
    colourValues(tenantId: string): Promise<string[]>;
    /** Fetches and shrinks the product photo. Only the shop's own storage is allowed; throws when it cannot be read. */
    loadImage(tenantId: string, url: string): Promise<{ mediaType: AiImageType; data: string }>;
    /** Writes the new tags and attributes through the catalogue (which refreshes search and the storefront). */
    update(tenantId: string, productId: string, patch: { tags: string[]; attributes: Record<string, string> }): Promise<void>;
  };
  enqueue?: (payload: TagJobPayload) => Promise<void>;
  log?: { warn(o: object, m?: string): void };
}

export interface TagJobPayload {
  tenantId: string;
  userId: string | null;
  batchId: string;
}

export interface TagEstimate {
  count: number;
  /** Selected products without a photo (left out). */
  withoutPhoto: number;
  credits: number;
  perProduct: number;
  remaining: number | null;
  enough: boolean;
}

export interface TagView {
  id: string;
  productId: string;
  batchId: string;
  status: ProductTagStatus;
  sourceName: string;
  imageUrl: string | null;
  proposal: TagProposal | null;
  /** What approval would do to the product as it is now (conflicts with attributes the owner set). */
  plan: FieldPlan[];
  applied: Record<string, unknown> | null;
  credits: number;
  error: string | null;
  updatedAt: Date;
}

export type Choices = Partial<Record<TagField, Partial<ApplyChoice> & { skip?: boolean }>>;

export class TagService {
  constructor(private readonly d: TagDeps) {}

  async estimate(tenantId: string, productIds: string[]): Promise<TagEstimate> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) throw badRequest("Select at least one product");
    if (ids.length > MAX_TAG_BATCH) throw badRequest(`Select at most ${MAX_TAG_BATCH} products at a time`);
    const products = await this.d.ports.products(tenantId, ids);
    const withPhoto = products.filter((p) => p.imageUrl);
    const credits = withPhoto.length * TAG_CREDITS_HINT;
    const remaining = (await this.d.ai.balance(tenantId)).remaining;
    return { count: withPhoto.length, withoutPhoto: products.length - withPhoto.length, credits, perProduct: TAG_CREDITS_HINT, remaining, enough: remaining === null || remaining >= credits };
  }

  async start(tenantId: string, userId: string | null, productIds: string[]) {
    const est = await this.estimate(tenantId, productIds);
    if (est.count === 0) throw new AppError(400, "no_photos", "None of the selected products has a photo.");
    if (!est.enough)
      throw new AppError(402, "ai_credits_exhausted", "You do not have enough AI credits for this batch. Choose fewer products or add a credit pack.", { needed: est.credits, remaining: est.remaining });
    const products = (await this.d.ports.products(tenantId, [...new Set(productIds)])).filter((p) => p.imageUrl);
    const batchId = randomUUID();
    for (const p of products) {
      await this.d.db
        .insert(aiProductTags)
        .values({ tenantId, productId: p.id, batchId, status: "queued", sourceName: p.name, imageUrl: p.imageUrl, createdBy: userId })
        .onConflictDoUpdate({
          target: [aiProductTags.tenantId, aiProductTags.productId],
          set: { batchId, status: "queued", sourceName: p.name, imageUrl: p.imageUrl, proposal: null, applied: null, error: null, credits: 0, runId: null, createdBy: userId, reviewedBy: null, reviewedAt: null, updatedAt: new Date() },
        });
    }
    const payload: TagJobPayload = { tenantId, userId, batchId };
    if (this.d.enqueue) await this.d.enqueue(payload);
    else await this.process(payload);
    return { batchId, count: products.length, estimate: est };
  }

  private async mark(id: string, tenantId: string, set: Partial<typeof aiProductTags.$inferInsert>) {
    await this.d.db.update(aiProductTags).set({ ...set, updatedAt: new Date() }).where(and(eq(aiProductTags.id, id), eq(aiProductTags.tenantId, tenantId)));
  }

  /** The job body. A failing product is marked failed and the rest go on; a switch / credit stop ends the batch. */
  async process(p: TagJobPayload): Promise<{ drafted: number; failed: number }> {
    const rows = await this.d.db
      .select()
      .from(aiProductTags)
      .where(and(eq(aiProductTags.tenantId, p.tenantId), eq(aiProductTags.batchId, p.batchId), eq(aiProductTags.status, "queued")));
    const colours = await this.d.ports.colourValues(p.tenantId).catch(() => []);
    const info = new Map((await this.d.ports.products(p.tenantId, rows.map((r) => r.productId)).catch(() => [])).map((x) => [x.id, x]));
    let drafted = 0;
    let failed = 0;
    let stop: string | null = null;
    for (const row of rows) {
      if (stop) {
        await this.mark(row.id, p.tenantId, { status: "failed", error: stop });
        failed++;
        continue;
      }
      try {
        if (!row.imageUrl) throw new AppError(400, "no_photos", "no photo");
        const image = await this.d.ports.loadImage(p.tenantId, row.imageUrl).catch((e) => {
          throw e instanceof AppError ? e : new AppError(422, "image_unavailable", "The product photo could not be read");
        });
        const r = await readProductTags(this.d.ai, { tenantId: p.tenantId, userId: p.userId, image, name: row.sourceName, category: info.get(row.productId)?.categoryName ?? null, shopColours: colours });
        await this.mark(row.id, p.tenantId, { status: "draft", proposal: r.proposal as unknown as Record<string, unknown>, runId: r.runId, credits: r.credits, error: null });
        drafted++;
      } catch (e) {
        const code = e instanceof AppError ? e.code : "ai_failed";
        if (STOP_CODES.includes(code)) stop = code;
        await this.mark(row.id, p.tenantId, { status: "failed", error: code });
        failed++;
        this.d.log?.warn({ tenantId: p.tenantId, productId: row.productId, code }, "ai: product tags failed");
      }
    }
    return { drafted, failed };
  }

  private async toViews(tenantId: string, rows: AiProductTagRow[]): Promise<TagView[]> {
    const drafts = rows.filter((r) => r.status === "draft");
    const live = new Map((drafts.length ? await this.d.ports.products(tenantId, drafts.map((r) => r.productId)) : []).map((p) => [p.id, p]));
    return rows.map((r) => {
      const proposal = (r.proposal as TagProposal | null) ?? null;
      const prod = live.get(r.productId);
      return {
        id: r.id,
        productId: r.productId,
        batchId: r.batchId,
        status: r.status,
        sourceName: r.sourceName,
        imageUrl: r.imageUrl,
        proposal,
        plan: proposal && prod ? planFields(proposal, prod) : [],
        applied: r.applied,
        credits: r.credits,
        error: r.error,
        updatedAt: r.updatedAt,
      };
    });
  }

  async list(tenantId: string, q: { batchId?: string; status?: ProductTagStatus; productId?: string; limit?: number } = {}): Promise<TagView[]> {
    const conds = [eq(aiProductTags.tenantId, tenantId)];
    if (q.batchId) conds.push(eq(aiProductTags.batchId, q.batchId));
    if (q.status) conds.push(eq(aiProductTags.status, q.status));
    if (q.productId) conds.push(eq(aiProductTags.productId, q.productId));
    const rows = await this.d.db.select().from(aiProductTags).where(and(...conds)).orderBy(desc(aiProductTags.updatedAt)).limit(Math.min(q.limit ?? 200, 500));
    return this.toViews(tenantId, rows);
  }

  private async row(tenantId: string, id: string) {
    const [row] = await this.d.db.select().from(aiProductTags).where(and(eq(aiProductTags.tenantId, tenantId), eq(aiProductTags.id, id))).limit(1);
    if (!row) throw notFound("Tag draft not found");
    return row;
  }

  /**
   * Approves one draft. `choices` lets the owner drop a field (`skip`), edit its values, or `replace` an attribute they had set;
   * without choices every field that does not conflict with an owner-set attribute is applied. The product is read fresh now, so
   * an edit made since the draft was written is respected, and tags are only ever added.
   */
  async approve(tenantId: string, userId: string | null, id: string, choices?: Choices): Promise<{ view: TagView; result: ApplyResult }> {
    const row = await this.row(tenantId, id);
    if (row.status !== "draft") throw new AppError(409, "conflict", "Only a draft can be approved");
    const proposal = row.proposal as TagProposal | null;
    if (!proposal) throw badRequest("This draft has no tags");
    const [product] = await this.d.ports.products(tenantId, [row.productId]);
    if (!product) throw notFound("Product not found");
    const picks: Partial<Record<TagField, ApplyChoice>> = {};
    for (const field of TAG_FIELDS) {
      const f = proposal.fields[field];
      if (!f) continue;
      const c = choices?.[field];
      if (c?.skip) continue;
      if (choices && !c) continue; // an explicit choice list only applies what it names
      picks[field] = { values: c?.values && c.values.length ? c.values : f.values, replace: c?.replace === true };
    }
    const result = applyChoices(product, picks);
    if (result.changed) await this.d.ports.update(tenantId, row.productId, { tags: result.tags, attributes: result.attributes });
    await this.mark(id, tenantId, { status: "approved", applied: { fields: result.applied, skipped: result.skipped }, reviewedBy: userId, reviewedAt: new Date() });
    const [view] = await this.toViews(tenantId, [await this.row(tenantId, id)]);
    return { view: view!, result };
  }

  async reject(tenantId: string, userId: string | null, id: string): Promise<TagView> {
    const row = await this.row(tenantId, id);
    if (row.status !== "draft" && row.status !== "failed") throw new AppError(409, "conflict", "Only a draft can be rejected");
    await this.mark(id, tenantId, { status: "rejected", reviewedBy: userId, reviewedAt: new Date() });
    const [view] = await this.toViews(tenantId, [await this.row(tenantId, id)]);
    return view!;
  }

  /** Approves every draft of a batch as proposed. Fields that would overwrite an owner-set attribute are skipped, never replaced. */
  async approveBatch(tenantId: string, userId: string | null, batchId: string): Promise<{ approved: number; skippedFields: number }> {
    const rows = await this.d.db
      .select({ id: aiProductTags.id })
      .from(aiProductTags)
      .where(and(eq(aiProductTags.tenantId, tenantId), eq(aiProductTags.batchId, batchId), eq(aiProductTags.status, "draft"), sql`${aiProductTags.proposal} is not null`));
    let approved = 0;
    let skippedFields = 0;
    for (const r of rows) {
      try {
        const { result } = await this.approve(tenantId, userId, r.id);
        approved++;
        skippedFields += result.skipped.length;
      } catch (e) {
        this.d.log?.warn({ tenantId, id: r.id, err: String(e) }, "ai: approving product tags failed");
      }
    }
    return { approved, skippedFields };
  }

  /** Counts for the "N tag drafts waiting" badge. */
  async waiting(tenantId: string): Promise<number> {
    const rows = await this.d.db.select({ id: aiProductTags.id }).from(aiProductTags).where(and(eq(aiProductTags.tenantId, tenantId), inArray(aiProductTags.status, ["draft", "queued"])));
    return rows.length;
  }
}
