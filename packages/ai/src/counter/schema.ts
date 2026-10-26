import { pk, tenantId, timestamps } from "@srirealtime/db";
import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * AI Phase 5 part A, the counter helpers (docs/ai.md "Phase 5 part A"). Re-exported from `../schema.ts` so migrations pick the
 * tables up. No bill text or customer data is kept here.
 */

/** An unusual-activity alert the owner or manager marked as looked at. Alerts themselves are worked out on demand from the bills. */
export const aiActivityReviews = pgTable(
  "ai_activity_reviews",
  {
    id: pk(),
    tenantId: tenantId(),
    /** The alert's stable key ("voids:<staff>:<date>"). */
    alertKey: text("alert_key").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedByName: text("reviewed_by_name"),
    note: text("note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ai_activity_reviews_uq").on(t.tenantId, t.alertKey)],
);
export type AiActivityReviewRow = typeof aiActivityReviews.$inferSelect;

/** Counter events the bills do not record themselves: the drawer opened with no sale. Sent by the POS, one row per press. */
export const aiCounterEvents = pgTable(
  "ai_counter_events",
  {
    id: pk(),
    tenantId: tenantId(),
    kind: text("kind").$type<"no_sale">().notNull(),
    userId: text("user_id"),
    userName: text("user_name"),
    /** The till session the press happened in (its opener is who the alert names). */
    tillSessionId: text("till_session_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_counter_events_tenant_at_idx").on(t.tenantId, t.at)],
);
export type AiCounterEventRow = typeof aiCounterEvents.$inferSelect;

/** One weekly coaching note for one person in one language. Kept so the owner can read, copy and share it again. */
export const aiStaffCoaching = pgTable(
  "ai_staff_coaching",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Monday of the week the note is about (IST). */
    weekStart: date("week_start").notNull(),
    staffKey: text("staff_key").notNull(),
    staffName: text("staff_name").notNull(),
    lang: text("lang").$type<"en" | "ta">().notNull(),
    notes: jsonb("notes").$type<string[]>().notNull(),
    /** The numbers the notes came from (counted in code). */
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
    source: text("source").$type<"ai" | "template">().notNull(),
    fallbackReason: text("fallback_reason"),
    runId: text("run_id"),
    credits: integer("credits").notNull().default(0),
    createdBy: text("created_by"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("ai_staff_coaching_uq").on(t.tenantId, t.weekStart, t.staffKey, t.lang)],
);
export type AiStaffCoachingRow = typeof aiStaffCoaching.$inferSelect;
