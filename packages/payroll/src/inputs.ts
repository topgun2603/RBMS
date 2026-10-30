import { isValidDate } from "@rbms/gst";
import { z } from "zod";
import { ATTENDANCE_STATUSES, DEFAULT_PAYROLL_CONFIG, DUE_KINDS, isMonth, MONTHLY_BASES, parseHm, PAY_METHODS, PAY_TYPES, PT_MODES, type PayrollConfig } from "./logic";

/** Money columns are Postgres `integer` (paise). */
export const MAX_PAISE = 2_000_000_000;

const date = z.string().refine(isValidDate, "Use a YYYY-MM-DD date");
const month = z.string().refine(isMonth, "Use a YYYY-MM month");
const hm = z.string().refine((v) => parseHm(v) !== null, "Use a time like 09:30");
const paise = z.number().int().min(0).max(MAX_PAISE);
const bp = z.number().int().min(0).max(10_000);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const weekOffs = z.array(z.number().int().min(0).max(6)).max(7).transform((v) => [...new Set(v)].sort());
const halfDays = z.number().min(0).max(366).refine((v) => Number.isInteger(v * 2), "Use whole or half days");

// ------------------------------------------------------------------ settings

const ptSlab = z.object({ upTo: paise.nullable(), tax: paise });

/** Settings patch (every key optional; nested statutory parts merge over the current ones). */
export const configPatch = z
  .object({
    weekOffs,
    shiftStart: hm,
    shiftEnd: hm,
    graceMinutes: z.number().int().min(0).max(240),
    halfDayBelowMinutes: z.number().int().min(0).max(1440),
    otAfterMinutes: z.number().int().min(0).max(600),
    otMultiplier: z.number().min(0).max(5),
    unmarkedAs: z.enum(["present", "absent"]),
    monthlyBasis: z.enum(MONTHLY_BASES),
    fixedDays: z.number().int().min(20).max(31),
    paidHolidaysForDaily: z.boolean(),
    paidWeekOffsForDaily: z.boolean(),
    offDayWorkPaid: z.boolean(),
    roundNet: z.boolean(),
    selfCheckIn: z.boolean(),
    leaveYearStartMonth: z.number().int().min(1).max(12),
    pf: z.object({ enabled: z.boolean(), employeeRateBp: bp, employerRateBp: bp, wageCeiling: paise, capAtCeiling: z.boolean() }).partial(),
    esi: z.object({ enabled: z.boolean(), employeeRateBp: bp, employerRateBp: bp, grossCeiling: paise }).partial(),
    pt: z
      .object({
        enabled: z.boolean(),
        mode: z.enum(PT_MODES),
        deductMonths: z.array(z.number().int().min(1).max(12)).max(12).transform((v) => [...new Set(v)].sort((a, b) => a - b)),
        slabs: z
          .array(ptSlab)
          .min(1)
          .max(20)
          .superRefine((slabs, ctx) => {
            const open = slabs.filter((s) => s.upTo === null).length;
            if (open > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only the last slab can be open-ended" });
            const limits = slabs.map((s) => s.upTo).filter((u): u is number => u !== null);
            if (new Set(limits).size !== limits.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Two slabs have the same upper limit" });
          }),
      })
      .partial(),
  })
  .partial()
  .strict();
export type ConfigPatch = z.input<typeof configPatch>;

/** Stored settings merged over the defaults (nested statutory parts too). */
export function mergeConfig(stored: Partial<PayrollConfig> | null | undefined, patch?: z.output<typeof configPatch>): PayrollConfig {
  const base = { ...DEFAULT_PAYROLL_CONFIG, ...(stored ?? {}) } as PayrollConfig;
  const merged: PayrollConfig = {
    ...base,
    ...(patch ?? {}),
    pf: { ...DEFAULT_PAYROLL_CONFIG.pf, ...(stored?.pf ?? {}), ...(patch?.pf ?? {}) },
    esi: { ...DEFAULT_PAYROLL_CONFIG.esi, ...(stored?.esi ?? {}), ...(patch?.esi ?? {}) },
    pt: { ...DEFAULT_PAYROLL_CONFIG.pt, ...(stored?.pt ?? {}), ...(patch?.pt ?? {}) },
  } as PayrollConfig;
  return merged;
}

// ------------------------------------------------------------------ employees

const allowance = z.object({ name: z.string().trim().min(1).max(60), amount: paise });

export const salaryInput = z
  .object({
    payType: z.enum(PAY_TYPES).default("monthly"),
    basic: paise.default(0),
    da: paise.default(0),
    hra: paise.default(0),
    allowances: z.array(allowance).max(12).default([]),
    dailyRate: paise.default(0),
    hourlyRate: paise.default(0),
    otRatePerHour: paise.nullish().transform((v) => v ?? null),
    pf: z.boolean().default(false),
    esi: z.boolean().default(false),
    pt: z.boolean().default(false),
  })
  .strict();

const phone = z
  .string()
  .trim()
  .max(20)
  .nullish()
  .transform((v) => (v ? v.replace(/[\s-]/g, "") : null))
  .refine((v) => v === null || /^\+?\d{6,15}$/.test(v), "Enter a phone number");

export const employeeInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone,
    userId: z.string().uuid().nullish().transform((v) => v ?? null),
    branchId: z.string().uuid().nullish().transform((v) => v ?? null),
    designation: optText(80),
    joinDate: date,
    leaveDate: date.nullish().transform((v) => v ?? null),
    salary: salaryInput.default({}),
    shiftStart: hm.nullish().transform((v) => v ?? null),
    shiftEnd: hm.nullish().transform((v) => v ?? null),
    weekOffs: weekOffs.nullish().transform((v) => v ?? null),
    payMethod: z.enum(PAY_METHODS).default("cash"),
    bankName: optText(80),
    accountNumber: optText(20).refine((v) => v === null || /^\d{6,20}$/.test(v), "Account number is 6 to 20 digits"),
    ifsc: optText(11)
      .transform((v) => (v ? v.toUpperCase() : null))
      .refine((v) => v === null || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "Enter an IFSC like SBIN0001234"),
    upiId: optText(100).refine((v) => v === null || /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(v), "Enter a UPI ID like name@bank"),
    uan: optText(12).refine((v) => v === null || /^\d{12}$/.test(v), "UAN is 12 digits"),
    esiNumber: optText(17).refine((v) => v === null || /^\d{10,17}$/.test(v), "ESI number is 10 to 17 digits"),
    pan: optText(10)
      .transform((v) => (v ? v.toUpperCase() : null))
      .refine((v) => v === null || /^[A-Z]{5}\d{4}[A-Z]$/.test(v), "Enter a PAN like ABCDE1234F"),
    notes: optText(1000),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.leaveDate && e.leaveDate < e.joinDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["leaveDate"], message: "The last day can't be before the joining date" });
    if (e.payMethod === "bank" && (!e.accountNumber || !e.ifsc)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accountNumber"], message: "Bank transfer needs the account number and IFSC" });
    if (e.payMethod === "upi" && !e.upiId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["upiId"], message: "UPI needs a UPI ID" });
    if ((e.shiftStart === null) !== (e.shiftEnd === null)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["shiftEnd"], message: "Give both shift times, or neither" });
  });
export type EmployeeInput = z.input<typeof employeeInput>;

export const employeeListQuery = z.object({
  status: z.enum(["active", "left", "all"]).default("active"),
  branchId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
});

// ------------------------------------------------------------------ holidays

export const holidayInput = z.object({ date, name: z.string().trim().min(1).max(80), branchId: z.string().uuid().nullish().transform((v) => v ?? null) }).strict();
export const yearQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });

// ------------------------------------------------------------------ attendance

export const markInput = z
  .object({
    employeeId: z.string().uuid(),
    date,
    status: z.enum(ATTENDANCE_STATUSES),
    leaveTypeId: z.string().uuid().nullish().transform((v) => v ?? null),
    /** "HH:MM" IST on the day (a check-out before the check-in is the next morning). */
    checkIn: hm.nullish().transform((v) => v ?? null),
    checkOut: hm.nullish().transform((v) => v ?? null),
    /** Override the minutes worked out from the times. */
    lateMinutes: z.number().int().min(0).max(1440).nullish(),
    overtimeMinutes: z.number().int().min(0).max(1440).nullish(),
    note: optText(300),
    /** Why a day already marked is changed (required then). */
    reason: optText(300),
  })
  .strict();
export type MarkInput = z.input<typeof markInput>;

export const bulkMarkInput = z
  .object({
    date,
    items: z.array(z.object({ employeeId: z.string().uuid(), status: z.enum(ATTENDANCE_STATUSES), leaveTypeId: z.string().uuid().nullish() })).min(1).max(500),
    /** Change days already marked too (needs `reason`); otherwise only unmarked people are marked. */
    overwrite: z.boolean().default(false),
    reason: optText(300),
  })
  .strict();

export const clearMarkInput = z.object({ employeeId: z.string().uuid(), date, reason: z.string().trim().min(2).max(300) }).strict();
export const pinInput = z.object({ pin: z.string().trim().regex(/^\d{4,8}$/, "Enter your PIN") }).strict();
export const dayQuery = z.object({ date: date.optional(), branchId: z.string().uuid().optional() });
export const monthQuery = z.object({ month: month.optional(), branchId: z.string().uuid().optional(), format: z.enum(["json", "csv"]).default("json") });
export const logQuery = z.object({ employeeId: z.string().uuid().optional(), from: date.optional(), to: date.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });

// ------------------------------------------------------------------ leave

export const leaveTypeInput = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,5}$/, "1 to 6 letters or digits"),
    name: z.string().trim().min(1).max(60),
    paid: z.boolean().default(true),
    yearlyDays: halfDays.default(0),
    carryForward: z.boolean().default(false),
    maxCarryDays: halfDays.default(0),
    active: z.boolean().default(true),
    sort: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
export const leaveTypePatch = leaveTypeInput.partial().strict();

export const leaveRequestInput = z
  .object({
    /** Required when a manager files it for someone; staff filing their own leave it out. */
    employeeId: z.string().uuid().optional(),
    leaveTypeId: z.string().uuid(),
    from: date,
    to: date,
    halfDay: z.boolean().default(false),
    reason: optText(500),
    /** Managers may approve while filing. */
    approve: z.boolean().default(false),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.to < r.from) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "'to' must be on or after 'from'" });
    if (r.halfDay && r.to !== r.from) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["halfDay"], message: "A half day is one date" });
    if (Date.parse(r.to) - Date.parse(r.from) > 90 * 86_400_000) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "At most 90 days at a time" });
  });
export type LeaveRequestInput = z.input<typeof leaveRequestInput>;

export const decisionInput = z.object({ note: optText(300) }).strict();
export const leaveListQuery = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled", "all"]).default("pending"),
  employeeId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const balanceQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), employeeId: z.string().uuid().optional() });
export const balanceInput = z
  .object({
    employeeId: z.string().uuid(),
    leaveTypeId: z.string().uuid(),
    year: z.number().int().min(2000).max(2100),
    opening: z.number().min(-366).max(366).refine((v) => Number.isInteger(v * 2), "Use whole or half days").optional(),
    adjustment: z.number().min(-366).max(366).refine((v) => Number.isInteger(v * 2), "Use whole or half days").optional(),
    note: optText(300),
  })
  .strict();
export const carryInput = z.object({ year: z.number().int().min(2000).max(2100) }).strict();

// ------------------------------------------------------------------ advances

export const advanceInput = z
  .object({
    employeeId: z.string().uuid(),
    date: date.optional(),
    amount: paise.refine((v) => v > 0, "Enter the amount"),
    instalment: paise.refine((v) => v > 0, "Enter the monthly recovery"),
    startMonth: month.optional(),
    method: z.enum(PAY_METHODS).default("cash"),
    reference: optText(100),
    reason: optText(300),
  })
  .strict()
  .refine((a) => a.instalment <= a.amount, { path: ["instalment"], message: "The monthly recovery can't be more than the advance" });
export const advancePatch = z.object({ instalment: paise.refine((v) => v > 0).optional(), reason: optText(300) }).strict();

// ------------------------------------------------------------------ payroll runs

export const runInput = z.object({ month, notes: optText(500) }).strict();
export const runListQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional(), status: z.enum(["draft", "finalized", "cancelled", "all"]).default("all") });
const lineMoney = z.object({ label: z.string().trim().min(1).max(60), amount: paise });
export const lineAdjustInput = z
  .object({
    overtimeMinutes: z.number().int().min(0).max(100_000).nullish(),
    extraLopDays: z.number().min(-31).max(31).refine((v) => Number.isInteger(v * 2), "Use whole or half days").nullish(),
    earnings: z.array(lineMoney).max(10).optional(),
    deductions: z.array(lineMoney).max(10).optional(),
    tds: paise.nullish(),
    advanceRecovery: z.record(z.string().uuid(), paise).optional(),
  })
  .strict();
export const cancelInput = z.object({ reason: z.string().trim().min(2).max(300) }).strict();
export const payInput = z
  .object({
    /** Lines to mark paid; left out = every unpaid line of the run. */
    lineIds: z.array(z.string().uuid()).max(500).optional(),
    date: date.optional(),
    /** Overrides each person's own way of being paid. */
    method: z.enum(PAY_METHODS).optional(),
    reference: optText(100),
  })
  .strict();

// ------------------------------------------------------------------ statutory dues

export const dueInput = z
  .object({ kind: z.enum(DUE_KINDS), month, date: date.optional(), amount: paise.refine((v) => v > 0, "Enter the amount"), method: z.enum(PAY_METHODS).default("bank"), reference: optText(100) })
  .strict();
export const duesQuery = z.object({ from: month.optional(), to: month.optional() });

export const meQuery = z.object({ month: month.optional() });
export const pdfQuery = z.object({ lang: z.enum(["en", "ta"]).optional() });
