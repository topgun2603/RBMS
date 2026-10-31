import { badRequest, conflict, featureDisabled, forbidden, notFound, permissionDenied } from "@rbms/core";
import { z } from "zod";
import { displayDate, istDate } from "./dates";
import { REPORTS_FEATURE } from "./features";
import { noopLogger, type EmailPort, type FeatureGatePort, type LoggerPort, type QueuePort } from "./ports";
import { renderReport, REPORT_FORMATS, type ReportFormat, type RenderedFile } from "./render";
import { nextRunAt, presetCron, SCHEDULE_PRESETS, scheduleTimingSchema, cronTiming } from "./schedule";
import type { ReportScheduleRow, SavedReportRow, ScheduleRunStatus } from "./schema";
import { assertValidDefinition, planReport, reportSpecSchema, type ReportSpecInput } from "./spec";
import type { ReportStore, SchedulePatch } from "./store";
import {
  DATE_BUCKETS,
  DATE_PRESETS,
  MEASURE_FNS,
  OPS_BY_TYPE,
  type ColumnType,
  type DatasetDefinition,
  type DatasetPort,
  type PlanColumn,
  type QueryPlan,
  type ReportRow,
} from "./types";

export const REPORTS_JOBS = {
  /** Every 5 minutes: finds due schedules and runs them. */
  due: "reports.schedules.due",
  /** One scheduled run `{ tenantId, scheduleId }`. */
  run: "reports.schedule.run",
} as const;

export interface ReportsConfig {
  /** Max rows for an on-screen run (default 5000). */
  maxRows?: number;
  /** Max rows for CSV/XLSX downloads and scheduled emails (default 20000). */
  maxExportRows?: number;
  /** Rows when the spec gives no limit (default 500). */
  defaultLimit?: number;
  /** Schedules per shop (default 50). */
  maxSchedules?: number;
  /** Saved reports per shop (default 500). */
  maxSavedReports?: number;
}

export interface ReportsDeps {
  store: ReportStore;
  /** Scheduled emails; without it scheduled runs fail with "Email is not set up". */
  email?: EmailPort;
  /** Dataset `feature` checks and the background-run `reports.advanced` check. Without it every feature counts as on. */
  features?: FeatureGatePort;
  queue?: QueuePort;
  log?: LoggerPort;
  config?: ReportsConfig;
  now?: () => Date;
}

/** Who is asking (built from the request context by the routes). */
export interface Actor {
  tenantId: string;
  userId: string | null;
  /** hasPermission(ctx, key) */
  can(permission: string): boolean;
  /** Owner/admin/super-admin: may edit and delete shared reports of others. */
  fullAccess: boolean;
}

/** A dataset as the builder UI sees it. */
export interface DatasetInfo extends DatasetDefinition {
  /** Filter operators per column type. */
  ops: Record<ColumnType, readonly string[]>;
  measures: readonly string[];
  dateBuckets: readonly string[];
  datePresets: readonly string[];
}

export interface RunResult {
  dataset: string;
  mode: QueryPlan["mode"];
  columns: PlanColumn[];
  rows: ReportRow[];
  totals: ReportRow | null;
  /** Rows returned. */
  rowCount: number;
  /** More rows matched than `limit`. */
  truncated: boolean;
  limit: number;
  dateRange: QueryPlan["dateRange"];
  generatedAt: string;
}

export interface ScheduleRunResult {
  status: ScheduleRunStatus;
  rowCount: number;
  sentTo: string[];
  error: string | null;
}

// ------------------------------------------------------------------ inputs

const formatEnum = z.enum(REPORT_FORMATS);

export const savedReportSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).nullish(),
    spec: z.unknown(),
    shared: z.boolean().default(false),
  })
  .strict();
export const savedReportPatchSchema = savedReportSchema.partial().strict();

const recipientsSchema = z
  .array(z.string().trim().toLowerCase().email().max(254))
  .min(1)
  .max(10)
  .transform((a) => [...new Set(a)]);

export const scheduleSchema = z
  .object({
    reportId: z.string().uuid(),
    preset: z.enum(SCHEDULE_PRESETS),
    hour: z.number().int().min(0).max(23).optional(),
    minute: z.number().int().min(0).max(59).optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    recipients: recipientsSchema,
    format: formatEnum.default("xlsx"),
    active: z.boolean().default(true),
  })
  .strict();
export const schedulePatchSchema = scheduleSchema.omit({ reportId: true }).partial().strict();

export type SavedReportInput = z.input<typeof savedReportSchema>;
export type ScheduleInput = z.input<typeof scheduleSchema>;

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
export const formatRupees = (paise: number) => inr.format(paise / 100);

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** Schedule as returned by the API (timing fields spelled out for the edit form). */
export type ScheduleView = ReportScheduleRow & { timing: ReturnType<typeof cronTiming> };
const scheduleView = (s: ReportScheduleRow): ScheduleView => ({ ...s, timing: cronTiming(s.cron) });

export class ReportsService {
  private readonly datasets = new Map<string, DatasetPort>();
  readonly store: ReportStore;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  private readonly cfg: Required<ReportsConfig>;

  constructor(private readonly deps: ReportsDeps) {
    this.store = deps.store;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    this.cfg = {
      maxRows: deps.config?.maxRows ?? 5000,
      maxExportRows: deps.config?.maxExportRows ?? 20_000,
      defaultLimit: deps.config?.defaultLimit ?? 500,
      maxSchedules: deps.config?.maxSchedules ?? 50,
      maxSavedReports: deps.config?.maxSavedReports ?? 500,
    };
    if (deps.queue) {
      deps.queue.define(REPORTS_JOBS.due, async () => {
        await this.runDue();
      });
      deps.queue.define(
        REPORTS_JOBS.run,
        async (data: { tenantId: string; scheduleId: string }) => {
          await this.runSchedule(data.tenantId, data.scheduleId);
        },
        // A failed run is recorded on the schedule; retrying would email some recipients twice.
        { attempts: 1 },
      );
    }
  }

  /** The recurring job apps/api schedules via the jobs module. */
  dueJob(): { name: string; cron: string } {
    return { name: REPORTS_JOBS.due, cron: "*/5 * * * *" };
  }

  // ---------------------------------------------------------------- datasets

  /** Called by apps/api kit for each module's dataset. Throws on an invalid definition or duplicate id. */
  registerDataset(port: DatasetPort): void {
    assertValidDefinition(port.definition);
    if (this.datasets.has(port.definition.id)) throw new Error(`Dataset "${port.definition.id}" is already registered`);
    this.datasets.set(port.definition.id, port);
  }

  datasetIds(): string[] {
    return [...this.datasets.keys()];
  }

  private async featureOn(tenantId: string, key: string | undefined): Promise<boolean> {
    if (!key || !this.deps.features) return true;
    return this.deps.features.isEnabled(tenantId, key);
  }

  /** The dataset if the actor may use it: 404 unknown, 403 feature_disabled / permission_denied. */
  private async datasetFor(actor: Actor, id: string): Promise<DatasetPort> {
    const ds = this.datasets.get(id);
    if (!ds) throw notFound("Dataset");
    const def = ds.definition;
    if (!(await this.featureOn(actor.tenantId, def.feature))) {
      throw featureDisabled(def.feature!, "dependency", `${def.label} needs a feature that is off for this shop: ${def.feature}`);
    }
    if (def.permission && !actor.can(def.permission)) throw permissionDenied(def.permission);
    return ds;
  }

  private info(def: DatasetDefinition): DatasetInfo {
    return { ...def, ops: OPS_BY_TYPE, measures: MEASURE_FNS, dateBuckets: DATE_BUCKETS, datePresets: DATE_PRESETS };
  }

  /** Datasets the actor may use (feature on, permission held), by label. */
  async listDatasets(actor: Actor): Promise<DatasetInfo[]> {
    const out: DatasetInfo[] = [];
    for (const ds of this.datasets.values()) {
      const def = ds.definition;
      if (def.permission && !actor.can(def.permission)) continue;
      if (!(await this.featureOn(actor.tenantId, def.feature))) continue;
      out.push(this.info(def));
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  async getDataset(actor: Actor, id: string): Promise<DatasetInfo> {
    return this.info((await this.datasetFor(actor, id)).definition);
  }

  // ---------------------------------------------------------------- running

  private datasetIdOf(spec: unknown): string {
    const r = z.object({ dataset: z.string().trim().min(1).max(80) }).passthrough().safeParse(spec);
    if (!r.success) throw badRequest("Invalid report: dataset is required", { issues: [{ path: "dataset", message: "Required" }] });
    return r.data.dataset;
  }

  private async execute(tenantId: string, ds: DatasetPort, spec: unknown, maxLimit: number, forceLimit?: number): Promise<RunResult> {
    const now = this.now();
    let plan = planReport(ds.definition, spec, { now, defaultLimit: this.cfg.defaultLimit, maxLimit });
    if (forceLimit) plan = { ...plan, limit: Math.min(forceLimit, maxLimit) };
    const res = await ds.query(tenantId, plan);
    const truncated = res.rows.length > plan.limit;
    const rows = truncated ? res.rows.slice(0, plan.limit) : res.rows;
    return {
      dataset: ds.definition.id,
      mode: plan.mode,
      columns: plan.columns,
      rows,
      totals: res.totals ?? null,
      rowCount: rows.length,
      truncated,
      limit: plan.limit,
      dateRange: plan.dateRange,
      generatedAt: now.toISOString(),
    };
  }

  /** Runs a spec on screen (rows + totals). */
  async run(actor: Actor, spec: unknown): Promise<RunResult> {
    const ds = await this.datasetFor(actor, this.datasetIdOf(spec));
    return this.execute(actor.tenantId, ds, spec, this.cfg.maxRows);
  }

  /** Runs a spec into a CSV/XLSX file (up to maxExportRows; the spec's limit is ignored). */
  async export(actor: Actor, spec: unknown, format: ReportFormat, title?: string): Promise<RenderedFile> {
    const ds = await this.datasetFor(actor, this.datasetIdOf(spec));
    const result = await this.execute(actor.tenantId, ds, spec, this.cfg.maxExportRows, this.cfg.maxExportRows);
    return this.render(format, title ?? ds.definition.label, result);
  }

  private render(format: ReportFormat, title: string, r: RunResult): Promise<RenderedFile> {
    return renderReport(format, { title, columns: r.columns, rows: r.rows, totals: r.totals }, istDate(this.now()));
  }

  // ---------------------------------------------------------------- saved reports

  private canSee(actor: Actor, r: SavedReportRow) {
    return r.shared || (actor.userId !== null && r.createdBy === actor.userId);
  }
  private canModify(actor: Actor, r: SavedReportRow) {
    return (actor.userId !== null && r.createdBy === actor.userId) || (r.shared && actor.fullAccess);
  }

  async listSaved(actor: Actor, opts: { dataset?: string } = {}): Promise<SavedReportRow[]> {
    return this.store.listReports(actor.tenantId, actor.userId, opts);
  }

  async getSaved(actor: Actor, id: string): Promise<SavedReportRow> {
    const r = await this.store.getReport(actor.tenantId, id);
    if (!r || !this.canSee(actor, r)) throw notFound("Report");
    return r;
  }

  private async modifiable(actor: Actor, id: string): Promise<SavedReportRow> {
    const r = await this.getSaved(actor, id);
    if (!this.canModify(actor, r)) throw forbidden("Only the person who made this report (or the shop owner) can change it");
    return r;
  }

  /** Validates the spec against its dataset (and the actor's access to it); returns the stored form. */
  private async checkSpec(actor: Actor, spec: unknown): Promise<ReportSpecInput> {
    const ds = await this.datasetFor(actor, this.datasetIdOf(spec));
    planReport(ds.definition, spec, { now: this.now(), maxLimit: this.cfg.maxExportRows });
    return reportSpecSchema.parse(spec);
  }

  async createSaved(actor: Actor, input: unknown): Promise<SavedReportRow> {
    const b = savedReportSchema.parse(input);
    const spec = await this.checkSpec(actor, b.spec);
    const existing = await this.store.listReports(actor.tenantId, actor.userId);
    if (existing.length >= this.cfg.maxSavedReports) throw conflict(`You can save up to ${this.cfg.maxSavedReports} reports`);
    return this.store.insertReport({
      tenantId: actor.tenantId,
      name: b.name,
      description: b.description ?? null,
      dataset: spec.dataset,
      spec,
      createdBy: actor.userId,
      shared: b.shared,
    });
  }

  async updateSaved(actor: Actor, id: string, input: unknown): Promise<SavedReportRow> {
    const current = await this.modifiable(actor, id);
    const b = savedReportPatchSchema.parse(input);
    const patch: Parameters<ReportStore["updateReport"]>[2] = {};
    if (b.name !== undefined) patch.name = b.name;
    if (b.description !== undefined) patch.description = b.description ?? null;
    if (b.shared !== undefined) {
      // Making someone else's shared report private would hide it from its creator's team; only the creator may.
      if (!b.shared && current.createdBy !== actor.userId) throw forbidden("Only the person who made this report can make it private");
      patch.shared = b.shared;
    }
    if (b.spec !== undefined) {
      const spec = await this.checkSpec(actor, b.spec);
      patch.spec = spec;
      patch.dataset = spec.dataset;
    }
    const row = await this.store.updateReport(actor.tenantId, id, patch);
    if (!row) throw notFound("Report");
    return row;
  }

  async deleteSaved(actor: Actor, id: string): Promise<{ ok: true }> {
    await this.modifiable(actor, id);
    await this.store.deleteReport(actor.tenantId, id);
    return { ok: true };
  }

  async runSaved(actor: Actor, id: string): Promise<RunResult & { report: SavedReportRow }> {
    const report = await this.getSaved(actor, id);
    return { ...(await this.run(actor, report.spec)), report };
  }

  async exportSaved(actor: Actor, id: string, format: ReportFormat): Promise<RenderedFile> {
    const report = await this.getSaved(actor, id);
    return this.export(actor, report.spec, format, report.name);
  }

  // ---------------------------------------------------------------- schedules

  async listSchedules(actor: Actor, opts: { reportId?: string } = {}): Promise<ScheduleView[]> {
    const rows = await this.store.listSchedules(actor.tenantId, opts);
    const visible: ScheduleView[] = [];
    for (const s of rows) {
      const r = await this.store.getReport(actor.tenantId, s.reportId);
      if (r && this.canSee(actor, r)) visible.push(scheduleView(s));
    }
    return visible;
  }

  private async scheduleFor(actor: Actor, id: string, modify: boolean): Promise<{ schedule: ReportScheduleRow; report: SavedReportRow }> {
    const schedule = await this.store.getSchedule(actor.tenantId, id);
    if (!schedule) throw notFound("Schedule");
    const report = await this.store.getReport(actor.tenantId, schedule.reportId);
    if (!report || !this.canSee(actor, report)) throw notFound("Schedule");
    if (modify && !this.canModify(actor, report)) throw forbidden("Only the person who made this report (or the shop owner) can change its schedule");
    return { schedule, report };
  }

  async getSchedule(actor: Actor, id: string): Promise<ScheduleView> {
    return scheduleView((await this.scheduleFor(actor, id, false)).schedule);
  }

  async createSchedule(actor: Actor, input: unknown): Promise<ScheduleView> {
    const b = scheduleSchema.parse(input);
    const report = await this.modifiable(actor, b.reportId);
    await this.datasetFor(actor, report.dataset);
    const count = (await this.store.listSchedules(actor.tenantId)).length;
    if (count >= this.cfg.maxSchedules) throw conflict(`A shop can have up to ${this.cfg.maxSchedules} report schedules`);
    const cron = presetCron({ preset: b.preset, hour: b.hour, minute: b.minute, weekday: b.weekday, dayOfMonth: b.dayOfMonth });
    const row = await this.store.insertSchedule({
      tenantId: actor.tenantId,
      reportId: report.id,
      preset: b.preset,
      cron,
      recipients: b.recipients,
      format: b.format,
      active: b.active,
      nextRunAt: b.active ? nextRunAt(cron, this.now()) : null,
      createdBy: actor.userId,
    });
    return scheduleView(row);
  }

  async updateSchedule(actor: Actor, id: string, input: unknown): Promise<ScheduleView> {
    const { schedule } = await this.scheduleFor(actor, id, true);
    const b = schedulePatchSchema.parse(input);
    const patch: SchedulePatch = {};
    const timingChanged = ["preset", "hour", "minute", "weekday", "dayOfMonth"].some((k) => (b as Record<string, unknown>)[k] !== undefined);
    let cron = schedule.cron;
    if (timingChanged) {
      const current = cronTiming(schedule.cron) ?? scheduleTimingSchema.parse({ preset: schedule.preset });
      const timing = { ...current, ...Object.fromEntries(Object.entries(b).filter(([k, v]) => v !== undefined && k in current)) };
      cron = presetCron(timing);
      patch.preset = timing.preset;
      patch.cron = cron;
    }
    if (b.recipients !== undefined) patch.recipients = b.recipients;
    if (b.format !== undefined) patch.format = b.format;
    if (b.active !== undefined) patch.active = b.active;
    const active = b.active ?? schedule.active;
    if (timingChanged || b.active !== undefined) patch.nextRunAt = active ? nextRunAt(cron, this.now()) : null;
    const row = await this.store.updateSchedule(actor.tenantId, id, patch);
    if (!row) throw notFound("Schedule");
    return scheduleView(row);
  }

  async deleteSchedule(actor: Actor, id: string): Promise<{ ok: true }> {
    await this.scheduleFor(actor, id, true);
    await this.store.deleteSchedule(actor.tenantId, id);
    return { ok: true };
  }

  /** Runs the schedule now (emails the recipients); next_run_at is unchanged. */
  async runNow(actor: Actor, id: string): Promise<{ schedule: ScheduleView; result: ScheduleRunResult }> {
    const { schedule, report } = await this.scheduleFor(actor, id, true);
    await this.datasetFor(actor, report.dataset);
    const result = await this.runSchedule(actor.tenantId, schedule.id);
    const updated = await this.store.getSchedule(actor.tenantId, id);
    return { schedule: scheduleView(updated ?? schedule), result };
  }

  /** Claims every due schedule (moves next_run_at on) and runs it — through the queue when there is one. */
  async runDue(limit = 100): Promise<{ claimed: number }> {
    const now = this.now();
    const due = await this.store.dueSchedules(now, limit);
    let claimed = 0;
    for (const s of due) {
      let next: Date | null;
      try {
        next = nextRunAt(s.cron, now);
      } catch (e) {
        this.log.error({ err: e, scheduleId: s.id }, "reports: bad schedule cron");
        await this.store.updateSchedule(s.tenantId, s.id, { active: false, nextRunAt: null, lastStatus: "failed", lastError: errorText(e) });
        continue;
      }
      if (!(await this.store.claimSchedule(s.id, s.nextRunAt!, next))) continue;
      claimed++;
      if (this.deps.queue) {
        await this.deps.queue.enqueue(REPORTS_JOBS.run, { tenantId: s.tenantId, scheduleId: s.id }, { jobId: `report-${s.id}-${s.nextRunAt!.getTime()}` });
      } else {
        await this.runSchedule(s.tenantId, s.id);
      }
    }
    return { claimed };
  }

  /** One scheduled run: render the saved report and email it. Never throws; the outcome is stored on the schedule. */
  async runSchedule(tenantId: string, scheduleId: string): Promise<ScheduleRunResult> {
    const schedule = await this.store.getSchedule(tenantId, scheduleId);
    if (!schedule) return { status: "failed", rowCount: 0, sentTo: [], error: "Schedule not found" };
    const now = this.now();
    const record = async (r: ScheduleRunResult) => {
      await this.store.updateSchedule(tenantId, scheduleId, {
        lastRunAt: now,
        lastStatus: r.status,
        lastError: r.error,
        lastRowCount: r.rowCount,
      });
      if (r.status !== "ok") this.log.warn({ tenantId, scheduleId, error: r.error }, "reports: scheduled run did not complete");
      return r;
    };
    try {
      const report = await this.store.getReport(tenantId, schedule.reportId);
      if (!report) return record({ status: "failed", rowCount: 0, sentTo: [], error: "The saved report was deleted" });
      if (!(await this.featureOn(tenantId, REPORTS_FEATURE))) {
        return record({ status: "skipped", rowCount: 0, sentTo: [], error: "The report builder is turned off for this shop" });
      }
      const ds = this.datasets.get(report.dataset);
      if (!ds) return record({ status: "failed", rowCount: 0, sentTo: [], error: `Dataset "${report.dataset}" is not available` });
      if (!(await this.featureOn(tenantId, ds.definition.feature))) {
        return record({ status: "skipped", rowCount: 0, sentTo: [], error: `${ds.definition.label} is turned off for this shop` });
      }
      if (!this.deps.email) return record({ status: "failed", rowCount: 0, sentTo: [], error: "Email is not set up" });

      const result = await this.execute(tenantId, ds, report.spec, this.cfg.maxExportRows, this.cfg.maxExportRows);
      const file = await this.render(schedule.format, report.name, result);
      const subject = `${report.name} – ${result.dateRange ? periodText(result.dateRange) : displayDate(istDate(now))}`;
      const text = emailText(report.name, result);
      const sentTo: string[] = [];
      const failed: string[] = [];
      for (const to of schedule.recipients) {
        try {
          await this.deps.email.send({ tenantId, to, subject, text, attachments: [file] });
          sentTo.push(to);
        } catch (e) {
          failed.push(`${to}: ${errorText(e)}`);
        }
      }
      return record({
        status: failed.length ? "failed" : "ok",
        rowCount: result.rowCount,
        sentTo,
        error: failed.length ? `Could not email ${failed.join("; ")}`.slice(0, 1000) : null,
      });
    } catch (e) {
      return record({ status: "failed", rowCount: 0, sentTo: [], error: errorText(e) });
    }
  }
}

const periodText = (r: { from: string; to: string }) =>
  r.from === r.to ? displayDate(r.from) : `${displayDate(r.from)} to ${displayDate(r.to)}`;

function formatValue(col: PlanColumn, v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (col.type === "money") return formatRupees(Number(v));
  if (col.type === "number") return Number(v).toLocaleString("en-IN");
  return String(v);
}

/** Plain-text email body: period, row count, totals. */
export function emailText(name: string, r: RunResult): string {
  const lines = [name, ""];
  if (r.dateRange) lines.push(`Period: ${periodText(r.dateRange)}`);
  lines.push(`Rows: ${r.rowCount.toLocaleString("en-IN")}${r.truncated ? ` (only the first ${r.limit.toLocaleString("en-IN")} are attached)` : ""}`);
  if (r.totals) {
    const parts = r.columns.filter((c) => r.totals![c.key] !== undefined && r.totals![c.key] !== null).map((c) => `${c.label}: ${formatValue(c, r.totals![c.key])}`);
    if (parts.length) {
      lines.push("", "Totals");
      for (const p of parts) lines.push(`  ${p}`);
    }
  }
  lines.push("", "The full report is attached.");
  return lines.join("\n");
}
