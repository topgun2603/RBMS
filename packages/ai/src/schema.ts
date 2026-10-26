import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { SummaryFacts } from "./insights/summary";
import type { AiFeedback, AiRunStatus, AiTier, RunProvider } from "./types";

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
    provider: text("provider").$type<RunProvider>().notNull(),
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

// ------------------------------------------------------------------ Phase 4 part B: store features (docs/ai.md "Phase 4 part B")

/** Where a product's search words came from: written by the AI, or edited/typed by the owner (never overwritten by a re-run). */
export const ALIAS_SOURCES = ["ai", "owner"] as const;
export type AliasSource = (typeof ALIAS_SOURCES)[number];

/**
 * Search words for a product: Tamil-script names, Tanglish spellings, synonyms and common misspellings. Made once by the light
 * tier when a product is saved (or by the bulk backfill), so a shopper's search costs nothing. `alias_text` is the normalised
 * joined text the catalogue search matches (lower weight than the real name). One row per (shop, product).
 */
export const aiProductAliases = pgTable(
  "ai_product_aliases",
  {
    id: pk(),
    tenantId: tenantId(),
    productId: uuid("product_id").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    /** Lowercased, space-joined `aliases` (what the search reads). */
    aliasText: text("alias_text").notNull().default(""),
    source: text("source").$type<AliasSource>().notNull().default("ai"),
    /** The product name the aliases were made from (a rename shows they may be stale). */
    sourceName: text("source_name").notNull().default(""),
    runId: uuid("run_id"),
    credits: integer("credits").notNull().default(0),
    error: text("error"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("ai_product_aliases_uq").on(t.tenantId, t.productId),
    index("ai_product_aliases_text_trgm_idx").using("gin", sql`${t.aliasText} gin_trgm_ops`),
  ],
);
export type AiProductAliasRow = typeof aiProductAliases.$inferSelect;

/**
 * "Often bought together": for each product A, the products B that appear in the same basket (a bill or a store order) more than
 * chance would explain. Directed rows (A -> B) with the counts and the three standard measures, recomputed daily per shop from
 * the last 180 days (no AI). Only the strongest partners per product are kept.
 */
export const aiItemPairs = pgTable(
  "ai_item_pairs",
  {
    tenantId: tenantId(),
    productId: uuid("product_id").notNull(),
    withProductId: uuid("with_product_id").notNull(),
    /** Baskets holding both. */
    together: integer("together").notNull(),
    /** Baskets holding A. */
    countA: integer("count_a").notNull(),
    countB: integer("count_b").notNull(),
    baskets: integer("baskets").notNull(),
    support: real("support").notNull(),
    confidence: real("confidence").notNull(),
    lift: real("lift").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.productId, t.withProductId] }), index("ai_item_pairs_tenant_a_idx").on(t.tenantId, t.productId, t.lift)],
);
export type AiItemPairRow = typeof aiItemPairs.$inferSelect;

// ---------------------------------------------------------------- Phase 4 part C: photo cleanup and try-on (docs/ai.md)

export const CLEANUP_STATUSES = ["queued", "running", "ready", "check", "failed", "applied", "discarded"] as const;
export type CleanupStatus = (typeof CLEANUP_STATUSES)[number];

/**
 * One cleaned-up product photo. The ORIGINAL url is never changed or deleted: `ready` / `check` rows hold the cleaned copy as
 * a proposal, "apply" swaps it into the product's image list and `applied` keeps the original url so "use the original again"
 * puts it back. `check` = the mask looked doubtful ("needs a manual check"); the owner still decides. One row per run, grouped by `batchId`.
 */
export const aiImageCleanups = pgTable(
  "ai_image_cleanups",
  {
    id: pk(),
    tenantId: tenantId(),
    batchId: uuid("batch_id").notNull(),
    productId: uuid("product_id").notNull(),
    originalUrl: text("original_url").notNull(),
    cleanedUrl: text("cleaned_url"),
    /** Transparent cut-out (PNG), kept when asked for (try-on image). */
    cutoutUrl: text("cutout_url"),
    style: text("style").notNull().default("white"),
    color: text("color"),
    status: text("status").$type<CleanupStatus>().notNull().default("queued"),
    /** Why a result needs a check: `MaskReason[]`. */
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    /** `{ fgRatio, confidence, edgeTouch }` of the mask. */
    stats: jsonb("stats").$type<Record<string, number>>(),
    model: text("model"),
    credits: integer("credits").notNull().default(0),
    ms: integer("ms"),
    error: text("error"),
    createdBy: text("created_by"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("ai_image_cleanups_batch_idx").on(t.tenantId, t.batchId), index("ai_image_cleanups_product_idx").on(t.tenantId, t.productId, t.createdAt)],
);
export type AiImageCleanupRow = typeof aiImageCleanups.$inferSelect;

/** Try-on setup of a product: the transparent front-view image and the alignment anchors (validated in imaging/tryon.ts). One per product. */
export const aiTryons = pgTable(
  "ai_tryons",
  {
    id: pk(),
    tenantId: tenantId(),
    productId: uuid("product_id").notNull(),
    /** glasses | earrings | nosepin | necklace */
    kind: text("kind").notNull(),
    imageUrl: text("image_url").notNull(),
    /** `TryonAnchors`: points in 0..1 of the image (eye line, hook point, ...) and the real-world width in mm. */
    anchors: jsonb("anchors").$type<Record<string, unknown>>().notNull(),
    updatedBy: text("updated_by"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("ai_tryons_product_uq").on(t.tenantId, t.productId)],
);
export type AiTryonRow = typeof aiTryons.$inferSelect;

// Studio assistant tables (Phase 4 part A): change sets and feature requests.
export * from "./studio/schema";

// Money tables (Phase 5 part B): packs for a lender.
export * from "./money/schema";

// Counter helpers (Phase 5 part A): activity-alert reviews, no-sale events, weekly coaching notes.
export * from "./counter/schema";

// Platform tools (Phase 7 part B): RBMS support tickets, shop follow-ups (churn signals), What's new notes.
export * from "./platform/schema";
