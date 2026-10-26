import { describe, expect, it } from "vitest";
import { kit, T, userText } from "../assist/test-kit";
import { allowedNumbers, checkNumbers } from "../insights/numbers";
import { addDays } from "./dates";
import { buildCashflow, cashflowSheet, collectionPlan, detectRecurring, festivalRatio, projectBalances, templateCashflow, weekdayAverages, writeCashflow, type CashflowInput, type DueBill } from "./cashflow";
import { causeOf, explain2b, groupMismatches, type MismatchRow } from "./explain2b";
import { acceptCover, buildLoanPack, loanSheet, templateCover, writeCover, LOAN_SECTIONS, type LoanPackInput } from "./loanpack";
import { explainRisk, riskSheet, scoreCredit, suggestLimit, type RiskBill, type RiskInput } from "./risk";
import { PLAN_FESTIVALS } from "../insights/calendar";

const TODAY = "2026-10-26"; // a Monday

/** A credit bill: made on `date`, due 15 days later, paid in full `paidAfter` days after the due date. */
const bill = (id: string, date: string, total: number, paidAfterDue: number | null, opts: Partial<RiskBill> = {}): RiskBill => {
  const dueDate = addDays(date, 15);
  return { id, date, dueDate, total, credited: 0, payments: paidAfterDue === null ? [] : [{ date: addDays(dueDate, paidAfterDue), amount: total }], ...opts };
};

const monthlyBills = (count: number, paidAfterDue: number | null, total = 500_000): RiskBill[] =>
  Array.from({ length: count }, (_, i) => bill(`b${i}`, addDays(TODAY, -(count - i) * 30 + 5), total, paidAfterDue));

const base = (bills: RiskBill[], extra: Partial<RiskInput> = {}): RiskInput => ({ today: TODAY, bills, creditLimit: 2_000_000, ...extra });

describe("credit risk score", () => {
  it("a customer who pays on the due date is band A with no overdue", () => {
    const r = scoreCredit(base(monthlyBills(6, 0)));
    expect(r.enough).toBe(true);
    expect(r.band).toBe("A");
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.metrics.onTimeShare).toBe(1);
    expect(r.metrics.overdueAmount).toBe(0);
    expect(r.factors.length).toBe(3);
    expect(r.factors.map((f) => f.key)).toContain("on_time");
    expect(r.hint).toBeNull();
  });

  it("a chronic late payer with an old overdue bill is band D, explained by bad factors", () => {
    const bills = [...monthlyBills(5, 40), bill("old", addDays(TODAY, -100), 800_000, null), bill("old2", addDays(TODAY, -70), 400_000, null)];
    const r = scoreCredit(base(bills, { creditLimit: 1_000_000 }));
    expect(r.band).toBe("D");
    expect(r.score).toBeLessThan(40);
    expect(r.metrics.oldestOverdueDays).toBeGreaterThan(60);
    const keys = r.factors.map((f) => f.key);
    expect(keys).toContain("often_late");
    expect(keys.some((k) => k === "long_overdue" || k === "overdue_now")).toBe(true);
    expect(r.factors.every((f) => f.tone !== "good")).toBe(true);
    expect(r.hint?.en).toMatch(/Before giving more credit/);
    expect(r.hint?.ta).toMatch(/[஀-௿]/);
  });

  it("occasional lateness is band B or C, between the two", () => {
    const bills = [...monthlyBills(4, 0), ...Array.from({ length: 4 }, (_, i) => bill(`l${i}`, addDays(TODAY, -(150 + i * 30)), 500_000, 12))];
    const r = scoreCredit(base(bills));
    expect(["B", "C"]).toContain(r.band);
  });

  it("a new customer with little history is not scored: 'not enough history'", () => {
    const r = scoreCredit(base([bill("a", addDays(TODAY, -20), 300_000, null), bill("b", addDays(TODAY, -5), 200_000, null)]));
    expect(r.band).toBe("new");
    expect(r.score).toBeNull();
    expect(r.enough).toBe(false);
    expect(r.factors[0]!.key).toBe("not_enough_history");
    expect(r.limit.amount).toBeNull();
    // Even without a score, an old overdue is still mentioned.
    expect(scoreCredit(base([bill("a", addDays(TODAY, -80), 300_000, null)])).hint?.en).toMatch(/overdue/);
  });

  it("money paid with the bill is not credit; credit notes reduce what is owed", () => {
    const upfront = bill("u", addDays(TODAY, -60), 100_000, null, { payments: [{ date: addDays(TODAY, -60), amount: 100_000 }] });
    expect(scoreCredit(base([upfront])).metrics.creditBills).toBe(0);
    const credited = bill("c", addDays(TODAY, -60), 100_000, null, { credited: 100_000 });
    expect(scoreCredit(base([credited])).metrics.openAmount).toBe(0);
  });

  it("a cheque bounce lowers the score, and is a named factor", () => {
    const clean = scoreCredit(base(monthlyBills(6, 0)));
    const bounced = scoreCredit(base(monthlyBills(6, 0), { chequeBounces: 1 }));
    expect(bounced.score!).toBeLessThan(clean.score!);
    expect(bounced.factors.map((f) => f.key)).toContain("cheque_bounced");
    expect(scoreCredit(base(monthlyBills(6, 0), { chequeBounces: null })).score).toBe(clean.score);
  });

  it("uses of the limit and rising dues count; over the limit is a bad factor", () => {
    const bills = [...monthlyBills(5, 0), bill("o1", addDays(TODAY, -10), 1_500_000, null), bill("o2", addDays(TODAY, -4), 900_000, null)];
    const r = scoreCredit(base(bills, { creditLimit: 2_000_000 }));
    expect(r.metrics.utilisation).toBeGreaterThan(1);
    expect(r.factors.map((f) => f.key)).toContain("over_limit");
    expect(r.metrics.trend).toBe("rising");
  });

  it("the input has no personal field: the score depends only on money and dates", () => {
    const input = base(monthlyBills(6, 0));
    expect(Object.keys(input).sort()).toEqual(["bills", "creditLimit", "today"]);
    expect(Object.keys(input.bills[0]!).sort()).toEqual(["credited", "date", "dueDate", "id", "payments", "total"]);
    // Same record under any bill ids gives the same result.
    const renamed = { ...input, bills: input.bills.map((b, i) => ({ ...b, id: `zz${i}` })) };
    expect(scoreCredit(renamed)).toEqual(scoreCredit(input));
  });

  it("the facts sheet for the AI line has no name, phone or place", () => {
    const sheet = riskSheet(scoreCredit(base(monthlyBills(6, 15))));
    expect(sheet).not.toMatch(/\d{10}|@|name/i);
    expect(sheet).toMatch(/^Band: /);
  });
});

describe("suggested credit limit", () => {
  const metrics = (over: Partial<ReturnType<typeof scoreCredit>["metrics"]> = {}) => ({ ...scoreCredit(base(monthlyBills(6, 0))).metrics, ...over });
  it("is a month of buying, stretched by days-to-pay, scaled by band, rounded to Rs 500", () => {
    // monthly 500000 paise (Rs 5,000), pays in 15 days (< 30 so 1 month): A x1.5 = 750000
    const m = metrics({ monthlyPurchase: 500_000, avgDaysToPay: 15 });
    expect(suggestLimit(m, "A", null)).toMatchObject({ amount: 750_000, action: "raise" });
    expect(suggestLimit(m, "B", 600_000).amount).toBe(600_000); // x1.2 = 600000
    expect(suggestLimit(m, "B", 600_000).action).toBe("keep");
    // pays in 60 days: 2 months
    expect(suggestLimit(metrics({ monthlyPurchase: 500_000, avgDaysToPay: 60 }), "B", null).amount).toBe(1_200_000);
    expect(suggestLimit(metrics({ monthlyPurchase: 333_333, avgDaysToPay: 15 }), "B", null).amount! % 50_000).toBe(0);
  });
  it("a C is trimmed and a D is held at what they already owe", () => {
    const m = metrics({ monthlyPurchase: 500_000, avgDaysToPay: 45, openAmount: 300_000 });
    expect(suggestLimit(m, "C", 2_000_000)).toMatchObject({ amount: 600_000, action: "lower" });
    const d = suggestLimit(m, "D", 2_000_000);
    expect(d.amount).toBe(300_000);
    expect(d.en).toMatch(/hold new credit/);
  });
  it("gives no number without history or recent buying", () => {
    expect(suggestLimit(metrics(), "new", null).amount).toBeNull();
    expect(suggestLimit(metrics({ monthlyPurchase: 0 }), "A", null).amount).toBeNull();
  });
});

describe("credit risk one-line explanation", () => {
  const result = scoreCredit(base(monthlyBills(6, 15)));
  it("keeps the AI line when every number is in the facts", async () => {
    const sheet = riskSheet(result);
    const nums = sheet.match(/\d+/g)!.slice(0, 2).join(" and ");
    const k = kit({ responders: [() => JSON.stringify({ line: `Rated ${result.band} with ${nums} as the key figures.` })] });
    const r = await explainRisk(k.service, { tenantId: T, result, lang: "en" });
    expect(r.source).toBe("ai");
  });
  it("falls back to the template on an invented number or a personal attribute", async () => {
    const k1 = kit({ responders: [() => JSON.stringify({ line: "They owe ₹98,765 and pay late." })] });
    expect((await explainRisk(k1.service, { tenantId: T, result, lang: "en" })).fallbackReason).toBe("numbers");
    const k2 = kit({ responders: [() => JSON.stringify({ line: "A Muslim customer who pays late." })] });
    const r2 = await explainRisk(k2.service, { tenantId: T, result, lang: "en" });
    expect(r2.source).toBe("template");
    expect(r2.fallbackReason).toBe("attributes");
  });
  it("sends no name or phone to the model", async () => {
    let seen = "";
    const k = kit({ responders: [(req) => ((seen = userText(req)), JSON.stringify({ line: "Pays late." }))] });
    await explainRisk(k.service, { tenantId: T, result, lang: "ta" });
    expect(seen).not.toMatch(/@|\d{10}/);
    expect(seen).toMatch(/Language: ta/);
  });
  it("is a template with no AI call without a runner or for a new customer", async () => {
    expect((await explainRisk(null, { tenantId: T, result, lang: "ta" })).text).toMatch(/[஀-௿]/);
    const fresh = scoreCredit(base([bill("a", addDays(TODAY, -3), 100, null)]));
    const k = kit();
    expect((await explainRisk(k.service, { tenantId: T, result: fresh, lang: "en" })).source).toBe("template");
    expect(k.spent()).toBe(0);
  });
});

// ------------------------------------------------------------------ cash-flow

/** Counter money: Rs 1,000 on Mon-Sat, Rs 3,000 on Sunday... for the 400 days before today. */
function receiptsFor(daily: (date: string, weekday: number) => number, days = 520): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = days; i >= 1; i--) {
    const d = addDays(TODAY, -i);
    out[d] = daily(d, new Date(`${d}T00:00:00Z`).getUTCDay());
  }
  return out;
}

const cf = (over: Partial<CashflowInput> = {}): CashflowInput => ({
  today: TODAY,
  receipts: receiptsFor((_d, w) => (w === 0 ? 300_000 : 100_000)),
  firstSaleDate: addDays(TODAY, -520),
  opening: { amount: 1_000_000, source: "entered", asOf: TODAY },
  threshold: 0,
  dues: [],
  payables: [],
  expenses: [],
  pos: [],
  ...over,
});

describe("cash-flow: sales by weekday and festival lift", () => {
  it("averages the last 8 weeks per weekday", () => {
    const { avg, historyDays } = weekdayAverages(cf().receipts, TODAY, addDays(TODAY, -520));
    expect(historyDays).toBe(56);
    expect(avg[0]).toBe(300_000);
    expect(avg[1]).toBe(100_000);
  });
  it("with under 14 days of history it uses the overall average for every day", () => {
    const first = addDays(TODAY, -10);
    const { avg } = weekdayAverages(receiptsFor(() => 50_000, 10), TODAY, first);
    expect(new Set(avg)).toEqual(new Set([50_000]));
    expect(weekdayAverages({}, TODAY, null).avg).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
  it("applies last year's festival lift to this year's shopping window only", () => {
    const deepavali25 = PLAN_FESTIVALS.find((f) => f.id === "deepavali" && f.year === 2025)!;
    const receipts = receiptsFor((d, w) => {
      const inWindow = d >= addDays(deepavali25.date, -deepavali25.leadDays) && d < deepavali25.date;
      return (w === 0 ? 300_000 : 100_000) * (inWindow ? 2 : 1);
    });
    const f26 = PLAN_FESTIVALS.find((f) => f.id === "deepavali" && f.year === 2026)!;
    expect(festivalRatio(receipts, f26, addDays(TODAY, -520))).toBeGreaterThan(1.9);
    const facts = buildCashflow(cf({ receipts }));
    const win = facts.festivals.find((x) => x.id === "deepavali")!;
    expect(win.ratio).toBeGreaterThan(1.9);
    const inside = facts.days.find((d) => d.date === "2026-10-30")!; // Friday inside the window (2026-10-25..11-07)
    const outside = facts.days.find((d) => d.date === "2026-10-27")!; // Tuesday, window started 10-25: also inside
    expect(inside.festival).toBe("deepavali");
    expect(inside.salesIn).toBeGreaterThan(190_000);
    expect(outside.festival).toBe("deepavali");
    // The window ends the day before the festival: the festival day itself is normal.
    const day = buildCashflow(cf({ receipts, today: "2026-11-01" })).days.find((d) => d.date === "2026-11-08")!;
    expect(day.festival).toBeNull();
  });
  it("no last-year data means no lift", () => {
    const facts = buildCashflow(cf({ receipts: receiptsFor(() => 100_000, 60), firstSaleDate: addDays(TODAY, -60) }));
    expect(facts.festivals.every((f) => f.ratio === null)).toBe(true);
    expect(facts.days.every((d) => d.festival === null)).toBe(true);
  });
});

describe("cash-flow: recurring expenses", () => {
  const rent = ["2026-04-05", "2026-05-05", "2026-06-06", "2026-07-05", "2026-08-05", "2026-09-05"].map((date) => ({ date, category: "Rent", vendor: "Mr Anand", amount: 1_500_000 }));
  it("finds a monthly pattern and puts the next one next month once this month's is paid", () => {
    const found = detectRecurring([...rent, { date: "2026-10-05", category: "Rent", vendor: "Mr Anand", amount: 1_500_000 }], TODAY);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ category: "Rent", amount: 1_500_000, dayOfMonth: 5, nextDate: "2026-11-05" });
    expect(Object.keys(found[0]!)).not.toContain("vendor");
  });
  it("a payroll paid to several people is one line by category, without their names", () => {
    const pay = ["2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"].flatMap((date) => [
      { date, category: "Salaries", vendor: "Geetha", amount: 2_200_000 },
      { date, category: "Salaries", vendor: "Eswari", amount: 1_400_000 },
    ]);
    const found = detectRecurring(pay, TODAY);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ category: "Salaries", amount: 3_600_000, nextDate: "2026-11-01" });
    const facts = buildCashflow(cf({ expenses: pay }));
    expect(cashflowSheet(facts)).not.toMatch(/Geetha|Eswari/);
  });
  it("if this month's is not yet paid and its day is ahead, it is due this month (less any part already paid)", () => {
    const sal = ["2026-05-28", "2026-06-28", "2026-07-28", "2026-08-28", "2026-09-28"].map((date) => ({ date, category: "Salaries", vendor: null, amount: 4_000_000 }));
    expect(detectRecurring(sal, TODAY)[0]).toMatchObject({ category: "Salaries", nextDate: "2026-10-28", amount: 4_000_000 });
    expect(detectRecurring([...sal, { date: "2026-10-10", category: "Salaries", vendor: null, amount: 1_000_000 }], TODAY)[0]).toMatchObject({ nextDate: "2026-10-28", amount: 3_000_000 });
  });
  it("ignores one-off, irregular and two-month patterns", () => {
    expect(detectRecurring([{ date: "2026-09-05", category: "Repairs", vendor: null, amount: 500_000 }], TODAY)).toEqual([]);
    expect(detectRecurring(rent.slice(0, 2), TODAY)).toEqual([]);
    const wild = ["2026-05-02", "2026-06-20", "2026-07-09", "2026-08-30"].map((date) => ({ date, category: "Transport", vendor: null, amount: 100_000 }));
    expect(detectRecurring(wild, TODAY)).toEqual([]);
    const varied = [100_000, 900_000, 100_000, 900_000].map((amount, i) => ({ date: `2026-0${5 + i}-05`, category: "Other", vendor: null, amount }));
    expect(detectRecurring(varied, TODAY)).toEqual([]);
  });
  it("they land on their day in the forecast as an outflow", () => {
    const facts = buildCashflow(cf({ expenses: rent }));
    const day = facts.days.find((d) => d.date === "2026-11-05")!;
    expect(day.recurringOut).toBe(1_500_000);
  });
});

describe("cash-flow: collections weighted by the customer's band", () => {
  const due = (band: DueBill["band"], dueDate: string, lateDays: number | null = null): DueBill => ({ customerKey: band, customerName: `C-${band}`, billId: band, number: null, balance: 1_000_000, dueDate, band, lateDays });
  const total = (p: { amount: number }[]) => p.reduce((a, x) => a + x.amount, 0);
  it("an A customer's bill is mostly expected, a D customer's much less", () => {
    const future = addDays(TODAY, 5);
    const a = collectionPlan(due("A", future), TODAY, 30);
    const d = collectionPlan(due("D", future), TODAY, 30);
    expect(total(a)).toBe(950_000); // 95%, paid on the due date
    expect(a[0]!.date).toBe(future);
    // D usually pays 45 days late: that is after the horizon, so nothing is counted
    expect(d).toEqual([]);
    expect(total(collectionPlan(due("D", future, 10), TODAY, 30))).toBe(250_000);
  });
  it("a bill already past the usual payment date trickles in over the horizon at the band's rate", () => {
    const plan = collectionPlan(due("C", addDays(TODAY, -60)), TODAY, 30);
    expect(plan).toHaveLength(30);
    expect(Math.round(total(plan))).toBe(550_000);
    expect(plan[0]!.date).toBe(addDays(TODAY, 1));
  });
  it("shows in the forecast and the collection slider scales it", () => {
    const facts = buildCashflow(cf({ receipts: {}, firstSaleDate: null, dues: [due("A", addDays(TODAY, 5))] }));
    expect(facts.days.reduce((a, d) => a + d.collectionsIn, 0)).toBe(950_000);
    const full = projectBalances(facts).at(-1)!;
    const half = projectBalances(facts, { collectionPct: 50 }).at(-1)!;
    expect(full - half).toBe(475_000);
    expect(projectBalances(facts, { salesPct: 20 }).at(-1)).toBe(full); // no sales in this fixture
  });
});

describe("cash-flow: balances, warning, suggestions", () => {
  const input = (): CashflowInput =>
    cf({
      receipts: receiptsFor(() => 100_000, 100),
      firstSaleDate: addDays(TODAY, -100),
      opening: { amount: 500_000, source: "entered", asOf: TODAY },
      payables: [{ billId: "p1", supplierName: "Sri Traders", number: "ST-1", balance: 2_500_000, dueDate: addDays(TODAY, 8) }],
      pos: [{ id: "po1", number: "PO-7", supplierName: "Anand Wholesale", remaining: 800_000, expectedDate: addDays(TODAY, 5), orderDate: addDays(TODAY, -3), creditDays: 0 }],
      dues: [
        { customerKey: "a", customerName: "Murugan Mess", billId: "d1", number: "INV-1", balance: 900_000, dueDate: addDays(TODAY, -20), band: "C", lateDays: null },
        { customerKey: "b", customerName: "Raja Stores", billId: "d2", number: "INV-2", balance: 400_000, dueDate: addDays(TODAY, -5), band: "B", lateDays: null },
      ],
    });
  it("balance each day = start + sales + collections - supplier - expenses - orders", () => {
    const f = buildCashflow(input());
    const first = f.days[0]!;
    expect(f.forecast.balances[0]).toBe(500_000 + first.salesIn + first.collectionsIn);
    const sum = f.days.reduce((a, d) => a + d.salesIn + d.collectionsIn - d.supplierOut - d.recurringOut - d.poOut, 500_000);
    expect(f.forecast.end).toBe(sum);
    expect(f.days.find((d) => d.date === addDays(TODAY, 8))!.supplierOut).toBe(2_500_000);
    expect(f.days.find((d) => d.date === addDays(TODAY, 5))!.poOut).toBe(800_000);
  });
  it("warns with the date and the main reason when the balance falls below the level", () => {
    const f = buildCashflow({ ...input(), threshold: 100_000, receipts: receiptsFor(() => 20_000, 100) });
    expect(f.warning).not.toBeNull();
    expect(f.warning!.date).toBe(addDays(TODAY, 8));
    expect(f.warning!.reason).toMatchObject({ kind: "supplier", label: "Sri Traders", amount: 2_500_000 });
    expect(f.warning!.shortBy).toBe(100_000 - f.warning!.balance);
  });
  it("no warning when the shop has not entered a balance; the forecast is then a net change from zero", () => {
    const f = buildCashflow({ ...input(), opening: { amount: null, source: "none", asOf: null } });
    expect(f.balanceKnown).toBe(false);
    expect(f.warning).toBeNull();
    expect(f.startBalance).toBe(0);
    expect(templateCashflow(f, "en").explanation).toMatch(/Enter your cash and bank balance/);
  });
  it("suggests collecting from the top dues and delaying a purchase order when that raises the low point", () => {
    const f = buildCashflow({ ...input(), threshold: 100_000, receipts: receiptsFor(() => 20_000, 100) });
    const collect = f.suggestions.find((s) => s.kind === "collect")!;
    expect(collect.dues![0]).toEqual({ label: "Murugan Mess", amount: 900_000 });
    expect(collect.duesTotal).toBe(1_300_000);
    const delay = f.suggestions.find((s) => s.kind === "delay_po");
    expect(delay?.po).toMatchObject({ number: "PO-7", delayDays: 5 });
    expect(delay!.po!.lowestAfter).toBeGreaterThan(f.forecast.lowest.balance);
    const t = templateCashflow(f, "en");
    expect(t.suggestions[0]).toMatch(/Collect ₹13,000 from the top 2 dues: Murugan Mess, Raja Stores/);
    expect(t.suggestions[1]).toMatch(/Delay order PO-7/);
  });
  it("the template wording (en and ta) uses only numbers from the facts sheet", () => {
    const f = buildCashflow({ ...input(), threshold: 100_000, receipts: receiptsFor(() => 20_000, 100) });
    const allowed = allowedNumbers(cashflowSheet(f));
    for (const lang of ["en", "ta"] as const) {
      const t = templateCashflow(f, lang);
      expect(checkNumbers([t.explanation, ...t.suggestions].join(" "), allowed)).toEqual({ ok: true, unknown: [] });
    }
    expect(templateCashflow(f, "ta").explanation).toMatch(/[஀-௿]/);
  });
  it("AI wording is kept only when numbers are in the facts, else the template", async () => {
    const f = buildCashflow({ ...input(), threshold: 100_000, receipts: receiptsFor(() => 20_000, 100) });
    const good = kit({ responders: [() => JSON.stringify({ explanation: `The balance may drop to ${"₹"}${(f.warning!.balance / 100).toLocaleString("en-IN")} soon.`, suggestions: [] })] });
    expect((await writeCashflow(good.service, { tenantId: T, facts: f, lang: "en" })).source).toBe("ai");
    const bad = kit({ responders: [() => JSON.stringify({ explanation: "You will have ₹7,77,777 next week.", suggestions: [] })] });
    const r = await writeCashflow(bad.service, { tenantId: T, facts: f, lang: "en" });
    expect(r).toMatchObject({ source: "template", fallbackReason: "numbers" });
    expect(await writeCashflow(null, { tenantId: T, facts: f, lang: "ta" })).toMatchObject({ source: "template", credits: 0 });
    expect(kit().spent()).toBe(0);
  });
  it("drops a suggestion that has no source in the facts", async () => {
    const f = buildCashflow(cf({ receipts: {}, firstSaleDate: null }));
    const k = kit({ responders: [() => JSON.stringify({ explanation: "Looks calm.", suggestions: ["Delay the order by 5 days."] })] });
    expect((await writeCashflow(k.service, { tenantId: T, facts: f, lang: "en" })).suggestions).toEqual([]);
  });
});

// ------------------------------------------------------------------ loan pack

const monthsList = Array.from({ length: 12 }, (_, i) => {
  const m = i + 1 + 9 > 12 ? i + 1 + 9 - 12 : i + 1 + 9; // Oct 2025 .. Sep 2026
  const y = i + 10 > 12 ? 2026 : 2025;
  return { month: `${y}-${String(m).padStart(2, "0")}`, sales: 1_000_000 + i * 100_000, taxable: 900_000 + i * 90_000, bills: 100 + i, gstOutput: 100_000, purchasesTaxable: 600_000 + i * 50_000, gstr1Filed: i < 10 };
});
const loanInput = (showNames = false): LoanPackInput => ({
  today: TODAY,
  months: monthsList,
  customers: [
    { name: "Murugan Mess", total: 4_000_000, bills: 30 },
    { name: "Raja Stores", total: 2_000_000, bills: 12 },
    { name: "A", total: 1_000_000, bills: 5 },
    { name: "B", total: 500_000, bills: 3 },
    { name: "C", total: 400_000, bills: 2 },
    { name: "D", total: 100_000, bills: 1 },
  ],
  receivables: { buckets: [{ key: "current", amount: 600_000, count: 5 }, { key: "1-30", amount: 200_000, count: 2 }, { key: "61-90", amount: 100_000, count: 1 }, { key: "90+", amount: 100_000, count: 1 }], total: 1_000_000, customers: 6 },
  payables: { total: 700_000, overdue: 100_000 },
  stockValue: 5_000_000,
  averageBalance: null,
  averageDailyCollections: 40_000,
  showNames,
});

describe("loan readiness pack", () => {
  it("computes totals, growth, margin and concentration in code", () => {
    const f = buildLoanPack(loanInput());
    const sales = monthsList.reduce((a, m) => a + m.sales, 0);
    expect(f.totals.sales).toBe(sales);
    expect(f.totals.avgMonthly).toBe(Math.round(sales / 12));
    expect(f.totals.last6).toBe(monthsList.slice(6).reduce((a, m) => a + m.sales, 0));
    expect(f.totals.growthPct).toBeGreaterThan(0);
    expect(f.totals.gstr1FiledMonths).toBe(10);
    expect(f.months[0]!.marginPct).toBe(Math.round(((900_000 - 600_000) / 900_000) * 1000) / 10);
    expect(f.concentration.top1SharePct).toBe(Math.round((4_000_000 / sales) * 1000) / 10);
    expect(f.concentration.top).toHaveLength(5);
    expect(f.receivables.over60).toBe(200_000);
    expect(f.receivables.over60Pct).toBe(20);
    expect(f.totals.best!.month).toBe("2026-09");
  });
  it("hides customer names by default and shows them only when the owner unticks the mask", () => {
    const masked = buildLoanPack(loanInput(false));
    expect(masked.concentration.top.map((t) => t.label)).toEqual(["Customer 1", "Customer 2", "Customer 3", "Customer 4", "Customer 5"]);
    expect(JSON.stringify(masked)).not.toMatch(/Murugan|Raja/);
    const open = buildLoanPack(loanInput(true));
    expect(open.concentration.top[0]!.label).toBe("Murugan Mess");
    expect(open.concentration.namesShown).toBe(true);
    // Names never reach the model, even when shown in the pack.
    expect(loanSheet(open)).not.toMatch(/Murugan|Raja/);
  });
  it("lists the sections it includes, and the balance only when one was entered", () => {
    const without = buildLoanPack(loanInput());
    expect(without.sections).not.toContain("balance");
    expect(without.balance.average).toBeNull();
    const withBal = buildLoanPack({ ...loanInput(), averageBalance: 2_500_000 });
    expect(withBal.sections).toContain("balance");
    expect(LOAN_SECTIONS.map((s) => s.key)).toEqual(["sales", "gst", "margin", "customers", "receivables", "payables", "stock", "balance"]);
  });
  it("the template cover note is neutral, factual, bilingual and uses only the facts", () => {
    const f = buildLoanPack(loanInput());
    const c = templateCover(f, "Kumar Stores");
    expect(c.en).toMatch(/not a credit decision/);
    expect(c.ta).toMatch(/[஀-௿]/);
    expect(checkNumbers(c.en, allowedNumbers(loanSheet(f)))).toEqual({ ok: true, unknown: [] });
    expect(c.en).not.toMatch(/guarantee|strong|excellent|eligible/i);
  });
  it("accepts a plain AI note but rejects promises, hype, invented figures and unsupported claims", () => {
    const f = buildLoanPack(loanInput());
    const sheet = loanSheet(f);
    const good = `The shop's records show total sales of ${"₹"}${(f.totals.sales / 100).toLocaleString("en-IN")} over 12 months from ${f.totals.bills} bills. This is a summary of its own records and not a credit decision.`;
    expect(acceptCover(good, sheet)).toBe(good);
    expect(acceptCover(good.replace("show", "show a guaranteed"), sheet)).toBeNull();
    expect(acceptCover("Repayment is assured and the business is strong with excellent growth and healthy margins in every month.", sheet)).toBeNull();
    expect(acceptCover(good.replace(String(f.totals.bills), "99999"), sheet)).toBeNull();
    expect(acceptCover("The shop offers free delivery and a lifetime warranty on all stock, recorded across twelve months of its own bills.", sheet)).toBeNull();
    expect(acceptCover("Too short.", sheet)).toBeNull();
  });
  it("writeCover falls back to the template on a bad note and always keeps the disclaimer", async () => {
    const f = buildLoanPack(loanInput());
    const bad = kit({ responders: [() => JSON.stringify({ en: "The business is guaranteed to repay every loan on time, with very strong sales.", ta: "நல்ல கடை." })] });
    const r = await writeCover(bad.service, { tenantId: T, facts: f, shop: "Kumar Stores" });
    expect(r).toMatchObject({ source: "template", fallbackReason: "checks" });
    const noAi = await writeCover(null, { tenantId: T, facts: f, shop: "" });
    expect(noAi.en).toMatch(/not a credit decision/);
    expect(noAi.credits).toBe(0);
    const ok = `Sales were ${"₹"}${(f.totals.sales / 100).toLocaleString("en-IN")} over the 12 months, from ${f.totals.bills} bills, as recorded in the shop's own billing system.`;
    const okTa = `கடையின் சொந்த பில்லிங் பதிவுகளின்படி 12 மாதத்தில் மொத்த விற்பனை ${"₹"}${(f.totals.sales / 100).toLocaleString("en-IN")}, ${f.totals.bills} பில்கள்.`;
    const good = kit({ responders: [() => JSON.stringify({ en: ok, ta: okTa })] });
    const g = await writeCover(good.service, { tenantId: T, facts: f, shop: "Kumar Stores" });
    expect(g.source).toBe("ai");
    expect(g.en).toMatch(/not (?:been )?audited|not a credit decision/);
  });
});

// ------------------------------------------------------------------ GSTR-2B

const row = (o: Partial<MismatchRow>): MismatchRow => ({ group: "amount_mismatch", supplier: "Sri Traders", number: "ST-1", tax: 180_000, date: "2026-09-12", ...o });

describe("GSTR-2B mismatch explanations", () => {
  it("names the likely cause from the recorded differences", () => {
    expect(causeOf(row({ diff: { cgst: [9_000, 9_100], sgst: [9_000, 9_100] } }))).toBe("rounding");
    expect(causeOf(row({ diff: { cgst: [9_000, 12_000] } }))).toBe("amount_differs");
    expect(causeOf(row({ diff: { date: ["2026-09-12", "2026-09-14"] } }))).toBe("date_only");
    expect(causeOf(row({ group: "fuzzy", diff: { number: ["ST/1", "ST-1"] } }))).toBe("number_format");
    expect(causeOf(row({ group: "missing_in_2b", date: "2026-09-30" }))).toBe("month_end");
    expect(causeOf(row({ group: "missing_in_2b", date: "2026-09-10", gstinInvalid: true }))).toBe("gstin_invalid");
    expect(causeOf(row({ group: "missing_in_books" }))).toBe("other");
  });
  it("groups rows with counts, tax, causes and the largest examples", () => {
    const g = groupMismatches([row({ diff: { cgst: [1, 2] } }), row({ number: "X", tax: 500_000, diff: { cgst: [1, 90_000] } }), row({ group: "missing_in_2b", number: "M-1", tax: 70_000 })]);
    expect(g.map((x) => x.group)).toEqual(["missing_in_2b", "amount_mismatch"]);
    const am = g.find((x) => x.group === "amount_mismatch")!;
    expect(am).toMatchObject({ count: 2, tax: 680_000 });
    expect(am.causes).toEqual({ rounding: 1, amount_differs: 1 });
    expect(am.examples[0]!.number).toBe("X");
  });
  it("uses the template with no runner, and keeps AI lines only when numbers match and there is no verdict", async () => {
    const groups = groupMismatches([row({ diff: { cgst: [1, 2] } }), row({ group: "missing_in_2b", number: "M-1", tax: 70_000 })]);
    const t = await explain2b(null, { tenantId: T, groups, lang: "ta" });
    expect(t.lines.every((l) => l.source === "template" && /[஀-௿]/.test(l.text))).toBe(true);
    const good = kit({ responders: [() => JSON.stringify({ lines: [{ group: "amount_mismatch", text: "1 bill has a rounding gap of a rupee or two; check it." }, { group: "missing_in_2b", text: "The supplier may not have filed yet for ₹99,999." }] })] });
    const r = await explain2b(good.service, { tenantId: T, groups, lang: "en" });
    expect(r.lines.find((l) => l.group === "amount_mismatch")!.source).toBe("ai");
    expect(r.lines.find((l) => l.group === "missing_in_2b")!.source).toBe("template"); // invented 99999
    const verdict = kit({ responders: [() => JSON.stringify({ lines: [{ group: "amount_mismatch", text: "This is fraud by the supplier." }, { group: "missing_in_2b", text: "Your return is wrong." }] })] });
    expect((await explain2b(verdict.service, { tenantId: T, groups, lang: "en" })).lines.every((l) => l.source === "template")).toBe(true);
  });
  it("AI off gives the template and the error code", async () => {
    const groups = groupMismatches([row({})]);
    const off = kit({ settings: { features: { "gst-2b-explain": false } } });
    const r = await explain2b(off.service, { tenantId: T, groups, lang: "en" });
    expect(r.aiNote).toBe("ai_feature_off");
    expect(r.lines[0]!.source).toBe("template");
  });
});
