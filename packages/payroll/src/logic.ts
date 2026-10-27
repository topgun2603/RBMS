/**
 * Payroll and attendance rules: pure functions, no database, no clock. Money is integer paise; dates are IST
 * "YYYY-MM-DD"; months "YYYY-MM"; rates in basis points (1200 = 12%). Every statutory default here is a starting point
 * the owner must confirm with their auditor (docs/payroll.md "Statutory defaults").
 */

export const PAY_TYPES = ["monthly", "daily", "hourly"] as const;
export type PayType = (typeof PAY_TYPES)[number];

export const ATTENDANCE_STATUSES = ["present", "absent", "half_day", "leave", "week_off", "holiday"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const PAY_METHODS = ["cash", "bank", "upi"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export const MONTHLY_BASES = ["calendar", "working", "fixed"] as const;
export type MonthlyBasis = (typeof MONTHLY_BASES)[number];

export const PT_MODES = ["half-yearly", "monthly"] as const;
export type PtMode = (typeof PT_MODES)[number];

export const DUE_KINDS = ["pf", "esi", "pt", "tds"] as const;
export type DueKind = (typeof DUE_KINDS)[number];

/** Half-yearly income slab of professional tax: income up to `upTo` paise (null = no upper limit) pays `tax` paise. */
export interface PtSlab {
  upTo: number | null;
  tax: number;
}

export interface PayrollConfig {
  /** Weekly days off, 0 = Sunday. */
  weekOffs: number[];
  /** Shop shift, "HH:MM" IST (an end before the start runs past midnight). */
  shiftStart: string;
  shiftEnd: string;
  /** Minutes after the shift start before a check-in counts as late. */
  graceMinutes: number;
  /** A day worked for fewer minutes becomes a half day at check-out (0 = never). */
  halfDayBelowMinutes: number;
  /** Extra minutes beyond the shift that count as overtime only from this many on. */
  otAfterMinutes: number;
  /** Overtime pays this multiple of the ordinary hourly rate (basic + DA). */
  otMultiplier: number;
  /** A working day with no mark counts as this (most small shops mark only absences). */
  unmarkedAs: "present" | "absent";
  /** How a monthly salary is divided into days: days in the month, working days, or a fixed number (26 / 30). */
  monthlyBasis: MonthlyBasis;
  fixedDays: number;
  /** Daily-wage and hourly staff are paid for holidays / weekly offs too. */
  paidHolidaysForDaily: boolean;
  paidWeekOffsForDaily: boolean;
  /** Work on a weekly off or holiday is paid as an extra day. */
  offDayWorkPaid: boolean;
  /** Round each net pay to the rupee. */
  roundNet: boolean;
  /** Staff may check themselves in and out from their own login. */
  selfCheckIn: boolean;
  /** First month of the leave year (1 = January). */
  leaveYearStartMonth: number;
  pf: { enabled: boolean; employeeRateBp: number; employerRateBp: number; wageCeiling: number; capAtCeiling: boolean };
  esi: { enabled: boolean; employeeRateBp: number; employerRateBp: number; grossCeiling: number };
  pt: { enabled: boolean; mode: PtMode; deductMonths: number[]; slabs: PtSlab[] };
}

/**
 * Tamil Nadu professional tax, half-yearly income slabs as revised for local bodies from 2024-25. Rates differ by
 * corporation / municipality and change by government order: CHECK WITH YOUR AUDITOR before switching PT on.
 */
export const TN_PT_SLABS: readonly PtSlab[] = [
  { upTo: 2_100_000, tax: 0 },
  { upTo: 3_000_000, tax: 18_000 },
  { upTo: 4_500_000, tax: 42_500 },
  { upTo: 6_000_000, tax: 93_000 },
  { upTo: 7_500_000, tax: 102_500 },
  { upTo: null, tax: 125_000 },
];

/** Defaults. Statutory parts are OFF and marked "check with your auditor" in the UI. */
export const DEFAULT_PAYROLL_CONFIG: PayrollConfig = {
  weekOffs: [0],
  shiftStart: "09:30",
  shiftEnd: "20:30",
  graceMinutes: 10,
  halfDayBelowMinutes: 240,
  otAfterMinutes: 30,
  otMultiplier: 2,
  unmarkedAs: "present",
  monthlyBasis: "working",
  fixedDays: 26,
  paidHolidaysForDaily: false,
  paidWeekOffsForDaily: false,
  offDayWorkPaid: true,
  roundNet: true,
  selfCheckIn: true,
  leaveYearStartMonth: 1,
  pf: { enabled: false, employeeRateBp: 1200, employerRateBp: 1200, wageCeiling: 1_500_000, capAtCeiling: true },
  esi: { enabled: false, employeeRateBp: 75, employerRateBp: 325, grossCeiling: 2_100_000 },
  pt: { enabled: false, mode: "half-yearly", deductMonths: [9, 3], slabs: [...TN_PT_SLABS] },
};

/** Leave types seeded for a new shop (yearly days). Owners edit them; CHECK the numbers against your standing orders. */
export const DEFAULT_LEAVE_TYPES = [
  { code: "CL", name: "Casual leave", paid: true, yearlyDays: 12, carryForward: false, maxCarryDays: 0 },
  { code: "SL", name: "Sick leave", paid: true, yearlyDays: 12, carryForward: false, maxCarryDays: 0 },
  { code: "EL", name: "Earned leave", paid: true, yearlyDays: 12, carryForward: true, maxCarryDays: 24 },
  { code: "LOP", name: "Leave without pay", paid: false, yearlyDays: 0, carryForward: false, maxCarryDays: 0 },
] as const;

/** Holidays every shop in Tamil Nadu closes on (fixed dates). Festival holidays move each year; add them by hand. */
export const FIXED_HOLIDAYS = [
  { md: "01-26", name: "Republic Day" },
  { md: "04-14", name: "Tamil New Year" },
  { md: "05-01", name: "May Day" },
  { md: "08-15", name: "Independence Day" },
  { md: "10-02", name: "Gandhi Jayanti" },
] as const;

// ------------------------------------------------------------------ dates

const DAY_MS = 86_400_000;
const IST_OFFSET_MIN = 330;

export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** First and last day of a month. */
export function monthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, "0")}` };
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Sunday. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Half-year of a month for professional tax: April to September, or October to March. */
export function halfYearOf(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  if (m >= 4 && m <= 9) return { from: `${y}-04`, to: `${y}-09` };
  const start = m >= 10 ? y : y - 1;
  return { from: `${start}-10`, to: `${start + 1}-03` };
}

/** The leave year a date falls in, named by the calendar year it starts in. */
export function leaveYearOf(date: string, startMonth: number): number {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return m >= startMonth ? y : y - 1;
}

export function leaveYearRange(year: number, startMonth: number): { from: string; to: string } {
  const start = `${year}-${String(startMonth).padStart(2, "0")}`;
  return { from: `${start}-01`, to: addDays(`${addMonths(start, 12)}-01`, -1) };
}

/** "HH:MM" → minutes after midnight, or null. */
export function parseHm(hm: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Shift length in minutes (an end before the start runs past midnight). */
export function shiftMinutes(start: string, end: string): number {
  const s = parseHm(start) ?? 0;
  const e = parseHm(end) ?? 0;
  const len = e - s;
  return len > 0 ? len : len + 1440;
}

/** IST date and minute of the day of an instant. */
export function istParts(at: Date): { date: string; minute: number } {
  const t = new Date(at.getTime() + IST_OFFSET_MIN * 60_000);
  return { date: t.toISOString().slice(0, 10), minute: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

// ------------------------------------------------------------------ check-in / check-out

export interface ShiftRules {
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  halfDayBelowMinutes: number;
  otAfterMinutes: number;
}

/** Minutes late at a check-in (0 inside the grace period). */
export function lateMinutesAt(checkIn: Date, rules: Pick<ShiftRules, "shiftStart" | "graceMinutes">): number {
  const start = parseHm(rules.shiftStart);
  if (start === null) return 0;
  const late = istParts(checkIn).minute - start;
  return late > rules.graceMinutes ? late : 0;
}

/** What a check-out makes of the day: minutes worked, overtime and whether it is only a half day. */
export function checkoutResult(checkIn: Date, checkOut: Date, rules: ShiftRules): { workedMinutes: number; overtimeMinutes: number; halfDay: boolean } {
  const worked = Math.max(0, Math.floor((checkOut.getTime() - checkIn.getTime()) / 60_000));
  const extra = worked - shiftMinutes(rules.shiftStart, rules.shiftEnd);
  const overtime = extra >= Math.max(1, rules.otAfterMinutes) ? extra : 0;
  const halfDay = rules.halfDayBelowMinutes > 0 && worked < rules.halfDayBelowMinutes;
  return { workedMinutes: worked, overtimeMinutes: overtime, halfDay };
}

// ------------------------------------------------------------------ days of a pay period

export interface DayMark {
  date: string;
  status: AttendanceStatus;
  /** For `leave` and `half_day`: the leave type is paid (true), unpaid (false), or no leave (null). */
  leavePaid: boolean | null;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
}

export interface DayCounts {
  periodDays: number;
  /** Days inside the employment (joined on or before, not yet left). */
  employedDays: number;
  notEmployedDays: number;
  /** Calendar weekly offs and holidays inside the employment. */
  weekOffs: number;
  holidays: number;
  /** Working days of the whole period by the calendar (the "working" basis divides by this). */
  periodWorkingDays: number;
  /** Calendar working days inside the employment. */
  workingDays: number;
  present: number;
  halfDays: number;
  paidLeave: number;
  unpaidLeave: number;
  /** Absent days (half of each half day without leave counts 0.5). */
  absent: number;
  /** Working days with no mark (counted as `unmarkedAs`). */
  unmarked: number;
  /** Working days marked as a weekly off or holiday by hand (a comp-off): paid like a day off. */
  compOffs: number;
  /** Days worked on a weekly off or holiday. */
  offDaysWorked: number;
  /** Loss-of-pay days: absent + unpaid leave. */
  lopDays: number;
  lateDays: number;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
}

export interface CountInput {
  from: string;
  to: string;
  joinDate: string | null;
  leaveDate: string | null;
  weekOffs: readonly number[];
  holidays: ReadonlySet<string>;
  marks: ReadonlyMap<string, DayMark>;
  unmarkedAs: "present" | "absent";
}

/** Counts the days of a pay period from the calendar (weekly offs, holidays), the marks and the employment dates. */
export function countDays(i: CountInput): DayCounts {
  const c: DayCounts = {
    periodDays: 0,
    employedDays: 0,
    notEmployedDays: 0,
    weekOffs: 0,
    holidays: 0,
    periodWorkingDays: 0,
    workingDays: 0,
    present: 0,
    halfDays: 0,
    paidLeave: 0,
    unpaidLeave: 0,
    absent: 0,
    unmarked: 0,
    compOffs: 0,
    offDaysWorked: 0,
    lopDays: 0,
    lateDays: 0,
    workedMinutes: 0,
    lateMinutes: 0,
    overtimeMinutes: 0,
  };
  const offs = new Set(i.weekOffs);
  for (const date of datesBetween(i.from, i.to)) {
    c.periodDays++;
    const off: "holiday" | "week_off" | null = i.holidays.has(date) ? "holiday" : offs.has(weekdayOf(date)) ? "week_off" : null;
    if (!off) c.periodWorkingDays++;
    if ((i.joinDate && date < i.joinDate) || (i.leaveDate && date > i.leaveDate)) {
      c.notEmployedDays++;
      continue;
    }
    c.employedDays++;
    if (off === "holiday") c.holidays++;
    else if (off === "week_off") c.weekOffs++;
    else c.workingDays++;
    const m = i.marks.get(date);
    if (m) {
      c.workedMinutes += m.workedMinutes;
      c.lateMinutes += m.lateMinutes;
      c.overtimeMinutes += m.overtimeMinutes;
      if (m.lateMinutes > 0) c.lateDays++;
    }
    if (!m) {
      if (off) continue;
      c.unmarked++;
      if (i.unmarkedAs === "present") c.present++;
      else c.absent++;
      continue;
    }
    switch (m.status) {
      case "present":
        if (off) c.offDaysWorked++;
        else c.present++;
        break;
      case "half_day":
        if (off) {
          c.offDaysWorked += 0.5;
          break;
        }
        c.halfDays++;
        if (m.leavePaid === true) c.paidLeave += 0.5;
        else if (m.leavePaid === false) c.unpaidLeave += 0.5;
        else c.absent += 0.5;
        break;
      case "leave":
        // Leave on a day the shop is closed anyway costs nothing.
        if (off) break;
        if (m.leavePaid === false) c.unpaidLeave++;
        else c.paidLeave++;
        break;
      case "absent":
        if (!off) c.absent++;
        break;
      case "week_off":
      case "holiday":
        if (!off) c.compOffs++;
        break;
    }
  }
  c.lopDays = c.absent + c.unpaidLeave;
  return c;
}

// ------------------------------------------------------------------ salary

export interface Allowance {
  name: string;
  /** Monthly amount, paise. */
  amount: number;
}

export interface SalaryStructure {
  payType: PayType;
  /** Monthly amounts (monthly pay type). */
  basic: number;
  da: number;
  hra: number;
  allowances: Allowance[];
  /** Daily wage (daily pay type). */
  dailyRate: number;
  /** Hourly rate (hourly pay type). */
  hourlyRate: number;
  /** Overtime paise an hour; null = worked out from the ordinary rate × the shop's multiplier. */
  otRatePerHour: number | null;
  pf: boolean;
  esi: boolean;
  pt: boolean;
}

export const EMPTY_STRUCTURE: SalaryStructure = {
  payType: "monthly",
  basic: 0,
  da: 0,
  hra: 0,
  allowances: [],
  dailyRate: 0,
  hourlyRate: 0,
  otRatePerHour: null,
  pf: false,
  esi: false,
  pt: false,
};

/** One-off lines and corrections the owner types on a payroll line. */
export interface LineAdjustments {
  /** Overtime minutes to pay instead of the counted ones. */
  overtimeMinutes?: number | null;
  /** Loss-of-pay days on top of the counted ones (negative gives days back). */
  extraLopDays?: number | null;
  /** Bonus, incentive, arrears ... (added to gross). */
  earnings?: { label: string; amount: number }[];
  /** Fine, canteen, uniform ... (deducted; booked as other income). */
  deductions?: { label: string; amount: number }[];
  /** TDS on salary for the month, worked out by the owner or auditor (no Form 24Q here). */
  tds?: number | null;
  /** Advance recovery this month per advance id, instead of the instalment. */
  advanceRecovery?: Record<string, number>;
}

export interface OpenAdvance {
  id: string;
  /** Still to recover, paise. */
  outstanding: number;
  instalment: number;
  label: string;
}

export interface Money {
  key: string;
  label: string;
  amount: number;
  /** Advance recovered (deductions). */
  advanceId?: string;
}

export const LINE_WARNINGS = ["net_negative", "recovery_reduced", "unmarked_days", "no_salary", "esi_over_ceiling"] as const;
export type LineWarning = (typeof LINE_WARNINGS)[number];

export interface PayLine {
  basisDays: number;
  paidDays: number;
  days: DayCounts;
  earnings: Money[];
  deductions: Money[];
  /** Employer PF and ESI (on top of gross; not taken from the employee). */
  employer: Money[];
  gross: number;
  totalDeductions: number;
  /** Before rounding. */
  netBeforeRounding: number;
  roundOff: number;
  net: number;
  /** Totals by head, for the books and the dues screen. */
  heads: { pfEmployee: number; pfEmployer: number; esiEmployee: number; esiEmployer: number; pt: number; tds: number; advance: number; other: number; overtime: number };
  pfWage: number;
  esiGross: number;
  otRatePerHour: number;
  warnings: LineWarning[];
}

export interface ComputeInput {
  structure: SalaryStructure;
  days: DayCounts;
  config: PayrollConfig;
  /** The month being paid, "YYYY-MM" (professional tax months). */
  month: string;
  /** Gross of earlier finalized months of the same half-year (half-yearly professional tax). */
  halfYearGrossBefore: number;
  /** PT already deducted earlier in the half-year (half-yearly mode deducts the balance). */
  halfYearPtBefore: number;
  advances: readonly OpenAdvance[];
  adjustments?: LineAdjustments;
}

const roundRupee = (paise: number) => Math.round(paise / 100) * 100;
const ceilRupee = (paise: number) => Math.ceil(paise / 100 - 1e-9) * 100;
const pctOf = (amount: number, bp: number) => (amount * bp) / 10_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Professional tax for a half-year's income from the slab table (slabs sorted by `upTo`, open slab last). */
export function ptForIncome(income: number, slabs: readonly PtSlab[]): number {
  const sorted = [...slabs].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  for (const s of sorted) if (s.upTo === null || income <= s.upTo) return s.tax;
  return sorted.length ? sorted[sorted.length - 1]!.tax : 0;
}

/** The days a monthly salary is divided by, and the days paid. */
export function monthlyPaidDays(days: DayCounts, config: Pick<PayrollConfig, "monthlyBasis" | "fixedDays">, extraLop = 0): { basisDays: number; paidDays: number } {
  const lop = Math.max(0, days.lopDays + extraLop);
  let basisDays: number;
  let paid: number;
  if (config.monthlyBasis === "calendar") {
    basisDays = days.periodDays;
    paid = days.employedDays - lop;
  } else if (config.monthlyBasis === "working") {
    basisDays = days.periodWorkingDays;
    paid = days.workingDays - lop;
  } else {
    basisDays = config.fixedDays;
    paid = (config.fixedDays * days.employedDays) / Math.max(1, days.periodDays) - lop;
  }
  return { basisDays, paidDays: r2(Math.min(basisDays, Math.max(0, paid))) };
}

/** Days a daily-wage (or hourly, for paid leave) person is paid for. */
export function dailyPaidDays(days: DayCounts, config: Pick<PayrollConfig, "paidHolidaysForDaily" | "paidWeekOffsForDaily">, extraLop = 0): number {
  const paid =
    days.present +
    days.offDaysWorked +
    days.halfDays * 0.5 +
    days.paidLeave +
    (config.paidHolidaysForDaily ? days.holidays : 0) +
    (config.paidWeekOffsForDaily ? days.weekOffs + days.compOffs : 0) -
    Math.max(0, extraLop);
  return r2(Math.max(0, paid));
}

/**
 * One person's pay for a period: earnings from the structure and the days, overtime, PF / ESI / PT when switched on (for
 * the shop and the person), TDS as typed, advance recovery, other deductions, rounding to the rupee.
 */
export function computePayLine(i: ComputeInput): PayLine {
  const { structure: s, days, config } = i;
  const adj = i.adjustments ?? {};
  const extraLop = adj.extraLopDays ?? 0;
  const shiftHours = shiftMinutes(config.shiftStart, config.shiftEnd) / 60;
  const earnings: Money[] = [];
  const warnings: LineWarning[] = [];
  let basisDays = 0;
  let paidDays = 0;
  let pfWage = 0;
  let ordinaryHourly = 0;
  let esiRateGross = 0;

  if (s.payType === "monthly") {
    ({ basisDays, paidDays } = monthlyPaidDays(days, config, extraLop));
    const part = (amount: number) => (basisDays > 0 ? Math.round((amount * paidDays) / basisDays) : 0);
    const basic = part(s.basic);
    const da = part(s.da);
    earnings.push({ key: "basic", label: "Basic", amount: basic });
    if (s.da) earnings.push({ key: "da", label: "Dearness allowance", amount: da });
    if (s.hra) earnings.push({ key: "hra", label: "House rent allowance", amount: part(s.hra) });
    s.allowances.forEach((a, n) => a.amount && earnings.push({ key: `allowance:${n}`, label: a.name, amount: part(a.amount) }));
    pfWage = basic + da;
    const monthly = s.basic + s.da + s.hra + s.allowances.reduce((t, a) => t + a.amount, 0);
    ordinaryHourly = basisDays > 0 && shiftHours > 0 ? (s.basic + s.da) / basisDays / shiftHours : 0;
    esiRateGross = monthly;
    if (config.offDayWorkPaid && days.offDaysWorked > 0 && basisDays > 0) {
      earnings.push({ key: "extra_days", label: "Work on days off", amount: Math.round((monthly * days.offDaysWorked) / basisDays) });
    }
    if (monthly === 0) warnings.push("no_salary");
  } else if (s.payType === "daily") {
    paidDays = dailyPaidDays(days, config, extraLop);
    basisDays = days.periodDays;
    const wages = Math.round(s.dailyRate * paidDays);
    earnings.push({ key: "wages", label: "Wages", amount: wages });
    pfWage = wages;
    ordinaryHourly = shiftHours > 0 ? s.dailyRate / shiftHours : 0;
    esiRateGross = s.dailyRate * 26;
    if (s.dailyRate === 0) warnings.push("no_salary");
  } else {
    // Hourly: minutes worked, plus paid leave (and holidays when the shop pays them) at a shift's hours.
    const leaveDays = days.paidLeave + (config.paidHolidaysForDaily ? days.holidays : 0) - Math.max(0, extraLop);
    paidDays = r2(Math.max(0, days.present + days.offDaysWorked + days.halfDays * 0.5 + leaveDays));
    basisDays = days.periodDays;
    const minutes = days.workedMinutes + Math.max(0, leaveDays) * shiftHours * 60;
    const wages = Math.round((s.hourlyRate * minutes) / 60);
    earnings.push({ key: "wages", label: "Wages", amount: wages });
    pfWage = wages;
    ordinaryHourly = s.hourlyRate;
    esiRateGross = wages;
    if (s.hourlyRate === 0) warnings.push("no_salary");
  }
  if (days.unmarked > 0 && config.unmarkedAs === "absent") warnings.push("unmarked_days");

  // Overtime. Hourly staff are already paid each minute worked, so only the premium above the ordinary rate.
  const otMinutes = Math.max(0, adj.overtimeMinutes ?? days.overtimeMinutes);
  const multiplier = s.payType === "hourly" ? Math.max(0, config.otMultiplier - 1) : config.otMultiplier;
  const otRate = s.otRatePerHour ?? Math.round(ordinaryHourly * multiplier);
  const overtime = Math.round((otMinutes * otRate) / 60);
  if (overtime > 0) earnings.push({ key: "overtime", label: "Overtime", amount: overtime });
  for (const [n, e] of (adj.earnings ?? []).entries()) if (e.amount) earnings.push({ key: `extra:${n}`, label: e.label, amount: e.amount });
  const gross = earnings.reduce((t, e) => t + e.amount, 0);

  const deductions: Money[] = [];
  const employer: Money[] = [];
  const heads = { pfEmployee: 0, pfEmployer: 0, esiEmployee: 0, esiEmployer: 0, pt: 0, tds: 0, advance: 0, other: 0, overtime };

  // PF on basic + DA (wages for daily / hourly), capped at the wage ceiling when the shop chooses.
  let pfBase = 0;
  if (config.pf.enabled && s.pf && pfWage > 0) {
    pfBase = config.pf.capAtCeiling ? Math.min(pfWage, config.pf.wageCeiling) : pfWage;
    heads.pfEmployee = roundRupee(pctOf(pfBase, config.pf.employeeRateBp));
    heads.pfEmployer = roundRupee(pctOf(pfBase, config.pf.employerRateBp));
    deductions.push({ key: "pf", label: "Provident fund", amount: heads.pfEmployee });
    employer.push({ key: "pf", label: "Provident fund (employer)", amount: heads.pfEmployer });
  }

  // ESI when the wage rate is within the ceiling; contributions on gross, rounded up to the rupee.
  let esiGross = 0;
  if (config.esi.enabled && s.esi && gross > 0) {
    if (esiRateGross <= config.esi.grossCeiling) {
      esiGross = gross;
      heads.esiEmployee = ceilRupee(pctOf(gross, config.esi.employeeRateBp));
      heads.esiEmployer = ceilRupee(pctOf(gross, config.esi.employerRateBp));
      deductions.push({ key: "esi", label: "ESI", amount: heads.esiEmployee });
      employer.push({ key: "esi", label: "ESI (employer)", amount: heads.esiEmployer });
    } else warnings.push("esi_over_ceiling");
  }

  // Professional tax: in the half-year's deduction month on the half-year's income, or a sixth of it every month.
  if (config.pt.enabled && s.pt && gross > 0) {
    const m = Number(i.month.slice(5, 7));
    if (config.pt.mode === "monthly") heads.pt = roundRupee(ptForIncome(gross * 6, config.pt.slabs) / 6);
    else if (config.pt.deductMonths.includes(m)) heads.pt = Math.max(0, ptForIncome(i.halfYearGrossBefore + gross, config.pt.slabs) - i.halfYearPtBefore);
    if (heads.pt > 0) deductions.push({ key: "pt", label: "Professional tax", amount: heads.pt });
  }

  heads.tds = Math.max(0, adj.tds ?? 0);
  if (heads.tds > 0) deductions.push({ key: "tds", label: "TDS on salary", amount: heads.tds });

  // Advances and other deductions never take net pay below zero: they are cut back first.
  let room = gross - deductions.reduce((t, d) => t + d.amount, 0);
  for (const a of i.advances) {
    const wanted = Math.min(Math.max(0, adj.advanceRecovery?.[a.id] ?? Math.min(a.instalment, a.outstanding)), a.outstanding);
    const take = Math.min(wanted, Math.max(0, room));
    if (take < wanted) warnings.push("recovery_reduced");
    if (take <= 0) continue;
    deductions.push({ key: `advance:${a.id}`, label: a.label, amount: take, advanceId: a.id });
    heads.advance += take;
    room -= take;
  }
  for (const [n, d] of (adj.deductions ?? []).entries()) {
    const take = Math.min(Math.max(0, d.amount), Math.max(0, room));
    if (take < d.amount) warnings.push("recovery_reduced");
    if (take <= 0) continue;
    deductions.push({ key: `other:${n}`, label: d.label, amount: take });
    heads.other += take;
    room -= take;
  }

  const totalDeductions = deductions.reduce((t, d) => t + d.amount, 0);
  const netBeforeRounding = gross - totalDeductions;
  const net = config.roundNet ? roundRupee(netBeforeRounding) : netBeforeRounding;
  if (net < 0) warnings.push("net_negative");
  return {
    basisDays,
    paidDays,
    days,
    earnings,
    deductions,
    employer,
    gross,
    totalDeductions,
    netBeforeRounding,
    roundOff: net - netBeforeRounding,
    net,
    heads,
    pfWage: pfBase,
    esiGross,
    otRatePerHour: otRate,
    warnings: [...new Set(warnings)],
  };
}

/** Run totals over lines. */
export function runTotals(lines: readonly Pick<PayLine, "gross" | "net" | "totalDeductions" | "roundOff" | "heads">[]) {
  const t = { staff: lines.length, gross: 0, deductions: 0, net: 0, roundOff: 0, pfEmployee: 0, pfEmployer: 0, esiEmployee: 0, esiEmployer: 0, pt: 0, tds: 0, advance: 0, other: 0, overtime: 0, employerCost: 0 };
  for (const l of lines) {
    t.gross += l.gross;
    t.deductions += l.totalDeductions;
    t.net += l.net;
    t.roundOff += l.roundOff;
    t.pfEmployee += l.heads.pfEmployee;
    t.pfEmployer += l.heads.pfEmployer;
    t.esiEmployee += l.heads.esiEmployee;
    t.esiEmployer += l.heads.esiEmployer;
    t.pt += l.heads.pt;
    t.tds += l.heads.tds;
    t.advance += l.heads.advance;
    t.other += l.heads.other;
    t.overtime += l.heads.overtime;
  }
  t.employerCost = t.gross + t.pfEmployer + t.esiEmployer;
  return t;
}
export type RunTotals = ReturnType<typeof runTotals>;

// ------------------------------------------------------------------ leave

/** Leave days a request takes: working days in the range (weekly offs and holidays are free), or 0.5 for a half day. */
export function leaveDaysIn(from: string, to: string, weekOffs: readonly number[], holidays: ReadonlySet<string>, halfDay: boolean): { days: number; dates: string[] } {
  const offs = new Set(weekOffs);
  const dates = datesBetween(from, to).filter((d) => !holidays.has(d) && !offs.has(weekdayOf(d)));
  if (halfDay) return { days: dates.length ? 0.5 : 0, dates: dates.slice(0, 1) };
  return { days: dates.length, dates };
}

/** Days left of a leave type in a year. Unpaid leave (yearly 0, not paid) has no limit (null). */
export function leaveBalance(t: { paid: boolean; yearlyDays: number }, opening: number, adjustment: number, used: number): number | null {
  if (!t.paid && t.yearlyDays === 0) return null;
  return r2(t.yearlyDays + opening + adjustment - used);
}

/** Carry forward into the next year: the unused days, capped. */
export function carryForward(t: { carryForward: boolean; maxCarryDays: number }, balance: number | null): number {
  if (!t.carryForward || balance === null) return 0;
  return Math.max(0, Math.min(balance, t.maxCarryDays));
}

// ------------------------------------------------------------------ advances

/** Instalments a new advance will take, for the dialog ("about 5 months"). */
export function instalmentsFor(amount: number, instalment: number): number {
  return instalment > 0 ? Math.ceil(amount / instalment) : 0;
}

/** Masks a bank account number for lists: "XXXX1234". */
export function maskAccount(acc: string | null | undefined): string | null {
  if (!acc) return null;
  return acc.length <= 4 ? acc : `XXXX${acc.slice(-4)}`;
}
