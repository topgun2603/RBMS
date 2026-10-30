import { AppError, badRequest, conflict, notFound, type AuditPort } from "@rbms/core";
import type { Db, DbOrTx } from "@rbms/db";
import { todayIST } from "@rbms/gst";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  advanceInput,
  advancePatch,
  balanceInput,
  balanceQuery,
  bulkMarkInput,
  cancelInput,
  carryInput,
  clearMarkInput,
  configPatch,
  dayQuery,
  decisionInput,
  dueInput,
  duesQuery,
  employeeInput,
  employeeListQuery,
  holidayInput,
  leaveListQuery,
  leaveRequestInput,
  leaveTypeInput,
  leaveTypePatch,
  lineAdjustInput,
  logQuery,
  markInput,
  mergeConfig,
  payInput,
  pinInput,
  runInput,
  runListQuery,
  yearQuery,
} from "./inputs";
import {
  addMonths,
  carryForward,
  checkoutResult,
  computePayLine,
  countDays,
  datesBetween,
  DEFAULT_LEAVE_TYPES,
  DEFAULT_PAYROLL_CONFIG,
  DUE_KINDS,
  EMPTY_STRUCTURE,
  FIXED_HOLIDAYS,
  halfYearOf,
  istParts,
  lateMinutesAt,
  leaveBalance,
  leaveDaysIn,
  leaveYearOf,
  leaveYearRange,
  maskAccount,
  monthRange,
  runTotals,
  weekdayOf,
  type AttendanceStatus,
  type DayCounts,
  type DayMark,
  type DueKind,
  type LineAdjustments,
  type OpenAdvance,
  type PayMethod,
  type PayrollConfig,
  type ShiftRules,
} from "./logic";
import type { BooksPort, LoggerPort, MembersPort, PayslipPdfPort, PinPort } from "./ports";
import {
  payrollAdvances,
  payrollAttendance,
  payrollAttendanceLog,
  payrollDuePayments,
  payrollEmployees,
  payrollHolidays,
  payrollLeaveBalances,
  payrollLeaveRequests,
  payrollLeaveTypes,
  payrollPayments,
  payrollRunLines,
  payrollRuns,
  payrollSettings,
  type AttendanceSource,
  type LineSnapshot,
  type PayrollAdvance,
  type PayrollAttendanceRow,
  type PayrollEmployee,
  type PayrollLeaveType,
  type PayrollRun,
  type PayrollRunLine,
} from "./schema";

export interface PayrollDeps {
  db: Db;
  /** Check-in with a POS PIN on the shop's device. */
  pins?: PinPort;
  /** Team members to link an employee to a login. */
  members?: MembersPort;
  payslipPdf?: PayslipPdfPort;
  /** Tells the books something changed (they post on their next sync anyway). */
  books?: BooksPort;
  audit?: AuditPort;
  log?: LoggerPort;
  now?: () => Date;
}

/** Who is acting. */
export interface Actor {
  userId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

const err = (status: number, code: string, message: string, details?: unknown) => new AppError(status, code, message, details);
const isUnique = (e: unknown) => {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code === "23505" || x?.cause?.code === "23505";
};
const sum = (xs: readonly number[]) => xs.reduce((t, x) => t + x, 0);
const atIst = (date: string, hm: string) => new Date(`${date}T${hm}:00+05:30`);
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 5 * 60_000;

/** An employee for lists: no bank number (masked) and, without `withPay`, no salary. */
export interface EmployeeView extends Omit<PayrollEmployee, "accountNumber" | "salary"> {
  accountNumber: string | null;
  accountMasked: string | null;
  salary: PayrollEmployee["salary"] | null;
  /** Monthly cost at full attendance (monthly staff), for the list. */
  monthlyGross: number | null;
}

export interface DayRow {
  employee: { id: string; code: string; name: string; designation: string | null; branchId: string | null; userId: string | null };
  date: string;
  /** What the calendar says about the day for this person. */
  expected: "working" | "week_off" | "holiday" | "not_employed";
  holiday: string | null;
  mark: PayrollAttendanceRow | null;
  leaveCode: string | null;
}

export interface CheckResult {
  action: "in" | "out";
  at: string;
  employee: { id: string; code: string; name: string };
  lateMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus;
}

export interface SheetRow {
  employee: { id: string; code: string; name: string; designation: string | null; branchId: string | null };
  /** One code per day: P, A, H (half day), a leave code, WO, HO, "" (not marked), "-" (not employed). */
  cells: { date: string; code: string; late: boolean; overtimeMinutes: number }[];
  counts: DayCounts;
}

export interface LeaveBalanceRow {
  employee: { id: string; code: string; name: string };
  types: { leaveTypeId: string; code: string; name: string; paid: boolean; yearlyDays: number; opening: number; adjustment: number; used: number; pending: number; balance: number | null }[];
}

export interface AdvanceView extends PayrollAdvance {
  employeeName: string;
  employeeCode: string;
  recovered: number;
  outstanding: number;
}

export interface RunLineView extends PayrollRunLine {
  payment: { id: string; date: string; method: PayMethod; amount: number; reference: string | null } | null;
}

export interface RunView extends PayrollRun {
  lines: RunLineView[];
  paid: { count: number; amount: number };
}

export interface DueRow {
  month: string;
  kind: DueKind;
  due: number;
  paid: number;
  balance: number;
  payments: { id: string; date: string; amount: number; method: PayMethod; reference: string | null }[];
}

/** What the books read (apps/api kit-accounting.ts maps it to the accounting ports). */
export interface PayrollBookSources {
  runs: {
    id: string;
    month: string;
    date: string;
    gross: number;
    employerPf: number;
    employerEsi: number;
    net: number;
    pf: number;
    esi: number;
    pt: number;
    tds: number;
    advance: number;
    other: number;
    roundOff: number;
  }[];
  payments: { id: string; date: string; amount: number; method: PayMethod; employeeName: string; month: string }[];
  advances: { id: string; date: string; amount: number; method: PayMethod; employeeName: string }[];
  dues: { id: string; kind: DueKind; month: string; date: string; amount: number; method: PayMethod; reference: string | null }[];
}

export class PayrollService {
  private readonly db: Db;
  private readonly now: () => Date;
  private readonly pinFailures = new Map<string, { n: number; until: number }>();
  private readonly seededLeave = new Set<string>();

  constructor(private readonly deps: PayrollDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  today() {
    return todayIST(this.now());
  }

  private changed(tenantId: string) {
    try {
      this.deps.books?.changed(tenantId);
    } catch (e) {
      this.deps.log?.warn({ err: e, tenantId }, "payroll: books nudge failed");
    }
  }

  private async audit(tenantId: string, actor: Actor | undefined, action: string, entityType: string, entityId: string | null, summary: string, before?: unknown, after?: unknown) {
    if (!this.deps.audit) return;
    await this.deps.audit.record({ tenantId, actorUserId: actor?.userId ?? null, action, entityType, entityId, summary, before, after, ip: actor?.ip ?? null, userAgent: actor?.userAgent ?? null });
  }

  // ================================================================ settings

  async config(tenantId: string, db: DbOrTx = this.db): Promise<PayrollConfig> {
    const [row] = await db.select().from(payrollSettings).where(eq(payrollSettings.tenantId, tenantId)).limit(1);
    return mergeConfig(row?.config);
  }

  async getSettings(tenantId: string) {
    return { config: await this.config(tenantId), defaults: DEFAULT_PAYROLL_CONFIG };
  }

  async updateSettings(tenantId: string, input: unknown, actor?: Actor) {
    const patch = configPatch.parse(input ?? {});
    const before = await this.config(tenantId);
    const next = mergeConfig(before, patch);
    await this.db
      .insert(payrollSettings)
      .values({ tenantId, config: next, updatedBy: actor?.userId ?? null })
      .onConflictDoUpdate({ target: payrollSettings.tenantId, set: { config: next, updatedBy: actor?.userId ?? null } });
    await this.audit(tenantId, actor, "payroll.settings.update", "payroll_settings", tenantId, "Payroll settings changed", before, next);
    return { config: next, defaults: DEFAULT_PAYROLL_CONFIG };
  }

  /** The shift rules of a person (their own shift when set, else the shop's). */
  rulesFor(e: Pick<PayrollEmployee, "shiftStart" | "shiftEnd">, c: PayrollConfig): ShiftRules {
    return {
      shiftStart: e.shiftStart ?? c.shiftStart,
      shiftEnd: e.shiftEnd ?? c.shiftEnd,
      graceMinutes: c.graceMinutes,
      halfDayBelowMinutes: c.halfDayBelowMinutes,
      otAfterMinutes: c.otAfterMinutes,
    };
  }

  private weekOffsFor(e: Pick<PayrollEmployee, "weekOffs">, c: PayrollConfig): number[] {
    return e.weekOffs ?? c.weekOffs;
  }

  // ================================================================ employees

  private view(e: PayrollEmployee, withPay: boolean): EmployeeView {
    const s = e.salary;
    const monthlyGross = s.payType === "monthly" ? s.basic + s.da + s.hra + s.allowances.reduce((t, a) => t + a.amount, 0) : null;
    return {
      ...e,
      status: e.leaveDate && e.leaveDate < this.today() ? "left" : "active",
      accountNumber: withPay ? e.accountNumber : null,
      accountMasked: maskAccount(e.accountNumber),
      salary: withPay ? e.salary : null,
      monthlyGross: withPay ? monthlyGross : null,
    };
  }

  async listEmployees(tenantId: string, query: unknown = {}, opts: { withPay: boolean } = { withPay: false }): Promise<{ items: EmployeeView[]; total: number }> {
    const q = employeeListQuery.parse(query ?? {});
    const rows = await this.db
      .select()
      .from(payrollEmployees)
      .where(
        and(
          eq(payrollEmployees.tenantId, tenantId),
          q.status === "all"
            ? undefined
            : q.status === "active"
              ? or(isNull(payrollEmployees.leaveDate), gte(payrollEmployees.leaveDate, this.today()))
              : sql`${payrollEmployees.leaveDate} < ${this.today()}`,
          q.branchId ? eq(payrollEmployees.branchId, q.branchId) : undefined,
          q.q ? or(ilike(payrollEmployees.name, `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`), ilike(payrollEmployees.code, `%${q.q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`)) : undefined,
        ),
      )
      .orderBy(asc(payrollEmployees.name), asc(payrollEmployees.id));
    return { items: rows.map((r) => this.view(r, opts.withPay)), total: rows.length };
  }

  async employee(tenantId: string, id: string, db: DbOrTx = this.db): Promise<PayrollEmployee> {
    const [row] = await db.select().from(payrollEmployees).where(and(eq(payrollEmployees.tenantId, tenantId), eq(payrollEmployees.id, id))).limit(1);
    if (!row) throw notFound("Staff member");
    return row;
  }

  async getEmployee(tenantId: string, id: string, opts: { withPay: boolean }): Promise<EmployeeView> {
    return this.view(await this.employee(tenantId, id), opts.withPay);
  }

  /** The employee linked to a login, or null. */
  async employeeForUser(tenantId: string, userId: string): Promise<PayrollEmployee | null> {
    const [row] = await this.db.select().from(payrollEmployees).where(and(eq(payrollEmployees.tenantId, tenantId), eq(payrollEmployees.userId, userId))).limit(1);
    return row ?? null;
  }

  private async nextCode(tx: DbOrTx, tenantId: string): Promise<string> {
    await tx.insert(payrollSettings).values({ tenantId }).onConflictDoNothing();
    const [row] = await tx
      .update(payrollSettings)
      .set({ nextEmployeeNo: sql`${payrollSettings.nextEmployeeNo} + 1` })
      .where(eq(payrollSettings.tenantId, tenantId))
      .returning({ n: payrollSettings.nextEmployeeNo });
    return `EMP-${String((row?.n ?? 2) - 1).padStart(3, "0")}`;
  }

  private values(p: z.output<typeof employeeInput>) {
    const salary = { ...EMPTY_STRUCTURE, ...p.salary };
    return {
      name: p.name,
      phone: p.phone,
      userId: p.userId,
      branchId: p.branchId,
      designation: p.designation,
      joinDate: p.joinDate,
      leaveDate: p.leaveDate,
      status: (p.leaveDate && p.leaveDate < this.today() ? "left" : "active") as PayrollEmployee["status"],
      payType: salary.payType,
      salary,
      shiftStart: p.shiftStart,
      shiftEnd: p.shiftEnd,
      weekOffs: p.weekOffs,
      payMethod: p.payMethod,
      bankName: p.bankName,
      accountNumber: p.accountNumber,
      ifsc: p.ifsc,
      upiId: p.upiId,
      uan: p.uan,
      esiNumber: p.esiNumber,
      pan: p.pan,
      notes: p.notes,
    };
  }

  async createEmployee(tenantId: string, input: unknown, actor?: Actor): Promise<EmployeeView> {
    const p = employeeInput.parse(input ?? {});
    try {
      const row = await this.db.transaction(async (tx) => {
        const code = await this.nextCode(tx, tenantId);
        const [r] = await tx.insert(payrollEmployees).values({ tenantId, code, ...this.values(p) }).returning();
        return r!;
      });
      await this.audit(tenantId, actor, "payroll.employee.create", "payroll_employee", row.id, `Staff ${row.code} ${row.name} added`);
      return this.view(row, true);
    } catch (e) {
      if (isUnique(e)) throw err(409, "user_linked", "That team member is already linked to another staff record");
      throw e;
    }
  }

  async updateEmployee(tenantId: string, id: string, input: unknown, actor?: Actor): Promise<EmployeeView> {
    const before = await this.employee(tenantId, id);
    const p = employeeInput.parse(input ?? {});
    try {
      const [row] = await this.db
        .update(payrollEmployees)
        .set(this.values(p))
        .where(and(eq(payrollEmployees.tenantId, tenantId), eq(payrollEmployees.id, id)))
        .returning();
      const salaryChanged = JSON.stringify(before.salary) !== JSON.stringify(row!.salary);
      await this.audit(
        tenantId,
        actor,
        salaryChanged ? "payroll.employee.salary" : "payroll.employee.update",
        "payroll_employee",
        id,
        salaryChanged ? `Salary of ${row!.name} changed` : `Staff ${row!.name} updated`,
        salaryChanged ? { salary: before.salary } : undefined,
        salaryChanged ? { salary: row!.salary } : undefined,
      );
      return this.view(row!, true);
    } catch (e) {
      if (isUnique(e)) throw err(409, "user_linked", "That team member is already linked to another staff record");
      throw e;
    }
  }

  /** Deletes a person who has no attendance, payroll or advances yet (otherwise set a last working day instead). */
  async deleteEmployee(tenantId: string, id: string, actor?: Actor): Promise<void> {
    const e = await this.employee(tenantId, id);
    const used = await Promise.all([
      this.db.select({ id: payrollAttendance.id }).from(payrollAttendance).where(and(eq(payrollAttendance.tenantId, tenantId), eq(payrollAttendance.employeeId, id))).limit(1),
      this.db.select({ id: payrollRunLines.id }).from(payrollRunLines).where(and(eq(payrollRunLines.tenantId, tenantId), eq(payrollRunLines.employeeId, id))).limit(1),
      this.db.select({ id: payrollAdvances.id }).from(payrollAdvances).where(and(eq(payrollAdvances.tenantId, tenantId), eq(payrollAdvances.employeeId, id))).limit(1),
    ]);
    if (used.some((r) => r.length > 0)) throw err(409, "employee_has_history", "This person has attendance or payroll records. Set their last working day instead.");
    await this.db.delete(payrollEmployees).where(and(eq(payrollEmployees.tenantId, tenantId), eq(payrollEmployees.id, id)));
    await this.audit(tenantId, actor, "payroll.employee.delete", "payroll_employee", id, `Staff ${e.code} ${e.name} deleted`);
  }

  /** Team members who can be linked (with who is linked already). */
  async linkableMembers(tenantId: string) {
    const members = (await this.deps.members?.list(tenantId)) ?? [];
    const linked = await this.db
      .select({ userId: payrollEmployees.userId, id: payrollEmployees.id, name: payrollEmployees.name })
      .from(payrollEmployees)
      .where(and(eq(payrollEmployees.tenantId, tenantId), sql`${payrollEmployees.userId} is not null`));
    const by = new Map(linked.map((l) => [l.userId!, l]));
    return { items: members.map((m) => ({ ...m, employeeId: by.get(m.userId)?.id ?? null, employeeName: by.get(m.userId)?.name ?? null })) };
  }

  // ================================================================ holidays

  async holidays(tenantId: string, query: unknown = {}) {
    const { year } = yearQuery.parse(query ?? {});
    const y = year ?? Number(this.today().slice(0, 4));
    const items = await this.db
      .select()
      .from(payrollHolidays)
      .where(and(eq(payrollHolidays.tenantId, tenantId), gte(payrollHolidays.date, `${y}-01-01`), lte(payrollHolidays.date, `${y}-12-31`)))
      .orderBy(asc(payrollHolidays.date));
    return { year: y, items, suggestions: FIXED_HOLIDAYS.map((h) => ({ date: `${y}-${h.md}`, name: h.name })).filter((s) => !items.some((i) => i.date === s.date && !i.branchId)) };
  }

  async addHoliday(tenantId: string, input: unknown) {
    const p = holidayInput.parse(input ?? {});
    const [dup] = await this.db
      .select({ id: payrollHolidays.id })
      .from(payrollHolidays)
      .where(and(eq(payrollHolidays.tenantId, tenantId), eq(payrollHolidays.date, p.date), p.branchId ? eq(payrollHolidays.branchId, p.branchId) : isNull(payrollHolidays.branchId)))
      .limit(1);
    if (dup) throw err(409, "holiday_exists", "There is already a holiday on that date");
    const [row] = await this.db.insert(payrollHolidays).values({ tenantId, ...p }).returning();
    return row!;
  }

  async removeHoliday(tenantId: string, id: string) {
    const [row] = await this.db.delete(payrollHolidays).where(and(eq(payrollHolidays.tenantId, tenantId), eq(payrollHolidays.id, id))).returning({ id: payrollHolidays.id });
    if (!row) throw notFound("Holiday");
  }

  /** Holidays between two dates: date → name, per branch (key "" = the whole shop). */
  private async holidayMap(tenantId: string, from: string, to: string, db: DbOrTx = this.db) {
    const rows = await db
      .select({ date: payrollHolidays.date, name: payrollHolidays.name, branchId: payrollHolidays.branchId })
      .from(payrollHolidays)
      .where(and(eq(payrollHolidays.tenantId, tenantId), gte(payrollHolidays.date, from), lte(payrollHolidays.date, to)));
    return (branchId: string | null) => {
      const m = new Map<string, string>();
      for (const r of rows) if (!r.branchId || r.branchId === branchId) m.set(r.date, r.name);
      return m;
    };
  }

  // ================================================================ attendance

  /** 409 when the month of `date` has a finalized payroll (cancel it first). */
  private async assertOpen(tenantId: string, dates: readonly string[], db: DbOrTx = this.db) {
    const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
    if (months.length === 0) return;
    const [run] = await db
      .select({ month: payrollRuns.month })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, tenantId), inArray(payrollRuns.month, months), eq(payrollRuns.status, "finalized")))
      .limit(1);
    if (run) throw err(409, "payroll_finalized", `Payroll for ${run.month} is final. Cancel that payroll to change its attendance.`, { month: run.month });
  }

  private async leaveTypesMap(tenantId: string): Promise<Map<string, PayrollLeaveType>> {
    return new Map((await this.leaveTypes(tenantId, true)).map((t) => [t.id, t]));
  }

  private async markRow(tenantId: string, employeeId: string, date: string, db: DbOrTx = this.db) {
    const [row] = await db
      .select()
      .from(payrollAttendance)
      .where(and(eq(payrollAttendance.tenantId, tenantId), eq(payrollAttendance.employeeId, employeeId), eq(payrollAttendance.date, date)))
      .limit(1);
    return row ?? null;
  }

  private snap(r: PayrollAttendanceRow | null) {
    if (!r) return null;
    return {
      status: r.status,
      leaveTypeId: r.leaveTypeId,
      checkIn: r.checkIn?.toISOString() ?? null,
      checkOut: r.checkOut?.toISOString() ?? null,
      workedMinutes: r.workedMinutes,
      lateMinutes: r.lateMinutes,
      overtimeMinutes: r.overtimeMinutes,
      note: r.note,
      source: r.source,
    };
  }

  private async logChange(db: DbOrTx, tenantId: string, employeeId: string, date: string, before: PayrollAttendanceRow | null, after: PayrollAttendanceRow | null, reason: string | null, by: string | null) {
    await db.insert(payrollAttendanceLog).values({ tenantId, employeeId, date, before: this.snap(before), after: this.snap(after), reason, changedBy: by });
  }

  /** The day board: every person working (or off) on a date with their mark. */
  async day(tenantId: string, query: unknown = {}): Promise<{ date: string; items: DayRow[]; counts: Record<string, number>; finalized: boolean }> {
    const q = dayQuery.parse(query ?? {});
    const date = q.date ?? this.today();
    const [config, emps, holidays, types] = await Promise.all([
      this.config(tenantId),
      this.db
        .select()
        .from(payrollEmployees)
        .where(and(eq(payrollEmployees.tenantId, tenantId), lte(payrollEmployees.joinDate, date), or(isNull(payrollEmployees.leaveDate), gte(payrollEmployees.leaveDate, date)), q.branchId ? eq(payrollEmployees.branchId, q.branchId) : undefined))
        .orderBy(asc(payrollEmployees.name)),
      this.holidayMap(tenantId, date, date),
      this.leaveTypesMap(tenantId),
    ]);
    const marks = emps.length
      ? await this.db.select().from(payrollAttendance).where(and(eq(payrollAttendance.tenantId, tenantId), eq(payrollAttendance.date, date), inArray(payrollAttendance.employeeId, emps.map((e) => e.id))))
      : [];
    const byEmp = new Map(marks.map((m) => [m.employeeId, m]));
    const counts: Record<string, number> = { present: 0, absent: 0, half_day: 0, leave: 0, week_off: 0, holiday: 0, unmarked: 0, late: 0, in: 0 };
    const items: DayRow[] = emps.map((e) => {
      const hol = holidays(e.branchId).get(date) ?? null;
      const off = this.weekOffsFor(e, config).includes(weekdayOf(date));
      const mark = byEmp.get(e.id) ?? null;
      const expected = hol ? "holiday" : off ? "week_off" : "working";
      if (mark) {
        counts[mark.status] = (counts[mark.status] ?? 0) + 1;
        if (mark.lateMinutes > 0) counts.late!++;
        if (mark.checkIn && !mark.checkOut) counts.in!++;
      } else if (expected === "working") counts.unmarked!++;
      else counts[expected] = (counts[expected] ?? 0) + 1;
      return {
        employee: { id: e.id, code: e.code, name: e.name, designation: e.designation, branchId: e.branchId, userId: e.userId },
        date,
        expected,
        holiday: hol,
        mark,
        leaveCode: mark?.leaveTypeId ? (types.get(mark.leaveTypeId)?.code ?? null) : null,
      };
    });
    const finalized = await this.assertOpen(tenantId, [date]).then(
      () => false,
      () => true,
    );
    return { date, items, counts, finalized };
  }

  /** Marks (or corrects) one day for one person. A change to a day already marked needs a reason and is logged. */
  async mark(tenantId: string, input: unknown, actor: Actor): Promise<PayrollAttendanceRow> {
    const p = markInput.parse(input ?? {});
    const e = await this.employee(tenantId, p.employeeId);
    if (p.date > this.today()) throw badRequest("You can mark leave ahead, but not attendance. Use a leave request for future days.");
    if (p.status === "leave" && !p.leaveTypeId) throw err(400, "leave_type_required", "Choose the leave type");
    if (p.leaveTypeId && !(await this.leaveTypesMap(tenantId)).has(p.leaveTypeId)) throw badRequest("Unknown leave type");
    const config = await this.config(tenantId);
    return this.db.transaction(async (tx) => {
      await this.assertOpen(tenantId, [p.date], tx);
      const before = await this.markRow(tenantId, e.id, p.date, tx);
      if (before && !p.reason) throw err(400, "reason_required", "Say why you are changing a day that was already marked");
      const worked = p.status === "present" || p.status === "half_day";
      const checkIn = worked && p.checkIn ? atIst(p.date, p.checkIn) : null;
      let checkOut = worked && p.checkOut ? atIst(p.date, p.checkOut) : null;
      if (checkIn && checkOut && checkOut <= checkIn) checkOut = new Date(checkOut.getTime() + 86_400_000);
      const rules = this.rulesFor(e, config);
      const late = worked ? (p.lateMinutes ?? (checkIn ? lateMinutesAt(checkIn, rules) : 0)) : 0;
      const out = checkIn && checkOut ? checkoutResult(checkIn, checkOut, rules) : null;
      const values = {
        status: p.status,
        leaveTypeId: p.status === "leave" || p.status === "half_day" ? p.leaveTypeId : null,
        leaveRequestId: before?.leaveRequestId && before.status === p.status && before.leaveTypeId === p.leaveTypeId ? before.leaveRequestId : null,
        checkIn,
        checkOut,
        workedMinutes: out?.workedMinutes ?? 0,
        lateMinutes: late,
        overtimeMinutes: worked ? (p.overtimeMinutes ?? out?.overtimeMinutes ?? 0) : 0,
        source: "manager" as AttendanceSource,
        note: p.note,
        markedBy: actor.userId,
      };
      const [row] = await tx
        .insert(payrollAttendance)
        .values({ tenantId, employeeId: e.id, date: p.date, ...values })
        .onConflictDoUpdate({ target: [payrollAttendance.tenantId, payrollAttendance.employeeId, payrollAttendance.date], set: values })
        .returning();
      await this.logChange(tx, tenantId, e.id, p.date, before, row!, p.reason, actor.userId);
      return row!;
    });
  }

  /** Marks many people for one day ("everyone present"). Without `overwrite` only people not marked yet are touched. */
  async bulkMark(tenantId: string, input: unknown, actor: Actor): Promise<{ marked: number; skipped: number }> {
    const p = bulkMarkInput.parse(input ?? {});
    if (p.date > this.today()) throw badRequest("Attendance can't be marked ahead");
    if (p.overwrite && !p.reason) throw err(400, "reason_required", "Say why you are changing days that were already marked");
    const types = await this.leaveTypesMap(tenantId);
    for (const it of p.items) if (it.status === "leave" && (!it.leaveTypeId || !types.has(it.leaveTypeId))) throw err(400, "leave_type_required", "Choose the leave type");
    const ids = [...new Set(p.items.map((i) => i.employeeId))];
    const emps = await this.db.select({ id: payrollEmployees.id }).from(payrollEmployees).where(and(eq(payrollEmployees.tenantId, tenantId), inArray(payrollEmployees.id, ids)));
    if (emps.length !== ids.length) throw notFound("Staff member");
    return this.db.transaction(async (tx) => {
      await this.assertOpen(tenantId, [p.date], tx);
      const existing = await tx.select().from(payrollAttendance).where(and(eq(payrollAttendance.tenantId, tenantId), eq(payrollAttendance.date, p.date), inArray(payrollAttendance.employeeId, ids)));
      const by = new Map(existing.map((r) => [r.employeeId, r]));
      let marked = 0;
      let skipped = 0;
      for (const it of p.items) {
        const before = by.get(it.employeeId) ?? null;
        if (before && !p.overwrite) {
          skipped++;
          continue;
        }
        if (before && before.status === it.status && (before.leaveTypeId ?? null) === (it.leaveTypeId ?? null)) {
          skipped++;
          continue;
        }
        const keepTimes = before && (it.status === "present" || it.status === "half_day");
        const values = {
          status: it.status,
          leaveTypeId: it.status === "leave" || it.status === "half_day" ? (it.leaveTypeId ?? null) : null,
          leaveRequestId: null,
          checkIn: keepTimes ? before!.checkIn : null,
          checkOut: keepTimes ? before!.checkOut : null,
          workedMinutes: keepTimes ? before!.workedMinutes : 0,
          lateMinutes: keepTimes ? before!.lateMinutes : 0,
          overtimeMinutes: keepTimes ? before!.overtimeMinutes : 0,
          source: "manager" as AttendanceSource,
          markedBy: actor.userId,
        };
        const [row] = await tx
          .insert(payrollAttendance)
          .values({ tenantId, employeeId: it.employeeId, date: p.date, ...values })
          .onConflictDoUpdate({ target: [payrollAttendance.tenantId, payrollAttendance.employeeId, payrollAttendance.date], set: values })
          .returning();
        await this.logChange(tx, tenantId, it.employeeId, p.date, before, row!, before ? p.reason : null, actor.userId);
        marked++;
      }
      return { marked, skipped };
    });
  }

  /** Removes a day's mark (back to "not marked"), with a reason. */
  async clearMark(tenantId: string, input: unknown, actor: Actor): Promise<void> {
    const p = clearMarkInput.parse(input ?? {});
    await this.db.transaction(async (tx) => {
      await this.assertOpen(tenantId, [p.date], tx);
      const before = await this.markRow(tenantId, p.employeeId, p.date, tx);
      if (!before) throw notFound("Attendance mark");
      await tx.delete(payrollAttendance).where(eq(payrollAttendance.id, before.id));
      await this.logChange(tx, tenantId, p.employeeId, p.date, before, null, p.reason, actor.userId);
    });
  }

  /** Check-in, or check-out when already in, at `now`. */
  private async checkFor(tenantId: string, e: PayrollEmployee, source: AttendanceSource, actor: Actor): Promise<CheckResult> {
    if (e.leaveDate && e.leaveDate < this.today()) throw err(409, "employee_left", "This person has left");
    const now = this.now();
    const { date } = istParts(now);
    const config = await this.config(tenantId);
    const rules = this.rulesFor(e, config);
    return this.db.transaction(async (tx) => {
      await this.assertOpen(tenantId, [date], tx);
      const before = await this.markRow(tenantId, e.id, date, tx);
      if (before?.status === "leave" && before.leaveRequestId) throw err(409, "on_leave", "You are on approved leave today. Ask your manager to change it.");
      if (before?.checkIn && before.checkOut) throw err(409, "already_checked_out", "You have already checked out today");
      let row: PayrollAttendanceRow;
      let action: "in" | "out";
      if (before?.checkIn && !before.checkOut) {
        const out = checkoutResult(before.checkIn, now, rules);
        action = "out";
        [row] = (await tx
          .update(payrollAttendance)
          .set({ checkOut: now, workedMinutes: out.workedMinutes, overtimeMinutes: out.overtimeMinutes, status: out.halfDay ? "half_day" : "present", source, markedBy: actor.userId })
          .where(eq(payrollAttendance.id, before.id))
          .returning()) as [PayrollAttendanceRow];
      } else {
        action = "in";
        const values = {
          status: "present" as AttendanceStatus,
          leaveTypeId: null,
          leaveRequestId: null,
          checkIn: now,
          checkOut: null,
          workedMinutes: 0,
          lateMinutes: lateMinutesAt(now, rules),
          overtimeMinutes: 0,
          source,
          markedBy: actor.userId,
        };
        [row] = (await tx
          .insert(payrollAttendance)
          .values({ tenantId, employeeId: e.id, date, ...values })
          .onConflictDoUpdate({ target: [payrollAttendance.tenantId, payrollAttendance.employeeId, payrollAttendance.date], set: values })
          .returning()) as [PayrollAttendanceRow];
      }
      await this.logChange(tx, tenantId, e.id, date, before, row, null, actor.userId);
      return {
        action,
        at: now.toISOString(),
        employee: { id: e.id, code: e.code, name: e.name },
        lateMinutes: row.lateMinutes,
        workedMinutes: row.workedMinutes,
        overtimeMinutes: row.overtimeMinutes,
        status: row.status,
      };
    });
  }

  /** The check-in screen: a person types their POS PIN on the shop's device. Five wrong PINs lock it for 5 minutes. */
  async checkByPin(tenantId: string, input: unknown, actor: Actor): Promise<CheckResult> {
    const { pin } = pinInput.parse(input ?? {});
    if (!this.deps.pins) throw err(409, "pins_unavailable", "PIN check-in needs POS PINs. Set a PIN for each person in Team.");
    const key = tenantId;
    const f = this.pinFailures.get(key);
    if (f && f.until > Date.now()) throw err(429, "pin_locked", "Too many wrong PINs. Try again in a few minutes.");
    const who = await this.deps.pins.memberForPin(tenantId, pin);
    if (!who) {
      const n = (f && f.until > Date.now() ? f.n : (f?.n ?? 0)) + 1;
      this.pinFailures.set(key, n >= PIN_MAX_FAILURES ? { n: 0, until: Date.now() + PIN_LOCK_MS } : { n, until: 0 });
      throw err(400, "wrong_pin", "That PIN is not right");
    }
    this.pinFailures.delete(key);
    const e = await this.employeeForUser(tenantId, who.userId);
    if (!e) throw err(404, "not_linked", "This PIN is not linked to a staff record. Link the team member in Staff.");
    return this.checkFor(tenantId, e, "pin", actor);
  }

  /** A person checks themselves in or out from their own login (when the shop allows it). */
  async checkSelf(tenantId: string, actor: Actor & { userId: string }): Promise<CheckResult> {
    const config = await this.config(tenantId);
    if (!config.selfCheckIn) throw err(403, "self_checkin_off", "Your shop has switched self check-in off. Use the check-in screen.");
    const e = await this.employeeForUser(tenantId, actor.userId);
    if (!e) throw err(404, "not_linked", "Your login is not linked to a staff record");
    return this.checkFor(tenantId, e, "self", actor);
  }

  /** The month sheet: one row per person with a code per day and the counts payroll uses. */
  async sheet(tenantId: string, query: { month?: string; branchId?: string; employeeId?: string } = {}): Promise<{ month: string; from: string; to: string; dates: string[]; rows: SheetRow[]; finalized: boolean }> {
    const month = query.month ?? this.today().slice(0, 7);
    const { from, to } = monthRange(month);
    const [config, types, holidays] = await Promise.all([this.config(tenantId), this.leaveTypesMap(tenantId), this.holidayMap(tenantId, from, to)]);
    const emps = await this.db
      .select()
      .from(payrollEmployees)
      .where(
        and(
          eq(payrollEmployees.tenantId, tenantId),
          lte(payrollEmployees.joinDate, to),
          or(isNull(payrollEmployees.leaveDate), gte(payrollEmployees.leaveDate, from)),
          query.branchId ? eq(payrollEmployees.branchId, query.branchId) : undefined,
          query.employeeId ? eq(payrollEmployees.id, query.employeeId) : undefined,
        ),
      )
      .orderBy(asc(payrollEmployees.name));
    const marks = emps.length
      ? await this.db
          .select()
          .from(payrollAttendance)
          .where(and(eq(payrollAttendance.tenantId, tenantId), gte(payrollAttendance.date, from), lte(payrollAttendance.date, to), inArray(payrollAttendance.employeeId, emps.map((e) => e.id))))
      : [];
    const dates = datesBetween(from, to);
    const rows = emps.map((e): SheetRow => {
      const mine = new Map(marks.filter((m) => m.employeeId === e.id).map((m) => [m.date, m]));
      const hol = holidays(e.branchId);
      const offs = this.weekOffsFor(e, config);
      const cells = dates.map((d) => {
        const m = mine.get(d);
        if (d < e.joinDate || (e.leaveDate && d > e.leaveDate)) return { date: d, code: "-", late: false, overtimeMinutes: 0 };
        const leave = m?.leaveTypeId ? (types.get(m.leaveTypeId)?.code ?? "L") : "L";
        const code = m
          ? { present: "P", absent: "A", half_day: m.leaveTypeId ? `H/${leave}` : "H", leave, week_off: "WO", holiday: "HO" }[m.status]
          : hol.has(d)
            ? "HO"
            : offs.includes(weekdayOf(d))
              ? "WO"
              : "";
        return { date: d, code, late: (m?.lateMinutes ?? 0) > 0, overtimeMinutes: m?.overtimeMinutes ?? 0 };
      });
      return {
        employee: { id: e.id, code: e.code, name: e.name, designation: e.designation, branchId: e.branchId },
        cells,
        counts: countDays({ from, to, joinDate: e.joinDate, leaveDate: e.leaveDate, weekOffs: offs, holidays: new Set(hol.keys()), marks: this.dayMarks(mine, types), unmarkedAs: config.unmarkedAs }),
      };
    });
    const finalized = await this.assertOpen(tenantId, [from]).then(
      () => false,
      () => true,
    );
    return { month, from, to, dates, rows, finalized };
  }

  private dayMarks(rows: ReadonlyMap<string, PayrollAttendanceRow>, types: ReadonlyMap<string, PayrollLeaveType>): Map<string, DayMark> {
    const out = new Map<string, DayMark>();
    for (const [d, r] of rows) {
      const t = r.leaveTypeId ? types.get(r.leaveTypeId) : undefined;
      out.set(d, {
        date: d,
        status: r.status,
        leavePaid: r.status === "leave" || r.status === "half_day" ? (t ? t.paid : r.status === "leave" ? true : null) : null,
        workedMinutes: r.workedMinutes,
        lateMinutes: r.lateMinutes,
        overtimeMinutes: r.overtimeMinutes,
      });
    }
    return out;
  }

  /** Corrections log (newest first). */
  async log(tenantId: string, query: unknown = {}) {
    const q = logQuery.parse(query ?? {});
    const rows = await this.db
      .select({ log: payrollAttendanceLog, name: payrollEmployees.name, code: payrollEmployees.code })
      .from(payrollAttendanceLog)
      .leftJoin(payrollEmployees, eq(payrollEmployees.id, payrollAttendanceLog.employeeId))
      .where(
        and(
          eq(payrollAttendanceLog.tenantId, tenantId),
          q.employeeId ? eq(payrollAttendanceLog.employeeId, q.employeeId) : undefined,
          q.from ? gte(payrollAttendanceLog.date, q.from) : undefined,
          q.to ? lte(payrollAttendanceLog.date, q.to) : undefined,
        ),
      )
      .orderBy(desc(payrollAttendanceLog.at))
      .limit(q.limit);
    return { items: rows.map((r) => ({ ...r.log, employeeName: r.name ?? "", employeeCode: r.code ?? "" })) };
  }

  // ================================================================ leave

  /** Leave types (the defaults are seeded on first use). */
  async leaveTypes(tenantId: string, includeInactive = false): Promise<PayrollLeaveType[]> {
    if (!this.seededLeave.has(tenantId)) {
      const [any] = await this.db.select({ id: payrollLeaveTypes.id }).from(payrollLeaveTypes).where(eq(payrollLeaveTypes.tenantId, tenantId)).limit(1);
      if (!any) await this.db.insert(payrollLeaveTypes).values(DEFAULT_LEAVE_TYPES.map((t, i) => ({ tenantId, ...t, sort: (i + 1) * 10 }))).onConflictDoNothing();
      this.seededLeave.add(tenantId);
    }
    return this.db
      .select()
      .from(payrollLeaveTypes)
      .where(and(eq(payrollLeaveTypes.tenantId, tenantId), includeInactive ? undefined : eq(payrollLeaveTypes.active, true)))
      .orderBy(asc(payrollLeaveTypes.sort), asc(payrollLeaveTypes.name));
  }

  async createLeaveType(tenantId: string, input: unknown) {
    const p = leaveTypeInput.parse(input ?? {});
    const existing = await this.leaveTypes(tenantId, true);
    try {
      const [row] = await this.db
        .insert(payrollLeaveTypes)
        .values({ tenantId, ...p, sort: p.sort ?? Math.max(0, ...existing.map((t) => t.sort)) + 10 })
        .returning();
      return row!;
    } catch (e) {
      if (isUnique(e)) throw err(409, "leave_code_taken", "A leave type with that code exists");
      throw e;
    }
  }

  async updateLeaveType(tenantId: string, id: string, input: unknown) {
    const p = leaveTypePatch.parse(input ?? {});
    try {
      const [row] = await this.db.update(payrollLeaveTypes).set(p).where(and(eq(payrollLeaveTypes.tenantId, tenantId), eq(payrollLeaveTypes.id, id))).returning();
      if (!row) throw notFound("Leave type");
      return row;
    } catch (e) {
      if (isUnique(e)) throw err(409, "leave_code_taken", "A leave type with that code exists");
      throw e;
    }
  }

  private async leaveUsed(tenantId: string, from: string, to: string, employeeIds: readonly string[]) {
    if (employeeIds.length === 0) return new Map<string, number>();
    const rows = await this.db
      .select({ employeeId: payrollAttendance.employeeId, leaveTypeId: payrollAttendance.leaveTypeId, status: payrollAttendance.status })
      .from(payrollAttendance)
      .where(
        and(
          eq(payrollAttendance.tenantId, tenantId),
          gte(payrollAttendance.date, from),
          lte(payrollAttendance.date, to),
          inArray(payrollAttendance.employeeId, [...employeeIds]),
          sql`${payrollAttendance.leaveTypeId} is not null`,
          inArray(payrollAttendance.status, ["leave", "half_day"]),
        ),
      );
    const used = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.employeeId}|${r.leaveTypeId}`;
      used.set(k, (used.get(k) ?? 0) + (r.status === "half_day" ? 0.5 : 1));
    }
    return used;
  }

  /** Leave balances of a year for everyone (or one person). */
  async balances(tenantId: string, query: unknown = {}): Promise<{ year: number; from: string; to: string; items: LeaveBalanceRow[] }> {
    const q = balanceQuery.parse(query ?? {});
    const config = await this.config(tenantId);
    const year = q.year ?? leaveYearOf(this.today(), config.leaveYearStartMonth);
    const { from, to } = leaveYearRange(year, config.leaveYearStartMonth);
    const [types, emps] = await Promise.all([
      this.leaveTypes(tenantId),
      this.db
        .select({ id: payrollEmployees.id, code: payrollEmployees.code, name: payrollEmployees.name })
        .from(payrollEmployees)
        .where(and(eq(payrollEmployees.tenantId, tenantId), q.employeeId ? eq(payrollEmployees.id, q.employeeId) : or(isNull(payrollEmployees.leaveDate), gte(payrollEmployees.leaveDate, from))))
        .orderBy(asc(payrollEmployees.name)),
    ]);
    const ids = emps.map((e) => e.id);
    const [used, stored, pending] = await Promise.all([
      this.leaveUsed(tenantId, from, to, ids),
      ids.length
        ? this.db.select().from(payrollLeaveBalances).where(and(eq(payrollLeaveBalances.tenantId, tenantId), eq(payrollLeaveBalances.year, year), inArray(payrollLeaveBalances.employeeId, ids)))
        : Promise.resolve([]),
      ids.length
        ? this.db
            .select({ employeeId: payrollLeaveRequests.employeeId, leaveTypeId: payrollLeaveRequests.leaveTypeId, days: payrollLeaveRequests.days })
            .from(payrollLeaveRequests)
            .where(and(eq(payrollLeaveRequests.tenantId, tenantId), eq(payrollLeaveRequests.status, "pending"), inArray(payrollLeaveRequests.employeeId, ids), gte(payrollLeaveRequests.fromDate, from), lte(payrollLeaveRequests.fromDate, to)))
        : Promise.resolve([]),
    ]);
    const st = new Map(stored.map((s) => [`${s.employeeId}|${s.leaveTypeId}`, s]));
    const pend = new Map<string, number>();
    for (const p of pending) pend.set(`${p.employeeId}|${p.leaveTypeId}`, (pend.get(`${p.employeeId}|${p.leaveTypeId}`) ?? 0) + p.days);
    return {
      year,
      from,
      to,
      items: emps.map((e) => ({
        employee: e,
        types: types.map((t) => {
          const k = `${e.id}|${t.id}`;
          const s = st.get(k);
          const u = used.get(k) ?? 0;
          return {
            leaveTypeId: t.id,
            code: t.code,
            name: t.name,
            paid: t.paid,
            yearlyDays: t.yearlyDays,
            opening: s?.opening ?? 0,
            adjustment: s?.adjustment ?? 0,
            used: u,
            pending: pend.get(k) ?? 0,
            balance: leaveBalance(t, s?.opening ?? 0, s?.adjustment ?? 0, u),
          };
        }),
      })),
    };
  }

  async setBalance(tenantId: string, input: unknown, actor?: Actor) {
    const p = balanceInput.parse(input ?? {});
    await this.employee(tenantId, p.employeeId);
    const set = { ...(p.opening !== undefined ? { opening: p.opening } : {}), ...(p.adjustment !== undefined ? { adjustment: p.adjustment } : {}), note: p.note };
    const [row] = await this.db
      .insert(payrollLeaveBalances)
      .values({ tenantId, employeeId: p.employeeId, leaveTypeId: p.leaveTypeId, year: p.year, opening: p.opening ?? 0, adjustment: p.adjustment ?? 0, note: p.note })
      .onConflictDoUpdate({ target: [payrollLeaveBalances.tenantId, payrollLeaveBalances.employeeId, payrollLeaveBalances.leaveTypeId, payrollLeaveBalances.year], set })
      .returning();
    await this.audit(tenantId, actor, "payroll.leave.balance", "payroll_leave_balance", row!.id, `Leave balance set for ${p.year}`, undefined, set);
    return row!;
  }

  /** Writes next year's opening days from this year's unused days for types that carry forward. */
  async carryForward(tenantId: string, input: unknown) {
    const { year } = carryInput.parse(input ?? {});
    const prev = await this.balances(tenantId, { year: year - 1 });
    const types = new Map((await this.leaveTypes(tenantId)).map((t) => [t.id, t]));
    let written = 0;
    for (const row of prev.items) {
      for (const b of row.types) {
        const t = types.get(b.leaveTypeId);
        if (!t?.carryForward) continue;
        const days = carryForward(t, b.balance);
        await this.db
          .insert(payrollLeaveBalances)
          .values({ tenantId, employeeId: row.employee.id, leaveTypeId: t.id, year, opening: days, note: `Carried from ${year - 1}` })
          .onConflictDoUpdate({ target: [payrollLeaveBalances.tenantId, payrollLeaveBalances.employeeId, payrollLeaveBalances.leaveTypeId, payrollLeaveBalances.year], set: { opening: days } });
        written++;
      }
    }
    return { year, written };
  }

  async leaveRequests(tenantId: string, query: unknown = {}) {
    const q = leaveListQuery.parse(query ?? {});
    const rows = await this.db
      .select({ r: payrollLeaveRequests, name: payrollEmployees.name, code: payrollEmployees.code, type: payrollLeaveTypes.name, typeCode: payrollLeaveTypes.code, paid: payrollLeaveTypes.paid })
      .from(payrollLeaveRequests)
      .leftJoin(payrollEmployees, eq(payrollEmployees.id, payrollLeaveRequests.employeeId))
      .leftJoin(payrollLeaveTypes, eq(payrollLeaveTypes.id, payrollLeaveRequests.leaveTypeId))
      .where(
        and(
          eq(payrollLeaveRequests.tenantId, tenantId),
          q.status === "all" ? undefined : eq(payrollLeaveRequests.status, q.status),
          q.employeeId ? eq(payrollLeaveRequests.employeeId, q.employeeId) : undefined,
        ),
      )
      .orderBy(desc(payrollLeaveRequests.createdAt))
      .limit(q.limit);
    return { items: rows.map((x) => ({ ...x.r, employeeName: x.name ?? "", employeeCode: x.code ?? "", leaveTypeName: x.type ?? "", leaveTypeCode: x.typeCode ?? "", leavePaid: x.paid ?? true })) };
  }

  private async request(tenantId: string, id: string, db: DbOrTx = this.db) {
    const [r] = await db.select().from(payrollLeaveRequests).where(and(eq(payrollLeaveRequests.tenantId, tenantId), eq(payrollLeaveRequests.id, id))).limit(1);
    if (!r) throw notFound("Leave request");
    return r;
  }

  /** Days a request would take for this person. */
  private async requestDays(tenantId: string, e: PayrollEmployee, from: string, to: string, halfDay: boolean) {
    const [config, holidays] = await Promise.all([this.config(tenantId), this.holidayMap(tenantId, from, to)]);
    return leaveDaysIn(from, to, this.weekOffsFor(e, config), new Set(holidays(e.branchId).keys()), halfDay);
  }

  /** Files a request for `employeeId` (a manager) or for the person linked to `selfUserId`. */
  async requestLeave(tenantId: string, input: unknown, actor: Actor, opts: { selfUserId?: string; canApprove: boolean }) {
    const p = leaveRequestInput.parse(input ?? {});
    let e: PayrollEmployee | null;
    if (opts.selfUserId) {
      e = await this.employeeForUser(tenantId, opts.selfUserId);
      if (!e) throw err(404, "not_linked", "Your login is not linked to a staff record");
    } else {
      if (!p.employeeId) throw badRequest("Choose the staff member");
      e = await this.employee(tenantId, p.employeeId);
    }
    const types = await this.leaveTypesMap(tenantId);
    const t = types.get(p.leaveTypeId);
    if (!t || !t.active) throw badRequest("Unknown leave type");
    const { days } = await this.requestDays(tenantId, e, p.from, p.to, p.halfDay);
    if (days === 0) throw err(400, "no_working_days", "Those dates are all weekly offs or holidays");
    const overlap = await this.db
      .select({ id: payrollLeaveRequests.id })
      .from(payrollLeaveRequests)
      .where(
        and(
          eq(payrollLeaveRequests.tenantId, tenantId),
          eq(payrollLeaveRequests.employeeId, e.id),
          inArray(payrollLeaveRequests.status, ["pending", "approved"]),
          lte(payrollLeaveRequests.fromDate, p.to),
          gte(payrollLeaveRequests.toDate, p.from),
        ),
      )
      .limit(1);
    if (overlap.length) throw err(409, "leave_overlap", "There is already a leave request for some of these days");
    const [row] = await this.db
      .insert(payrollLeaveRequests)
      .values({ tenantId, employeeId: e.id, leaveTypeId: t.id, fromDate: p.from, toDate: p.to, halfDay: p.halfDay, days, reason: p.reason, requestedBy: actor.userId })
      .returning();
    if (p.approve && opts.canApprove && !opts.selfUserId) return this.approveLeave(tenantId, row!.id, {}, actor);
    return row!;
  }

  /** Approves a pending request: checks the balance and marks each working day as leave (days worked are left alone). */
  async approveLeave(tenantId: string, id: string, input: unknown, actor: Actor) {
    const { note } = decisionInput.parse(input ?? {});
    const r = await this.request(tenantId, id);
    if (r.status !== "pending") throw err(409, "not_pending", "This request was already decided");
    const e = await this.employee(tenantId, r.employeeId);
    const config = await this.config(tenantId);
    const types = await this.leaveTypesMap(tenantId);
    const t = types.get(r.leaveTypeId);
    if (!t) throw badRequest("Unknown leave type");
    const { dates } = await this.requestDays(tenantId, e, r.fromDate, r.toDate, r.halfDay);
    const year = leaveYearOf(r.fromDate, config.leaveYearStartMonth);
    const bal = (await this.balances(tenantId, { year, employeeId: e.id })).items[0]?.types.find((x) => x.leaveTypeId === t.id);
    if (bal && bal.balance !== null && r.days > bal.balance) {
      throw err(409, "leave_balance_low", `Only ${bal.balance} days of ${t.name} are left. Approve fewer days or use leave without pay.`, { balance: bal.balance, days: r.days });
    }
    return this.db.transaction(async (tx) => {
      await this.assertOpen(tenantId, dates, tx);
      let applied = 0;
      for (const d of dates) {
        const before = await this.markRow(tenantId, e.id, d, tx);
        if (before?.checkIn) continue;
        const values = {
          status: (r.halfDay ? "half_day" : "leave") as AttendanceStatus,
          leaveTypeId: t.id,
          leaveRequestId: r.id,
          checkIn: null,
          checkOut: null,
          workedMinutes: 0,
          lateMinutes: 0,
          overtimeMinutes: 0,
          source: "leave" as AttendanceSource,
          markedBy: actor.userId,
        };
        const [row] = await tx
          .insert(payrollAttendance)
          .values({ tenantId, employeeId: e.id, date: d, ...values })
          .onConflictDoUpdate({ target: [payrollAttendance.tenantId, payrollAttendance.employeeId, payrollAttendance.date], set: values })
          .returning();
        await this.logChange(tx, tenantId, e.id, d, before, row!, "Leave approved", actor.userId);
        applied += r.halfDay ? 0.5 : 1;
      }
      const [row] = await tx
        .update(payrollLeaveRequests)
        .set({ status: "approved", days: applied, decidedBy: actor.userId, decidedAt: this.now(), decisionNote: note })
        .where(eq(payrollLeaveRequests.id, r.id))
        .returning();
      return row!;
    });
  }

  async rejectLeave(tenantId: string, id: string, input: unknown, actor: Actor) {
    const { note } = decisionInput.parse(input ?? {});
    const r = await this.request(tenantId, id);
    if (r.status !== "pending") throw err(409, "not_pending", "This request was already decided");
    const [row] = await this.db.update(payrollLeaveRequests).set({ status: "rejected", decidedBy: actor.userId, decidedAt: this.now(), decisionNote: note }).where(eq(payrollLeaveRequests.id, r.id)).returning();
    return row!;
  }

  /** Cancels a pending request, or an approved one (its leave marks are removed). `selfUserId`: only own pending ones. */
  async cancelLeave(tenantId: string, id: string, actor: Actor, opts: { selfUserId?: string } = {}) {
    const r = await this.request(tenantId, id);
    if (opts.selfUserId) {
      const e = await this.employeeForUser(tenantId, opts.selfUserId);
      if (!e || e.id !== r.employeeId) throw notFound("Leave request");
      if (r.status !== "pending") throw err(409, "not_pending", "Ask your manager to cancel approved leave");
    }
    if (r.status !== "pending" && r.status !== "approved") throw err(409, "not_pending", "This request is closed");
    return this.db.transaction(async (tx) => {
      if (r.status === "approved") {
        const marks = await tx.select().from(payrollAttendance).where(and(eq(payrollAttendance.tenantId, tenantId), eq(payrollAttendance.leaveRequestId, r.id)));
        await this.assertOpen(tenantId, marks.map((m) => m.date), tx);
        for (const m of marks) {
          await tx.delete(payrollAttendance).where(eq(payrollAttendance.id, m.id));
          await this.logChange(tx, tenantId, m.employeeId, m.date, m, null, "Leave cancelled", actor.userId);
        }
      }
      const [row] = await tx.update(payrollLeaveRequests).set({ status: "cancelled", decidedBy: actor.userId, decidedAt: this.now() }).where(eq(payrollLeaveRequests.id, r.id)).returning();
      return row!;
    });
  }

  // ================================================================ advances

  /** Recovered so far per advance: deductions of finalized payroll lines (other than `exceptRun`). */
  private async recoveredByAdvance(tenantId: string, employeeIds: readonly string[], exceptRun?: string, db: DbOrTx = this.db): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (employeeIds.length === 0) return out;
    const rows = await db
      .select({ deductions: payrollRunLines.deductions })
      .from(payrollRunLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
      .where(
        and(
          eq(payrollRunLines.tenantId, tenantId),
          eq(payrollRuns.status, "finalized"),
          inArray(payrollRunLines.employeeId, [...employeeIds]),
          exceptRun ? ne(payrollRuns.id, exceptRun) : undefined,
        ),
      );
    for (const r of rows) for (const d of r.deductions) if (d.advanceId) out.set(d.advanceId, (out.get(d.advanceId) ?? 0) + d.amount);
    return out;
  }

  async advances(tenantId: string, query: { employeeId?: string; status?: string } = {}): Promise<{ items: AdvanceView[]; outstanding: number }> {
    const rows = await this.db
      .select({ a: payrollAdvances, name: payrollEmployees.name, code: payrollEmployees.code })
      .from(payrollAdvances)
      .leftJoin(payrollEmployees, eq(payrollEmployees.id, payrollAdvances.employeeId))
      .where(and(eq(payrollAdvances.tenantId, tenantId), query.employeeId ? eq(payrollAdvances.employeeId, query.employeeId) : undefined))
      .orderBy(desc(payrollAdvances.date), desc(payrollAdvances.createdAt));
    const rec = await this.recoveredByAdvance(tenantId, [...new Set(rows.map((r) => r.a.employeeId))]);
    let items = rows.map((r): AdvanceView => {
      const recovered = rec.get(r.a.id) ?? 0;
      return { ...r.a, employeeName: r.name ?? "", employeeCode: r.code ?? "", recovered, outstanding: r.a.status === "cancelled" ? 0 : Math.max(0, r.a.amount - recovered) };
    });
    if (query.status === "open") items = items.filter((a) => a.status === "open" && a.outstanding > 0);
    else if (query.status === "closed") items = items.filter((a) => a.status === "open" && a.outstanding === 0);
    return { items, outstanding: sum(items.map((a) => a.outstanding)) };
  }

  async createAdvance(tenantId: string, input: unknown, actor: Actor) {
    const p = advanceInput.parse(input ?? {});
    const e = await this.employee(tenantId, p.employeeId);
    const date = p.date ?? this.today();
    const [row] = await this.db
      .insert(payrollAdvances)
      .values({ tenantId, employeeId: e.id, date, amount: p.amount, instalment: p.instalment, startMonth: p.startMonth ?? date.slice(0, 7), method: p.method, reference: p.reference, reason: p.reason, createdBy: actor.userId })
      .returning();
    await this.audit(tenantId, actor, "payroll.advance.create", "payroll_advance", row!.id, `Advance of ${p.amount / 100} to ${e.name}`);
    this.changed(tenantId);
    return row!;
  }

  async updateAdvance(tenantId: string, id: string, input: unknown) {
    const p = advancePatch.parse(input ?? {});
    const [row] = await this.db.update(payrollAdvances).set(p).where(and(eq(payrollAdvances.tenantId, tenantId), eq(payrollAdvances.id, id))).returning();
    if (!row) throw notFound("Advance");
    return row;
  }

  /** Cancels an advance nothing was recovered from (a mistake). Its posting is reversed. */
  async cancelAdvance(tenantId: string, id: string, actor: Actor) {
    const [a] = await this.db.select().from(payrollAdvances).where(and(eq(payrollAdvances.tenantId, tenantId), eq(payrollAdvances.id, id))).limit(1);
    if (!a) throw notFound("Advance");
    if (a.status === "cancelled") return a;
    const rec = (await this.recoveredByAdvance(tenantId, [a.employeeId])).get(a.id) ?? 0;
    if (rec > 0) throw err(409, "advance_recovered", "Part of this advance is already recovered in a final payroll; it can't be cancelled");
    const [row] = await this.db.update(payrollAdvances).set({ status: "cancelled", cancelledAt: this.now() }).where(eq(payrollAdvances.id, a.id)).returning();
    await this.audit(tenantId, actor, "payroll.advance.cancel", "payroll_advance", a.id, "Advance cancelled");
    this.changed(tenantId);
    return row!;
  }

  // ================================================================ payroll runs

  async runs(tenantId: string, query: unknown = {}) {
    const q = runListQuery.parse(query ?? {});
    const rows = await this.db
      .select()
      .from(payrollRuns)
      .where(
        and(
          eq(payrollRuns.tenantId, tenantId),
          q.status === "all" ? undefined : eq(payrollRuns.status, q.status),
          q.year ? and(gte(payrollRuns.month, `${q.year}-01`), lte(payrollRuns.month, `${q.year}-12`)) : undefined,
        ),
      )
      .orderBy(desc(payrollRuns.month), desc(payrollRuns.createdAt));
    const paid = rows.length
      ? await this.db
          .select({ runId: payrollPayments.runId, n: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${payrollPayments.amount}), 0)::int` })
          .from(payrollPayments)
          .where(and(eq(payrollPayments.tenantId, tenantId), eq(payrollPayments.status, "paid"), inArray(payrollPayments.runId, rows.map((r) => r.id))))
          .groupBy(payrollPayments.runId)
      : [];
    const by = new Map(paid.map((p) => [p.runId, p]));
    return { items: rows.map(({ config: _c, ...r }) => ({ ...r, paid: { count: Number(by.get(r.id)?.n ?? 0), amount: Number(by.get(r.id)?.amount ?? 0) } })) };
  }

  private async runRow(tenantId: string, id: string, db: DbOrTx = this.db): Promise<PayrollRun> {
    const [r] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, id))).limit(1);
    if (!r) throw notFound("Payroll");
    return r;
  }

  async getRun(tenantId: string, id: string): Promise<RunView> {
    const run = await this.runRow(tenantId, id);
    const [lines, pays] = await Promise.all([
      this.db.select().from(payrollRunLines).where(and(eq(payrollRunLines.tenantId, tenantId), eq(payrollRunLines.runId, id))),
      this.db.select().from(payrollPayments).where(and(eq(payrollPayments.tenantId, tenantId), eq(payrollPayments.runId, id), eq(payrollPayments.status, "paid"))),
    ]);
    const byLine = new Map(pays.map((p) => [p.lineId, p]));
    const view = lines
      .map((l): RunLineView => {
        const p = byLine.get(l.id);
        return { ...l, payment: p ? { id: p.id, date: p.date, method: p.method, amount: p.amount, reference: p.reference } : null };
      })
      .sort((a, b) => a.snapshot.name.localeCompare(b.snapshot.name));
    return { ...run, lines: view, paid: { count: pays.length, amount: sum(pays.map((p) => p.amount)) } };
  }

  /** Starts a month's payroll (a draft worked out from attendance). One payroll per month. */
  async createRun(tenantId: string, input: unknown, actor: Actor): Promise<RunView> {
    const p = runInput.parse(input ?? {});
    if (p.month > this.today().slice(0, 7)) throw badRequest("Payroll can't be run for a month that has not started");
    const config = await this.config(tenantId);
    const { from, to } = monthRange(p.month);
    let id: string;
    try {
      const [run] = await this.db.insert(payrollRuns).values({ tenantId, month: p.month, periodFrom: from, periodTo: to, config, notes: p.notes, createdBy: actor.userId }).returning();
      id = run!.id;
    } catch (e) {
      if (isUnique(e)) throw err(409, "run_exists", `There is already a payroll for ${p.month}`);
      throw e;
    }
    await this.compute(tenantId, id);
    return this.getRun(tenantId, id);
  }

  /** Works the draft out again from the latest attendance, salaries, advances and settings (adjustments are kept). */
  async refreshRun(tenantId: string, id: string): Promise<RunView> {
    const run = await this.runRow(tenantId, id);
    if (run.status !== "draft") throw err(409, "run_not_draft", "Only a draft payroll can be worked out again");
    await this.db.update(payrollRuns).set({ config: await this.config(tenantId) }).where(eq(payrollRuns.id, id));
    await this.compute(tenantId, id);
    return this.getRun(tenantId, id);
  }

  /** Changes one line's overtime, extra loss-of-pay days, extra earnings / deductions, TDS or advance recovery. */
  async adjustLine(tenantId: string, runId: string, lineId: string, input: unknown): Promise<RunView> {
    const p = lineAdjustInput.parse(input ?? {});
    const run = await this.runRow(tenantId, runId);
    if (run.status !== "draft") throw err(409, "run_not_draft", "Only a draft payroll can be changed");
    const [line] = await this.db.select().from(payrollRunLines).where(and(eq(payrollRunLines.tenantId, tenantId), eq(payrollRunLines.runId, runId), eq(payrollRunLines.id, lineId))).limit(1);
    if (!line) throw notFound("Payroll line");
    const adjustments: LineAdjustments = { ...line.adjustments, ...p };
    await this.db.update(payrollRunLines).set({ adjustments }).where(eq(payrollRunLines.id, lineId));
    await this.compute(tenantId, runId);
    return this.getRun(tenantId, runId);
  }

  /** (Re)computes every line of a draft run inside one transaction. */
  private async compute(tenantId: string, runId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payroll:${tenantId}`}))`);
      const run = await this.runRow(tenantId, runId, tx);
      if (run.status !== "draft") return;
      const config = mergeConfig(run.config);
      const { periodFrom: from, periodTo: to, month } = run;
      const emps = await tx
        .select()
        .from(payrollEmployees)
        .where(and(eq(payrollEmployees.tenantId, tenantId), lte(payrollEmployees.joinDate, to), or(isNull(payrollEmployees.leaveDate), gte(payrollEmployees.leaveDate, from))));
      const ids = emps.map((e) => e.id);
      const types = new Map((await tx.select().from(payrollLeaveTypes).where(eq(payrollLeaveTypes.tenantId, tenantId))).map((t) => [t.id, t]));
      const holidays = await this.holidayMap(tenantId, from, to, tx);
      const marks = ids.length
        ? await tx.select().from(payrollAttendance).where(and(eq(payrollAttendance.tenantId, tenantId), gte(payrollAttendance.date, from), lte(payrollAttendance.date, to), inArray(payrollAttendance.employeeId, ids)))
        : [];
      const advances = ids.length
        ? await tx
            .select()
            .from(payrollAdvances)
            .where(and(eq(payrollAdvances.tenantId, tenantId), eq(payrollAdvances.status, "open"), inArray(payrollAdvances.employeeId, ids), lte(payrollAdvances.startMonth, month), lte(payrollAdvances.date, to)))
            .orderBy(asc(payrollAdvances.date))
        : [];
      const recovered = await this.recoveredByAdvance(tenantId, ids, runId, tx);
      // Professional tax: earlier finalized months of the same half-year.
      const half = halfYearOf(month);
      const before = ids.length
        ? await tx
            .select({ employeeId: payrollRunLines.employeeId, gross: payrollRunLines.gross, heads: payrollRunLines.heads })
            .from(payrollRunLines)
            .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
            .where(and(eq(payrollRunLines.tenantId, tenantId), eq(payrollRuns.status, "finalized"), gte(payrollRuns.month, half.from), sql`${payrollRuns.month} < ${month}`, inArray(payrollRunLines.employeeId, ids)))
        : [];
      const existing = await tx.select().from(payrollRunLines).where(and(eq(payrollRunLines.tenantId, tenantId), eq(payrollRunLines.runId, runId)));
      const existingBy = new Map(existing.map((l) => [l.employeeId, l]));

      const computed = [];
      for (const e of emps) {
        const mine = new Map(marks.filter((m) => m.employeeId === e.id).map((m) => [m.date, m]));
        const days = countDays({
          from,
          to,
          joinDate: e.joinDate,
          leaveDate: e.leaveDate,
          weekOffs: this.weekOffsFor(e, config),
          holidays: new Set(holidays(e.branchId).keys()),
          marks: this.dayMarks(mine, types),
          unmarkedAs: config.unmarkedAs,
        });
        const open: OpenAdvance[] = advances
          .filter((a) => a.employeeId === e.id)
          .map((a) => ({ id: a.id, outstanding: Math.max(0, a.amount - (recovered.get(a.id) ?? 0)), instalment: a.instalment, label: `Advance recovery (${a.date})` }))
          .filter((a) => a.outstanding > 0);
        const prior = before.filter((b) => b.employeeId === e.id);
        const adjustments = existingBy.get(e.id)?.adjustments ?? {};
        const line = computePayLine({
          structure: { ...EMPTY_STRUCTURE, ...e.salary },
          days,
          config,
          month,
          halfYearGrossBefore: sum(prior.map((b) => b.gross)),
          halfYearPtBefore: sum(prior.map((b) => Number(b.heads.pt ?? 0))),
          advances: open,
          adjustments,
        });
        const snapshot: LineSnapshot = {
          code: e.code,
          name: e.name,
          designation: e.designation,
          branchId: e.branchId,
          joinDate: e.joinDate,
          leaveDate: e.leaveDate,
          payType: e.salary.payType,
          structure: e.salary,
          payMethod: e.payMethod,
          bankName: e.bankName,
          accountNumber: e.accountNumber,
          ifsc: e.ifsc,
          upiId: e.upiId,
          uan: e.uan,
          esiNumber: e.esiNumber,
          pan: e.pan,
        };
        const values = {
          snapshot,
          days: line.days,
          basisDays: line.basisDays,
          paidDays: line.paidDays,
          earnings: line.earnings,
          deductions: line.deductions,
          employer: line.employer,
          heads: line.heads,
          adjustments,
          warnings: line.warnings,
          gross: line.gross,
          totalDeductions: line.totalDeductions,
          roundOff: line.roundOff,
          net: line.net,
        };
        await tx
          .insert(payrollRunLines)
          .values({ tenantId, runId, employeeId: e.id, ...values })
          .onConflictDoUpdate({ target: [payrollRunLines.runId, payrollRunLines.employeeId], set: values });
        computed.push(line);
      }
      const keep = new Set(ids);
      const gone = existing.filter((l) => !keep.has(l.employeeId)).map((l) => l.id);
      if (gone.length) await tx.delete(payrollRunLines).where(inArray(payrollRunLines.id, gone));
      await tx.update(payrollRuns).set({ totals: runTotals(computed), computedAt: this.now() }).where(eq(payrollRuns.id, runId));
    });
  }

  /** Freezes the payroll (worked out once more first) and posts it to the books. */
  async finalizeRun(tenantId: string, id: string, actor: Actor): Promise<RunView> {
    const run = await this.runRow(tenantId, id);
    if (run.status !== "draft") throw err(409, "run_not_draft", "This payroll is not a draft");
    await this.compute(tenantId, id);
    const view = await this.getRun(tenantId, id);
    const negative = view.lines.filter((l) => l.net < 0);
    if (negative.length) throw err(409, "net_negative", "Net pay is below zero for some staff. Lower their deductions first.", { names: negative.map((l) => l.snapshot.name) });
    if (view.lines.length === 0) throw err(409, "run_empty", "There is nobody to pay for this month");
    await this.db.update(payrollRuns).set({ status: "finalized", finalizedAt: this.now(), finalizedBy: actor.userId }).where(and(eq(payrollRuns.id, id), eq(payrollRuns.status, "draft")));
    await this.audit(tenantId, actor, "payroll.run.finalize", "payroll_run", id, `Payroll for ${run.month} made final: net ${(view.totals?.net ?? 0) / 100}`);
    this.changed(tenantId);
    return this.getRun(tenantId, id);
  }

  /** A draft is deleted; a final payroll with no payments is cancelled (kept, and its posting is reversed). */
  async cancelRun(tenantId: string, id: string, input: unknown, actor: Actor): Promise<{ ok: true; deleted: boolean }> {
    const run = await this.runRow(tenantId, id);
    if (run.status === "cancelled") return { ok: true, deleted: false };
    if (run.status === "draft") {
      await this.db.transaction(async (tx) => {
        await tx.delete(payrollRunLines).where(and(eq(payrollRunLines.tenantId, tenantId), eq(payrollRunLines.runId, id)));
        await tx.delete(payrollRuns).where(eq(payrollRuns.id, id));
      });
      return { ok: true, deleted: true };
    }
    const { reason } = cancelInput.parse(input ?? {});
    const [paid] = await this.db.select({ id: payrollPayments.id }).from(payrollPayments).where(and(eq(payrollPayments.tenantId, tenantId), eq(payrollPayments.runId, id), eq(payrollPayments.status, "paid"))).limit(1);
    if (paid) throw err(409, "run_has_payments", "Some staff are marked paid. Undo those payments first.");
    // A later month already counted this one (advances, professional tax): it must be cancelled first.
    const [later] = await this.db
      .select({ month: payrollRuns.month })
      .from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.status, "finalized"), sql`${payrollRuns.month} > ${run.month}`))
      .limit(1);
    if (later) throw err(409, "later_run_final", `The payroll for ${later.month} is final and builds on this one. Cancel it first.`, { month: later.month });
    await this.db.update(payrollRuns).set({ status: "cancelled", cancelledAt: this.now(), cancelReason: reason }).where(eq(payrollRuns.id, id));
    await this.audit(tenantId, actor, "payroll.run.cancel", "payroll_run", id, `Payroll for ${run.month} cancelled: ${reason}`);
    this.changed(tenantId);
    return { ok: true, deleted: false };
  }

  // ================================================================ payments

  /** Marks lines of a final payroll paid (each person's own method unless one is given). */
  async pay(tenantId: string, runId: string, input: unknown, actor: Actor): Promise<{ paid: number; amount: number }> {
    const p = payInput.parse(input ?? {});
    const run = await this.runRow(tenantId, runId);
    if (run.status !== "finalized") throw err(409, "run_not_final", "Make the payroll final before paying");
    const date = p.date ?? this.today();
    const view = await this.getRun(tenantId, runId);
    const want = p.lineIds ? new Set(p.lineIds) : null;
    const todo = view.lines.filter((l) => !l.payment && l.net > 0 && (!want || want.has(l.id)));
    if (todo.length === 0) return { paid: 0, amount: 0 };
    try {
      await this.db.insert(payrollPayments).values(
        todo.map((l) => ({ tenantId, runId, lineId: l.id, employeeId: l.employeeId, date, amount: l.net, method: p.method ?? l.snapshot.payMethod, reference: p.reference, paidBy: actor.userId })),
      );
    } catch (e) {
      if (isUnique(e)) throw err(409, "already_paid", "Someone already marked one of these paid. Refresh and try again.");
      throw e;
    }
    await this.audit(tenantId, actor, "payroll.pay", "payroll_run", runId, `${todo.length} paid for ${run.month}`);
    this.changed(tenantId);
    return { paid: todo.length, amount: sum(todo.map((l) => l.net)) };
  }

  /** Undoes a payment marked by mistake (kept as cancelled; its posting is reversed). */
  async unpay(tenantId: string, paymentId: string, actor: Actor) {
    const [row] = await this.db
      .update(payrollPayments)
      .set({ status: "cancelled", cancelledAt: this.now() })
      .where(and(eq(payrollPayments.tenantId, tenantId), eq(payrollPayments.id, paymentId), eq(payrollPayments.status, "paid")))
      .returning();
    if (!row) throw notFound("Payment");
    await this.audit(tenantId, actor, "payroll.unpay", "payroll_payment", paymentId, "Salary payment undone");
    this.changed(tenantId);
    return row;
  }

  // ================================================================ statutory dues

  /** PF, ESI, professional tax and salary TDS due per month (from final payrolls) against what was paid. */
  async dues(tenantId: string, query: unknown = {}): Promise<{ items: DueRow[] }> {
    const q = duesQuery.parse(query ?? {});
    const to = q.to ?? this.today().slice(0, 7);
    const from = q.from ?? addMonths(to, -11);
    const [runs, pays] = await Promise.all([
      this.db
        .select({ month: payrollRuns.month, totals: payrollRuns.totals })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.status, "finalized"), gte(payrollRuns.month, from), lte(payrollRuns.month, to))),
      this.db
        .select()
        .from(payrollDuePayments)
        .where(and(eq(payrollDuePayments.tenantId, tenantId), eq(payrollDuePayments.status, "paid"), gte(payrollDuePayments.month, from), lte(payrollDuePayments.month, to))),
    ]);
    const items: DueRow[] = [];
    const months = [...new Set([...runs.map((r) => r.month), ...pays.map((p) => p.month)])].sort().reverse();
    for (const m of months) {
      const t = runs.find((r) => r.month === m)?.totals;
      const due: Record<DueKind, number> = {
        pf: (t?.pfEmployee ?? 0) + (t?.pfEmployer ?? 0),
        esi: (t?.esiEmployee ?? 0) + (t?.esiEmployer ?? 0),
        pt: t?.pt ?? 0,
        tds: t?.tds ?? 0,
      };
      for (const kind of DUE_KINDS) {
        const ps = pays.filter((p) => p.month === m && p.kind === kind);
        if (due[kind] === 0 && ps.length === 0) continue;
        const paid = sum(ps.map((p) => p.amount));
        items.push({ month: m, kind, due: due[kind], paid, balance: due[kind] - paid, payments: ps.map((p) => ({ id: p.id, date: p.date, amount: p.amount, method: p.method, reference: p.reference })) });
      }
    }
    return { items };
  }

  async payDue(tenantId: string, input: unknown, actor: Actor) {
    const p = dueInput.parse(input ?? {});
    const [row] = await this.db.insert(payrollDuePayments).values({ tenantId, ...p, date: p.date ?? this.today(), paidBy: actor.userId }).returning();
    await this.audit(tenantId, actor, "payroll.due.pay", "payroll_due_payment", row!.id, `${p.kind.toUpperCase()} for ${p.month} paid`);
    this.changed(tenantId);
    return row!;
  }

  async cancelDue(tenantId: string, id: string, actor: Actor) {
    const [row] = await this.db
      .update(payrollDuePayments)
      .set({ status: "cancelled", cancelledAt: this.now() })
      .where(and(eq(payrollDuePayments.tenantId, tenantId), eq(payrollDuePayments.id, id), eq(payrollDuePayments.status, "paid")))
      .returning();
    if (!row) throw notFound("Payment");
    await this.audit(tenantId, actor, "payroll.due.cancel", "payroll_due_payment", id, "Statutory payment undone");
    this.changed(tenantId);
    return row;
  }

  // ================================================================ self service

  /** The signed-in person's own staff record, today's mark, leave balances and pending requests. */
  async me(tenantId: string, userId: string) {
    const e = await this.employeeForUser(tenantId, userId);
    const config = await this.config(tenantId);
    if (!e) return { employee: null, selfCheckIn: config.selfCheckIn };
    const today = this.today();
    const [mark, balances, requests] = await Promise.all([
      this.markRow(tenantId, e.id, today),
      this.balances(tenantId, { employeeId: e.id }),
      this.leaveRequests(tenantId, { employeeId: e.id, status: "all", limit: 20 }),
    ]);
    return {
      employee: { id: e.id, code: e.code, name: e.name, designation: e.designation, joinDate: e.joinDate, payType: e.payType, payMethod: e.payMethod, accountMasked: maskAccount(e.accountNumber), shiftStart: e.shiftStart ?? config.shiftStart, shiftEnd: e.shiftEnd ?? config.shiftEnd },
      selfCheckIn: config.selfCheckIn,
      today: { date: today, mark },
      balances: balances.items[0]?.types ?? [],
      requests: requests.items,
    };
  }

  async myAttendance(tenantId: string, userId: string, month?: string) {
    const e = await this.employeeForUser(tenantId, userId);
    if (!e) throw err(404, "not_linked", "Your login is not linked to a staff record");
    const s = await this.sheet(tenantId, { month, employeeId: e.id });
    return { month: s.month, dates: s.dates, row: s.rows[0] ?? null };
  }

  async myPayslips(tenantId: string, userId: string) {
    const e = await this.employeeForUser(tenantId, userId);
    if (!e) return { items: [] };
    const rows = await this.db
      .select({ id: payrollRunLines.id, month: payrollRuns.month, gross: payrollRunLines.gross, net: payrollRunLines.net, totalDeductions: payrollRunLines.totalDeductions, paidDays: payrollRunLines.paidDays })
      .from(payrollRunLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
      .where(and(eq(payrollRunLines.tenantId, tenantId), eq(payrollRunLines.employeeId, e.id), eq(payrollRuns.status, "finalized")))
      .orderBy(desc(payrollRuns.month));
    return { items: rows };
  }

  /** A payslip PDF of the person's own final payroll line. */
  async myPayslipPdf(tenantId: string, userId: string, lineId: string, locale: "en" | "ta") {
    const e = await this.employeeForUser(tenantId, userId);
    const data = e ? await this.payslipData(tenantId, lineId) : null;
    if (!e || !data || data.line.employeeId !== e.id) throw notFound("Payslip");
    if (!this.deps.payslipPdf) throw err(409, "pdf_unavailable", "Payslip PDFs are not available here");
    return this.deps.payslipPdf.render(tenantId, lineId, locale);
  }

  /** Everything a payslip shows (final payrolls only). */
  async payslipData(tenantId: string, lineId: string) {
    const [row] = await this.db
      .select({ line: payrollRunLines, run: payrollRuns })
      .from(payrollRunLines)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollRunLines.runId))
      .where(and(eq(payrollRunLines.tenantId, tenantId), eq(payrollRunLines.id, lineId), eq(payrollRuns.status, "finalized")))
      .limit(1);
    if (!row) return null;
    const [pay] = await this.db.select().from(payrollPayments).where(and(eq(payrollPayments.tenantId, tenantId), eq(payrollPayments.lineId, lineId), eq(payrollPayments.status, "paid"))).limit(1);
    const { config: _c, ...run } = row.run;
    return { line: row.line, run, payment: pay ? { date: pay.date, method: pay.method, reference: pay.reference } : null };
  }

  // ================================================================ the books

  /** Final payrolls, salary payments, advances given and statutory dues paid, for the accounting sync. */
  async bookSources(tenantId: string): Promise<PayrollBookSources> {
    const [runs, pays, advs, dues] = await Promise.all([
      this.db.select({ id: payrollRuns.id, month: payrollRuns.month, to: payrollRuns.periodTo, totals: payrollRuns.totals }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.status, "finalized"))),
      this.db
        .select({ p: payrollPayments, name: payrollEmployees.name, month: payrollRuns.month })
        .from(payrollPayments)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payrollPayments.runId))
        .leftJoin(payrollEmployees, eq(payrollEmployees.id, payrollPayments.employeeId))
        .where(and(eq(payrollPayments.tenantId, tenantId), eq(payrollPayments.status, "paid"), eq(payrollRuns.status, "finalized"))),
      this.db
        .select({ a: payrollAdvances, name: payrollEmployees.name })
        .from(payrollAdvances)
        .leftJoin(payrollEmployees, eq(payrollEmployees.id, payrollAdvances.employeeId))
        .where(and(eq(payrollAdvances.tenantId, tenantId), eq(payrollAdvances.status, "open"))),
      this.db.select().from(payrollDuePayments).where(and(eq(payrollDuePayments.tenantId, tenantId), eq(payrollDuePayments.status, "paid"))),
    ]);
    return {
      runs: runs.map((r) => {
        const t = r.totals ?? runTotals([]);
        return {
          id: r.id,
          month: r.month,
          date: r.to,
          gross: t.gross,
          employerPf: t.pfEmployer,
          employerEsi: t.esiEmployer,
          net: t.net,
          pf: t.pfEmployee + t.pfEmployer,
          esi: t.esiEmployee + t.esiEmployer,
          pt: t.pt,
          tds: t.tds,
          advance: t.advance,
          other: t.other,
          roundOff: t.roundOff,
        };
      }),
      payments: pays.map((x) => ({ id: x.p.id, date: x.p.date, amount: x.p.amount, method: x.p.method, employeeName: x.name ?? "Staff", month: x.month })),
      advances: advs.map((x) => ({ id: x.a.id, date: x.a.date, amount: x.a.amount, method: x.a.method, employeeName: x.name ?? "Staff" })),
      dues: dues.map((d) => ({ id: d.id, kind: d.kind, month: d.month, date: d.date, amount: d.amount, method: d.method, reference: d.reference })),
    };
  }
}
