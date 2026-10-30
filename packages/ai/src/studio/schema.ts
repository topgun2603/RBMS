import { pk, tenantId, timestamps } from "@rbms/db";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const STUDIO_STATUSES = ["planned", "applied", "undone", "cancelled", "failed", "rejected"] as const;
export type StudioStatus = (typeof STUDIO_STATUSES)[number];

/**
 * One row per Studio request. `request_text` is masked (phones, e-mails) and clipped. `ops` are the checked operations
 * (with a before / after snapshot of the areas each one touched once applied); `areas` holds, per changed area of the
 * shop, what it held before and after the change plus the hash of the read-back "after", which undo compares with the
 * shop's current content before restoring anything.
 */
export const studioChanges = pgTable(
  "studio_changes",
  {
    id: pk(),
    tenantId: tenantId(),
    userId: text("user_id").notNull(),
    requestText: text("request_text").notNull(),
    language: text("language").notNull().default("en"),
    summary: text("summary").notNull().default(""),
    classification: text("classification").$type<"full" | "partial" | "none">().notNull(),
    status: text("status").$type<StudioStatus>().notNull().default("planned"),
    ops: jsonb("ops").$type<unknown[]>().notNull().default([]),
    unsupported: jsonb("unsupported").$type<unknown[]>().notNull().default([]),
    preview: jsonb("preview").$type<Record<string, unknown>>().notNull().default({}),
    /** Hash of each changed area when the plan was checked. */
    base: jsonb("base").$type<Record<string, string>>().notNull().default({}),
    /** Applied: { area: { before, after, afterHash } } in write order. */
    areas: jsonb("areas").$type<Record<string, unknown>>().notNull().default({}),
    highRisk: boolean("high_risk").notNull().default(false),
    runId: text("run_id"),
    credits: integer("credits").notNull().default(0),
    error: text("error"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    appliedBy: text("applied_by"),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: text("undone_by"),
    ...timestamps(),
  },
  (t) => [index("studio_changes_tenant_created_idx").on(t.tenantId, t.createdAt)],
);
export type StudioChangeRow = typeof studioChanges.$inferSelect;

/**
 * Things owners asked for that Studio cannot do yet (like docs/layout-requests.md, but in the database): the super-admin
 * reads them in the admin console, counted by theme.
 */
export const studioFeatureRequests = pgTable(
  "studio_feature_requests",
  {
    id: pk(),
    tenantId: tenantId(),
    changeId: uuid("change_id"),
    trade: text("trade").notNull().default(""),
    requestText: text("request_text").notNull(),
    language: text("language").notNull().default("en"),
    /** What the platform is missing, in a sentence. */
    missing: text("missing").notNull(),
    theme: text("theme").notNull().default("other"),
    ...timestamps(),
  },
  (t) => [index("studio_feature_requests_theme_idx").on(t.theme, t.createdAt), index("studio_feature_requests_tenant_idx").on(t.tenantId, t.createdAt)],
);
export type StudioFeatureRequestRow = typeof studioFeatureRequests.$inferSelect;
