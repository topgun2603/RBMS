import { AppError, badRequest, notFound } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { costMicroUsd, creditsForCost } from "../pricing";
import { aiProductTranslations, type AiProductTranslationRow, type TranslationStatus } from "../schema";
import type { AiService } from "../service";
import { translateProduct, TRANSLATE_SYSTEM } from "./describe";

/** The job that drafts the translations of one batch (run by the job queue; defined in the API kit). */
export const TRANSLATE_JOB = "ai.translate-batch";
export const MAX_BATCH = 100;

export interface TranslateSource {
  id: string;
  name: string;
  description: string | null;
}

export interface TranslationDeps {
  db: Db;
  ai: AiService;
  /** Reads products of one shop (name + description). */
  products: { get(tenantId: string, ids: string[]): Promise<TranslateSource[]> };
  /** Puts the batch on the job queue; omit to draft inline (tests, memory queue). */
  enqueue?: (payload: TranslateJobPayload) => Promise<void>;
  log?: { warn(o: object, m?: string): void };
}

export interface TranslateJobPayload {
  tenantId: string;
  userId: string | null;
  batchId: string;
}

export interface BatchEstimate {
  count: number;
  /** Rough credits for the whole batch (a draft costs about this much; the real charge is the actual usage). */
  credits: number;
  perProduct: number;
  remaining: number | null;
  enough: boolean;
}

export interface TranslationView {
  id: string;
  productId: string;
  batchId: string;
  status: TranslationStatus;
  sourceName: string;
  sourceDescription: string | null;
  name: string | null;
  description: string | null;
  removed: { sentence: string; kinds: string[]; reason: string }[];
  credits: number;
  error: string | null;
  updatedAt: Date;
}

const view = (r: AiProductTranslationRow): TranslationView => ({
  id: r.id,
  productId: r.productId,
  batchId: r.batchId,
  status: r.status,
  sourceName: r.sourceName,
  sourceDescription: r.sourceDescription,
  name: r.name,
  description: r.description,
  removed: r.removed ?? [],
  credits: r.credits,
  error: r.error,
  updatedAt: r.updatedAt,
});

/** Tamil takes about 3 tokens per 2 characters of source in the reply; thinking is low. */
export function estimateOne(model: string, p: { name: string; description: string | null }): number {
  const inChars = TRANSLATE_SYSTEM.length + p.name.length + (p.description ?? "").length + 120;
  const inputTokens = Math.ceil(inChars / 3.5);
  const outputTokens = 250 + Math.ceil((p.name.length + (p.description ?? "").length) * 1.6);
  return creditsForCost(costMicroUsd(model, { inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 }));
}

/** "Translate catalogue to Tamil": draft in the background, the owner approves each product. */
export class TranslationService {
  constructor(private readonly deps: TranslationDeps) {}

  async estimate(tenantId: string, productIds: string[]): Promise<BatchEstimate> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) throw badRequest("Select at least one product");
    if (ids.length > MAX_BATCH) throw badRequest(`Select at most ${MAX_BATCH} products at a time`);
    const products = await this.deps.products.get(tenantId, ids);
    const model = this.deps.ai.config.models.standard;
    const credits = products.reduce((n, p) => n + estimateOne(model, p), 0);
    const remaining = (await this.deps.ai.balance(tenantId)).remaining;
    return {
      count: products.length,
      credits,
      perProduct: products.length ? Math.ceil(credits / products.length) : 0,
      remaining,
      enough: remaining === null || remaining >= credits,
    };
  }

  /** Queues the drafts. Refuses when the estimate is more than the credits left, so a batch is never half-paid. */
  async start(tenantId: string, userId: string | null, productIds: string[]) {
    const est = await this.estimate(tenantId, productIds);
    if (est.count === 0) throw notFound("Products not found");
    if (!est.enough)
      throw new AppError(402, "ai_credits_exhausted", "You do not have enough AI credits for this batch. Choose fewer products or add a credit pack.", { needed: est.credits, remaining: est.remaining });
    const products = await this.deps.products.get(tenantId, [...new Set(productIds)]);
    const batchId = randomUUID();
    for (const p of products) {
      await this.deps.db
        .insert(aiProductTranslations)
        .values({ tenantId, productId: p.id, locale: "ta", batchId, status: "queued", sourceName: p.name, sourceDescription: p.description, createdBy: userId })
        .onConflictDoUpdate({
          target: [aiProductTranslations.tenantId, aiProductTranslations.productId, aiProductTranslations.locale],
          set: { batchId, status: "queued", sourceName: p.name, sourceDescription: p.description, name: null, description: null, removed: null, error: null, credits: 0, runId: null, createdBy: userId, reviewedBy: null, reviewedAt: null, updatedAt: new Date() },
        });
    }
    const payload: TranslateJobPayload = { tenantId, userId, batchId };
    if (this.deps.enqueue) await this.deps.enqueue(payload);
    else await this.process(payload);
    return { batchId, count: products.length, estimate: est };
  }

  /** The job body: drafts every queued row of the batch. A failing product is marked failed and the rest go on; a credit stop ends the batch. */
  async process(p: TranslateJobPayload): Promise<{ drafted: number; failed: number }> {
    const rows = await this.deps.db
      .select()
      .from(aiProductTranslations)
      .where(and(eq(aiProductTranslations.tenantId, p.tenantId), eq(aiProductTranslations.batchId, p.batchId), eq(aiProductTranslations.status, "queued")));
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
        const r = await translateProduct(this.deps.ai, { tenantId: p.tenantId, userId: p.userId, name: row.sourceName, description: row.sourceDescription });
        await this.mark(row.id, p.tenantId, { status: "draft", name: r.draft.name_ta, description: r.draft.description_ta || null, removed: r.removed, runId: r.runId, credits: r.credits, error: null });
        drafted++;
      } catch (e) {
        const code = e instanceof AppError ? e.code : "ai_failed";
        // Switched off / out of credits: no point trying the rest.
        if (["ai_off", "ai_feature_off", "ai_credits_exhausted", "ai_disabled", "ai_unavailable", "ai_not_available"].includes(code)) stop = code;
        await this.mark(row.id, p.tenantId, { status: "failed", error: code });
        failed++;
        this.deps.log?.warn({ tenantId: p.tenantId, productId: row.productId, code }, "ai: translation draft failed");
      }
    }
    return { drafted, failed };
  }

  private async mark(id: string, tenantId: string, set: Partial<typeof aiProductTranslations.$inferInsert>) {
    await this.deps.db.update(aiProductTranslations).set({ ...set, updatedAt: new Date() }).where(and(eq(aiProductTranslations.id, id), eq(aiProductTranslations.tenantId, tenantId)));
  }

  async list(tenantId: string, q: { batchId?: string; status?: TranslationStatus; limit?: number } = {}): Promise<TranslationView[]> {
    const conds = [eq(aiProductTranslations.tenantId, tenantId)];
    if (q.batchId) conds.push(eq(aiProductTranslations.batchId, q.batchId));
    if (q.status) conds.push(eq(aiProductTranslations.status, q.status));
    const rows = await this.deps.db.select().from(aiProductTranslations).where(and(...conds)).orderBy(desc(aiProductTranslations.updatedAt)).limit(Math.min(q.limit ?? 200, 500));
    return rows.map(view);
  }

  private async get(tenantId: string, id: string) {
    const [row] = await this.deps.db.select().from(aiProductTranslations).where(and(eq(aiProductTranslations.tenantId, tenantId), eq(aiProductTranslations.id, id))).limit(1);
    if (!row) throw notFound("Translation not found");
    return row;
  }

  /** Approves one draft, optionally with the owner's edits. Only a draft can be approved. */
  async approve(tenantId: string, userId: string | null, id: string, edits: { name?: string; description?: string | null } = {}): Promise<TranslationView> {
    const row = await this.get(tenantId, id);
    if (row.status !== "draft") throw new AppError(409, "conflict", "Only a draft can be approved");
    const name = (edits.name ?? row.name ?? "").trim();
    if (!name) throw badRequest("The Tamil name cannot be empty");
    await this.mark(id, tenantId, { status: "approved", name, description: edits.description === undefined ? row.description : edits.description, reviewedBy: userId, reviewedAt: new Date() });
    return view(await this.get(tenantId, id));
  }

  async reject(tenantId: string, userId: string | null, id: string): Promise<TranslationView> {
    const row = await this.get(tenantId, id);
    if (row.status !== "draft" && row.status !== "failed") throw new AppError(409, "conflict", "Only a draft can be rejected");
    await this.mark(id, tenantId, { status: "rejected", reviewedBy: userId, reviewedAt: new Date() });
    return view(await this.get(tenantId, id));
  }

  /** The owner's own Tamil text for one product (for example from "Write description"): saved as approved straight away. */
  async saveApproved(tenantId: string, userId: string | null, productId: string, text: { name?: string | null; description?: string | null }): Promise<TranslationView> {
    const [p] = await this.deps.products.get(tenantId, [productId]);
    if (!p) throw notFound("Product not found");
    const name = text.name?.trim() || null;
    const description = text.description?.trim() || null;
    if (!name && !description) throw badRequest("Give the Tamil name or description");
    const now = new Date();
    const values = { tenantId, productId, locale: "ta", batchId: randomUUID(), status: "approved" as const, sourceName: p.name, sourceDescription: p.description, name, description, removed: null, error: null, credits: 0, runId: null, createdBy: userId, reviewedBy: userId, reviewedAt: now };
    const [row] = await this.deps.db
      .insert(aiProductTranslations)
      .values(values)
      .onConflictDoUpdate({ target: [aiProductTranslations.tenantId, aiProductTranslations.productId, aiProductTranslations.locale], set: { ...values, updatedAt: now } })
      .returning();
    return view(row!);
  }

  /** Approves every draft of a batch as written. */
  async approveBatch(tenantId: string, userId: string | null, batchId: string): Promise<{ approved: number }> {
    const res = await this.deps.db
      .update(aiProductTranslations)
      .set({ status: "approved", reviewedBy: userId, reviewedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(aiProductTranslations.tenantId, tenantId), eq(aiProductTranslations.batchId, batchId), eq(aiProductTranslations.status, "draft"), sql`${aiProductTranslations.name} is not null`))
      .returning({ id: aiProductTranslations.id });
    return { approved: res.length };
  }

  /** Approved Tamil text for products (what a storefront or the product editor may show). */
  async approvedFor(tenantId: string, productIds: string[], locale = "ta"): Promise<Record<string, { name: string; description: string | null; sourceName: string }>> {
    if (productIds.length === 0) return {};
    const rows = await this.deps.db
      .select()
      .from(aiProductTranslations)
      .where(and(eq(aiProductTranslations.tenantId, tenantId), eq(aiProductTranslations.locale, locale), eq(aiProductTranslations.status, "approved"), inArray(aiProductTranslations.productId, productIds)));
    return Object.fromEntries(rows.map((r) => [r.productId, { name: r.name ?? "", description: r.description, sourceName: r.sourceName }]));
  }
}
