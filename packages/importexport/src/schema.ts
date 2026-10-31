import { pk, tenantId, timestamps } from "@rbms/db";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** preview = uploaded and parsed, waiting for commit; then queued → running → done | failed. */
export const IMPORT_JOB_STATUSES = ["preview", "queued", "running", "done", "failed", "rolled_back"] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export interface ImportJobSummary {
  rows: number;
  valid: number;
  invalid: number;
  processed: number;
  created: number;
  updated: number;
  failed: number;
  skipped: number;
}

export interface ImportJobError {
  row: number;
  message: string;
  /** The original cells of the row (first errors only), for the downloadable error report. */
  raw?: string[];
}

/** The uploaded table, kept until the job finishes (bounded by the row limit). */
export interface ImportJobRows {
  headers: string[];
  data: string[][];
  /** The row number in the uploaded file of each data row (title blocks and blank rows counted). Absent: header = 1, data from 2. */
  lineNos?: number[];
}

export const importJobs = pgTable(
  "import_jobs",
  {
    id: pk(),
    tenantId: tenantId(),
    key: text("key").notNull(),
    status: text("status").notNull().$type<ImportJobStatus>().default("preview"),
    fileName: text("file_name"),
    fileType: text("file_type").$type<"csv" | "xlsx">(),
    fileSize: integer("file_size"),
    /** column key → file column index (null = skipped). */
    mapping: jsonb("mapping").$type<Record<string, number | null>>().notNull().default({}),
    rows: jsonb("rows").$type<ImportJobRows | null>(),
    summary: jsonb("summary").$type<ImportJobSummary>().notNull(),
    errors: jsonb("errors").$type<ImportJobError[]>().notNull().default([]),
    /** Source software chosen/detected in the wizard: generic, vyapar, tally, busy, marg. */
    source: text("source"),
    /** Wizard choices (e.g. carryDues). */
    options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
    /** Rows dropped before mapping (receipts, journals ...). */
    ignoredRows: integer("ignored_rows").notNull().default(0),
    /** Result of an undo: what was reverted and what had to stay. */
    rollback: jsonb("rollback").$type<{ reverted: number; kept: { entity: string; key: string; reason: string }[] } | null>(),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    rolledBackBy: uuid("rolled_back_by"),
    skipInvalid: boolean("skip_invalid").notNull().default(true),
    createdBy: uuid("created_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("import_jobs_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export type ImportJobRow = typeof importJobs.$inferSelect;

/**
 * Records an import created or linked: the stable external key (re-importing the same file skips it) and our id (undo
 * deletes it). Rolled-back records are deleted so the file can be imported again.
 */
export const importRecords = pgTable(
  "import_records",
  {
    id: pk(),
    tenantId: tenantId(),
    batchId: uuid("batch_id").notNull(),
    /** customer | supplier | product | sale | purchase */
    entity: text("entity").notNull(),
    externalKey: text("external_key").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").$type<"created" | "linked">().notNull().default("created"),
    meta: jsonb("meta").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("import_records_tenant_entity_key_uq").on(t.tenantId, t.entity, t.externalKey),
    index("import_records_tenant_batch_idx").on(t.tenantId, t.batchId),
  ],
);
export type ImportRecordRow = typeof importRecords.$inferSelect;

export const EXPORT_JOB_STATUSES = ["queued", "running", "done", "failed", "expired"] as const;
export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number];

/** "Export all my data": a zip built in the background and kept for a few days. */
export const exportJobs = pgTable(
  "export_jobs",
  {
    id: pk(),
    tenantId: tenantId(),
    status: text("status").$type<ExportJobStatus>().notNull().default("queued"),
    requestedBy: uuid("requested_by"),
    fileKey: text("file_key"),
    fileName: text("file_name"),
    fileSize: integer("file_size"),
    /** Rows written per dataset. */
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    error: text("error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("export_jobs_tenant_created_idx").on(t.tenantId, t.createdAt)],
);
export type ExportJobRow = typeof exportJobs.$inferSelect;
