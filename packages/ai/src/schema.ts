import { pk, tenantId, timestamps } from "@srirealtime/db";
import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { SummaryFacts } from "./insights/summary";
import type { AiFeedback, AiRunStatus, AiTier, ProviderKind } from "./types";

/**
 * One row per AI call. Metadata only: who, which helper, which model, tokens, cost, credits, outcome. The text of the
 * prompt and the reply is NOT stored, except in `debug` when the shop switched "store prompts for debugging" on
 * (kept 7 days, then cleared). This table is also the credit ledger: the sum of `credits` per `period` is what the shop spent.
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: pk(),
    tenantId: tenantId(),
    userId: text("user_id"),
    feature: text("feature").notNull(),
    tier: text("tier").$type<AiTier>().notNull(),
    model: text("model").notNull(),
    provider: text("provider").$type<ProviderKind>().notNull(),
    status: text("status").$type<AiRunStatus>().notNull(),
    /** Machine code of the failure or block (`ai_credits_exhausted`, `ai_refused`...). */
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** Model cost in micro-USD (1,000,000 = $1). */
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    /** Credits taken from the shop (1 credit = $0.001 of model cost). */
    credits: integer("credits").notNull().default(0),
    /** Model calls in the run (more than 1 when tools were used). */
    steps: integer("steps").notNull().default(1),
    latencyMs: integer("latency_ms").notNull().default(0),
    /** IST month the credits belong to, "2026-10". */
    period: text("period").notNull(),
    /** accepted | edited | rejected: what the person did with the draft. */
    feedback: text("feedback").$type<AiFeedback>(),
    feedbackNote: text("feedback_note"),
    feedbackAt: timestamp("feedback_at", { withTimezone: true }),
    /** Only when the shop switched on "store prompts for debugging". Cleared after 7 days. */
    debug: jsonb("debug").$type<{ input: string; output: string }>(),
    ...timestamps(),
  },
  (t) => [index("ai_runs_tenant_created_idx").on(t.tenantId, t.createdAt), index("ai_runs_tenant_period_idx").on(t.tenantId, t.period, t.feature)],
);

export type AiRunRow = typeof aiRuns.$inferSelect;

/** Statuses of an AI draft translation (bulk "translate catalogue to Tamil"): the owner approves each one. */
export const TRANSLATION_STATUSES = ["queued", "draft", "failed", "approved", "rejected"] as const;
export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

/**
 * Product text in another language. A bulk run writes `draft` rows; the owner reviews them and approves each one
 * (`approved` is what a storefront may show). The catalogue has no translation columns of its own, so this is where
 * `translations.ta` for products lives. One row per (shop, product, locale).
 */
export const aiProductTranslations = pgTable(
  "ai_product_translations",
  {
    id: pk(),
    tenantId: tenantId(),
    productId: uuid("product_id").notNull(),
    locale: text("locale").notNull().default("ta"),
    /** The bulk run this row belongs to. */
    batchId: uuid("batch_id").notNull(),
    status: text("status").$type<TranslationStatus>().notNull().default("queued"),
    /** The English text it was made from (so a later edit of the product shows the draft is stale). */
    sourceName: text("source_name").notNull(),
    sourceDescription: text("source_description"),
    name: text("name"),
    description: text("description"),
    /** Sentences the claims filter removed, shown in the review list. */
    removed: jsonb("removed").$type<{ sentence: string; kinds: string[]; reason: string }[]>(),
    runId: uuid("run_id"),
    credits: integer("credits").notNull().default(0),
    error: text("error"),
    createdBy: text("created_by"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("ai_product_translations_uq").on(t.tenantId, t.productId, t.locale),
    index("ai_product_translations_batch_idx").on(t.tenantId, t.batchId),
  ],
);
export type AiProductTranslationRow = typeof aiProductTranslations.$inferSelect;

// ------------------------------------------------------------------ Phase 2 part B: daily summary

export const SUMMARY_STATUSES = ["running", "ready", "failed"] as const;
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

/** What happened to a summary after it was written (kept for the owner's "Sent to" line). Phones are masked. */
export interface SummaryDelivery {
  inApp: boolean;
  whatsapp: { to: string; status: string }[];
  email: { to: string; status: string }[];
  /** Why a channel was not used ("whatsapp_not_configured", "no_phone"...). */
  skipped: string[];
}

/**
 * One row per shop and IST day: the daily summary shown on the dashboard card and sent to WhatsApp / email. The unique key
 * (tenant, date) is what makes the scheduled job idempotent: whoever inserts the row first runs the day.
 */
export const aiDailySummaries = pgTable(
  "ai_daily_summaries",
  {
    id: pk(),
    tenantId: tenantId(),
    /** The IST business date summarised. */
    date: date("date", { mode: "string" }).notNull(),
    status: text("status").$type<SummaryStatus>().notNull().default("running"),
    attempts: integer("attempts").notNull().default(1),
    /** "schedule" (the job) or "manual" (Send now). */
    trigger: text("trigger").notNull().default("schedule"),
    language: text("language").notNull().default("en"),
    /** "ai" or "template". */
    source: text("source"),
    fallbackReason: text("fallback_reason"),
    facts: jsonb("facts").$type<SummaryFacts>(),
    narrative: text("narrative"),
    actions: jsonb("actions").$type<string[]>(),
    runId: uuid("run_id"),
    credits: integer("credits").notNull().default(0),
    delivery: jsonb("delivery").$type<SummaryDelivery>(),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("ai_daily_summaries_tenant_date_uq").on(t.tenantId, t.date), index("ai_daily_summaries_tenant_idx").on(t.tenantId, t.createdAt)],
);
export type AiDailySummaryRow = typeof aiDailySummaries.$inferSelect;

// ------------------------------------------------------------------ Phase 3 part B: catalogue from photos, product photo tags

export const PHOTO_BATCH_STATUSES = ["queued", "running", "done", "failed"] as const;
export type PhotoBatchStatus = (typeof PHOTO_BATCH_STATUSES)[number];

/**
 * "Add products from photos": one row per upload of up to 20 photos. The photos themselves are NOT stored (they travel in the
 * job payload and are dropped when the job ends); this row holds progress and the checked product drafts for the review grid.
 * Nothing is created in the catalogue until the owner confirms in the grid.
 */
export const aiPhotoBatches = pgTable(
  "ai_photo_batches",
  {
    id: pk(),
    tenantId: tenantId(),
    kind: text("kind").notNull().default("catalogue-photos"),
    status: text("status").$type<PhotoBatchStatus>().notNull().default("queued"),
    total: integer("total").notNull().default(0),
    done: integer("done").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    credits: integer("credits").notNull().default(0),
    /** Checked drafts (`ProductDraft[]`, see trades/catalogue/photos.ts). */
    drafts: jsonb("drafts").$type<unknown[]>().notNull().default([]),
    /** Per photo problems: `{ photo, code }`. */
    problems: jsonb("problems").$type<{ photo: number; code: string }[]>().notNull().default([]),
    error: text("error"),
    createdBy: text("created_by"),
    ...timestamps(),
  },
  (t) => [index("ai_photo_batches_tenant_idx").on(t.tenantId, t.createdAt)],
);
export type AiPhotoBatchRow = typeof aiPhotoBatches.$inferSelect;

export const PRODUCT_TAG_STATUSES = ["queued", "draft", "failed", "approved", "rejected"] as const;
export type ProductTagStatus = (typeof PRODUCT_TAG_STATUSES)[number];

/**
 * AI draft tags for a product photo (colour, fabric, pattern, occasion, work, sleeve, neck). A bulk run writes `draft` rows;
 * the owner approves each product (or all non-conflicting drafts of a batch). Approving writes tags and attributes to the
 * product through the catalogue (which refreshes search); `applied` records exactly what was written. One row per (shop, product).
 */
export const aiProductTags = pgTable(
  "ai_product_tags",
  {
    id: pk(),
    tenantId: tenantId(),
    productId: uuid("product_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    status: text("status").$type<ProductTagStatus>().notNull().default("queued"),
    /** The product name and image the draft was made from. */
    sourceName: text("source_name").notNull(),
    imageUrl: text("image_url"),
    /** `TagProposal` (see trades/textiles/tags.ts). */
    proposal: jsonb("proposal").$type<Record<string, unknown>>(),
    /** What approval wrote: `{ tags: string[], attributes: Record<string,string> }`. */
    applied: jsonb("applied").$type<Record<string, unknown>>(),
    runId: uuid("run_id"),
    credits: integer("credits").notNull().default(0),
    error: text("error"),
    createdBy: text("created_by"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("ai_product_tags_uq").on(t.tenantId, t.productId), index("ai_product_tags_batch_idx").on(t.tenantId, t.batchId)],
);
export type AiProductTagRow = typeof aiProductTags.$inferSelect;
