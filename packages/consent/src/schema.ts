import { pk, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export type ConsentSource = "web" | "android" | "ios" | "admin";
export type DataRequestType = "export" | "delete";
export type DataRequestStatus = "pending" | "processing" | "completed" | "cancelled" | "failed";

/**
 * Append-only log of consent decisions. Rows are never updated or deleted, except that erasing a user
 * clears user_id / anonymous_id / ip / user_agent while keeping the decision itself as a legal record.
 */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: pk(),
    userId: uuid("user_id"),
    /** Device/browser id for consent given before sign-up (e.g. cookie banner). */
    anonymousId: text("anonymous_id"),
    /** Null for platform-wide consent (terms, privacy); set for tenant-specific purposes. */
    tenantId: uuid("tenant_id"),
    /** e.g. "terms", "privacy", "marketing_sms", "marketing_whatsapp", "analytics". */
    purpose: text("purpose").notNull(),
    /** Version of the notice/policy the user saw. */
    version: text("version").notNull(),
    granted: boolean("granted").notNull(),
    source: text("source").$type<ConsentSource>().notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consent_records_user_idx").on(t.userId, t.createdAt), index("consent_records_anon_idx").on(t.anonymousId)],
);

export const dataRequests = pgTable(
  "data_requests",
  {
    id: pk(),
    userId: uuid("user_id").notNull(),
    tenantId: uuid("tenant_id"),
    type: text("type").$type<DataRequestType>().notNull(),
    status: text("status").$type<DataRequestStatus>().notNull().default("pending"),
    /** Delete: now + grace period. Export: now. */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull().defaultNow(),
    /** Export payload; cleared after the retention period. */
    result: jsonb("result"),
    error: text("error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    index("data_requests_user_idx").on(t.userId),
    index("data_requests_due_idx").on(t.type, t.status, t.scheduledFor),
    // At most one open request of each type per user.
    uniqueIndex("data_requests_one_open")
      .on(t.userId, t.type)
      .where(sql`status in ('pending', 'processing')`),
  ],
);

export type ConsentRecordRow = typeof consentRecords.$inferSelect;
export type DataRequestRow = typeof dataRequests.$inferSelect;
