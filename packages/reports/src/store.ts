import { newId } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, desc, eq, isNotNull, lte, or } from "drizzle-orm";
import { reportSchedules, savedReports, type ReportScheduleRow, type SavedReportRow } from "./schema";

export type NewSavedReport = Pick<SavedReportRow, "tenantId" | "name" | "description" | "dataset" | "spec" | "createdBy" | "shared">;
export type SavedReportPatch = Partial<Pick<SavedReportRow, "name" | "description" | "dataset" | "spec" | "shared">>;
export type NewSchedule = Pick<ReportScheduleRow, "tenantId" | "reportId" | "preset" | "cron" | "recipients" | "format" | "active" | "nextRunAt" | "createdBy">;
export type SchedulePatch = Partial<
  Pick<ReportScheduleRow, "preset" | "cron" | "recipients" | "format" | "active" | "nextRunAt" | "lastRunAt" | "lastStatus" | "lastError" | "lastRowCount">
>;

/** Persistence for saved reports and schedules (Postgres in the app, memory in tests). */
export interface ReportStore {
  /** Shared reports plus the user's own private ones, newest first. */
  listReports(tenantId: string, userId: string | null, opts?: { dataset?: string }): Promise<SavedReportRow[]>;
  getReport(tenantId: string, id: string): Promise<SavedReportRow | null>;
  insertReport(values: NewSavedReport): Promise<SavedReportRow>;
  updateReport(tenantId: string, id: string, patch: SavedReportPatch): Promise<SavedReportRow | null>;
  deleteReport(tenantId: string, id: string): Promise<boolean>;

  listSchedules(tenantId: string, opts?: { reportId?: string }): Promise<ReportScheduleRow[]>;
  getSchedule(tenantId: string, id: string): Promise<ReportScheduleRow | null>;
  insertSchedule(values: NewSchedule): Promise<ReportScheduleRow>;
  updateSchedule(tenantId: string, id: string, patch: SchedulePatch): Promise<ReportScheduleRow | null>;
  deleteSchedule(tenantId: string, id: string): Promise<boolean>;

  /** Active schedules with next_run_at <= now, across tenants, oldest first. */
  dueSchedules(now: Date, limit: number): Promise<ReportScheduleRow[]>;
  /** Moves next_run_at from `expected` to `next` only if it is still `expected` (claims the run). */
  claimSchedule(id: string, expected: Date, next: Date): Promise<boolean>;
}

export class DrizzleReportStore implements ReportStore {
  constructor(private readonly db: Db) {}

  async listReports(tenantId: string, userId: string | null, opts: { dataset?: string } = {}) {
    const visible = userId ? or(eq(savedReports.shared, true), eq(savedReports.createdBy, userId)) : eq(savedReports.shared, true);
    const conds = [eq(savedReports.tenantId, tenantId), visible!];
    if (opts.dataset) conds.push(eq(savedReports.dataset, opts.dataset));
    return this.db.select().from(savedReports).where(and(...conds)).orderBy(desc(savedReports.createdAt)).limit(500);
  }

  async getReport(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(savedReports)
      .where(and(eq(savedReports.tenantId, tenantId), eq(savedReports.id, id)))
      .limit(1);
    return row ?? null;
  }

  async insertReport(values: NewSavedReport) {
    const [row] = await this.db.insert(savedReports).values(values).returning();
    return row!;
  }

  async updateReport(tenantId: string, id: string, patch: SavedReportPatch) {
    const [row] = await this.db
      .update(savedReports)
      .set(patch)
      .where(and(eq(savedReports.tenantId, tenantId), eq(savedReports.id, id)))
      .returning();
    return row ?? null;
  }

  async deleteReport(tenantId: string, id: string) {
    const rows = await this.db
      .delete(savedReports)
      .where(and(eq(savedReports.tenantId, tenantId), eq(savedReports.id, id)))
      .returning({ id: savedReports.id });
    return rows.length > 0;
  }

  async listSchedules(tenantId: string, opts: { reportId?: string } = {}) {
    const conds = [eq(reportSchedules.tenantId, tenantId)];
    if (opts.reportId) conds.push(eq(reportSchedules.reportId, opts.reportId));
    return this.db.select().from(reportSchedules).where(and(...conds)).orderBy(desc(reportSchedules.createdAt)).limit(500);
  }

  async getSchedule(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(reportSchedules)
      .where(and(eq(reportSchedules.tenantId, tenantId), eq(reportSchedules.id, id)))
      .limit(1);
    return row ?? null;
  }

  async insertSchedule(values: NewSchedule) {
    const [row] = await this.db.insert(reportSchedules).values(values).returning();
    return row!;
  }

  async updateSchedule(tenantId: string, id: string, patch: SchedulePatch) {
    const [row] = await this.db
      .update(reportSchedules)
      .set(patch)
      .where(and(eq(reportSchedules.tenantId, tenantId), eq(reportSchedules.id, id)))
      .returning();
    return row ?? null;
  }

  async deleteSchedule(tenantId: string, id: string) {
    const rows = await this.db
      .delete(reportSchedules)
      .where(and(eq(reportSchedules.tenantId, tenantId), eq(reportSchedules.id, id)))
      .returning({ id: reportSchedules.id });
    return rows.length > 0;
  }

  async dueSchedules(now: Date, limit: number) {
    return this.db
      .select()
      .from(reportSchedules)
      .where(and(eq(reportSchedules.active, true), isNotNull(reportSchedules.nextRunAt), lte(reportSchedules.nextRunAt, now)))
      .orderBy(asc(reportSchedules.nextRunAt))
      .limit(limit);
  }

  async claimSchedule(id: string, expected: Date, next: Date) {
    const rows = await this.db
      .update(reportSchedules)
      .set({ nextRunAt: next })
      .where(and(eq(reportSchedules.id, id), eq(reportSchedules.nextRunAt, expected)))
      .returning({ id: reportSchedules.id });
    return rows.length > 0;
  }
}

/** In-memory store for tests and development. */
export class MemoryReportStore implements ReportStore {
  readonly reports = new Map<string, SavedReportRow>();
  readonly schedules = new Map<string, ReportScheduleRow>();
  private tick = 0;
  /** Strictly increasing timestamps so "newest first" is stable in tests. */
  private stamp() {
    return new Date(Date.UTC(2026, 0, 1) + this.tick++ * 1000);
  }

  async listReports(tenantId: string, userId: string | null, opts: { dataset?: string } = {}) {
    return [...this.reports.values()]
      .filter((r) => r.tenantId === tenantId && (r.shared || (userId !== null && r.createdBy === userId)))
      .filter((r) => !opts.dataset || r.dataset === opts.dataset)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async getReport(tenantId: string, id: string) {
    const r = this.reports.get(id);
    return r && r.tenantId === tenantId ? r : null;
  }
  async insertReport(values: NewSavedReport) {
    const at = this.stamp();
    const row: SavedReportRow = { id: newId(), ...values, createdAt: at, updatedAt: at };
    this.reports.set(row.id, row);
    return row;
  }
  async updateReport(tenantId: string, id: string, patch: SavedReportPatch) {
    const r = await this.getReport(tenantId, id);
    if (!r) return null;
    const row = { ...r, ...patch, updatedAt: this.stamp() };
    this.reports.set(id, row);
    return row;
  }
  async deleteReport(tenantId: string, id: string) {
    if (!(await this.getReport(tenantId, id))) return false;
    this.reports.delete(id);
    for (const [sid, s] of this.schedules) if (s.reportId === id) this.schedules.delete(sid);
    return true;
  }

  async listSchedules(tenantId: string, opts: { reportId?: string } = {}) {
    return [...this.schedules.values()]
      .filter((s) => s.tenantId === tenantId && (!opts.reportId || s.reportId === opts.reportId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async getSchedule(tenantId: string, id: string) {
    const s = this.schedules.get(id);
    return s && s.tenantId === tenantId ? s : null;
  }
  async insertSchedule(values: NewSchedule) {
    const at = this.stamp();
    const row: ReportScheduleRow = {
      id: newId(),
      ...values,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      lastRowCount: null,
      createdAt: at,
      updatedAt: at,
    };
    this.schedules.set(row.id, row);
    return row;
  }
  async updateSchedule(tenantId: string, id: string, patch: SchedulePatch) {
    const s = await this.getSchedule(tenantId, id);
    if (!s) return null;
    const row = { ...s, ...patch, updatedAt: this.stamp() };
    this.schedules.set(id, row);
    return row;
  }
  async deleteSchedule(tenantId: string, id: string) {
    if (!(await this.getSchedule(tenantId, id))) return false;
    this.schedules.delete(id);
    return true;
  }
  async dueSchedules(now: Date, limit: number) {
    return [...this.schedules.values()]
      .filter((s) => s.active && s.nextRunAt && s.nextRunAt.getTime() <= now.getTime())
      .sort((a, b) => a.nextRunAt!.getTime() - b.nextRunAt!.getTime())
      .slice(0, limit);
  }
  async claimSchedule(id: string, expected: Date, next: Date) {
    const s = this.schedules.get(id);
    if (!s || s.nextRunAt?.getTime() !== expected.getTime()) return false;
    this.schedules.set(id, { ...s, nextRunAt: next });
    return true;
  }
}
