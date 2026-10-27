import { describe, expect, it } from "vitest";
import { closingLines, depreciationBetween, disposalResult, slmYearly, yearSchedule } from "./assets-logic";
import { buildReconciliation, refTokens, statementBalanceOn, subsetsSumming, suggestMatches, words } from "./bank-match";
import {
  computeTds,
  deducteeTypeOfPan,
  depositDueDate,
  financialYearOf,
  isValidPan,
  lateInterest,
  mergedSections,
  panFromGstin,
  parseQuarter,
  quarterDueDates,
  quarterOf,
  SECTION_BY_KEY,
  taxOf,
} from "./tds-rules";

const bank = (id: string, date: string, amount: number, narration = "", reference: string | null = null) => ({ id, date, amount, narration, reference });
const book = (id: string, date: string, amount: number, narration = "", extra: { reference?: string | null; chequeNo?: string | null } = {}) => ({ id, date, amount, narration, reference: extra.reference ?? null, chequeNo: extra.chequeNo ?? null });

describe("matching statement lines to the books", () => {
  it("one to one: same amount and day, unique, is a high-confidence match", () => {
    const s = suggestMatches([bank("b1", "2026-10-01", 118_000, "UPI/CR/627412345678/RAVI KUMAR")], [book("k1", "2026-10-01", 118_000, "Payment (upi) for INV-12 - Ravi Kumar"), book("k2", "2026-10-01", 50_000)]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "one_to_one", bankIds: ["b1"], bookIds: ["k1"] });
    expect(s[0]!.confidence).toBeGreaterThanOrEqual(90);
  });

  it("a cheque number that agrees allows a later clearing date (up to 45 days)", () => {
    const s = suggestMatches([bank("b1", "2026-10-25", -2_000_000, "CLG/KUMAR TRADERS", "456789")], [book("k1", "2026-10-02", -2_000_000, "Paid to Kumar Traders (cheque)", { chequeNo: "456789" })]);
    expect(s[0]!.reasons).toContain("Cheque 456789 agrees");
    expect(suggestMatches([bank("b1", "2026-10-25", -2_000_000)], [book("k1", "2026-10-02", -2_000_000)])).toEqual([]);
  });

  it("the closer date wins when two book lines have the same amount; ambiguity lowers confidence", () => {
    const s = suggestMatches(
      [bank("b1", "2026-10-05", 50_000), bank("b2", "2026-10-09", 50_000)],
      [book("k1", "2026-10-04", 50_000), book("k2", "2026-10-09", 50_000)],
    );
    const pairs = Object.fromEntries(s.map((x) => [x.bankIds[0], x.bookIds[0]]));
    expect(pairs).toEqual({ b1: "k1", b2: "k2" });
    for (const x of s) expect(x.confidence).toBeLessThan(90);
  });

  it("never matches across directions or different amounts", () => {
    expect(suggestMatches([bank("b1", "2026-10-01", 100)], [book("k1", "2026-10-01", -100), book("k2", "2026-10-01", 101)])).toEqual([]);
  });

  it("many book lines to one statement line (a UPI settlement of several bills)", () => {
    const s = suggestMatches([bank("b1", "2026-10-03", 75_000, "UPI SETTLEMENT")], [book("k1", "2026-10-02", 20_000), book("k2", "2026-10-02", 30_000), book("k3", "2026-10-03", 25_000), book("k4", "2026-09-01", 75_000 - 1)]);
    expect(s[0]).toMatchObject({ kind: "many_book", bankIds: ["b1"] });
    expect([...s[0]!.bookIds].sort()).toEqual(["k1", "k2", "k3"]);
  });

  it("one book line to several statement lines (a payment the bank split)", () => {
    const s = suggestMatches([bank("b1", "2026-10-03", -40_000), bank("b2", "2026-10-03", -60_000)], [book("k1", "2026-10-02", -100_000)]);
    expect(s[0]).toMatchObject({ kind: "many_bank", bookIds: ["k1"] });
    expect([...s[0]!.bankIds].sort()).toEqual(["b1", "b2"]);
  });

  it("subset sums are exact and bounded", () => {
    expect(subsetsSumming([{ amount: 5 }, { amount: 7 }, { amount: 3 }], 10, 3).map((x) => x.map((y) => y.amount).sort())).toEqual([[3, 7]]);
    expect(subsetsSumming([{ amount: 5 }, { amount: -5 }], 10, 3)).toEqual([]);
    expect(subsetsSumming(Array.from({ length: 30 }, () => ({ amount: 1 })), 1000, 5)).toEqual([]);
  });

  it("words and reference tokens ignore bank jargon and padding", () => {
    expect([...words("UPI/CR/RAVI KUMAR/NEFT")]).toEqual(["ravi", "kumar"]);
    expect([...refTokens("CHQ 000456789", null)]).toEqual(["456789"]);
  });
});

describe("bank reconciliation statement", () => {
  it("book balance + uncleared payments - uncleared receipts + bank-only lines = bank balance", () => {
    // Books: opening 50,000 + receipt 25,000 (deposited 30/9, cleared 3/10) - cheque 20,000 (not presented) = 55,000
    const st = buildReconciliation(
      "2026-09-30",
      5_500_000,
      [
        { id: "r", date: "2026-09-29", amount: 2_500_000, narration: "Cheque deposited", number: "AU-1", clearedOn: "2026-10-03" },
        { id: "p", date: "2026-09-28", amount: -2_000_000, narration: "Cheque to Kumar", number: "AU-2", clearedOn: null, chequeNo: "456789" },
        { id: "c", date: "2026-09-10", amount: 1_000_000, narration: "Cleared", number: "AU-3", clearedOn: "2026-09-11" },
      ],
      [
        { id: "i", date: "2026-09-30", amount: 31_200, narration: "Interest", reference: null, bookedOn: null },
        { id: "f", date: "2026-09-30", amount: -1_770, narration: "SMS charges", reference: null, bookedOn: null },
        { id: "x", date: "2026-09-11", amount: 1_000_000, narration: "Cleared", reference: null, bookedOn: "2026-09-10" },
        { id: "later", date: "2026-10-03", amount: 2_500_000, narration: "Clearing", reference: null, bookedOn: "2026-09-29" },
      ],
      5_500_000 + 2_000_000 - 2_500_000 + 31_200 - 1_770,
    );
    expect(st.notInBankPayments.map((l) => l.id)).toEqual(["p"]);
    expect(st.notInBankReceipts.map((l) => l.id)).toEqual(["r"]);
    expect(st.notInBooksCredits.map((l) => l.id)).toEqual(["i"]);
    expect(st.notInBooksDebits.map((l) => l.id)).toEqual(["f"]);
    expect(st.expectedBankBalance).toBe(5_029_430);
    expect(st.difference).toBe(0);
    expect(st.reconciled).toBe(true);
    expect(buildReconciliation("2026-09-30", 0, [], [], null).difference).toBeNull();
  });

  it("statement balance on a date: last printed balance plus the lines after it", () => {
    const lines = [
      { date: "2026-10-01", amount: 100, balance: 1_100 },
      { date: "2026-10-02", amount: 50, balance: null },
      { date: "2026-10-05", amount: -20, balance: 1_130 },
    ];
    expect(statementBalanceOn(lines, "2026-10-03")).toBe(1_150);
    expect(statementBalanceOn(lines, "2026-10-09")).toBe(1_130);
    expect(statementBalanceOn(lines, "2026-09-30")).toBeNull();
  });
});

describe("TDS / TCS rules", () => {
  const s = (k: string) => mergedSections().find((x) => x.key === k)!;

  it("194C: 1% individuals, 2% others; single Rs 30,000 or yearly Rs 1 lakh; catch-up once the year crosses", () => {
    expect(computeTds({ section: s("194C"), deducteeType: "individual", pan: "ABCPK1234F", base: 25_000_00, earlier: 0, date: "2026-10-01" })).toMatchObject({ applies: false, amount: 0 });
    expect(computeTds({ section: s("194C"), deducteeType: "individual", pan: "ABCPK1234F", base: 40_000_00, earlier: 0, date: "2026-10-01" })).toMatchObject({ applies: true, rate: 100, amount: 400_00 });
    expect(computeTds({ section: s("194C"), deducteeType: "firm", pan: "ABCFK1234F", base: 40_000_00, earlier: 0, date: "2026-10-01" })).toMatchObject({ rate: 200, amount: 800_00 });
    const cross = computeTds({ section: s("194C"), deducteeType: "company", pan: "ABCCK1234F", base: 20_000_00, earlier: 90_000_00, earlierUntaxed: 90_000_00, date: "2026-10-01" });
    expect(cross).toMatchObject({ applies: true, taxable: 110_000_00, amount: 2_200_00 });
  });

  it("no PAN: the higher rate (206AA)", () => {
    expect(computeTds({ section: s("194J-b"), deducteeType: null, pan: null, base: 60_000_00, earlier: 0, date: "2026-10-01" })).toMatchObject({ rate: 2000, amount: 12_000_00, noPan: true });
    expect(computeTds({ section: s("194Q"), deducteeType: null, pan: "bad", base: 10 * 100_000_00, earlier: 45 * 100_000_00, date: "2026-10-01", turnoverAbove10Cr: true })).toMatchObject({ rate: 500, taxable: 5 * 100_000_00 });
  });

  it("194Q: only above Rs 50 lakh a year, only for buyers above Rs 10 crore", () => {
    const sec = s("194Q");
    expect(computeTds({ section: sec, deducteeType: "company", pan: "ABCCK1234F", base: 20 * 100_000_00, earlier: 40 * 100_000_00, date: "2026-10-01" }).applies).toBe(false);
    const r = computeTds({ section: sec, deducteeType: "company", pan: "ABCCK1234F", base: 20 * 100_000_00, earlier: 40 * 100_000_00, date: "2026-10-01", turnoverAbove10Cr: true });
    expect(r).toMatchObject({ taxable: 10 * 100_000_00, rate: 10, amount: 1_000_00 });
  });

  it("194J yearly limit Rs 50,000; 194H Rs 20,000; 194I above Rs 50,000 a payment; 194A Rs 10,000", () => {
    expect(computeTds({ section: s("194J-b"), deducteeType: "individual", pan: "ABCPK1234F", base: 45_000_00, earlier: 0, date: "2026-10-01" }).applies).toBe(false);
    expect(computeTds({ section: s("194J-b"), deducteeType: "individual", pan: "ABCPK1234F", base: 10_000_00, earlier: 45_000_00, date: "2026-10-01" })).toMatchObject({ applies: true, amount: 1_000_00 });
    expect(computeTds({ section: s("194H"), deducteeType: "individual", pan: "ABCPK1234F", base: 25_000_00, earlier: 0, date: "2026-10-01" })).toMatchObject({ rate: 200, amount: 500_00 });
    expect(computeTds({ section: s("194I-b"), deducteeType: "individual", pan: "ABCPK1234F", base: 50_000_00, earlier: 0, date: "2026-10-01" }).applies).toBe(false);
    expect(computeTds({ section: s("194I-b"), deducteeType: "individual", pan: "ABCPK1234F", base: 60_000_00, earlier: 0, date: "2026-10-01" })).toMatchObject({ amount: 6_000_00 });
    expect(computeTds({ section: s("194A"), deducteeType: "individual", pan: "ABCPK1234F", base: 12_000_00, earlier: 0, date: "2026-10-01" })).toMatchObject({ amount: 1_200_00 });
  });

  it("a section 197 certificate rate replaces the normal rate", () => {
    expect(computeTds({ section: s("194C"), deducteeType: "company", pan: "ABCCK1234F", base: 40_000_00, earlier: 0, lowerRate: 50, date: "2026-10-01" })).toMatchObject({ rate: 50, amount: 200_00 });
  });

  it("206C(1H) is flagged as not applying after 31 March 2025", () => {
    const r = computeTds({ section: s("206C1H"), deducteeType: "company", pan: "ABCCK1234F", base: 60 * 100_000_00, earlier: 0, date: "2026-10-01", turnoverAbove10Cr: true });
    expect(r.reasons.join(" ")).toMatch(/does not apply after 2025-03-31/);
  });

  it("overrides change rates and thresholds per shop; 194Q and TCS start switched off", () => {
    const m = mergedSections({ "194C": { rate: 150, enabled: false } });
    expect(m.find((x) => x.key === "194C")).toMatchObject({ rate: 150, enabled: false });
    expect(m.find((x) => x.key === "194Q")!.enabled).toBe(false);
    expect(m.find((x) => x.key === "206C1H")!.enabled).toBe(false);
    expect(SECTION_BY_KEY["194J-b"]!.section).toBe("194J");
  });

  it("PAN checks and PAN from GSTIN", () => {
    expect(isValidPan("ABCPK1234F")).toBe(true);
    expect(isValidPan("ABCPK1234")).toBe(false);
    expect(panFromGstin("33ABCPK1234F1Z5")).toBe("ABCPK1234F");
    expect(deducteeTypeOfPan("ABCCK1234F")).toBe("company");
    expect(deducteeTypeOfPan("ABCHK1234F")).toBe("huf");
    expect(taxOf(1_234_56, 100)).toBe(1_200);
  });

  it("financial years, quarters and due dates", () => {
    expect(financialYearOf("2026-03-31")).toMatchObject({ fy: "2025-26", from: "2025-04-01", to: "2026-03-31" });
    expect(quarterOf("2026-10-26")).toMatchObject({ quarter: 3, key: "2026-27-Q3", from: "2026-10-01", to: "2026-12-31" });
    expect(quarterOf("2027-02-10")).toMatchObject({ quarter: 4, from: "2027-01-01", to: "2027-03-31" });
    expect(parseQuarter("2026-27-Q4")).toMatchObject({ from: "2027-01-01", to: "2027-03-31" });
    expect(parseQuarter("2026-28-Q1")).toBeNull();
    expect(depositDueDate("2026-10", "tds")).toBe("2026-11-07");
    expect(depositDueDate("2027-03", "tds")).toBe("2027-04-30");
    expect(depositDueDate("2027-03", "tcs")).toBe("2027-04-07");
    expect(depositDueDate("2026-12", "tds")).toBe("2027-01-07");
    expect(quarterDueDates({ quarter: 4, fy: "2026-27" }, "tds")).toEqual({ returnDue: "2027-05-31", certificateDue: "2027-06-15" });
    expect(quarterDueDates({ quarter: 1, fy: "2026-27" }, "tcs")).toEqual({ returnDue: "2026-07-15", certificateDue: "2026-07-30" });
  });

  it("late deposit interest hint: 1.5% a month or part from deduction", () => {
    expect(lateInterest(10_000_00, "2026-10-15", "2026-11-05", "2026-11-07", "tds")).toBe(0);
    expect(lateInterest(10_000_00, "2026-10-15", "2026-11-10", "2026-11-07", "tds")).toBe(300_00);
  });
});

describe("depreciation and the year-end close", () => {
  const asset = { cost: 120_000_00, salvage: 0, method: "slm" as const, rate: null, lifeMonths: 60, inUseFrom: "2026-04-01" };

  it("SLM by life: yearly charge, pro-rata by days, never below the residual value", () => {
    expect(slmYearly(asset)).toBe(24_000_00);
    const year = depreciationBetween(asset, "2026-04-01", "2027-03-31", 0);
    expect(year).toEqual([{ from: "2026-04-01", to: "2027-03-31", fy: "2026-27", amount: 24_000_00 }]);
    const half = depreciationBetween({ ...asset, inUseFrom: "2026-10-01" }, "2026-04-01", "2027-03-31", 0);
    expect(half[0]!.amount).toBe(Math.round((24_000_00 * 182) / 365 / 100) * 100);
    expect(depreciationBetween(asset, "2026-04-01", "2027-03-31", 110_000_00)[0]!.amount).toBe(10_000_00);
    expect(depreciationBetween(asset, "2026-04-01", "2027-03-31", 120_000_00)).toEqual([]);
  });

  it("WDV on the year's opening value; monthly runs add up to the year", () => {
    const wdv = { cost: 100_000_00, salvage: 0, method: "wdv" as const, rate: 1500, lifeMonths: null, inUseFrom: "2026-04-01" };
    const y1 = yearSchedule(wdv, "2026-04-01", "2027-03-31", 0);
    expect(y1).toEqual({ opening: 100_000_00, depreciation: 15_000_00, closing: 85_000_00 });
    const y2 = yearSchedule(wdv, "2027-04-01", "2028-03-31", 15_000_00);
    expect(y2.depreciation).toBe(12_750_00);
    // April then May..March as two runs: same base (the year's opening value).
    const apr = depreciationBetween(wdv, "2026-04-01", "2026-04-30", 0);
    const rest = depreciationBetween(wdv, "2026-05-01", "2027-03-31", apr[0]!.amount, apr[0]!.amount);
    expect(Math.abs(apr[0]!.amount + rest[0]!.amount - 15_000_00)).toBeLessThanOrEqual(100);
    // A run across two years is split by year.
    expect(depreciationBetween(wdv, "2026-04-01", "2028-03-31", 0).map((p) => p.fy)).toEqual(["2026-27", "2027-28"]);
  });

  it("stops at the day before disposal; gain or loss on sale", () => {
    const sold = depreciationBetween({ ...asset, disposedOn: "2026-07-01" }, "2026-04-01", "2027-03-31", 0);
    expect(sold[0]!.to).toBe("2026-06-30");
    expect(disposalResult(120_000_00, 30_000_00, 100_000_00)).toEqual({ bookValue: 90_000_00, gain: 10_000_00 });
  });

  it("closing journal: income and expense to zero, stock to the valued closing stock, profit to retained earnings, balanced", () => {
    const accounts = [
      { id: "sales", type: "income" as const, group: "sales" },
      { id: "purch", type: "expense" as const, group: "direct" },
      { id: "rent", type: "expense" as const, group: "indirect" },
      { id: "bank", type: "asset" as const, group: "cash_bank" },
    ];
    const net = new Map([
      ["sales", -500_000_00],
      ["purch", 300_000_00],
      ["rent", 60_000_00],
      ["bank", 140_000_00],
    ]);
    const r = closingLines(accounts, net, { retainedEarningsId: "re", stockAccountId: "stock", stockAdjustment: 40_000_00 });
    expect(r.netProfit).toBe(180_000_00);
    const dr = r.lines.reduce((t, l) => t + l.debit, 0);
    const cr = r.lines.reduce((t, l) => t + l.credit, 0);
    expect(dr).toBe(cr);
    expect(r.lines.find((l) => l.accountId === "sales")).toMatchObject({ debit: 500_000_00 });
    expect(r.lines.find((l) => l.accountId === "re")).toMatchObject({ credit: 180_000_00 });
    expect(r.lines.some((l) => l.accountId === "bank")).toBe(false);
    const loss = closingLines(accounts, new Map([["rent", 10_000_00]]), { retainedEarningsId: "re" });
    expect(loss.lines.find((l) => l.accountId === "re")).toMatchObject({ debit: 10_000_00 });
  });
});

describe("postings that undo each other are left out of the open book lines", () => {
  it("an engine reversal pairs with its original; a mirror posting (_reversal / _cancel) with the document's posting", async () => {
    const { BankService, pairKeyOf } = await import("./bank");
    const line = (id: string, entryId: string, amount: number, sourceType: string | null, sourceId: string | null, reversalOfId: string | null = null, origSource: string | null = null) => ({
      id,
      entryId,
      amount,
      sourceType,
      reversalOfId,
      pairKey: pairKeyOf({ entryId, reversalOfId, sourceType, sourceId, origSource }),
    });
    const lines = [
      line("a", "e1", -100_000, "supplier_payment", "sp1"),
      line("b", "e2", 100_000, "supplier_payment_reversal", "sp1"),
      line("c", "e3", -5_000, "expense", "x1"),
      line("d", "e4", 5_000, null, null, "e3", "expense|x1"),
      line("e", "e5", -6_000, "expense", "x1"),
      line("f", "e6", 2_000, "invoice_payment", "p9"),
    ];
    expect(BankService.dropCancelled(lines).map((l) => l.id)).toEqual(["e", "f"]);
    expect(pairKeyOf({ entryId: "e2", reversalOfId: null, sourceType: "invoice_cancel", sourceId: "i1" })).toBe("invoice|i1");
  });
});
