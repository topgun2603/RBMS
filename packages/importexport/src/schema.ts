import { pk, tenantId, timestamps } from "@srirealtime/db";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** preview = uploaded and parsed, waiting for commit; then queued → running → done | failed. */
export const IMPORT_JOB_STATUSES = ["preview", "queued", "running", "done", "failed"] as const;
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

/** The uploaded table, kept until the job finishes (bounded by the row limit). */
export interface ImportJobRows {
  headers: string[];
  data: string[][];
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
    errors: jsonb("errors").$type<{ row: number; message: string }[]>().notNull().default([]),
    skipInvalid: boolean("skip_invalid").notNull().default(true),
    createdBy: uuid("created_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("import_jobs_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export type ImportJobRow = typeof importJobs.$inferSelect;
