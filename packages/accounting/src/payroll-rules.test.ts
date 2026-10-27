import { describe, expect, it } from "vitest";
import { STANDARD_CHART, SYS } from "./chart";
import type { PayrollRunSrc, PayrollSrc } from "./ports";
import { isBalanced, payrollPostings, payrollRunPostings, postingHash, SOURCE_LABELS, SOURCE_TYPES, totalOf } from "./rules";

const run = (o: Partial<PayrollRunSrc> = {}): PayrollRunSrc => ({
  id: "r1",
  month: "2026-10",
  date: "2026-10-31",
  // Two staff: gross 25,000; PF 1,800 + 1,800 and 1,200 + 1,200; ESI 113 + 488 (rounded up); PT 0; advance 1,000;
  // canteen 150; net 25,000 − 1,800 − 1,200 − 113 − 1,000 − 150 = 20,737 → rounded up by 0.37 on one line.
  gross: 2_500_000,
  employerPf: 300_000,
  employerEsi: 48_800,
  net: 2_073_737,
  pf: 600_000,
  esi: 60_100,
  pt: 0,
  tds: 0,
  advance: 100_000,
  other: 15_000,
  roundOff: 37,
  ...o,
});
const key = (k: string) => ({ key: k });
const line = (lines: { account: unknown; debit: number; credit: number }[], k: string) => lines.find((l) => JSON.stringify(l.account) === JSON.stringify(key(k)));

describe("payroll postings", () => {
  it("a final payroll balances: expense and employer share against salaries payable, dues, advances and other income", () => {
    const [p] = payrollRunPostings(run());
    expect(p!.sourceType).toBe("payroll_run");
    expect(p!.date).toBe("2026-10-31");
    expect(isBalanced(p!.lines)).toBe(true);
    expect(line(p!.lines, SYS.salaries)?.debit).toBe(2_500_000);
    expect(line(p!.lines, SYS.staffStatutory)?.debit).toBe(348_800);
    expect(line(p!.lines, SYS.salariesPayable)?.credit).toBe(2_073_737);
    expect(line(p!.lines, SYS.pfPayable)?.credit).toBe(600_000);
    expect(line(p!.lines, SYS.esiPayable)?.credit).toBe(60_100);
    expect(line(p!.lines, SYS.staffAdvances)?.credit).toBe(100_000);
    expect(line(p!.lines, SYS.otherIncome)?.credit).toBe(15_000);
    expect(line(p!.lines, SYS.roundOff)?.debit).toBe(37);
    expect(line(p!.lines, SYS.ptPayable)).toBeUndefined();
  });

  it("rounding down credits Round off, and the payroll still balances", () => {
    const [p] = payrollRunPostings(run({ net: 2_073_637, roundOff: -63 }));
    expect(isBalanced(p!.lines)).toBe(true);
    expect(line(p!.lines, SYS.roundOff)?.credit).toBe(63);
  });

  it("salary payments, advances and statutory deposits come out of the money account of their method", () => {
    const src: PayrollSrc = {
      runs: [run()],
      payments: [{ id: "p1", date: "2026-11-01", amount: 1_200_000, method: "cash", employeeName: "Meena", month: "2026-10" }],
      advances: [{ id: "a1", date: "2026-10-05", amount: 500_000, method: "upi", employeeName: "Ravi" }],
      dues: [
        { id: "d1", kind: "pf", month: "2026-10", date: "2026-11-14", amount: 600_000, method: "bank", reference: "TRRN1" },
        { id: "d2", kind: "tds", month: "2026-10", date: "2026-11-07", amount: 10_000, method: "bank", reference: null },
      ],
    };
    const ps = payrollPostings(src);
    expect(ps.map((p) => p.sourceType)).toEqual(["payroll_run", "salary_payment", "staff_advance", "payroll_due", "payroll_due"]);
    for (const p of ps) expect(isBalanced(p.lines)).toBe(true);
    expect(ps[1]!.lines).toEqual([
      { account: key(SYS.salariesPayable), debit: 1_200_000, credit: 0, party: undefined },
      { account: { method: "cash" }, debit: 0, credit: 1_200_000, party: undefined },
    ]);
    expect(ps[2]!.lines[0]!.account).toEqual(key(SYS.staffAdvances));
    expect(ps[2]!.lines[1]!.account).toEqual({ method: "upi" });
    expect(ps[3]!.lines[0]!.account).toEqual(key(SYS.pfPayable));
    expect(ps[4]!.lines[0]!.account).toEqual(key(SYS.salaryTdsPayable));
  });

  it("paying everyone and depositing the dues clears salaries payable and the dues accounts", () => {
    const r = run();
    const ps = payrollPostings({
      runs: [r],
      payments: [{ id: "p1", date: "2026-11-01", amount: r.net, method: "bank", employeeName: "All", month: r.month }],
      advances: [],
      dues: [
        { id: "d1", kind: "pf", month: r.month, date: "2026-11-14", amount: r.pf, method: "bank", reference: null },
        { id: "d2", kind: "esi", month: r.month, date: "2026-11-14", amount: r.esi, method: "bank", reference: null },
      ],
    });
    const net = (k: string) => ps.flatMap((p) => p.lines).filter((l) => JSON.stringify(l.account) === JSON.stringify(key(k))).reduce((t, l) => t + l.debit - l.credit, 0);
    expect(net(SYS.salariesPayable)).toBe(0);
    expect(net(SYS.pfPayable)).toBe(0);
    expect(net(SYS.esiPayable)).toBe(0);
    const all = totalOf(ps.flatMap((p) => p.lines));
    expect(all.debit).toBe(all.credit);
  });

  it("is idempotent: the same payroll hashes the same, a changed one does not", () => {
    const [a] = payrollRunPostings(run());
    const [b] = payrollRunPostings(run());
    const [c] = payrollRunPostings(run({ gross: 2_500_100, net: 2_073_837 }));
    expect(postingHash(a!)).toBe(postingHash(b!));
    expect(postingHash(a!)).not.toBe(postingHash(c!));
  });

  it("an empty payroll posts nothing; the source types, labels and accounts exist", () => {
    expect(payrollRunPostings(run({ gross: 0, employerPf: 0, employerEsi: 0, net: 0, pf: 0, esi: 0, advance: 0, other: 0, roundOff: 0 }))).toEqual([]);
    for (const t of ["payroll_run", "salary_payment", "staff_advance", "payroll_due"] as const) {
      expect(SOURCE_TYPES).toContain(t);
      expect(SOURCE_LABELS[t]).toBeTruthy();
    }
    for (const k of [SYS.salaries, SYS.staffStatutory, SYS.salariesPayable, SYS.pfPayable, SYS.esiPayable, SYS.ptPayable, SYS.salaryTdsPayable, SYS.staffAdvances]) {
      expect(STANDARD_CHART.some((c) => c.key === k)).toBe(true);
    }
    expect(STANDARD_CHART.find((c) => c.key === SYS.salariesPayable)?.code).toBe("2200");
  });
});
