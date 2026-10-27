import { pk, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

// ---------------------------------------------------------------- DPDP: notices, rights requests, retention, breaches
// (docs/privacy-dpdp.md). The shop is the data fiduciary for its customers; the platform is the processor.

export interface NoticeTextRow {
  title: string;
  intro: string;
  sections: Array<{ id: string; heading: string; paragraphs: string[]; items?: string[] }>;
  reviewNote: string;
}
/** One generated notice text of a shop, in both languages. */
export interface StoredNotice {
  en: NoticeTextRow;
  ta: NoticeTextRow;
}

const NIL_UUID = sql`'00000000-0000-0000-0000-000000000000'::uuid`;

/**
 * Versioned privacy notice. The text is generated from the shop's settings and enabled modules; when the generated text
 * changes a new version is stored, and the consent log records which version the person accepted (consent_records.version).
 * `tenant_id` null = the platform's own notice for shop owners.
 */
export const privacyNotices = pgTable(
  "privacy_notices",
  {
    id: pk(),
    tenantId: uuid("tenant_id"),
    /** 1, 2, 3 ... per shop (per platform when tenant_id is null). */
    version: integer("version").notNull(),
    contentHash: text("content_hash").notNull(),
    content: jsonb("content").$type<StoredNotice>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("privacy_notices_version_uq").on(sql`coalesce(${t.tenantId}, ${NIL_UUID})`, t.version),
    index("privacy_notices_tenant_idx").on(t.tenantId, t.version),
  ],
);

export const PRIVACY_REQUEST_TYPES = ["access", "correction", "erasure", "withdraw_consent", "nominate"] as const;
export type PrivacyRequestType = (typeof PRIVACY_REQUEST_TYPES)[number];
export const PRIVACY_REQUEST_STATUSES = ["open", "in_progress", "completed", "rejected", "cancelled"] as const;
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];
export type PrivacyRequestSource = "store" | "counter";

export interface Nominee {
  name: string;
  phone?: string | null;
  relation?: string | null;
}

/** A customer's request to a shop about their personal data (access, correction, erasure, withdraw consent, nominate). */
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    type: text("type").$type<PrivacyRequestType>().notNull(),
    status: text("status").$type<PrivacyRequestStatus>().notNull().default("open"),
    source: text("source").$type<PrivacyRequestSource>().notNull(),
    /** The signed-in shopper, when the request came from the store account page. */
    subjectUserId: uuid("subject_user_id"),
    subjectName: text("subject_name"),
    subjectPhone: text("subject_phone"),
    subjectEmail: text("subject_email"),
    /** What the person asked for, in their words (correction: what is wrong). */
    details: text("details"),
    nominee: jsonb("nominee").$type<Nominee | null>(),
    /** Consent purposes named by a withdrawal. */
    purposes: text("purposes").array(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    handledBy: uuid("handled_by"),
    resolution: text("resolution"),
    /** Access: the data bundle. Erasure: what was anonymised and what was kept (and why). */
    result: jsonb("result"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    index("privacy_requests_tenant_status_idx").on(t.tenantId, t.status, t.dueAt),
    index("privacy_requests_subject_idx").on(t.tenantId, t.subjectUserId),
  ],
);

/** Audit trail of one rights request: who did what and when. Rows are never updated. */
export const privacyRequestEvents = pgTable(
  "privacy_request_events",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id"),
    /** created, status, note, located, exported, erased, consent_withdrawn, cancelled. */
    action: text("action").notNull(),
    note: text("note"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("privacy_request_events_request_idx").on(t.requestId, t.createdAt)],
);

/** One run (or dry-run preview) of one retention category. */
export const privacyRetentionRuns = pgTable(
  "privacy_retention_runs",
  {
    id: pk(),
    /** Null for platform-wide categories. */
    tenantId: uuid("tenant_id"),
    category: text("category").notNull(),
    dryRun: boolean("dry_run").notNull(),
    cutoff: timestamp("cutoff", { withTimezone: true }).notNull(),
    days: integer("days").notNull(),
    affected: integer("affected").notNull().default(0),
    status: text("status").$type<"ok" | "failed">().notNull().default("ok"),
    error: text("error"),
    trigger: text("trigger").$type<"job" | "manual">().notNull().default("job"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("privacy_retention_runs_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const BREACH_STATUSES = ["open", "contained", "reported", "closed"] as const;
export type BreachStatus = (typeof BREACH_STATUSES)[number];
export const BREACH_SEVERITIES = ["low", "medium", "high"] as const;
export type BreachSeverity = (typeof BREACH_SEVERITIES)[number];

/**
 * Personal data breach register (DPDP Act s.8(6), Rules 2025 r.7): what happened, who is affected, the report to the Data
 * Protection Board (a first intimation without delay and the detailed report within 72 hours) and telling the people.
 * `tenant_id` null = an incident of the platform itself. Nothing is sent automatically.
 */
export const breachIncidents = pgTable(
  "breach_incidents",
  {
    id: pk(),
    tenantId: uuid("tenant_id"),
    /** "BR-0001", per shop (per platform). */
    reference: text("reference").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    severity: text("severity").$type<BreachSeverity>().notNull().default("medium"),
    status: text("status").$type<BreachStatus>().notNull().default("open"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    discoveredAt: timestamp("discovered_at", { withTimezone: true }).notNull(),
    /** discovered_at + 72 hours: the detailed report to the Board. */
    boardDeadlineAt: timestamp("board_deadline_at", { withTimezone: true }).notNull(),
    /** Kinds of data involved: phone, email, address, purchases, health, id_documents, payment, staff, other. */
    dataTypes: text("data_types").array().notNull().default(sql`'{}'::text[]`),
    /** Null = not known yet. */
    peopleAffected: integer("people_affected"),
    containment: text("containment").notNull().default(""),
    cause: text("cause").notNull().default(""),
    boardIntimatedAt: timestamp("board_intimated_at", { withTimezone: true }),
    boardReportedAt: timestamp("board_reported_at", { withTimezone: true }),
    /** The acknowledgement number the Board's portal gave. */
    boardReference: text("board_reference"),
    peopleNotifiedAt: timestamp("people_notified_at", { withTimezone: true }),
    peopleNotifiedNote: text("people_notified_note"),
    /** Checklist key -> when it was ticked. */
    checklist: jsonb("checklist").$type<Record<string, string>>().notNull().default({}),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("breach_incidents_ref_uq").on(sql`coalesce(${t.tenantId}, ${NIL_UUID})`, t.reference),
    index("breach_incidents_tenant_idx").on(t.tenantId, t.status, t.boardDeadlineAt),
  ],
);

export type PrivacyNoticeRow = typeof privacyNotices.$inferSelect;
export type PrivacyRequestRow = typeof privacyRequests.$inferSelect;
export type PrivacyRequestEventRow = typeof privacyRequestEvents.$inferSelect;
export type PrivacyRetentionRunRow = typeof privacyRetentionRuns.$inferSelect;
export type BreachIncidentRow = typeof breachIncidents.$inferSelect;
