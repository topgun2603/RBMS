import { isBalanced, payrollRunPostings, type PayrollRunSrc } from "@rbms/accounting";
import { computePayLine, countDays, DEFAULT_PAYROLL_CONFIG, EMPTY_STRUCTURE, monthRange, runTotals, type DayMark, type PayrollConfig, type SalaryStructure } from "@rbms/payroll";
import { describe, expect, it } from "vitest";

/** Small deterministic generator, so a failure can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("payroll → books", () => {
  it("every final payroll posts a balanced journal, whatever the salaries, days, statutory switches and deductions", () => {
    const rand = rng(44);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
    const { from, to } = monthRange("2026-09");
    for (let run = 0; run < 60; run++) {
      const config: PayrollConfig = {
        ...DEFAULT_PAYROLL_CONFIG,
        monthlyBasis: pick(["calendar", "working", "fixed"] as const),
        roundNet: rand() < 0.7,
        pf: { ...DEFAULT_PAYROLL_CONFIG.pf, enabled: rand() < 0.6, capAtCeiling: rand() < 0.8 },
        esi: { ...DEFAULT_PAYROLL_CONFIG.esi, enabled: rand() < 0.6 },
        pt: { ...DEFAULT_PAYROLL_CONFIG.pt, enabled: rand() < 0.6, mode: pick(["half-yearly", "monthly"] as const) },
      };
      const lines = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => {
        const payType = pick(["monthly", "daily", "hourly"] as const);
        const structure: SalaryStructure = {
          ...EMPTY_STRUCTURE,
          payType,
          basic: Math.round(rand() * 3_000_000),
          da: Math.round(rand() * 200_000),
          hra: Math.round(rand() * 600_000),
          allowances: rand() < 0.4 ? [{ name: "Travel", amount: Math.round(rand() * 150_000) }] : [],
          dailyRate: Math.round(rand() * 120_000),
          hourlyRate: Math.round(rand() * 20_000),
          pf: rand() < 0.7,
          esi: rand() < 0.7,
          pt: rand() < 0.7,
        };
        const marks = new Map<string, DayMark>();
        for (let d = 1; d <= 30; d++) {
          if (rand() < 0.15) {
            const date = `2026-09-${String(d).padStart(2, "0")}`;
            marks.set(date, { date, status: pick(["present", "absent", "half_day", "leave"] as const), leavePaid: pick([true, false, null]), workedMinutes: Math.round(rand() * 700), lateMinutes: 0, overtimeMinutes: Math.round(rand() * 120) });
          }
        }
        const days = countDays({ from, to, joinDate: rand() < 0.2 ? "2026-09-12" : null, leaveDate: null, weekOffs: [0], holidays: new Set(), marks, unmarkedAs: "present" });
        return computePayLine({
          structure,
          days,
          config,
          month: "2026-09",
          halfYearGrossBefore: Math.round(rand() * 10_000_000),
          halfYearPtBefore: 0,
          advances: rand() < 0.4 ? [{ id: "a", outstanding: Math.round(rand() * 1_000_000), instalment: Math.round(rand() * 300_000) + 1, label: "Advance" }] : [],
          adjustments: { tds: rand() < 0.2 ? Math.round(rand() * 100_000) : 0, deductions: rand() < 0.3 ? [{ label: "Canteen", amount: Math.round(rand() * 50_000) }] : [] },
        });
      });
      // Final payrolls never have a negative net (finalizing refuses), so leave such random cases out.
      const ok = lines.filter((l) => l.net >= 0);
      if (ok.length === 0) continue;
      const t = runTotals(ok);
      // The same mapping as PayrollService.bookSources.
      const src: PayrollRunSrc = {
        id: `r${run}`,
        month: "2026-09",
        date: to,
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
      const posted = payrollRunPostings(src);
      if (t.gross === 0 && t.net === 0) continue;
      expect(posted).toHaveLength(1);
      expect(isBalanced(posted[0]!.lines), JSON.stringify(src)).toBe(true);
    }
  });
});
