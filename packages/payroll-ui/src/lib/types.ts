/** API shapes of /v1/payroll (packages/payroll). Money is integer paise; dates "YYYY-MM-DD" (IST); months "YYYY-MM". */

export const PAY_TYPES = ["monthly", "daily", "hourly"] as const;
export type PayType = (typeof PAY_TYPES)[number];
export const PAY_METHODS = ["cash", "bank", "upi"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const ATTENDANCE_STATUSES = ["present", "absent", "half_day", "leave", "week_off", "holiday"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const MONTHLY_BASES = ["calendar", "working", "fixed"] as const;
export type MonthlyBasis = (typeof MONTHLY_BASES)[number];
export const PT_MODES = ["half-yearly", "monthly"] as const;
export type PtMode = (typeof PT_MODES)[number];
export const DUE_KINDS = ["pf", "esi", "pt", "tds"] as const;
export type DueKind = (typeof DUE_KINDS)[number];
export const RUN_STATUSES = ["draft", "finalized", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];
export const LINE_WARNINGS = ["net_negative", "recovery_reduced", "unmarked_days", "no_salary", "esi_over_ceiling"] as const;
export type LineWarning = (typeof LINE_WARNINGS)[number];
export const EXPECTED_DAYS = ["working", "week_off", "holiday", "not_employed"] as const;
export type ExpectedDay = (typeof EXPECTED_DAYS)[number];

/** API error codes with a message in `payroll.errors.*` (describeError looks them up by the module id). */
export const ERROR_CODES = [
  "reason_required",
  "leave_type_required",
  "payroll_finalized",
  "wrong_pin",
  "pin_locked",
  "not_linked",
  "pins_unavailable",
  "already_checked_out",
  "on_leave",
  "employee_left",
  "self_checkin_off",
  "leave_balance_low",
  "leave_overlap",
  "no_working_days",
  "not_pending",
  "run_exists",
  "run_not_draft",
  "run_not_final",
  "run_has_payments",
  "later_run_final",
  "net_negative",
  "run_empty",
  "already_paid",
  "advance_recovered",
  "employee_has_history",
  "user_linked",
  "holiday_exists",
  "leave_code_taken",
] as const;

export interface PtSlab {
  upTo: number | null;
  tax: number;
}

export interface PayrollConfig {
  weekOffs: number[];
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  halfDayBelowMinutes: number;
  otAfterMinutes: number;
  otMultiplier: number;
  unmarkedAs: "present" | "absent";
  monthlyBasis: MonthlyBasis;
  fixedDays: number;
  paidHolidaysForDaily: boolean;
  paidWeekOffsForDaily: boolean;
  offDayWorkPaid: boolean;
  roundNet: boolean;
  selfCheckIn: boolean;
  leaveYearStartMonth: number;
  pf: { enabled: boolean; employeeRateBp: number; employerRateBp: number; wageCeiling: number; capAtCeiling: boolean };
  esi: { enabled: boolean; employeeRateBp: number; employerRateBp: number; grossCeiling: number };
  pt: { enabled: boolean; mode: PtMode; deductMonths: number[]; slabs: PtSlab[] };
}

export interface PayrollSettings {
  config: PayrollConfig;
  defaults: PayrollConfig;
}

export interface Allowance {
  name: string;
  amount: number;
}

export interface SalaryStructure {
  payType: PayType;
  basic: number;
  da: number;
  hra: number;
  allowances: Allowance[];
  dailyRate: number;
  hourlyRate: number;
  otRatePerHour: number | null;
  pf: boolean;
  esi: boolean;
  pt: boolean;
}

export interface Employee {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  userId: string | null;
  branchId: string | null;
  designation: string | null;
  joinDate: string;
  leaveDate: string | null;
  status: "active" | "left";
  payType: PayType;
  /** Null without payroll.manage. */
  salary: SalaryStructure | null;
  monthlyGross: number | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  weekOffs: number[] | null;
  payMethod: PayMethod;
  bankName: string | null;
  /** Full number only for payroll.manage. */
  accountNumber: string | null;
  accountMasked: string | null;
  ifsc: string | null;
  upiId: string | null;
  uan: string | null;
  esiNumber: string | null;
  pan: string | null;
  notes: string | null;
}

export interface LinkableMember {
  userId: string;
  name: string | null;
  phone: string | null;
  active: boolean;
  employeeId: string | null;
  employeeName: string | null;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  branchId: string | null;
}

export interface AttendanceMark {
  id: string;
  employeeId: string;
  date: string;
  status: AttendanceStatus;
  leaveTypeId: string | null;
  leaveRequestId: string | null;
  checkIn: string | null;
  checkOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  source: "manager" | "pin" | "self" | "leave";
  note: string | null;
}

export interface DayRow {
  employee: { id: string; code: string; name: string; designation: string | null; branchId: string | null; userId: string | null };
  date: string;
  expected: ExpectedDay;
  holiday: string | null;
  mark: AttendanceMark | null;
  leaveCode: string | null;
}

export interface DayBoard {
  date: string;
  items: DayRow[];
  counts: Record<string, number>;
  finalized: boolean;
}

export interface DayCounts {
  periodDays: number;
  employedDays: number;
  notEmployedDays: number;
  weekOffs: number;
  holidays: number;
  periodWorkingDays: number;
  workingDays: number;
  present: number;
  halfDays: number;
  paidLeave: number;
  unpaidLeave: number;
  absent: number;
  unmarked: number;
  compOffs: number;
  offDaysWorked: number;
  lopDays: number;
  lateDays: number;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
}

export interface SheetRow {
  employee: { id: string; code: string; name: string; designation: string | null; branchId: string | null };
  cells: { date: string; code: string; late: boolean; overtimeMinutes: number }[];
  counts: DayCounts;
}

export interface Sheet {
  month: string;
  from: string;
  to: string;
  dates: string[];
  rows: SheetRow[];
  finalized: boolean;
}

export interface LogEntry {
  id: string;
  employeeId: string;
  date: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  changedBy: string | null;
  at: string;
  employeeName: string;
  employeeCode: string;
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

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  paid: boolean;
  yearlyDays: number;
  carryForward: boolean;
  maxCarryDays: number;
  active: boolean;
  sort: number;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  fromDate: string;
  toDate: string;
  halfDay: boolean;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  decisionNote: string | null;
  createdAt: string;
  employeeName: string;
  employeeCode: string;
  leaveTypeName: string;
  leaveTypeCode: string;
  leavePaid: boolean;
}

export interface BalanceCell {
  leaveTypeId: string;
  code: string;
  name: string;
  paid: boolean;
  yearlyDays: number;
  opening: number;
  adjustment: number;
  used: number;
  pending: number;
  balance: number | null;
}

export interface Balances {
  year: number;
  from: string;
  to: string;
  items: { employee: { id: string; code: string; name: string }; types: BalanceCell[] }[];
}

export interface Advance {
  id: string;
  employeeId: string;
  date: string;
  amount: number;
  instalment: number;
  startMonth: string;
  method: PayMethod;
  reference: string | null;
  reason: string | null;
  status: "open" | "cancelled";
  employeeName: string;
  employeeCode: string;
  recovered: number;
  outstanding: number;
}

export interface Money {
  key: string;
  label: string;
  amount: number;
  advanceId?: string;
}

export interface LineAdjustments {
  overtimeMinutes?: number | null;
  extraLopDays?: number | null;
  earnings?: { label: string; amount: number }[];
  deductions?: { label: string; amount: number }[];
  tds?: number | null;
  advanceRecovery?: Record<string, number>;
}

export interface RunTotals {
  staff: number;
  gross: number;
  deductions: number;
  net: number;
  roundOff: number;
  pfEmployee: number;
  pfEmployer: number;
  esiEmployee: number;
  esiEmployer: number;
  pt: number;
  tds: number;
  advance: number;
  other: number;
  overtime: number;
  employerCost: number;
}

export interface RunLine {
  id: string;
  runId: string;
  employeeId: string;
  snapshot: { code: string; name: string; designation: string | null; branchId: string | null; payType: PayType; payMethod: PayMethod; accountNumber: string | null; bankName: string | null };
  days: DayCounts;
  basisDays: number;
  paidDays: number;
  earnings: Money[];
  deductions: Money[];
  employer: Money[];
  adjustments: LineAdjustments;
  warnings: LineWarning[];
  gross: number;
  totalDeductions: number;
  roundOff: number;
  net: number;
  payment: { id: string; date: string; method: PayMethod; amount: number; reference: string | null } | null;
}

export interface RunSummary {
  id: string;
  month: string;
  status: RunStatus;
  periodFrom: string;
  periodTo: string;
  totals: RunTotals | null;
  notes: string | null;
  finalizedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  paid: { count: number; amount: number };
}

export interface Run extends RunSummary {
  lines: RunLine[];
}

export interface DueRow {
  month: string;
  kind: DueKind;
  due: number;
  paid: number;
  balance: number;
  payments: { id: string; date: string; amount: number; method: PayMethod; reference: string | null }[];
}

export interface MeResponse {
  employee: {
    id: string;
    code: string;
    name: string;
    designation: string | null;
    joinDate: string;
    payType: PayType;
    payMethod: PayMethod;
    accountMasked: string | null;
    shiftStart: string;
    shiftEnd: string;
  } | null;
  selfCheckIn: boolean;
  today?: { date: string; mark: AttendanceMark | null };
  balances?: BalanceCell[];
  requests?: LeaveRequest[];
}

export interface MyPayslip {
  id: string;
  month: string;
  gross: number;
  net: number;
  totalDeductions: number;
  paidDays: number;
}
