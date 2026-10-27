import { describe, expect, it } from "vitest";
import {
  carryForward,
  checkoutResult,
  computePayLine,
  countDays,
  DEFAULT_PAYROLL_CONFIG,
  EMPTY_STRUCTURE,
  halfYearOf,
  lateMinutesAt,
  leaveBalance,
  leaveDaysIn,
  leaveYearOf,
  leaveYearRange,
  monthlyPaidDays,
  monthRange,
  ptForIncome,
  runTotals,
  shiftMinutes,
  TN_PT_SLABS,
  type ComputeInput,
  type DayMark,
  type PayrollConfig,
  type SalaryStructure,
} from "./logic";
import { configPatch, employeeInput, mergeConfig } from "./inputs";

// October 2026: 31 days, Sundays 4, 11, 18, 25 → 27 working days with Sunday off.
const OCT = monthRange("2026-10");
const mark = (date: string, status: DayMark["status"], extra: Partial<DayMark> = {}): [string, DayMark] => [
  date,
  { date, status, leavePaid: null, workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0, ...extra },
];
const days = (marks: [string, DayMark][] = [], o: Partial<Parameters<typeof countDays>[0]> = {}) =>
  countDays({ ...OCT, joinDate: "2020-01-01", leaveDate: null, weekOffs: [0], holidays: new Set(), marks: new Map(marks), unmarkedAs: "present", ...o });
const cfg = (o: Partial<PayrollConfig> = {}): PayrollConfig => ({ ...DEFAULT_PAYROLL_CONFIG, ...o });
const monthly = (o: Partial<SalaryStructure> = {}): SalaryStructure => ({ ...EMPTY_STRUCTURE, payType: "monthly", basic: 1_500_000, ...o });
const pay = (o: Partial<ComputeInput> = {}) =>
  computePayLine({ structure: monthly(), days: days(), config: cfg(), month: "2026-10", halfYearGrossBefore: 0, halfYearPtBefore: 0, advances: [], ...o });

describe("days of the month", () => {
  it("counts working days, weekly offs and holidays", () => {
    const c = days([], { holidays: new Set(["2026-10-02"]) });
    expect(c).toMatchObject({ periodDays: 31, weekOffs: 4, holidays: 1, workingDays: 26, periodWorkingDays: 26, present: 26, unmarked: 26, lopDays: 0 });
  });

  it("turns absences, unpaid leave and half days into loss-of-pay days", () => {
    const c = days([
      mark("2026-10-05", "absent"),
      mark("2026-10-06", "leave", { leavePaid: false }),
      mark("2026-10-07", "leave", { leavePaid: true }),
      mark("2026-10-08", "half_day"),
      mark("2026-10-09", "half_day", { leavePaid: true }),
    ]);
    expect(c.absent).toBe(1.5);
    expect(c.unpaidLeave).toBe(1);
    expect(c.paidLeave).toBe(1.5);
    expect(c.halfDays).toBe(2);
    expect(c.lopDays).toBe(2.5);
  });

  it("counts unmarked days as absent when the shop says so, and work on a Sunday as an extra day", () => {
    const c = days([mark("2026-10-01", "present"), mark("2026-10-04", "present")], { unmarkedAs: "absent" });
    expect(c.present).toBe(1);
    expect(c.offDaysWorked).toBe(1);
    expect(c.absent).toBe(26);
    expect(c.unmarked).toBe(26);
  });

  it("leave on a Sunday costs nothing and a comp-off on a working day is paid", () => {
    const c = days([mark("2026-10-11", "leave", { leavePaid: false }), mark("2026-10-12", "week_off")]);
    expect(c.unpaidLeave).toBe(0);
    expect(c.compOffs).toBe(1);
    expect(c.lopDays).toBe(0);
  });

  it("leaves out days before joining and after leaving", () => {
    const c = days([], { joinDate: "2026-10-16", leaveDate: "2026-10-28" });
    expect(c.employedDays).toBe(13);
    expect(c.notEmployedDays).toBe(18);
    expect(c.workingDays).toBe(11);
    expect(c.periodWorkingDays).toBe(27);
  });
});

describe("paid days for monthly salaries", () => {
  const c = days([mark("2026-10-05", "absent"), mark("2026-10-06", "absent")]);
  it("working-day basis: paid days = working days − LOP", () => {
    expect(monthlyPaidDays(c, { monthlyBasis: "working", fixedDays: 26 })).toEqual({ basisDays: 27, paidDays: 25 });
  });
  it("calendar and fixed 26-day bases", () => {
    expect(monthlyPaidDays(c, { monthlyBasis: "calendar", fixedDays: 26 })).toEqual({ basisDays: 31, paidDays: 29 });
    expect(monthlyPaidDays(c, { monthlyBasis: "fixed", fixedDays: 26 })).toEqual({ basisDays: 26, paidDays: 24 });
  });
  it("never pays more than the basis or less than zero", () => {
    expect(monthlyPaidDays(c, { monthlyBasis: "working", fixedDays: 26 }, -10).paidDays).toBe(27);
    expect(monthlyPaidDays(c, { monthlyBasis: "working", fixedDays: 26 }, 40).paidDays).toBe(0);
  });
});

describe("pay line", () => {
  it("full month: the whole structure, nothing deducted", () => {
    const l = pay({ structure: monthly({ basic: 1_200_000, hra: 300_000, allowances: [{ name: "Travel", amount: 100_000 }] }) });
    expect(l.gross).toBe(1_600_000);
    expect(l.net).toBe(1_600_000);
    expect(l.paidDays).toBe(27);
    expect(l.earnings.map((e) => e.key)).toEqual(["basic", "hra", "allowance:0"]);
  });

  it("prorates every component by paid days and rounds net to the rupee", () => {
    // 2 LOP of 27: 15,000 × 25/27 = 13,888.89
    const l = pay({ days: days([mark("2026-10-05", "absent"), mark("2026-10-06", "absent")]) });
    expect(l.earnings[0]!.amount).toBe(1_388_889);
    expect(l.netBeforeRounding).toBe(1_388_889);
    expect(l.net).toBe(1_388_900);
    expect(l.roundOff).toBe(11);
    expect(l.gross - l.totalDeductions + l.roundOff).toBe(l.net);
  });

  it("can keep paise when rounding is off", () => {
    const l = pay({ days: days([mark("2026-10-05", "absent")]), config: cfg({ roundNet: false }) });
    expect(l.roundOff).toBe(0);
    expect(l.net).toBe(l.netBeforeRounding);
  });

  it("daily wage: rate × days worked; Sunday work counts; holidays only when the shop pays them", () => {
    const d = days([mark("2026-10-04", "present"), mark("2026-10-05", "absent"), mark("2026-10-06", "half_day")], { holidays: new Set(["2026-10-02"]) });
    const s: SalaryStructure = { ...EMPTY_STRUCTURE, payType: "daily", dailyRate: 60_000 };
    // working days 26 − absent 1 − half 1 = 24 present + 1 Sunday + 0.5 = 25.5
    expect(pay({ structure: s, days: d }).gross).toBe(1_530_000);
    expect(pay({ structure: s, days: d, config: cfg({ paidHolidaysForDaily: true }) }).gross).toBe(1_590_000);
  });

  it("hourly: minutes worked plus paid leave at shift hours", () => {
    const d = days([mark("2026-10-01", "present", { workedMinutes: 480 }), mark("2026-10-02", "leave", { leavePaid: true })], { unmarkedAs: "absent" });
    const s: SalaryStructure = { ...EMPTY_STRUCTURE, payType: "hourly", hourlyRate: 10_000 };
    // 8 h worked + 1 day leave × 11 h shift = 19 h × ₹100
    expect(pay({ structure: s, days: d }).gross).toBe(190_000);
  });

  it("pays overtime at twice basic + DA per hour by default, or the person's own rate", () => {
    const d = days([mark("2026-10-01", "present", { overtimeMinutes: 90 })]);
    const l = pay({ structure: monthly({ basic: 2_970_000 }), days: d });
    // 29,700 / 27 days / 11 h = 100 an hour → ×2 = 200; 1.5 h = 300
    expect(l.otRatePerHour).toBe(20_000);
    expect(l.heads.overtime).toBe(30_000);
    expect(pay({ structure: monthly({ otRatePerHour: 15_000 }), days: d }).heads.overtime).toBe(22_500);
    expect(pay({ structure: monthly(), days: d, adjustments: { overtimeMinutes: 0 } }).heads.overtime).toBe(0);
  });

  it("adds the owner's extra earnings and LOP days", () => {
    const l = pay({ adjustments: { earnings: [{ label: "Diwali bonus", amount: 200_000 }], extraLopDays: 1 } });
    expect(l.paidDays).toBe(26);
    expect(l.earnings.find((e) => e.key === "extra:0")?.amount).toBe(200_000);
  });
});

describe("PF and ESI", () => {
  const on = cfg({ pf: { ...DEFAULT_PAYROLL_CONFIG.pf, enabled: true }, esi: { ...DEFAULT_PAYROLL_CONFIG.esi, enabled: true } });

  it("PF 12% + 12% on basic + DA, capped at the ₹15,000 wage ceiling", () => {
    const l = pay({ structure: monthly({ basic: 1_800_000, da: 200_000, pf: true }), config: on });
    expect(l.pfWage).toBe(1_500_000);
    expect(l.heads.pfEmployee).toBe(180_000);
    expect(l.heads.pfEmployer).toBe(180_000);
    const uncapped = pay({ structure: monthly({ basic: 1_800_000, da: 200_000, pf: true }), config: { ...on, pf: { ...on.pf, capAtCeiling: false } } });
    expect(uncapped.heads.pfEmployee).toBe(240_000);
  });

  it("PF leaves HRA and allowances out and is rounded to the rupee", () => {
    const l = pay({ structure: monthly({ basic: 1_234_567, hra: 500_000, pf: true }), config: on });
    expect(l.pfWage).toBe(1_234_567);
    expect(l.heads.pfEmployee).toBe(148_100); // 1,48,148.04 paise → ₹1,481
  });

  it("ESI 0.75% / 3.25% of gross when the wage is ₹21,000 or less, rounded up to the rupee", () => {
    const l = pay({ structure: monthly({ basic: 1_234_500, esi: true }), config: on });
    expect(l.heads.esiEmployee).toBe(9_300); // 92.59 → 93
    expect(l.heads.esiEmployer).toBe(40_200); // 401.21 → 402
    const atCeiling = pay({ structure: monthly({ basic: 2_100_000, esi: true }), config: on });
    expect(atCeiling.heads.esiEmployee).toBe(15_800);
    const over = pay({ structure: monthly({ basic: 2_100_100, esi: true }), config: on });
    expect(over.heads.esiEmployee).toBe(0);
    expect(over.warnings).toContain("esi_over_ceiling");
  });

  it("ESI eligibility is the salary rate, so loss-of-pay does not bring a ₹22,000 salary under the ceiling", () => {
    const l = pay({ structure: monthly({ basic: 2_200_000, esi: true }), config: on, days: days([mark("2026-10-05", "absent"), mark("2026-10-06", "absent")]) });
    expect(l.gross).toBeLessThan(2_100_000);
    expect(l.heads.esiEmployee).toBe(0);
  });

  it("nothing is deducted when the shop or the person has it switched off", () => {
    expect(pay({ structure: monthly({ pf: true, esi: true }) }).totalDeductions).toBe(0);
    expect(pay({ structure: monthly(), config: on }).totalDeductions).toBe(0);
  });
});

describe("professional tax (Tamil Nadu slabs)", () => {
  it("looks a half-year's income up in the slab table", () => {
    expect(ptForIncome(2_100_000, TN_PT_SLABS)).toBe(0);
    expect(ptForIncome(2_100_100, TN_PT_SLABS)).toBe(18_000);
    expect(ptForIncome(4_500_000, TN_PT_SLABS)).toBe(42_500);
    expect(ptForIncome(7_500_100, TN_PT_SLABS)).toBe(125_000);
    expect(ptForIncome(50_000_000, [{ upTo: 1_000, tax: 0 }, { upTo: null, tax: 99 }])).toBe(99);
  });

  const pt = (o: Partial<PayrollConfig["pt"]> = {}) => cfg({ pt: { ...DEFAULT_PAYROLL_CONFIG.pt, enabled: true, ...o } });

  it("half-yearly: deducted in September on April–September income, nothing in other months", () => {
    const s = monthly({ basic: 1_500_000, pt: true });
    expect(pay({ structure: s, config: pt(), month: "2026-08" }).heads.pt).toBe(0);
    // five earlier months of 15,000 + this one = 90,000 → ₹1,250
    const sept = pay({ structure: s, config: pt(), month: "2026-09", days: countDays({ ...monthRange("2026-09"), joinDate: null, leaveDate: null, weekOffs: [0], holidays: new Set(), marks: new Map(), unmarkedAs: "present" }), halfYearGrossBefore: 7_500_000 });
    expect(sept.heads.pt).toBe(125_000);
    expect(pay({ structure: s, config: pt(), month: "2026-09", halfYearGrossBefore: 7_500_000, halfYearPtBefore: 125_000 }).heads.pt).toBe(0);
  });

  it("monthly mode deducts a sixth of the half-year tax every month", () => {
    expect(pay({ structure: monthly({ basic: 1_500_000, pt: true }), config: pt({ mode: "monthly" }) }).heads.pt).toBe(20_800); // 1,250 / 6 = 208.33
  });

  it("a slab table edited by the owner is used as is", () => {
    const l = pay({ structure: monthly({ basic: 1_500_000, pt: true }), config: pt({ deductMonths: [10], slabs: [{ upTo: null, tax: 50_000 }] }) });
    expect(l.heads.pt).toBe(50_000);
  });

  it("half-years run April to September and October to March", () => {
    expect(halfYearOf("2026-05")).toEqual({ from: "2026-04", to: "2026-09" });
    expect(halfYearOf("2026-11")).toEqual({ from: "2026-10", to: "2027-03" });
    expect(halfYearOf("2027-02")).toEqual({ from: "2026-10", to: "2027-03" });
  });
});

describe("advances, TDS and other deductions", () => {
  const adv = (outstanding: number, instalment: number, id = "a1") => ({ id, outstanding, instalment, label: "Advance recovery" });

  it("recovers the instalment, or what is left when that is less", () => {
    expect(pay({ advances: [adv(500_000, 200_000)] }).heads.advance).toBe(200_000);
    expect(pay({ advances: [adv(50_000, 200_000)] }).heads.advance).toBe(50_000);
  });

  it("takes the owner's recovery for the month instead, never more than outstanding", () => {
    expect(pay({ advances: [adv(500_000, 200_000)], adjustments: { advanceRecovery: { a1: 0 } } }).heads.advance).toBe(0);
    expect(pay({ advances: [adv(500_000, 200_000)], adjustments: { advanceRecovery: { a1: 900_000 } } }).heads.advance).toBe(500_000);
  });

  it("never takes net pay below zero: recoveries are cut back and flagged", () => {
    const s = monthly({ basic: 300_000 });
    const l = pay({ structure: s, advances: [adv(1_000_000, 500_000)], adjustments: { deductions: [{ label: "Canteen", amount: 10_000 }] } });
    expect(l.heads.advance).toBe(300_000);
    expect(l.heads.other).toBe(0);
    expect(l.net).toBe(0);
    expect(l.warnings).toContain("recovery_reduced");
  });

  it("TDS as typed, and other deductions", () => {
    const l = pay({ adjustments: { tds: 50_000, deductions: [{ label: "Uniform", amount: 25_000 }] } });
    expect(l.heads.tds).toBe(50_000);
    expect(l.heads.other).toBe(25_000);
    expect(l.net).toBe(1_500_000 - 75_000);
  });

  it("run totals add up and the cost to the shop includes employer PF and ESI", () => {
    const on = cfg({ pf: { ...DEFAULT_PAYROLL_CONFIG.pf, enabled: true }, esi: { ...DEFAULT_PAYROLL_CONFIG.esi, enabled: true } });
    const a = pay({ structure: monthly({ basic: 1_500_000, pf: true, esi: true }), config: on });
    const b = pay({ structure: monthly({ basic: 1_000_000, pf: true }), config: on, advances: [adv(100_000, 100_000)] });
    const t = runTotals([a, b]);
    expect(t.gross).toBe(2_500_000);
    expect(t.net).toBe(a.net + b.net);
    expect(t.employerCost).toBe(t.gross + t.pfEmployer + t.esiEmployer);
    expect(t.gross - t.deductions + t.roundOff).toBe(t.net);
  });
});

describe("check-in and check-out", () => {
  const rules = { shiftStart: "09:30", shiftEnd: "20:30", graceMinutes: 10, halfDayBelowMinutes: 240, otAfterMinutes: 30 };
  const ist = (d: string, hm: string) => new Date(`${d}T${hm}:00+05:30`);

  it("late only after the grace period", () => {
    expect(lateMinutesAt(ist("2026-10-01", "09:39"), rules)).toBe(0);
    expect(lateMinutesAt(ist("2026-10-01", "09:42"), rules)).toBe(12);
  });

  it("overtime past the shift, half day under the threshold", () => {
    expect(checkoutResult(ist("2026-10-01", "09:30"), ist("2026-10-01", "21:15"), rules)).toEqual({ workedMinutes: 705, overtimeMinutes: 45, halfDay: false });
    expect(checkoutResult(ist("2026-10-01", "09:30"), ist("2026-10-01", "20:50"), rules).overtimeMinutes).toBe(0);
    expect(checkoutResult(ist("2026-10-01", "09:30"), ist("2026-10-01", "12:30"), rules).halfDay).toBe(true);
  });

  it("night shifts run past midnight", () => {
    expect(shiftMinutes("22:00", "06:00")).toBe(480);
  });
});

describe("leave", () => {
  it("counts working days of a request; a half day is 0.5", () => {
    expect(leaveDaysIn("2026-10-02", "2026-10-06", [0], new Set(["2026-10-05"]), false)).toEqual({ days: 3, dates: ["2026-10-02", "2026-10-03", "2026-10-06"] });
    expect(leaveDaysIn("2026-10-07", "2026-10-07", [0], new Set(), true).days).toBe(0.5);
    expect(leaveDaysIn("2026-10-04", "2026-10-04", [0], new Set(), false).days).toBe(0);
  });

  it("balances, unlimited unpaid leave and carry forward", () => {
    expect(leaveBalance({ paid: true, yearlyDays: 12 }, 3, -1, 4.5)).toBe(9.5);
    expect(leaveBalance({ paid: false, yearlyDays: 0 }, 0, 0, 10)).toBeNull();
    expect(carryForward({ carryForward: true, maxCarryDays: 24 }, 30)).toBe(24);
    expect(carryForward({ carryForward: false, maxCarryDays: 24 }, 30)).toBe(0);
  });

  it("leave years can start in April", () => {
    expect(leaveYearOf("2027-02-10", 4)).toBe(2026);
    expect(leaveYearRange(2026, 4)).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(leaveYearRange(2026, 1)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("inputs", () => {
  it("merges a settings patch over the defaults, nested parts too", () => {
    const c = mergeConfig({ graceMinutes: 5 }, configPatch.parse({ pf: { enabled: true } }));
    expect(c.graceMinutes).toBe(5);
    expect(c.pf).toEqual({ ...DEFAULT_PAYROLL_CONFIG.pf, enabled: true });
    expect(c.pt.slabs.length).toBe(TN_PT_SLABS.length);
  });

  it("refuses a slab table with two open slabs", () => {
    expect(() => configPatch.parse({ pt: { slabs: [{ upTo: null, tax: 1 }, { upTo: null, tax: 2 }] } })).toThrow();
  });

  it("checks bank details for bank transfer and the IFSC / PAN shapes", () => {
    expect(() => employeeInput.parse({ name: "Meena", joinDate: "2026-01-01", payMethod: "bank" })).toThrow();
    const e = employeeInput.parse({ name: "Meena", joinDate: "2026-01-01", payMethod: "bank", accountNumber: "1234567890", ifsc: "sbin0001234", pan: "abcde1234f" });
    expect(e.ifsc).toBe("SBIN0001234");
    expect(e.pan).toBe("ABCDE1234F");
    expect(e.salary.payType).toBe("monthly");
  });
});
