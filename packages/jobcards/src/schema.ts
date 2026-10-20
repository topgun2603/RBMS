import { pk, tenantId, timestamps } from "@srirealtime/db";
import { date, index, integer, jsonb, numeric, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { JobTemplate } from "./templates";

/** The work flow, in order. `trial` (tailoring fittings) is optional; `cancelled` sits outside the flow. */
export const JOB_FLOW = ["received", "diagnosed", "awaiting_approval", "in_progress", "trial", "ready", "delivered"] as const;
export const JOB_STATUSES = [...JOB_FLOW, "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
/** Still in the shop (on the board). */
export const OPEN_STATUSES: readonly JobStatus[] = ["received", "diagnosed", "awaiting_approval", "in_progress", "trial", "ready"];
/** Done with: no longer overdue, never edited. */
export const CLOSED_STATUSES: readonly JobStatus[] = ["delivered", "cancelled"];

export const JOB_PRIORITIES = ["normal", "urgent"] as const;
export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const LINE_KINDS = ["part", "labour"] as const;
export type JobLineKind = (typeof LINE_KINDS)[number];

export const EVENT_TYPES = ["created", "status", "note", "estimate", "billed"] as const;
export type JobEventType = (typeof EVENT_TYPES)[number];

/** A job taken in for service: a phone to repair, a blouse to stitch, spectacles to make. */
export const jobcards = pgTable(
  "jobcards",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Per shop: 1, 2, 3… (shown as "JC-0012"). */
    number: integer("number").notNull(),
    template: text("template").$type<JobTemplate>().notNull().default("general"),
    status: text("status").$type<JobStatus>().notNull().default("received"),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    /** Billing customer, when picked from the customer list. */
    customerId: uuid("customer_id"),
    /** Template details (validated per template in templates.ts). */
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull().default({}),
    dueDate: date("due_date", { mode: "string" }),
    assigneeName: text("assignee_name"),
    assigneeUserId: uuid("assignee_user_id"),
    priority: text("priority").$type<JobPriority>().notNull().default("normal"),
    /** Paise taken as advance at intake (taken off the balance; recorded on the bill by the shop). */
    advance: integer("advance").notNull().default(0),
    notes: text("notes"),
    invoiceId: uuid("invoice_id"),
    invoiceNumber: text("invoice_number"),
    /** Secret in the customer's tracking link. */
    trackToken: text("track_token").notNull(),
    createdBy: uuid("created_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("jobcards_tenant_number_uq").on(t.tenantId, t.number),
    unique("jobcards_track_token_uq").on(t.trackToken),
    index("jobcards_tenant_status_idx").on(t.tenantId, t.status),
    index("jobcards_tenant_due_idx").on(t.tenantId, t.dueDate),
    index("jobcards_tenant_updated_idx").on(t.tenantId, t.updatedAt),
  ],
);

/** Parts and labour on a job: the estimate, and later the bill. Rates are GST-exclusive paise. */
export const jobcardLines = pgTable(
  "jobcard_lines",
  {
    id: pk(),
    tenantId: tenantId(),
    jobcardId: uuid("jobcard_id").notNull(),
    kind: text("kind").$type<JobLineKind>().notNull().default("part"),
    /** Billing item (catalogue variant) for parts from stock. */
    itemId: uuid("item_id"),
    description: text("description").notNull(),
    qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
    rate: integer("rate").notNull(),
    gstRate: real("gst_rate").notNull().default(18),
    hsn: text("hsn"),
    unit: text("unit"),
    ...timestamps(),
  },
  (t) => [index("jobcard_lines_tenant_job_idx").on(t.tenantId, t.jobcardId)],
);

/** Append-only timeline of a job: intake, status moves, notes, estimate changes, billing. */
export const jobcardEvents = pgTable(
  "jobcard_events",
  {
    id: pk(),
    tenantId: tenantId(),
    jobcardId: uuid("jobcard_id").notNull(),
    type: text("type").$type<JobEventType>().notNull(),
    fromStatus: text("from_status").$type<JobStatus>(),
    toStatus: text("to_status").$type<JobStatus>(),
    note: text("note"),
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobcard_events_tenant_job_idx").on(t.tenantId, t.jobcardId, t.createdAt)],
);

export type JobcardRow = typeof jobcards.$inferSelect;
export type JobcardLineRow = typeof jobcardLines.$inferSelect;
export type JobcardEventRow = typeof jobcardEvents.$inferSelect;
