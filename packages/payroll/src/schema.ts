import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, real, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AttendanceStatus, DayCounts, DueKind, LineAdjustments, LineWarning, Money, PayMethod, PayrollConfig, PayType, RunTotals, SalaryStructure } from "./logic";

export const EMPLOYEE_STATUSES = ["active", "left"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const ATTENDANCE_SOURCES = ["manager", "pin", "self", "leave"] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const LEAVE_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];

export const RUN_STATUSES = ["draft", "finalized", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ADVANCE_STATUSES = ["open", "cancelled"] as const;
export type AdvanceStatus = (typeof ADVANCE_STATUSES)[number];

export const PAYMENT_STATUSES = ["paid", "cancelled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** One row per shop: the payroll and attendance rules (logic.ts `PayrollConfig`, merged over the defaults). */
export const payrollSettings = pgTable("payroll_settings", {
  tenantId: uuid("tenant_id").primaryKey(),
  config: jsonb("config").$type<Partial<PayrollConfig>>().notNull().default({}),
  /** Running number of employee codes (EMP-001). */
  nextEmployeeNo: integer("next_employee_no").notNull().default(1),
  updatedBy: uuid("updated_by"),
  ...timestamps(),
});

/**
 * A person the shop pays. Not every employee signs in: `userId` links a team member (for self check-in with their POS
 * PIN, "my payslips" and "my attendance"). The salary structure is kept here; each payroll line keeps a copy of the one
 * it was worked out from.
 */
export const payrollEmployees = pgTable(
  "payroll_employees",
  {
    id: pk(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    userId: uuid("user_id"),
    branchId: uuid("branch_id"),
    designation: text("designation"),
    joinDate: date("join_date", { mode: "string" }).notNull(),
    /** Last working day; null while employed. */
    leaveDate: date("leave_date", { mode: "string" }),
    status: text("status").$type<EmployeeStatus>().notNull().default("active"),
    payType: text("pay_type").$type<PayType>().notNull().default("monthly"),
    salary: jsonb("salary").$type<SalaryStructure>().notNull(),
    /** Own shift / weekly offs when they differ from the shop's (null = the shop's). */
    shiftStart: text("shift_start"),
    shiftEnd: text("shift_end"),
    weekOffs: integer("week_offs").array(),
    payMethod: text("pay_method").$type<PayMethod>().notNull().default("cash"),
    bankName: text("bank_name"),
    /** Full number: the bank transfer sheet needs it. Lists show it masked. */
    accountNumber: text("account_number"),
    ifsc: text("ifsc"),
    upiId: text("upi_id"),
    /** UAN (PF), ESI IP number and PAN, printed on the payslip. */
    uan: text("uan"),
    esiNumber: text("esi_number"),
    pan: text("pan"),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    unique("payroll_employees_tenant_code_uq").on(t.tenantId, t.code),
    uniqueIndex("payroll_employees_tenant_user_uq").on(t.tenantId, t.userId).where(sql`${t.userId} is not null`),
    index("payroll_employees_tenant_status_idx").on(t.tenantId, t.status),
    check("payroll_employees_pay_type_chk", sql`${t.payType} in ('monthly', 'daily', 'hourly')`),
  ],
);

/** Paid holidays of the shop (`branchId` null) or of one branch. */
export const payrollHolidays = pgTable(
  "payroll_holidays",
  {
    id: pk(),
    tenantId: tenantId(),
    branchId: uuid("branch_id"),
    date: date("date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
    ...timestamps(),
  },
  (t) => [index("payroll_holidays_tenant_date_idx").on(t.tenantId, t.date)],
);

/** One mark per person per day. A working day without a row counts as the shop's `unmarkedAs`. */
export const payrollAttendance = pgTable(
  "payroll_attendance",
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid("employee_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    status: text("status").$type<AttendanceStatus>().notNull(),
    /** For `leave` and a half day on leave. */
    leaveTypeId: uuid("leave_type_id"),
    leaveRequestId: uuid("leave_request_id"),
    checkIn: timestamp("check_in", { withTimezone: true }),
    checkOut: timestamp("check_out", { withTimezone: true }),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    source: text("source").$type<AttendanceSource>().notNull().default("manager"),
    note: text("note"),
    markedBy: uuid("marked_by"),
    ...timestamps(),
  },
  (t) => [
    unique("payroll_attendance_emp_date_uq").on(t.tenantId, t.employeeId, t.date),
    index("payroll_attendance_tenant_date_idx").on(t.tenantId, t.date),
    check("payroll_attendance_status_chk", sql`${t.status} in ('present', 'absent', 'half_day', 'leave', 'week_off', 'holiday')`),
  ],
);

/** Every change to a day already marked (corrections): who, when, before / after and why. Never edited. */
export const payrollAttendanceLog = pgTable(
  "payroll_attendance_log",
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid("employee_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    reason: text("reason"),
    changedBy: uuid("changed_by"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payroll_attendance_log_emp_idx").on(t.tenantId, t.employeeId, t.date)],
);

export const payrollLeaveTypes = pgTable(
  "payroll_leave_types",
  {
    id: pk(),
    tenantId: tenantId(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    paid: boolean("paid").notNull().default(true),
    /** Days a year (halves allowed). 0 for an unpaid type = no limit. */
    yearlyDays: real("yearly_days").notNull().default(0),
    carryForward: boolean("carry_forward").notNull().default(false),
    maxCarryDays: real("max_carry_days").notNull().default(0),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("payroll_leave_types_tenant_code_uq").on(t.tenantId, t.code)],
);

/** Opening days (carried forward) and hand adjustments of one person's leave type in a leave year. */
export const payrollLeaveBalances = pgTable(
  "payroll_leave_balances",
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid("employee_id").notNull(),
    leaveTypeId: uuid("leave_type_id").notNull(),
    year: integer("year").notNull(),
    opening: real("opening").notNull().default(0),
    adjustment: real("adjustment").notNull().default(0),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [unique("payroll_leave_balances_uq").on(t.tenantId, t.employeeId, t.leaveTypeId, t.year)],
);

export const payrollLeaveRequests = pgTable(
  "payroll_leave_requests",
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid("employee_id").notNull(),
    leaveTypeId: uuid("leave_type_id").notNull(),
    fromDate: date("from_date", { mode: "string" }).notNull(),
    toDate: date("to_date", { mode: "string" }).notNull(),
    halfDay: boolean("half_day").notNull().default(false),
    days: real("days").notNull(),
    reason: text("reason"),
    status: text("status").$type<LeaveRequestStatus>().notNull().default("pending"),
    requestedBy: uuid("requested_by"),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    ...timestamps(),
  },
  (t) => [index("payroll_leave_requests_tenant_status_idx").on(t.tenantId, t.status), index("payroll_leave_requests_emp_idx").on(t.tenantId, t.employeeId)],
);

/** Salary advance or loan to a person, recovered in monthly instalments from payroll. */
export const payrollAdvances = pgTable(
  "payroll_advances",
  {
    id: pk(),
    tenantId: tenantId(),
    employeeId: uuid("employee_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    amount: integer("amount").notNull(),
    /** Paise recovered each month. */
    instalment: integer("instalment").notNull(),
    /** First month recovered, "YYYY-MM". */
    startMonth: text("start_month").notNull(),
    method: text("method").$type<PayMethod>().notNull().default("cash"),
    reference: text("reference"),
    reason: text("reason"),
    status: text("status").$type<AdvanceStatus>().notNull().default("open"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [index("payroll_advances_tenant_emp_idx").on(t.tenantId, t.employeeId), check("payroll_advances_amount_chk", sql`${t.amount} > 0 and ${t.instalment} > 0`)],
);

/** A month's payroll. Draft (recomputed from attendance on refresh) → finalized (frozen, posted to the books) → cancelled. */
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: pk(),
    tenantId: tenantId(),
    month: text("month").notNull(),
    status: text("status").$type<RunStatus>().notNull().default("draft"),
    periodFrom: date("period_from", { mode: "string" }).notNull(),
    periodTo: date("period_to", { mode: "string" }).notNull(),
    totals: jsonb("totals").$type<RunTotals | null>(),
    /** The rules it was worked out with (a copy). */
    config: jsonb("config").$type<PayrollConfig>().notNull(),
    notes: text("notes"),
    computedAt: timestamp("computed_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizedBy: uuid("finalized_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("payroll_runs_tenant_month_uq").on(t.tenantId, t.month).where(sql`${t.status} <> 'cancelled'`),
    index("payroll_runs_tenant_idx").on(t.tenantId, t.month),
  ],
);

/** What the line was worked out from, frozen with it. */
export interface LineSnapshot {
  code: string;
  name: string;
  designation: string | null;
  branchId: string | null;
  joinDate: string;
  leaveDate: string | null;
  payType: PayType;
  structure: SalaryStructure;
  payMethod: PayMethod;
  bankName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  upiId: string | null;
  uan: string | null;
  esiNumber: string | null;
  pan: string | null;
}

export const payrollRunLines = pgTable(
  "payroll_run_lines",
  {
    id: pk(),
    tenantId: tenantId(),
    runId: uuid("run_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    snapshot: jsonb("snapshot").$type<LineSnapshot>().notNull(),
    days: jsonb("days").$type<DayCounts>().notNull(),
    basisDays: real("basis_days").notNull().default(0),
    paidDays: real("paid_days").notNull().default(0),
    earnings: jsonb("earnings").$type<Money[]>().notNull().default([]),
    deductions: jsonb("deductions").$type<Money[]>().notNull().default([]),
    employer: jsonb("employer").$type<Money[]>().notNull().default([]),
    heads: jsonb("heads").$type<Record<string, number>>().notNull().default({}),
    adjustments: jsonb("adjustments").$type<LineAdjustments>().notNull().default({}),
    warnings: text("warnings").array().$type<LineWarning[]>().notNull().default([]),
    gross: integer("gross").notNull().default(0),
    totalDeductions: integer("total_deductions").notNull().default(0),
    roundOff: integer("round_off").notNull().default(0),
    net: integer("net").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("payroll_run_lines_run_emp_uq").on(t.runId, t.employeeId), index("payroll_run_lines_tenant_emp_idx").on(t.tenantId, t.employeeId)],
);

/** Net pay handed over (cash, bank transfer, UPI). Unmarking cancels it (kept for the record). */
export const payrollPayments = pgTable(
  "payroll_payments",
  {
    id: pk(),
    tenantId: tenantId(),
    runId: uuid("run_id").notNull(),
    lineId: uuid("line_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    amount: integer("amount").notNull(),
    method: text("method").$type<PayMethod>().notNull(),
    reference: text("reference"),
    status: text("status").$type<PaymentStatus>().notNull().default("paid"),
    paidBy: uuid("paid_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("payroll_payments_line_paid_uq").on(t.lineId).where(sql`${t.status} = 'paid'`),
    index("payroll_payments_tenant_run_idx").on(t.tenantId, t.runId),
  ],
);

/** PF, ESI, professional tax or salary TDS paid to the government for a month (challan). */
export const payrollDuePayments = pgTable(
  "payroll_due_payments",
  {
    id: pk(),
    tenantId: tenantId(),
    kind: text("kind").$type<DueKind>().notNull(),
    month: text("month").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    amount: integer("amount").notNull(),
    method: text("method").$type<PayMethod>().notNull().default("bank"),
    reference: text("reference"),
    status: text("status").$type<PaymentStatus>().notNull().default("paid"),
    paidBy: uuid("paid_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("payroll_due_payments_tenant_idx").on(t.tenantId, t.month), check("payroll_due_payments_amount_chk", sql`${t.amount} > 0`)],
);

export type PayrollEmployee = typeof payrollEmployees.$inferSelect;
export type PayrollAttendanceRow = typeof payrollAttendance.$inferSelect;
export type PayrollLeaveType = typeof payrollLeaveTypes.$inferSelect;
export type PayrollLeaveRequest = typeof payrollLeaveRequests.$inferSelect;
export type PayrollAdvance = typeof payrollAdvances.$inferSelect;
export type PayrollRun = typeof payrollRuns.$inferSelect;
export type PayrollRunLine = typeof payrollRunLines.$inferSelect;
export type PayrollPayment = typeof payrollPayments.$inferSelect;
export type PayrollDuePayment = typeof payrollDuePayments.$inferSelect;
export type PayrollHoliday = typeof payrollHolidays.$inferSelect;
