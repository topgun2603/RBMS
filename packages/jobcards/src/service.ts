import { randomBytes } from "node:crypto";
import { AppError, badRequest, conflict, defineSort, facetCounts, listFilter, listQuerySchema, notFound, runList, searchAny, type ListPage, type TenantRef } from "@srirealtime/core";
import type { Db, Tx } from "@srirealtime/db";
import { todayIST } from "@srirealtime/gst";
import { and, asc, count, eq, inArray, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  allowedMoves,
  APPROVAL_CHANNELS,
  APPROVAL_DECISIONS,
  approvalText,
  canRespondOnline,
  currentApproval,
  formatJobNumber,
  isClosed,
  isOverdue,
  jobTotals,
  joinFields,
  lineAmount,
  lineSerialsProblem,
  lineTax,
  moveBlock,
  nextSteps,
  normaliseSerial,
  parseJobNumber,
  phoneMatches,
  roundQty,
  SERIAL_RE,
  splitFields,
  type ApprovalChannel,
  type ApprovalDecision,
  type JobApproval,
  type JobMeta,
  type JobTotals,
} from "./logic";
import { NOTIFY_STATUSES, noopLogger, type BillingPort, type BillResult, type JobSummary, type LoggerPort, type NotifyPort, type SerialStockPort } from "./ports";
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
  /** Checks serial numbers put on part lines against the shop's serial stock (serials module). */
  serials?: SerialStockPort;
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
    /**
     * Serial numbers / IMEIs of the units on a part from stock (an SSD, a battery), picked from the item's units on the
     * shelf: passed to the bill, which marks them sold and starts their warranty. Replaces the line's list when given.
     */
    serials: z
      .array(z.string().transform(normaliseSerial).pipe(z.string().regex(SERIAL_RE, "Serial numbers: 3 to 40 letters, digits, / and -")))
      .max(200)
      .optional(),
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
export const billInput = z.object({ tillSessionId: z.string().uuid().nullish(), /** Credit terms for a saved customer (YYYY-MM-DD). */ dueDate: optDate }).strict();
export type BillInput = z.input<typeof billInput>;

/** Staff record the customer's answer to the estimate (approval channels other than the tracking page). */
export const approvalInput = z
  .object({
    decision: z.enum(APPROVAL_DECISIONS),
    /** Who answered; the customer's name when left out. */
    by: optText(120),
    channel: z.enum(APPROVAL_CHANNELS.filter((c) => c !== "online") as [ApprovalChannel, ...ApprovalChannel[]]).default("in_person"),
    /** When the customer answered (default now; not in the future). */
    at: z.coerce.date().optional(),
    note: optText(500),
  })
  .strict();
export type ApprovalInput = z.input<typeof approvalInput>;

/** The customer answers on the tracking page. */
export const publicApprovalInput = z.object({ decision: z.enum(["approve", "decline"]), note: optText(300) }).strict();
export type PublicApprovalInput = z.input<typeof publicApprovalInput>;

/** "Track my repair": the job number from the receipt and the last 4 digits of the phone given at intake. */
export const findJobInput = z
  .object({
    number: z.string().trim().min(1).max(20),
    phoneLast4: z.string().trim().regex(/^\d{4}$/, "The last 4 digits of your phone number"),
  })
  .strict();
export type FindJobInput = z.input<typeof findJobInput>;

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
  /** The customer's answer to the estimate now asked (null: not answered, or never asked). */
  approval: JobApproval | null;
}

export interface JobLine extends Omit<JobcardLineRow, "qty"> {
  qty: number;
  /** Before GST. */
  amount: number;
  tax: number;
  /** Serial numbers / IMEIs of the units on this part line. */
  serials: string[];
}

export interface JobView extends JobcardSummary {
  lines: JobLine[];
  events: JobcardEventRow[];
  totals: JobTotals;
  /** Statuses the job may move to now. */
  moves: JobStatus[];
  /** The stepper's forward button(s). */
  next: JobStatus[];
  /** When the job was last sent for approval (ISO), if ever. */
  approvalRequestedAt: string | null;
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
  /** The answer to the estimate now asked: decision, how and when (no names, no address). */
  approval: { decision: ApprovalDecision; channel: ApprovalChannel; at: string; amount: number } | null;
  /** The customer can approve or decline the estimate on this page now. */
  canRespond: boolean;
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
    const { fields, meta } = splitFields(row.fields);
    return {
      ...row,
      fields,
      label: formatJobNumber(row.number),
      summary: fieldsSummary(row.template, fields),
      overdue: isOverdue(row.dueDate, row.status, today),
      total,
      approval: currentApproval(meta),
    };
  }

  /** Saves the card's `_meta` (the row must be locked by the caller's transaction). */
  private async saveMeta(tx: Db | Tx, row: JobcardRow, meta: JobMeta) {
    const fields = joinFields(splitFields(row.fields).fields, meta);
    row.fields = fields;
    await tx.update(jobcards).set({ fields, updatedAt: this.now() }).where(eq(jobcards.id, row.id));
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

  private toLines(rows: JobcardLineRow[], meta: JobMeta = {}): JobLine[] {
    return rows.map((r) => {
      const l = { qty: toNum(r.qty), rate: r.rate, gstRate: r.gstRate };
      return { ...r, qty: l.qty, amount: lineAmount(l), tax: lineTax(l), serials: meta.serials?.[r.id] ?? [] };
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
    const { meta } = splitFields(row.fields);
    const lines = this.toLines(lineRows, meta);
    const totals = jobTotals(lines, row.advance);
    const ctx = { billed: !!row.invoiceId, total: totals.total, approval: currentApproval(meta)?.decision ?? null };
    return {
      ...this.summaryOf(row, totals.total, this.today()),
      lines,
      events,
      totals,
      moves: allowedMoves(row.status, ctx),
      next: nextSteps(row.status, ctx),
      approvalRequestedAt: meta.approvalRequestedAt ?? null,
    };
  }

  /** Parts and labour with the amount, GST per line and totals (advance and balance included). */
  async estimate(tenantId: string, id: string): Promise<{ lines: JobLine[]; totals: JobTotals }> {
    const row = await this.row(tenantId, id);
    const lines = this.toLines(await this.lineRows(tenantId, id), splitFields(row.fields).meta);
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
    // `_meta` is the service's own: never taken from the client.
    const raw = input && typeof input === "object" && !Array.isArray(input) ? splitFields(input as Record<string, unknown>).fields : input;
    return z.object({ fields: TEMPLATE_FIELDS[template] }).parse({ fields: raw ?? {} }).fields as Record<string, unknown>;
  }

  /** Normalised serials of a line, checked: on a part from stock, one per unit, not on another line, on the shelf. */
  private async checkSerials(tenantId: string, l: { kind: "part" | "labour"; itemId: string | null; qty: number; serials: string[] }, elsewhere: string[]): Promise<string[]> {
    const serials = [...l.serials];
    const problem = lineSerialsProblem({ ...l, serials }, elsewhere);
    if (problem) throw badRequest(problem);
    if (serials.length === 0) return serials;
    if (!this.deps.serials) throw new AppError(501, "serials_unavailable", "Serial numbers are not available for this shop");
    const missing = await this.deps.serials.unavailable(tenantId, l.itemId!, serials);
    if (missing.length) throw new AppError(409, "serial_unavailable", `Not in stock for this item: ${missing.join(", ")}`, { serials: missing });
    return serials;
  }

  private static otherSerials(meta: JobMeta, lineId: string | null): string[] {
    return Object.entries(meta.serials ?? {})
      .filter(([id]) => id !== lineId)
      .flatMap(([, v]) => v);
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
    const lineSerials: string[][] = [];
    for (const l of b.lines ?? []) {
      lineSerials.push(await this.checkSerials(tenantId, { kind: l.kind, itemId: l.itemId ?? null, qty: l.qty, serials: l.serials ?? [] }, lineSerials.flat()));
    }
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
          createdAt: this.now(),
          updatedAt: this.now(),
        })
        .returning();
      if (b.lines?.length) {
        const ids = await tx
          .insert(jobcardLines)
          .values(b.lines.map((l) => this.lineValues(tenantId, row!.id, l)))
          .returning({ id: jobcardLines.id });
        const serials = Object.fromEntries(ids.map((r, i) => [r.id, lineSerials[i] ?? []]));
        if (Object.values(serials).some((v) => v.length)) await this.saveMeta(tx, row!, { serials });
      }
      await this.event(tx, tenantId, row!.id, "created", { to: "received", userId });
      return row!.id;
    });
    const job = await this.get(tenantId, id);
    this.notify(tenantId, job);
    return job;
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
      if (rawFields !== undefined) set.fields = joinFields(this.fieldsFor(row.template, rawFields), splitFields(row.fields).meta);
      await tx
        .update(jobcards)
        .set({ ...set, updatedAt: this.now() })
        .where(eq(jobcards.id, id));
    });
    return this.get(tenantId, id);
  }

  /** A note on the timeline ("customer approved ₹1,800 on call"). */
  async addNote(tenantId: string, id: string, input: unknown, userId: string | null = null): Promise<JobView> {
    const { note } = noteInput.parse(input);
    await this.row(tenantId, id);
    await this.event(this.db, tenantId, id, "note", { note, userId });
    await this.db.update(jobcards).set({ updatedAt: this.now() }).where(eq(jobcards.id, id));
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

  /** Tells the notify port (received at intake, awaiting approval, ready, delivered). Never throws. */
  private notify(tenantId: string, job: JobView) {
    if (!this.deps.notify || !NOTIFY_STATUSES.includes(job.status)) return;
    try {
      void Promise.resolve(this.deps.notify.statusChanged(tenantId, this.summaryFor(job, job.totals))).catch((err) =>
        this.log.warn({ err, tenantId, jobId: job.id }, "jobcards: notify failed"),
      );
    } catch (err) {
      this.log.warn({ err, tenantId, jobId: job.id }, "jobcards: notify failed");
    }
  }

  private async moveTx(tx: Tx, tenantId: string, row: JobcardRow, to: JobStatus, note: string | null, userId: string | null) {
    const { meta } = splitFields(row.fields);
    const totals = jobTotals(this.toLines(await this.lineRows(tenantId, row.id, tx)), row.advance);
    const block = moveBlock(row.status, to, { billed: !!row.invoiceId, total: totals.total, approval: currentApproval(meta)?.decision ?? null });
    if (block === "not_billed") throw new AppError(409, "not_billed", "Bill this job before delivering it");
    if (block === "same") return;
    if (block === "needs_approval") {
      throw new AppError(409, "needs_approval", to === "approved" ? "Record the customer's approval first" : "Record the customer's answer to the estimate first");
    }
    if (block) throw new AppError(409, "job_move", `A ${row.status.replace(/_/g, " ")} job can't go to ${to.replace(/_/g, " ")}`);
    // Sent (again) for approval: an earlier answer was for an older estimate.
    if (to === "awaiting_approval") await this.saveMeta(tx, row, { ...meta, approvalRequestedAt: this.now().toISOString() });
    await tx
      .update(jobcards)
      .set({ status: to, closedAt: isClosed(to) ? this.now() : null, updatedAt: this.now() })
      .where(eq(jobcards.id, row.id));
    await this.event(tx, tenantId, row.id, "status", { from: row.status, to, note, userId });
  }

  /** Moves a job along the flow (see `moveBlock` for what's allowed). Approval, ready and delivered tell the notify port. */
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

  // ---------------------------------------------------------------- approval

  /**
   * Records the customer's answer to the estimate in the row's transaction: the approval on the card (who, how, when,
   * the total answered) and the timeline; approved → `approved`, declined → back to `diagnosed` when it was waiting.
   */
  private async decideTx(tx: Tx, tenantId: string, row: JobcardRow, a: Omit<JobApproval, "amount">, userId: string | null): Promise<JobApproval> {
    const { meta } = splitFields(row.fields);
    const totals = jobTotals(this.toLines(await this.lineRows(tenantId, row.id, tx)), row.advance);
    const approval: JobApproval = { ...a, amount: totals.total };
    await this.saveMeta(tx, row, { ...meta, approval });
    await this.event(tx, tenantId, row.id, "approval", { note: [approvalText(approval), approval.note].filter(Boolean).join("\n"), userId });
    if (approval.decision === "approved") await this.moveTx(tx, tenantId, row, "approved", null, userId);
    else if (row.status === "awaiting_approval") await this.moveTx(tx, tenantId, row, "diagnosed", null, userId);
    return approval;
  }

  /**
   * Staff record that the customer approved (or declined) the estimate — at the counter, on a call, on WhatsApp… — with
   * who and when. Jobs not yet sent for approval may be approved directly (told at intake).
   */
  async recordApproval(tenantId: string, id: string, input: unknown, userId: string | null = null): Promise<JobView> {
    const b = approvalInput.parse(input);
    const at = b.at ?? this.now();
    if (Number.isNaN(at.getTime()) || at.getTime() > this.now().getTime() + 5 * 60_000) throw badRequest("The approval time can't be in the future");
    await this.db.transaction(async (tx) => {
      const row = await this.row(tenantId, id, tx, true);
      this.assertOpen(row);
      if (row.invoiceId) throw new AppError(409, "job_billed", "This job is already billed");
      const before = JOB_FLOW.indexOf("approved");
      if ((JOB_FLOW as readonly JobStatus[]).indexOf(row.status) >= before) throw new AppError(409, "not_awaiting_approval", "This job is already past approval");
      if (b.decision === "declined" && row.status !== "awaiting_approval") throw new AppError(409, "not_awaiting_approval", "Ask for approval before recording a decline");
      await this.decideTx(tx, tenantId, row, { decision: b.decision, by: b.by ?? row.customerName, channel: b.channel, at: at.toISOString(), note: b.note, recordedBy: userId }, userId);
    });
    return this.get(tenantId, id);
  }

  /**
   * The customer approves or declines the estimate on the tracking page (only while it waits for approval and isn't
   * answered yet; 409 otherwise). Their address and browser are kept with the answer; the shop is told.
   */
  async publicRespond(tenantId: string, token: string, input: unknown, client: { ip?: string | null; userAgent?: string | null } = {}): Promise<JobTrack | null> {
    const b = publicApprovalInput.parse(input);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
    const [found] = await this.db
      .select({ id: jobcards.id })
      .from(jobcards)
      .where(and(eq(jobcards.tenantId, tenantId), eq(jobcards.trackToken, token)))
      .limit(1);
    if (!found) return null;
    const decided = await this.db.transaction(async (tx) => {
      const row = await this.row(tenantId, found.id, tx, true);
      const { meta } = splitFields(row.fields);
      const totals = jobTotals(this.toLines(await this.lineRows(tenantId, row.id, tx)), row.advance);
      if (!canRespondOnline(row.status, totals.total, currentApproval(meta))) {
        throw new AppError(409, "not_awaiting_approval", "This estimate isn't waiting for your answer any more. Please call the shop.");
      }
      const approval = await this.decideTx(
        tx,
        tenantId,
        row,
        {
          decision: b.decision === "approve" ? "approved" : "declined",
          by: row.customerName,
          channel: "online",
          at: this.now().toISOString(),
          note: b.note,
          recordedBy: null,
          ip: client.ip ? client.ip.slice(0, 64) : null,
          userAgent: client.userAgent ? client.userAgent.slice(0, 300) : null,
        },
        null,
      );
      return { approval, summary: this.summaryFor(row, totals) };
    });
    this.tellShop(tenantId, { ...decided.summary, status: decided.approval.decision === "approved" ? "approved" : "diagnosed" }, decided.approval);
    return this.track(tenantId, token);
  }

  /** The shop hears about an answer given online. Never throws. */
  private tellShop(tenantId: string, job: JobSummary, approval: JobApproval) {
    const fn = this.deps.notify?.approvalDecided;
    if (!fn) return;
    try {
      void Promise.resolve(fn.call(this.deps.notify, tenantId, job, approval)).catch((err) => this.log.warn({ err, tenantId, jobId: job.id }, "jobcards: approval notice failed"));
    } catch (err) {
      this.log.warn({ err, tenantId, jobId: job.id }, "jobcards: approval notice failed");
    }
  }

  // ---------------------------------------------------------------- lines

  async addLine(tenantId: string, id: string, input: unknown, userId: string | null = null): Promise<JobView> {
    const l = lineInput.parse(input);
    await this.db.transaction(async (tx) => {
      const row = await this.row(tenantId, id, tx, true);
      this.assertEditableLines(row);
      const { meta } = splitFields(row.fields);
      const serials = await this.checkSerials(tenantId, { kind: l.kind, itemId: l.itemId ?? null, qty: l.qty, serials: l.serials ?? [] }, JobcardsService.otherSerials(meta, null));
      const [added] = await tx.insert(jobcardLines).values(this.lineValues(tenantId, id, l)).returning({ id: jobcardLines.id });
      if (serials.length) await this.saveMeta(tx, row, { ...meta, serials: { ...meta.serials, [added!.id]: serials } });
      await this.event(tx, tenantId, id, "estimate", { note: `Added ${l.description}`, userId });
      await tx.update(jobcards).set({ updatedAt: this.now() }).where(eq(jobcards.id, id));
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
    const { serials: newSerials, ...b } = linePatch.parse(input);
    await this.db.transaction(async (tx) => {
      const row = await this.row(tenantId, id, tx, true);
      this.assertEditableLines(row);
      const line = await this.lineRow(tx, tenantId, id, lineId);
      const { meta } = splitFields(row.fields);
      const current = meta.serials?.[lineId] ?? [];
      const next = { kind: b.kind ?? line.kind, itemId: b.itemId !== undefined ? (b.itemId ?? null) : line.itemId, qty: b.qty ?? toNum(line.qty), serials: newSerials ?? current };
      // Units already on the line stay valid; only newly added ones are checked against the shelf.
      const added = next.serials.filter((s) => !current.includes(s));
      const problem = lineSerialsProblem(next, JobcardsService.otherSerials(meta, lineId));
      if (problem) throw badRequest(problem);
      if (added.length) await this.checkSerials(tenantId, { ...next, serials: added }, []);
      if (newSerials !== undefined || next.serials.length !== current.length) {
        await this.saveMeta(tx, row, { ...meta, serials: { ...meta.serials, [lineId]: next.serials } });
      }
      const set: Partial<typeof jobcardLines.$inferInsert> = Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));
      if (b.qty !== undefined) set.qty = String(roundQty(b.qty));
      await tx
        .update(jobcardLines)
        .set({ ...set, updatedAt: this.now() })
        .where(eq(jobcardLines.id, lineId));
      await this.event(tx, tenantId, id, "estimate", { note: `Changed ${b.description ?? line.description}`, userId });
      await tx.update(jobcards).set({ updatedAt: this.now() }).where(eq(jobcards.id, id));
    });
    return this.get(tenantId, id);
  }

  async removeLine(tenantId: string, id: string, lineId: string, userId: string | null = null): Promise<JobView> {
    await this.db.transaction(async (tx) => {
      const row = await this.row(tenantId, id, tx, true);
      this.assertEditableLines(row);
      const line = await this.lineRow(tx, tenantId, id, lineId);
      await tx.delete(jobcardLines).where(eq(jobcardLines.id, lineId));
      const { meta } = splitFields(row.fields);
      if (meta.serials?.[lineId]) {
        const { [lineId]: _gone, ...rest } = meta.serials;
        await this.saveMeta(tx, row, { ...meta, serials: rest });
      }
      await this.event(tx, tenantId, id, "estimate", { note: `Removed ${line.description}`, userId });
      await tx.update(jobcards).set({ updatedAt: this.now() }).where(eq(jobcards.id, id));
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
      const { fields, meta } = splitFields(row.fields);
      const what = fieldsSummary(row.template, fields);
      // Units picked on part lines must still be on the shelf: the bill marks them sold and starts their warranty.
      if (this.deps.serials) {
        for (const l of lines) {
          const serials = meta.serials?.[l.id] ?? [];
          if (!serials.length || !l.itemId) continue;
          const missing = await this.deps.serials.unavailable(tenantId, l.itemId, serials);
          if (missing.length) throw new AppError(409, "serial_unavailable", `${l.description}: no longer in stock: ${missing.join(", ")}`, { serials: missing });
        }
      }
      let r: BillResult;
      try {
        r = await billing.createBill(
          tenant,
          {
            lines: lines.map((l) => ({
              description: l.description,
              itemId: l.itemId,
              qty: toNum(l.qty),
              rate: l.rate,
              gstRate: l.gstRate,
              hsn: l.hsn,
              unit: l.unit,
              ...(meta.serials?.[l.id]?.length && l.itemId ? { serials: meta.serials[l.id] } : {}),
            })),
            customer: { name: row.customerName, phone: row.customerPhone, customerId: row.customerId ?? null, dueDate: b.dueDate ?? null },
            notes: `Job card ${label}${what ? ` · ${what}` : ""}`,
            tillSessionId: b.tillSessionId ?? null,
            // The advance taken at intake is already paid: recorded on the bill so its balance is total − advance.
            advance: row.advance > 0 ? { amount: row.advance, date: todayIST(row.createdAt), reference: `Advance on ${label}` } : null,
          },
          { branchId: opts.branchId ?? null },
        );
      } catch (err) {
        this.log.error({ err, tenantId, jobId: id }, "jobcards: billing failed");
        throw err;
      }
      await tx
        .update(jobcards)
        .set({ invoiceId: r.id, invoiceNumber: r.number, updatedAt: this.now() })
        .where(eq(jobcards.id, id));
      await this.event(tx, tenantId, id, "billed", { note: r.number, userId: opts.userId ?? null });
      if ((JOB_FLOW as readonly JobStatus[]).indexOf(row.status) < JOB_FLOW.indexOf("ready")) {
        await tx
          .update(jobcards)
          .set({ status: "ready", updatedAt: this.now() })
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
    const { meta } = splitFields(row.job.fields);
    const approval = currentApproval(meta);
    const total = Math.round(toNum(row.total));
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
      total,
      createdAt: row.job.createdAt,
      timeline: events.filter((e) => e.toStatus).map((e) => ({ status: e.toStatus!, at: e.createdAt })),
      approval: approval ? { decision: approval.decision, channel: approval.channel, at: approval.at, amount: approval.amount } : null,
      canRespond: canRespondOnline(row.job.status, total, approval),
    };
  }

  /**
   * "Track my repair": the job's tracking token for its number ("JC-0007", "7") and the last 4 digits of the phone
   * given at intake; null when there is no such job or the digits don't match (callers answer the same either way).
   */
  async findTrackToken(tenantId: string, input: unknown): Promise<string | null> {
    const b = findJobInput.parse(input);
    const n = parseJobNumber(b.number);
    if (n === null) return null;
    const [row] = await this.db
      .select({ token: jobcards.trackToken, phone: jobcards.customerPhone })
      .from(jobcards)
      .where(and(eq(jobcards.tenantId, tenantId), eq(jobcards.number, n)))
      .limit(1);
    return row && phoneMatches(row.phone, b.phoneLast4) ? row.token : null;
  }
}
