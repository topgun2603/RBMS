import { pk, tenantId, timestamps } from "@rbms/db";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ReportFormat } from "./render";
import type { SchedulePreset } from "./schedule";
import type { ReportSpecInput } from "./spec";

export const SCHEDULE_STATUSES = ["ok", "failed", "skipped"] as const;
export type ScheduleRunStatus = (typeof SCHEDULE_STATUSES)[number];

export const savedReports = pgTable(
  "saved_reports",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description"),
    /** Copy of spec.dataset, for listing and filtering. */
    dataset: text("dataset").notNull(),
    spec: jsonb("spec").$type<ReportSpecInput>().notNull(),
    createdBy: uuid("created_by"),
    /** Visible to every member with reports.view; private reports only to their creator. */
    shared: boolean("shared").notNull().default(false),
    ...timestamps(),
  },
  (t) => [index("saved_reports_tenant_idx").on(t.tenantId, t.createdAt)],
);

export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: pk(),
    tenantId: tenantId(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => savedReports.id, { onDelete: "cascade" }),
    preset: text("preset").$type<SchedulePreset>().notNull(),
    /** IST cron, e.g. "0 8 * * 1". */
    cron: text("cron").notNull(),
    recipients: jsonb("recipients").$type<string[]>().notNull(),
    format: text("format").$type<ReportFormat>().notNull().default("xlsx"),
    active: boolean("active").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastStatus: text("last_status").$type<ScheduleRunStatus>(),
    lastError: text("last_error"),
    lastRowCount: integer("last_row_count"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    index("report_schedules_tenant_report_idx").on(t.tenantId, t.reportId),
    // The due sweep scans active schedules by next run across tenants.
    index("report_schedules_due_idx").on(t.active, t.nextRunAt),
  ],
);

export type SavedReportRow = typeof savedReports.$inferSelect;
export type ReportScheduleRow = typeof reportSchedules.$inferSelect;
