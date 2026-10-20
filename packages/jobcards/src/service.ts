import { randomBytes } from "node:crypto";
import { AppError, badRequest, conflict, defineSort, facetCounts, listFilter, listQuerySchema, notFound, runList, searchAny, type ListPage, type TenantRef } from "@srirealtime/core";
import type { Db, Tx } from "@srirealtime/db";
import { todayIST } from "@srirealtime/gst";
import { and, asc, count, eq, inArray, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { allowedMoves, formatJobNumber, isClosed, isOverdue, jobTotals, lineAmount, lineTax, moveBlock, nextSteps, parseJobNumber, roundQty, type JobTotals } from "./logic";
import { noopLogger, type BillingPort, type BillResult, type JobSummary, type LoggerPort, type NotifyPort } from "./ports";
import {
  CLOSED_STATUSES,
  JOB_PRIORITIES,
  JOB_STATUSES,
  JOB_FLOW,
  jobcardEvents,
  jobcardLines,
  jobcards,
  LINE_KINDS,
  type JobcardEventRow,
  type JobcardLineRow,
  type JobcardRow,
  type JobEventType,
  type JobStatus,
} from "./schema";
import { fieldsSummary, JOB_TEMPLATES, TEMPLATE_FIELDS, type JobTemplate } from "./templates";

export interface JobcardsDeps {
  db: Db;
  billing?: BillingPort;
  notify?: NotifyPort;
  log?: LoggerPort;
  now?: () => Date;
}

const MAX_QTY = 10_000;
const MAX_PAISE = 1_000_000_000;
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const optDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Invalid date")
  .nullish()
  .transform((v) => v ?? null);

export const lineInput = z
  .object({
    kind: z.enum(LINE_KINDS).default("part"),
    itemId: z.string().uuid().nullish(),
    description: z.string().trim().min(1).max(200),
    qty: z.number().positive().max(MAX_QTY),
    /** GST-exclusive paise per unit. */
    rate: z.number().int().min(0).max(100_000_000),
    gstRate: z.number().min(0).max(28).default(18),
    hsn: optText(20),
    unit: optText(20),
  })
  .strict();
export type LineInput = z.input<typeof lineInput>;
export const linePatch = lineInput.partial().strict();

const cardFields = {
  customerName: z.string().trim().min(1).max(120),
  customerPhone: optText(20),
  customerId: z.string().uuid().nullish(),
  dueDate: optDate,
  assigneeName: optText(80),
  assigneeUserId: z.string().uuid().nullish(),
  priority: z.enum(JOB_PRIORITIES).default("normal"),
  advance: z.number().int().min(0).max(MAX_PAISE).default(0),
  notes: optText(2000),
};

export const createInput = z
  .object({
    template: z.enum(JOB_TEMPLATES).default("general"),
    /** Template details; validated against the template (see templates.ts). */
    fields: z.unknown().optional(),
    ...cardFields,
    lines: z.array(lineInput).max(100).optional(),
  })
  .strict();
export type CreateInput = z.input<typeof createInput>;

export const updateInput = z
  .object({
    fields: z.unknown().optional(),
    customerName: cardFields.customerName.optional(),
    // `.optional()` outside the null-normalising transforms: a key left out stays unchanged.
    customerPhone: cardFields.customerPhone.optional(),
    customerId: cardFields.customerId.optional(),
    dueDate: cardFields.dueDate.optional(),
    assigneeName: cardFields.assigneeName.optional(),
    assigneeUserId: cardFields.assigneeUserId.optional(),
    priority: z.enum(JOB_PRIORITIES).optional(),
    advance: z.number().int().min(0).max(MAX_PAISE).optional(),
    notes: cardFields.notes.optional(),
  })
  .strict();
export type UpdateInput = z.input<typeof updateInput>;

export const moveInput = z.object({ status: z.enum(JOB_STATUSES), note: optText(500) }).strict();
export type MoveInput = z.input<typeof moveInput>;
export const noteInput = z.object({ note: z.string().trim().min(1).max(1000) }).strict();
export const cancelInput = z.object({ reason: z.string().trim().min(2).max(300) }).strict();
export const billInput = z.object({ tillSessionId: z.string().uuid().nullish() }).strict();
export type BillInput = z.input<typeof billInput>;

/** GET /: `status` (comma list), `template`, `priority`, `overdue=1`, `q` (number, customer, phone, details), sort number | due | updated. */
export const jobListQuery = listQuerySchema({ defaultLimit: 25, maxLimit: 200 }).extend({
  status: listFilter.oneOf(JOB_STATUSES),
  template: listFilter.oneOf(JOB_TEMPLATES),
  priority: listFilter.oneOf(JOB_PRIORITIES),
  overdue: listFilter.bool(),
});
export type JobListQuery = z.input<typeof jobListQuery>;

export const JOB_SORT = defineSort(
  { number: jobcards.number, due: jobcards.dueDate, updated: jobcards.updatedAt },
  { default: "-updated", tieBreaker: [jobcards.id] },
);

/** A card on the board / a row in the list. */
export interface JobcardSummary extends JobcardRow {
  /** "JC-0012" */
  label: string;
  /** One line about the job ("Redmi Note 12 · screen broken"). */
  summary: string;
  overdue: boolean;
  /** With GST, paise. */
  total: number;
}

export interface JobLine extends Omit<JobcardLineRow, "qty"> {
  qty: number;
  /** Before GST. */
  amount: number;
  tax: number;
}

export interface JobView extends JobcardSummary {
  lines: JobLine[];
  events: JobcardEventRow[];
  totals: JobTotals;
  /** Statuses the job may move to now. */
  moves: JobStatus[];
  /** The stepper's forward button(s). */
  next: JobStatus[];
}

/** What the customer's tracking link shows. No phone, no name, no prices except the total. */
export interface JobTrack {
  label: string;
  number: number;
  template: JobTemplate;
  status: JobStatus;
  dueDate: string | null;
  total: number;
  createdAt: Date;
  timeline: { status: JobStatus; at: Date }[];
}

export interface JobsSummary {
  open: number;
  ready: number;
  overdue: number;
  byStatus: Record<string, number>;
}

const toNum = (v: string | number | null | undefined) => Number(v ?? 0);
const trackToken = () => randomBytes(16).toString("base64url");

/** Total with GST of a job's lines, summed per line as `jobTotals` does. */
/**
 * A job's total incl. GST (paise). Columns are written out with their table names: inside a correlated subquery drizzle
 * would print them bare (`jobcard_id = id`), which compares the line with itself.
 */
const totalSql = sql<string>`coalesce((select sum(round(jl.qty * jl.rate) + round(round(jl.qty * jl.rate) * jl.gst_rate::numeric / 100)) from ${jobcardLines} jl where jl.tenant_id = "jobcards"."tenant_id" and jl.jobcard_id = "jobcards"."id"), 0)`;

export class JobcardsService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: JobcardsDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  private today() {
    return todayIST(this.now());
  }

  // ---------------------------------------------------------------- list

  /** WHERE of the list; without `status` for the status facet counts. */
  listConditions(tenantId: string, p: z.output<typeof jobListQuery>, today: string, withStatus = true): SQL | undefined {
    const n = p.q ? parseJobNumber(p.q) : null;
    const search = searchAny(p.q, [jobcards.customerName, jobcards.customerPhone, sql`${jobcards.fields}::text`]);
    return and(
      eq(jobcards.tenantId, tenantId),
      withStatus && p.status?.length ? inArray(jobcards.status, p.status) : undefined,
      p.template?.length ? inArray(jobcards.template, p.template) : undefined,
      p.priority?.length ? inArray(jobcards.priority, p.priority) : undefined,
      p.overdue ? and(lt(jobcards.dueDate, today), notInArray(jobcards.status, ["ready", ...CLOSED_STATUSES])) : undefined,
      search && n !== null ? or(search, eq(jobcards.number, n)) : search,
    );
  }

  private summaryOf(row: JobcardRow, total: number, today: string): JobcardSummary {
    return {
      ...row,
      label: formatJobNumber(row.number),
      summary: fieldsSummary(row.template, row.fields ?? {}),
      overdue: isOverdue(row.dueDate, row.status, today),
      total,
    };
  }

  /** Jobs, paged; `facets.status` counts each status under the other filters. */
  async list(tenantId: string, query: JobListQuery = {}): Promise<ListPage<JobcardSummary>> {
    const p = jobListQuery.parse(query);
    const order = JOB_SORT.orderBy(p.sort);
    const today = this.today();
    const where = this.listConditions(tenantId, p, today);
    const [page, byStatus] = await Promise.all([
      runList(p, {
        rows: () => this.db.select({ job: jobcards, total: totalSql }).from(jobcards).where(where).orderBy(...order).limit(p.limit).offset(p.offset),
        count: () => this.db.select({ total: count() }).from(jobcards).where(where),
        map: (r) => this.summaryOf(r.job, Math.round(toNum(r.total)), today),
      }),
      this.db
        .select({ key: jobcards.status, n: count() })
        .from(jobcards)
        .where(this.listConditions(tenantId, p, today, false))
        .groupBy(jobcards.status),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus) } };
  }

  /** Counts for the dashboard: open jobs, ready for pickup, overdue. */
  async summary(tenantId: string): Promise<JobsSummary> {
    const today = this.today();
    const [rows, [late]] = await Promise.all([
      this.db
        .select({ key: jobcards.status, n: count() })
        .from(jobcards)
        .where(and(eq(jobcards.tenantId, tenantId), notInArray(jobcards.status, [...CLOSED_STATUSES])))
        .groupBy(jobcards.status),
      this.db
        .select({ n: count() })
        .from(jobcards)
        .where(and(eq(jobcards.tenantId, tenantId), lt(jobcards.dueDate, today), notInArray(jobcards.status, ["ready", ...CLOSED_STATUSES]))),
    ]);
    const byStatus = facetCounts(rows);
    return { open: Object.values(byStatus).reduce((s, n) => s + n, 0), ready: byStatus.ready ?? 0, overdue: late?.n ?? 0, byStatus };
  }

  // ---------------------------------------------------------------- one job

  private async row(tenantId: string, id: string, tx: Db | Tx = this.db, lock = false): Promise<JobcardRow> {
    const q = tx
      .select()
      .from(jobcards)
      .where(and(eq(jobcards.tenantId, tenantId), eq(jobcards.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Job card");
    return row;
  }

  private async lineRows(tenantId: string, id: string, tx: Db | Tx = this.db): Promise<JobcardLineRow[]> {
    return tx
      .select()
      .from(jobcardLines)
      .where(and(eq(jobcardLines.tenantId, tenantId), eq(jobcardLines.jobcardId, id)))
      .orderBy(asc(jobcardLines.createdAt), asc(jobcardLines.id));
  }

  private toLines(rows: JobcardLineRow[]): JobLine[] {
    return rows.map((r) => {
      const l = { qty: toNum(r.qty), rate: r.rate, gstRate: r.gstRate };
      return { ...r, qty: l.qty, amount: lineAmount(l), tax: lineTax(l) };
    });
  }

  async get(tenantId: string, id: string): Promise<JobView> {
    const row = await this.row(tenantId, id);
    const [lineRows, events] = await Promise.all([
      this.lineRows(tenantId, id),
      this.db
        .select()
        .from(jobcardEvents)
        .where(and(eq(jobcardEvents.tenantId, tenantId), eq(jobcardEvents.jobcardId, id)))
        .orderBy(asc(jobcardEvents.createdAt), asc(jobcardEvents.id)),
    ]);
    const lines = this.toLines(lineRows);
    const totals = jobTotals(lines, row.advance);
    const ctx = { billed: !!row.invoiceId, total: totals.total };
    return {
      ...this.summaryOf(row, totals.total, this.today()),
      lines,
      events,
      totals,
      moves: allowedMoves(row.status, ctx),
      next: nextSteps(row.status, ctx),
    };
  }

  /** Parts and labour with the amount, GST per line and totals (advance and balance included). */
  async estimate(tenantId: string, id: string): Promise<{ lines: JobLine[]; totals: JobTotals }> {
    const row = await this.row(tenantId, id);
    const lines = this.toLines(await this.lineRows(tenantId, id));
    return { lines, totals: jobTotals(lines, row.advance) };
  }

  private async event(tx: Db | Tx, tenantId: string, jobcardId: string, type: JobEventType, e: { from?: JobStatus | null; to?: JobStatus | null; note?: string | null; userId?: string | null } = {}) {
    await tx.insert(jobcardEvents).values({
      tenantId,
      jobcardId,
      type,
      fromStatus: e.from ?? null,
      toStatus: e.to ?? null,
      note: e.note ?? null,
      userId: e.userId ?? null,
      createdAt: this.now(),
    });
  }

  private async nextNumber(tx: Tx, tenantId: string): Promise<number> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`jobcards:number:${tenantId}`}))`);
    const [r] = await tx
      .select({ n: sql<number>`coalesce(max(${jobcards.number}), 0)::int` })
      .from(jobcards)
      .where(eq(jobcards.tenantId, tenantId));
    return (r?.n ?? 0) + 1;
  }

  /** Validates a template's details; errors point at `fields.<name>`. */
  private fieldsFor(template: JobTemplate, input: unknown): Record<string, unknown> {
    return z.object({ fields: TEMPLATE_FIELDS[template] }).parse({ fields: input ?? {} }).fields as Record<string, unknown>;
  }

  private lineValues(tenantId: string, jobcardId: string, l: z.output<typeof lineInput>) {
    return {
      tenantId,
      jobcardId,
      kind: l.kind,
      itemId: l.itemId ?? null,
      description: l.description,
      qty: String(roundQty(l.qty)),
      rate: l.rate,
      gstRate: l.gstRate,
      hsn: l.hsn,
      unit: l.unit,
    };
  }

  /** Takes in a job: number, tracking token and a "created" event; lines (an estimate) are optional. */
  async create(tenantId: string, input: unknown, userId: string | null = null): Promise<JobView> {
    const b = createInput.parse(input);
    const fields = this.fieldsFor(b.template, b.fields);
    const id = await this.db.transaction(async (tx) => {
      const number = await this.nextNumber(tx, tenantId);
      const [row] = await tx
        .insert(jobcards)
        .values({
          tenantId,
          number,
          template: b.template,
          customerName: b.customerName,
          customerPhone: b.customerPhone,
          customerId: b.customerId ?? null,
          fields,
          dueDate: b.dueDate,
          assigneeName: b.assigneeName,
          assigneeUserId: b.assigneeUserId ?? null,
          priority: b.priority,
          advance: b.advance,
          notes: b.notes,
          trackToken: trackToken(),
          createdBy: userId,
        })
        .returning();
      if (b.lines?.length) await tx.insert(jobcardLines).values(b.lines.map((l) => this.lineValues(tenantId, row!.id, l)));
      await this.event(tx, tenantId, row!.id, "created", { to: "received", userId });
      return row!.id;
    });
    return this.get(tenantId, id);
  }

  private assertOpen(row: JobcardRow) {
    if (isClosed(row.status)) throw new AppError(409, "job_closed", row.status === "delivered" ? "This job was delivered" : "This job was cancelled");
  }

  private assertEditableLines(row: JobcardRow) {
    this.assertOpen(row);
    if (row.invoiceId) throw new AppError(409, "job_billed", "This job is billed: change the bill instead");
  }

  /** Details, customer, due date, assignee, priority, notes or advance of a job still in the shop. */
  async update(tenantId: string, id: string, input: unknown): Promise<JobView> {
    const b = updateInput.parse(input);
    await this.db.transaction(async (tx) => {
      const row = await this.row(tenantId, id, tx, true);
      this.assertOpen(row);
      const { fields: rawFields, ...rest } = b;
      const set: Partial<typeof jobcards.$inferInsert> = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (rawFields !== undefined) set.fields = this.fieldsFor(row.template, rawFields);
      await tx
        .update(jobcards)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(jobcards.id, id));
    });
    return this.get(tenantId, id);
  }

  /** A note on the timeline ("customer approved ₹1,800 on call"). */
  async addNote(tenantId: string, id: string, input: unknown, userId: string | null = null): Promise<JobView> {
    const { note } = noteInput.parse(input);
    await this.row(tenantId, id);
    await this.event(this.db, tenantId, id, "note", { note, userId });
    await this.db.update(jobcards).set({ updatedAt: new Date() }).where(eq(jobcards.id, id));
    return this.get(tenantId, id);
  }

  // ---------------------------------------------------------------- status

  private summaryFor(row: JobcardRow, totals: JobTotals): JobSummary {
    return {
      id: row.id,
      number: row.number,
      label: formatJobNumber(row.number),
      template: row.template,
      status: row.status,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      dueDate: row.dueDate,
      total: totals.total,
      balance: totals.balance,
      trackToken: row.trackToken,
    };
  }

  /** Tells the notify port (ready / delivered). Never throws. */
  private notify(tenantId: string, job: JobView) {
    if (!this.deps.notify || (job.status !== "ready" && job.status !== "delivered")) return;
    try {
      void Promise.resolve(this.deps.notify.statusChanged(tenantId, this.summaryFor(job, job.totals))).catch((err) =>
        this.log.warn({ err, tenantId, jobId: job.id }, "jobcards: notify failed"),
      );
    } catch (err) {
      this.log.warn({ err, tenantId, jobId: job.id }, "jobcards: notify failed");
    }
  }

  private async moveTx(tx: Tx, tenantId: string, row: JobcardRow, to: JobStatus, note: string | null, userId: string | null) {
    const totals = jobTotals(this.toLines(await this.lineRows(tenantId, row.id, tx)), row.advance);
    const block = moveBlock(row.status, to, { billed: !!row.invoiceId, total: totals.total });
    if (block === "not_billed") throw new AppError(409, "not_billed", "Bill this job before delivering it");
    if (block === "same") return;
    if (block) throw new AppError(409, "job_move", `A ${row.status.replace(/_/g, " ")} job can't go to ${to.replace(/_/g, " ")}`);
    await tx
      .update(jobcards)
      .set({ status: to, closedAt: isClosed(to) ? this.now() : null, updatedAt: new Date() })
      .where(eq(jobcards.id, row.id));
    await this.event(tx, tenantId, row.id, "status", { from: row.status, to, note, userId });
  }

  /** Moves a job along the flow (see `moveBlock` for what's allowed). Ready / delivered tell the notify port. */
  async moveStatus(tenantId: string, id: string, input: unknown, userId: string | null = null): Promise<JobView> {
    const b = moveInput.parse(input);
    if (b.status === "cancelled") return this.cancel(tenantId, id, { reason: b.note ?? "" }, userId);
    let moved = false;
    await this.db.transaction(async (tx) => {
      const row = await this.row(tenantId, id, tx, true);
      moved = row.status !== b.status;
      await this.moveTx(tx, tenantId, row, b.status, b.note, userId);
    });
    const job = await this.get(tenantId, id);
    if (moved) this.notify(tenantId, job);
    return job;
  }

  /** Cancels a job that wasn't delivered, with a reason on the timeline. */
  async cancel(tenantId: string, id: string, input: unknown, userId: string | null = null): Promise<JobView> {
    const { reason } = cancelInput.parse(input);
    await this.db.transaction(async (tx) => {
      const row = await this.row(tenantId, id, tx, true);
      if (row.status === "cancelled") return;
      await this.moveTx(tx, tenantId, row, "cancelled", reason, userId);
    });
    return this.get(tenantId, id);
  }

  // ---------------------------------------------------------------- lines

  async addLine(tenantId: string, id: string, input: unknown, userId: string | null = null): Promise<JobView> {
    const l = lineInput.parse(input);
    await this.db.transaction(async (tx) => {
      this.assertEditableLines(await this.row(tenantId, id, tx, true));
      await tx.insert(jobcardLines).values(this.lineValues(tenantId, id, l));
      await this.event(tx, tenantId, id, "estimate", { note: `Added ${l.description}`, userId });
      await tx.update(jobcards).set({ updatedAt: new Date() }).where(eq(jobcards.id, id));
    });
    return this.get(tenantId, id);
  }

  private async lineRow(tx: Db | Tx, tenantId: string, jobcardId: string, lineId: string): Promise<JobcardLineRow> {
    const [row] = await tx
      .select()
      .from(jobcardLines)
      .where(and(eq(jobcardLines.tenantId, tenantId), eq(jobcardLines.jobcardId, jobcardId), eq(jobcardLines.id, lineId)))
      .limit(1);
    if (!row) throw notFound("Job line");
    return row;
  }

  async updateLine(tenantId: string, id: string, lineId: string, input: unknown, userId: string | null = null): Promise<JobView> {
    const b = linePatch.parse(input);
    await this.db.transaction(async (tx) => {
      this.assertEditableLines(await this.row(tenantId, id, tx, true));
      const line = await this.lineRow(tx, tenantId, id, lineId);
      const set: Partial<typeof jobcardLines.$inferInsert> = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
      if (b.qty !== undefined) set.qty = String(roundQty(b.qty));
      await tx
        .update(jobcardLines)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(jobcardLines.id, lineId));
      await this.event(tx, tenantId, id, "estimate", { note: `Changed ${b.description ?? line.description}`, userId });
      await tx.update(jobcards).set({ updatedAt: new Date() }).where(eq(jobcards.id, id));
    });
    return this.get(tenantId, id);
  }

  async removeLine(tenantId: string, id: string, lineId: string, userId: string | null = null): Promise<JobView> {
    await this.db.transaction(async (tx) => {
      this.assertEditableLines(await this.row(tenantId, id, tx, true));
      const line = await this.lineRow(tx, tenantId, id, lineId);
      await tx.delete(jobcardLines).where(eq(jobcardLines.id, lineId));
      await this.event(tx, tenantId, id, "estimate", { note: `Removed ${line.description}`, userId });
      await tx.update(jobcards).set({ updatedAt: new Date() }).where(eq(jobcards.id, id));
    });
    return this.get(tenantId, id);
  }

  // ---------------------------------------------------------------- bill

  /**
   * Bills the job's lines through invoices (one issued GST bill) and records it on the card. A job not ready yet moves
   * to `ready`. The row stays locked while the bill is made, so two devices can't bill it twice.
   */
  async bill(tenant: TenantRef, id: string, input: unknown = {}, opts: { branchId?: string | null; userId?: string | null } = {}): Promise<{ job: JobView; bill: BillResult }> {
    const b = billInput.parse(input);
    const billing = this.deps.billing;
    if (!billing) throw new AppError(501, "billing_unavailable", "Billing is not available");
    const tenantId = tenant.id;
    let movedToReady = false;
    const bill = await this.db.transaction(async (tx) => {
      const row = await this.row(tenantId, id, tx, true);
      if (row.status === "cancelled") throw new AppError(409, "job_closed", "This job was cancelled");
      if (row.invoiceId) throw conflict("This job is already billed");
      const lines = await this.lineRows(tenantId, id, tx);
      if (lines.length === 0) throw badRequest("Nothing to bill: add parts or labour first");
      const label = formatJobNumber(row.number);
      const what = fieldsSummary(row.template, row.fields ?? {});
      let r: BillResult;
      try {
        r = await billing.createBill(
          tenant,
          {
            lines: lines.map((l) => ({ description: l.description, itemId: l.itemId, qty: toNum(l.qty), rate: l.rate, gstRate: l.gstRate, hsn: l.hsn, unit: l.unit })),
            customer: { name: row.customerName, phone: row.customerPhone },
            notes: `Job card ${label}${what ? ` · ${what}` : ""}`,
            tillSessionId: b.tillSessionId ?? null,
          },
          { branchId: opts.branchId ?? null },
        );
      } catch (err) {
        this.log.error({ err, tenantId, jobId: id }, "jobcards: billing failed");
        throw err;
      }
      await tx
        .update(jobcards)
        .set({ invoiceId: r.id, invoiceNumber: r.number, updatedAt: new Date() })
        .where(eq(jobcards.id, id));
      await this.event(tx, tenantId, id, "billed", { note: r.number, userId: opts.userId ?? null });
      if ((JOB_FLOW as readonly JobStatus[]).indexOf(row.status) < JOB_FLOW.indexOf("ready")) {
        await tx
          .update(jobcards)
          .set({ status: "ready", updatedAt: new Date() })
          .where(eq(jobcards.id, id));
        await this.event(tx, tenantId, id, "status", { from: row.status, to: "ready", userId: opts.userId ?? null });
        movedToReady = true;
      }
      return r;
    });
    const job = await this.get(tenantId, id);
    if (movedToReady) this.notify(tenantId, job);
    return { job, bill };
  }

  // ---------------------------------------------------------------- tracking link

  /** The customer's view of a job by its tracking token (only this shop's jobs). */
  async track(tenantId: string, token: string): Promise<JobTrack | null> {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
    const [row] = await this.db
      .select({ job: jobcards, total: totalSql })
      .from(jobcards)
      .where(and(eq(jobcards.tenantId, tenantId), eq(jobcards.trackToken, token)))
      .limit(1);
    if (!row) return null;
    const events = await this.db
      .select({ type: jobcardEvents.type, toStatus: jobcardEvents.toStatus, createdAt: jobcardEvents.createdAt })
      .from(jobcardEvents)
      .where(and(eq(jobcardEvents.tenantId, tenantId), eq(jobcardEvents.jobcardId, row.job.id), inArray(jobcardEvents.type, ["created", "status"])))
      .orderBy(asc(jobcardEvents.createdAt), asc(jobcardEvents.id));
    return {
      label: formatJobNumber(row.job.number),
      number: row.job.number,
      template: row.job.template,
      status: row.job.status,
      dueDate: row.job.dueDate,
      total: Math.round(toNum(row.total)),
      createdAt: row.job.createdAt,
      timeline: events.filter((e) => e.toStatus).map((e) => ({ status: e.toStatus!, at: e.createdAt })),
    };
  }
}
