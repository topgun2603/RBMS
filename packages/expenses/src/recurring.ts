/**
 * Recurring expenses (docs/expenses-debit-notes.md): rent, electricity, subscriptions, a salary-like fixed payment (staff
 * payroll lives in packages/payroll). Each one makes an expense on its dates — recorded and posted to the books, or a
 * draft to check; with "ask each time" (no amount) always a draft whose amount the owner fills in.
 *
 * Same approach as recurring invoices (packages/invoices/src/recurring.ts): the schedule maths is shared
 * (`@srirealtime/core` schedule.ts); every date is a run row unique per (recurring, date), and the run row and its
 * expense are written in one transaction, so a job that runs twice — or two at once — never makes a second expense.
 * The latest `CATCH_UP_LIMIT` missed dates are made, older ones recorded as skipped; dates in a locked accounting
 * period are recorded as locked and make nothing.
 */
import {
  addDaysIso,
  AppError,
  badRequest,
  CATCH_UP_LIMIT,
  conflict,
  listFilter,
  listQuerySchema,
  nextAfter,
  nextOnOrAfter,
  notFound,
  planDue,
  previewDates,
  runList,
  scheduleProblem,
  SCHEDULE_FREQUENCIES,
  type ListPage,
  type Schedule,
} from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { GST_RATES, isValidDate, normalizeGstin, todayIST } from "@srirealtime/gst";
import { and, asc, count, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import type { LoggerPort } from "./ports";
import {
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_RECURRING_MODES,
  EXPENSE_RECURRING_STATUSES,
  expenseRecurring,
  expenseRecurringRuns,
  expenses,
  type ExpenseRecurringRow,
  type ExpenseRecurringRunRow,
  type ExpenseRunStatus,
} from "./schema";
import { MAX_PAISE, type ExpensesService } from "./service";

const date = z.string().refine(isValidDate, "Use a YYYY-MM-DD date");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const gstRate = z.number().refine((r) => (GST_RATES as readonly number[]).includes(r), "Not a GST rate");
const NOUN = { one: "date", many: "expenses" };

const fields = {
  name: z.string().trim().min(1).max(120),
  categoryId: z.string().uuid().optional(),
  supplierId: z.string().uuid().nullish(),
  /** Left out = the user's current branch; null = shop-wide. */
  branchId: z.string().uuid().nullish(),
  vendorName: optText(200),
  vendorGstin: optText(20).transform((v) => (v ? normalizeGstin(v) : null)),
  /** Paise including GST; null = ask each time (each date makes a draft to fill). */
  amount: z.number().int().positive().max(MAX_PAISE).nullable(),
  gstRate: gstRate.default(0),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).default("cash"),
  dueDays: z.number().int().min(0).max(365).nullish(),
  note: optText(1000),
  /** "auto" = recorded and posted on its date; "draft" = a draft to check. */
  mode: z.enum(EXPENSE_RECURRING_MODES).default("auto"),
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  interval: z.number().int().min(1).max(24).default(1),
  dayOfMonth: z.number().int().min(1).max(31).nullish(),
  weekday: z.number().int().min(0).max(6).nullish(),
  startDate: date,
  endDate: date.nullish(),
};
export const recurringExpenseInput = z.object(fields).strict();
export type RecurringExpenseInput = z.input<typeof recurringExpenseInput>;
export const recurringExpensePatch = z
  .object(fields)
  .partial()
  .extend({ gstRate: gstRate.optional(), paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).optional(), mode: z.enum(EXPENSE_RECURRING_MODES).optional(), interval: z.number().int().min(1).max(24).optional() })
  .strict();
export type RecurringExpensePatch = z.input<typeof recurringExpensePatch>;

export const recurringExpenseListQuery = listQuerySchema({ defaultLimit: 50, maxLimit: 200 }).extend({
  status: listFilter.oneOf(EXPENSE_RECURRING_STATUSES),
});
export type RecurringExpenseListQuery = z.input<typeof recurringExpenseListQuery>;

export interface RecurringExpenseRun {
  id: string;
  runDate: string;
  status: ExpenseRunStatus;
  expenseId: string | null;
  error: string | null;
  trigger: string;
  createdAt: Date;
}

export interface RecurringExpense extends ExpenseRecurringRow {
  /** True when each date makes a draft whose amount is filled in by hand. */
  askEachTime: boolean;
}

export interface RecurringExpenseDetail extends RecurringExpense {
  runs: RecurringExpenseRun[];
  /** The next dates it will make an expense on. */
  upcoming: string[];
}

export interface RecurringExpenseRunResult {
  recurring: number;
  created: number;
  drafts: number;
  skipped: number;
  locked: number;
  failed: number;
}

export interface RecurringExpenseDeps {
  db: Db;
  expenses: ExpensesService;
  lockedThrough?: (tenantId: string) => Promise<string | null>;
  isEnabled?: (tenantId: string, key: string) => Promise<boolean>;
  log?: LoggerPort;
  now?: () => Date;
}

const SCAN_LIMIT = 500;

const scheduleOf = (r: Pick<ExpenseRecurringRow, "frequency" | "interval" | "dayOfMonth" | "weekday" | "startDate" | "endDate">): Schedule => ({
  frequency: r.frequency,
  interval: r.interval,
  dayOfMonth: r.frequency === "weekly" ? null : r.dayOfMonth,
  weekday: r.frequency === "weekly" ? r.weekday : null,
  startDate: r.startDate,
  endDate: r.endDate,
});

const toRun = (r: ExpenseRecurringRunRow): RecurringExpenseRun => ({
  id: r.id,
  runDate: r.runDate,
  status: r.status,
  expenseId: r.expenseId,
  error: r.error,
  trigger: r.trigger,
  createdAt: r.createdAt,
});

const toRecurring = (r: ExpenseRecurringRow): RecurringExpense => ({ ...r, askEachTime: r.amount === null });

const errorText = (err: unknown): string => {
  if (err instanceof AppError) return err.message;
  if (err instanceof z.ZodError) return err.issues.map((i) => i.message).join("; ");
  return err instanceof Error ? err.message : String(err);
};

export class RecurringExpensesService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: RecurringExpenseDeps) {
    this.db = deps.db;
    this.log = deps.log ?? { info() {}, warn() {}, error() {} };
    this.now = deps.now ?? (() => new Date());
  }

  private today() {
    return todayIST(this.now());
  }

  private checkSchedule(s: Schedule) {
    const problem = scheduleProblem(s, NOUN);
    if (problem) throw badRequest(problem);
  }

  /** The first date on or after today (or the start date, when later). */
  private firstDate(s: Schedule): string | null {
    const today = this.today();
    return nextOnOrAfter(s, s.startDate > today ? s.startDate : today);
  }

  private async row(tenantId: string, id: string, db: DbOrTx = this.db, lock = false): Promise<ExpenseRecurringRow> {
    const q = db
      .select()
      .from(expenseRecurring)
      .where(and(eq(expenseRecurring.tenantId, tenantId), eq(expenseRecurring.id, id)))
      .limit(1);
    const [r] = lock ? await q.for("update") : await q;
    if (!r) throw notFound("Recurring expense");
    return r;
  }

  async list(tenantId: string, query: RecurringExpenseListQuery = {}): Promise<ListPage<RecurringExpense>> {
    const p = recurringExpenseListQuery.parse(query);
    const where = and(
      eq(expenseRecurring.tenantId, tenantId),
      p.status?.length ? inArray(expenseRecurring.status, p.status) : undefined,
      p.q ? sql`${expenseRecurring.name} ilike ${`%${p.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}` : undefined,
    );
    return runList(p, {
      rows: () =>
        this.db
          .select()
          .from(expenseRecurring)
          .where(where)
          .orderBy(sql`${expenseRecurring.nextRunDate} asc nulls last`, asc(expenseRecurring.name), asc(expenseRecurring.id))
          .limit(p.limit)
          .offset(p.offset),
      count: () => this.db.select({ total: count() }).from(expenseRecurring).where(where),
      map: toRecurring,
    });
  }

  async get(tenantId: string, id: string): Promise<RecurringExpenseDetail> {
    const r = await this.row(tenantId, id);
    const runs = await this.db
      .select()
      .from(expenseRecurringRuns)
      .where(and(eq(expenseRecurringRuns.tenantId, tenantId), eq(expenseRecurringRuns.recurringId, id)))
      .orderBy(desc(expenseRecurringRuns.runDate))
      .limit(60);
    const upcoming = r.status === "active" && r.nextRunDate ? previewDates(scheduleOf(r), r.nextRunDate, 5) : [];
    return { ...toRecurring(r), runs: runs.map(toRun), upcoming };
  }

  /** Drafts waiting to be filled or checked, and what is due in the next 7 days (the Expenses page reminders). */
  async summary(tenantId: string): Promise<{ drafts: number; dueSoon: { id: string; name: string; nextRunDate: string; amount: number | null }[] }> {
    const today = this.today();
    const [[d], soon] = await Promise.all([
      this.db
        .select({ n: count() })
        .from(expenses)
        .where(and(eq(expenses.tenantId, tenantId), eq(expenses.status, "draft"))),
      this.db
        .select({ id: expenseRecurring.id, name: expenseRecurring.name, nextRunDate: expenseRecurring.nextRunDate, amount: expenseRecurring.amount })
        .from(expenseRecurring)
        .where(and(eq(expenseRecurring.tenantId, tenantId), eq(expenseRecurring.status, "active"), lte(expenseRecurring.nextRunDate, addDaysIso(today, 7))))
        .orderBy(asc(expenseRecurring.nextRunDate))
        .limit(20),
    ]);
    return { drafts: Number(d?.n ?? 0), dueSoon: soon.map((s) => ({ ...s, nextRunDate: s.nextRunDate! })) };
  }

  /** The next dates of a schedule (the form's preview). */
  preview(q: Record<string, unknown>): { dates: string[] } {
    const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));
    const b = z
      .object({ frequency: fields.frequency, interval: fields.interval, dayOfMonth: fields.dayOfMonth, weekday: fields.weekday, startDate: fields.startDate, endDate: fields.endDate })
      .parse({ ...q, interval: num(q.interval), dayOfMonth: num(q.dayOfMonth), weekday: num(q.weekday), endDate: q.endDate || null });
    const s: Schedule = {
      frequency: b.frequency,
      interval: b.interval,
      dayOfMonth: b.frequency === "weekly" ? null : (b.dayOfMonth ?? null),
      weekday: b.frequency === "weekly" ? (b.weekday ?? null) : null,
      startDate: b.startDate,
      endDate: b.endDate ?? null,
    };
    this.checkSchedule(s);
    const today = this.today();
    return { dates: previewDates(s, s.startDate > today ? s.startDate : today, 6) };
  }

  // ---------------------------------------------------------------- writes

  /** The expense a run makes, checked now so a bad set-up fails on save rather than on its date. */
  private async checkExpense(tenantId: string, r: { categoryId?: string | null; supplierId?: string | null; paymentMethod: string }) {
    if (r.paymentMethod === "credit" && !r.supplierId) throw badRequest("Choose the supplier to buy on credit from", { field: "supplierId" });
    if (r.categoryId && !(await this.deps.expenses.categories(tenantId)).some((c) => c.id === r.categoryId)) throw badRequest("Unknown category");
  }

  async create(tenantId: string, input: RecurringExpenseInput, opts: { userId?: string | null; branchId?: string | null } = {}): Promise<RecurringExpenseDetail> {
    const b = recurringExpenseInput.parse(input);
    const s: Schedule = {
      frequency: b.frequency,
      interval: b.interval,
      dayOfMonth: b.frequency === "weekly" ? null : (b.dayOfMonth ?? null),
      weekday: b.frequency === "weekly" ? (b.weekday ?? null) : null,
      startDate: b.startDate,
      endDate: b.endDate ?? null,
    };
    this.checkSchedule(s);
    await this.checkExpense(tenantId, b);
    const categoryId = b.categoryId ?? (await this.deps.expenses.categories(tenantId)).find((c) => c.name === "Other")?.id;
    if (!categoryId) throw badRequest("Choose a category");
    const next = this.firstDate(s);
    if (!next) throw badRequest("No date falls between today and the end date");
    const [row] = await this.db
      .insert(expenseRecurring)
      .values({
        tenantId,
        name: b.name,
        categoryId,
        supplierId: b.supplierId ?? null,
        branchId: b.branchId !== undefined ? b.branchId : (opts.branchId ?? null),
        vendorName: b.vendorName,
        vendorGstin: b.vendorGstin,
        amount: b.amount,
        gstRate: b.gstRate,
        paymentMethod: b.paymentMethod,
        dueDays: b.dueDays ?? null,
        note: b.note,
        mode: b.mode,
        ...s,
        nextRunDate: next,
        status: "active",
        createdBy: opts.userId ?? null,
      })
      .returning();
    return this.get(tenantId, row!.id);
  }

  async update(tenantId: string, id: string, input: RecurringExpensePatch): Promise<RecurringExpenseDetail> {
    const b = recurringExpensePatch.parse(input);
    const r = await this.row(tenantId, id);
    if (r.status === "ended") throw badRequest("This recurring expense has ended; make a new one");
    const frequency = b.frequency ?? r.frequency;
    const s: Schedule = {
      frequency,
      interval: b.interval ?? r.interval,
      dayOfMonth: frequency === "weekly" ? null : b.dayOfMonth !== undefined ? (b.dayOfMonth ?? null) : r.dayOfMonth,
      weekday: frequency === "weekly" ? (b.weekday !== undefined ? (b.weekday ?? null) : r.weekday) : null,
      startDate: b.startDate ?? r.startDate,
      endDate: b.endDate !== undefined ? (b.endDate ?? null) : r.endDate,
    };
    this.checkSchedule(s);
    await this.checkExpense(tenantId, {
      categoryId: b.categoryId,
      supplierId: b.supplierId !== undefined ? b.supplierId : r.supplierId,
      paymentMethod: b.paymentMethod ?? r.paymentMethod,
    });
    const set: Partial<typeof expenseRecurring.$inferInsert> = { ...s };
    for (const k of ["name", "categoryId", "supplierId", "branchId", "vendorName", "vendorGstin", "amount", "gstRate", "paymentMethod", "dueDays", "note", "mode"] as const) {
      if (b[k] !== undefined) (set as Record<string, unknown>)[k] = b[k];
    }
    const scheduleChanged = (["frequency", "interval", "dayOfMonth", "weekday", "startDate", "endDate"] as const).some((k) => b[k] !== undefined);
    if (scheduleChanged) {
      const next = this.firstDate(s);
      set.nextRunDate = next;
      if (!next && r.status === "active") set.status = "ended";
    }
    await this.db.update(expenseRecurring).set(set).where(and(eq(expenseRecurring.tenantId, tenantId), eq(expenseRecurring.id, id)));
    return this.get(tenantId, id);
  }

  async pause(tenantId: string, id: string): Promise<RecurringExpenseDetail> {
    const r = await this.row(tenantId, id);
    if (r.status !== "active") throw badRequest("Only an active recurring expense can be paused");
    await this.db.update(expenseRecurring).set({ status: "paused" }).where(and(eq(expenseRecurring.tenantId, tenantId), eq(expenseRecurring.id, id)));
    return this.get(tenantId, id);
  }

  /** Back to active from the next date on or after today: dates missed while paused make nothing. */
  async resume(tenantId: string, id: string): Promise<RecurringExpenseDetail> {
    const r = await this.row(tenantId, id);
    if (r.status !== "paused") throw badRequest("Only a paused recurring expense can be resumed");
    const next = this.firstDate(scheduleOf(r));
    await this.db
      .update(expenseRecurring)
      .set({ status: next ? "active" : "ended", nextRunDate: next })
      .where(and(eq(expenseRecurring.tenantId, tenantId), eq(expenseRecurring.id, id)));
    return this.get(tenantId, id);
  }

  async end(tenantId: string, id: string): Promise<RecurringExpenseDetail> {
    await this.row(tenantId, id);
    await this.db.update(expenseRecurring).set({ status: "ended", nextRunDate: null }).where(and(eq(expenseRecurring.tenantId, tenantId), eq(expenseRecurring.id, id)));
    return this.get(tenantId, id);
  }

  /** Skips the next date (recorded in the history); the one after becomes next. */
  async skipNext(tenantId: string, id: string): Promise<RecurringExpenseDetail> {
    await this.db.transaction(async (tx) => {
      const r = await this.row(tenantId, id, tx, true);
      if (r.status !== "active" || !r.nextRunDate) throw badRequest("There is no next date to skip");
      const claimed = await tx
        .insert(expenseRecurringRuns)
        .values({ tenantId, recurringId: id, runDate: r.nextRunDate, status: "skipped", trigger: "user" })
        .onConflictDoNothing()
        .returning({ id: expenseRecurringRuns.id });
      if (!claimed.length) throw conflict("That date was already done; reload and try again");
      const next = nextAfter(scheduleOf(r), r.nextRunDate);
      await tx
        .update(expenseRecurring)
        .set({ nextRunDate: next, status: next ? "active" : "ended" })
        .where(and(eq(expenseRecurring.tenantId, tenantId), eq(expenseRecurring.id, id)));
    });
    return this.get(tenantId, id);
  }

  /** Only one that never made an expense can be deleted (otherwise end it: the history stays). */
  async remove(tenantId: string, id: string): Promise<void> {
    const r = await this.row(tenantId, id);
    if (r.count > 0) throw badRequest("This recurring expense already made expenses; end it instead so its history stays");
    await this.db.delete(expenseRecurring).where(and(eq(expenseRecurring.tenantId, tenantId), eq(expenseRecurring.id, id)));
  }

  /**
   * Makes today's expense now ("Make now"): a run dated today. If today is also a scheduled date it is that date's
   * expense (the scheduler then finds it done); otherwise it is an extra one and the schedule is unchanged.
   */
  async runNow(tenantId: string, id: string, userId: string | null = null): Promise<{ run: RecurringExpenseRun; recurring: RecurringExpenseDetail }> {
    const today = this.today();
    const locked = this.deps.lockedThrough ? await this.deps.lockedThrough(tenantId) : null;
    const run = await this.db.transaction(async (tx) => {
      const r = await this.row(tenantId, id, tx, true);
      if (r.status === "ended") throw badRequest("This recurring expense has ended");
      const made = await this.makeRun(tx, r, today, "manual", locked, userId);
      if (!made) throw conflict("Today's expense of this recurring expense was already made");
      if (r.nextRunDate === today) {
        const next = nextAfter(scheduleOf(r), today);
        await tx
          .update(expenseRecurring)
          .set({ nextRunDate: next, ...(r.status === "active" && !next ? { status: "ended" as const } : {}) })
          .where(eq(expenseRecurring.id, id));
      }
      return made;
    });
    return { run: toRun(run), recurring: await this.get(tenantId, id) };
  }

  // ---------------------------------------------------------------- the scheduler

  /**
   * Claims one date and makes its expense in the caller's transaction. Null when the date was already claimed (another
   * run made it). A date in a locked period is recorded as locked and makes nothing.
   */
  private async makeRun(
    tx: DbOrTx,
    r: ExpenseRecurringRow,
    runDate: string,
    trigger: "auto" | "manual",
    locked: string | null,
    userId: string | null,
  ): Promise<ExpenseRecurringRunRow | null> {
    if (locked && runDate <= locked) {
      const [row] = await tx
        .insert(expenseRecurringRuns)
        .values({ tenantId: r.tenantId, recurringId: r.id, runDate, status: "locked", trigger, error: `The books are locked up to ${locked}` })
        .onConflictDoNothing()
        .returning();
      return row ?? null;
    }
    const draft = r.amount === null || r.mode === "draft";
    const [claimed] = await tx
      .insert(expenseRecurringRuns)
      .values({ tenantId: r.tenantId, recurringId: r.id, runDate, status: draft ? "draft" : "created", trigger })
      .onConflictDoNothing()
      .returning();
    if (!claimed) return null;
    const amount = r.amount ?? 0;
    // Drafts with no amount yet (ask each time) skip the input check: the owner fills the amount before recording.
    const input = {
      date: runDate,
      categoryId: r.categoryId,
      amount: amount > 0 ? amount : 1,
      gstRate: r.gstRate,
      vendorName: r.vendorName,
      vendorGstin: r.vendorGstin,
      paymentMethod: r.paymentMethod,
      supplierId: r.supplierId,
      branchId: r.branchId,
      dueDate: r.paymentMethod === "credit" && r.dueDays !== null ? addDaysIso(runDate, r.dueDays) : null,
      note: r.note ? `${r.name} - ${r.note}` : r.name,
    };
    const e = await this.deps.expenses.create(r.tenantId, input, userId ?? r.createdBy, {
      status: draft ? "draft" : "recorded",
      recurringId: r.id,
      recurringRunId: claimed.id,
      db: tx,
    });
    if (amount === 0) await tx.update(expenses).set({ amount: 0, gstAmount: 0 }).where(eq(expenses.id, e.id));
    const [done] = await tx.update(expenseRecurringRuns).set({ expenseId: e.id }).where(eq(expenseRecurringRuns.id, claimed.id)).returning();
    await tx
      .update(expenseRecurring)
      .set({ count: sql`${expenseRecurring.count} + 1`, lastRunAt: this.now() })
      .where(eq(expenseRecurring.id, r.id));
    return done ?? claimed;
  }

  /** The scheduled job: every active recurring expense that is due, in every shop with expenses on. */
  async runDue(now: Date = this.now()): Promise<RecurringExpenseRunResult> {
    const today = todayIST(now);
    const due = await this.db
      .select({ id: expenseRecurring.id, tenantId: expenseRecurring.tenantId })
      .from(expenseRecurring)
      .where(and(eq(expenseRecurring.status, "active"), lte(expenseRecurring.nextRunDate, today)))
      .orderBy(asc(expenseRecurring.nextRunDate))
      .limit(SCAN_LIMIT);
    const result: RecurringExpenseRunResult = { recurring: 0, created: 0, drafts: 0, skipped: 0, locked: 0, failed: 0 };
    const enabled = new Map<string, boolean>();
    for (const p of due) {
      if (!enabled.has(p.tenantId)) enabled.set(p.tenantId, this.deps.isEnabled ? await this.deps.isEnabled(p.tenantId, "expenses").catch(() => false) : true);
      if (!enabled.get(p.tenantId)) continue;
      result.recurring += 1;
      try {
        const r = await this.runOne(p.tenantId, p.id, now);
        result.created += r.created;
        result.drafts += r.drafts;
        result.skipped += r.skipped;
        result.locked += r.locked;
      } catch (err) {
        result.failed += 1;
        this.log.error({ err: errorText(err), tenantId: p.tenantId, recurringId: p.id }, "recurring expenses: run failed");
      }
    }
    return result;
  }

  /**
   * One recurring expense's due dates in one transaction: the row is locked, the latest `CATCH_UP_LIMIT` dates are
   * made, older missed ones recorded as skipped, and the next date moves on. Safe to run twice at once.
   */
  async runOne(tenantId: string, id: string, now: Date = this.now()): Promise<Omit<RecurringExpenseRunResult, "recurring" | "failed">> {
    const today = todayIST(now);
    const out = { created: 0, drafts: 0, skipped: 0, locked: 0 };
    const locked = this.deps.lockedThrough ? await this.deps.lockedThrough(tenantId) : null;
    await this.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(expenseRecurring)
        .where(and(eq(expenseRecurring.tenantId, tenantId), eq(expenseRecurring.id, id)))
        .for("update");
      if (!r || r.status !== "active" || !r.nextRunDate || r.nextRunDate > today) return;
      const plan = planDue(scheduleOf(r), r.nextRunDate, today, null, CATCH_UP_LIMIT);
      if (plan.missed.length) {
        const missed = await tx
          .insert(expenseRecurringRuns)
          .values(plan.missed.map((d) => ({ tenantId, recurringId: id, runDate: d, status: "skipped" as const, error: "Missed: older than the catch-up limit" })))
          .onConflictDoNothing()
          .returning({ id: expenseRecurringRuns.id });
        out.skipped += missed.length;
      }
      for (const d of plan.bill) {
        const run = await this.makeRun(tx, r, d, "auto", locked, null);
        if (!run) continue;
        if (run.status === "locked") out.locked += 1;
        else if (run.status === "draft") out.drafts += 1;
        else out.created += 1;
      }
      await tx
        .update(expenseRecurring)
        .set({ nextRunDate: plan.next, status: plan.next ? "active" : "ended", lastRunAt: now })
        .where(eq(expenseRecurring.id, id));
    });
    return out;
  }
}
