import { describe, expect, it } from "vitest";
import { ACCOUNT_GROUPS, STANDARD_CHART, SYS } from "./chart";
import { profitLossTable, trialBalanceTable, balanceSheetTable } from "./tables";
import { buildBalanceSheet, buildGstLedger, buildLedger, buildProfitLoss, buildTrialBalance, tableToCsv, type AccountInfo, type Balance } from "./reports-logic";
import { reportBodyHtml } from "./pdf";

const accounts: AccountInfo[] = STANDARD_CHART.map((c, i) => ({
  id: `a${i}`,
  code: c.code,
  name: c.name,
  type: c.type,
  group: c.group,
  subGroup: c.subGroup ?? null,
  key: c.key ?? null,
  isCash: !!c.isCash,
  isBank: !!c.isBank,
}));
const id = (key: string) => accounts.find((a) => a.key === key)!.id;
const bal = (m: Record<string, [number, number]>) => new Map<string, Balance>(Object.entries(m).map(([k, [debit, credit]]) => [id(k), { debit, credit }]));

describe("chart of accounts", () => {
  it("has unique codes and keys, and every group exists for its type", () => {
    expect(new Set(STANDARD_CHART.map((c) => c.code)).size).toBe(STANDARD_CHART.length);
    const keys = STANDARD_CHART.map((c) => c.key).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of STANDARD_CHART) expect(ACCOUNT_GROUPS.find((g) => g.key === c.group)?.type, c.name).toBe(c.type);
  });

  it("includes the accounts the posting rules use", () => {
    for (const k of Object.values(SYS)) expect(keysOf()).toContain(k);
  });
  const keysOf = () => STANDARD_CHART.map((c) => c.key);

  it("covers GST input and output heads, cash, bank, debtors, creditors, TDS and TCS", () => {
    for (const k of ["gst_in_cgst", "gst_in_sgst", "gst_in_igst", "gst_out_cgst", "gst_out_sgst", "gst_out_igst", "cash", "bank", "debtors", "creditors", "tds_receivable", "tds_payable", "tcs_receivable", "tcs_payable", "stock", "round_off"]) {
      expect(keysOf()).toContain(k);
    }
  });
});

describe("trial balance", () => {
  it("splits opening, period and closing into debit and credit columns and balances", () => {
    // Before: capital 1,000 in cash. During: sale 500 + 90 GST in cash, buy 200 on credit.
    const before = bal({ cash: [100_000, 0], capital: [0, 100_000] });
    const during = bal({ cash: [59_000, 0], sales: [0, 50_000], gst_out_cgst: [0, 4_500], gst_out_sgst: [0, 4_500], purchases: [20_000, 0], creditors: [0, 20_000] });
    const tb = buildTrialBalance(accounts, before, during, { from: "2026-10-01", to: "2026-10-31" });
    expect(tb.balanced).toBe(true);
    expect(tb.totals.openingDr).toBe(tb.totals.openingCr);
    const cash = tb.rows.find((r) => r.name === "Cash in hand")!;
    expect(cash).toMatchObject({ openingDr: 100_000, debit: 59_000, closingDr: 159_000, closingCr: 0 });
    expect(tb.rows.find((r) => r.name === "Owner's capital")).toMatchObject({ openingCr: 100_000, closingCr: 100_000 });
    expect(tb.rows.some((r) => r.name === "Bank account")).toBe(false);
  });

  it("flags a trial balance that does not balance", () => {
    const tb = buildTrialBalance(accounts, new Map(), bal({ cash: [100, 0] }), { from: "2026-10-01", to: "2026-10-31" });
    expect(tb.balanced).toBe(false);
  });

  it("exports to CSV with rupee columns and a BOM", () => {
    const tb = buildTrialBalance(accounts, new Map(), bal({ cash: [12_345, 0], sales: [0, 12_345] }), { from: "2026-10-01", to: "2026-10-31" });
    const csv = tableToCsv(trialBalanceTable(tb, "Shop"));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("123.45");
    expect(reportBodyHtml(trialBalanceTable(tb, "Shop"))).toContain("Trial balance");
  });
});

describe("ledger", () => {
  it("keeps a running balance from the opening balance", () => {
    const line = (n: number, d: number, c: number) => ({ lineId: `l${n}`, entryId: `e${n}`, date: "2026-10-0" + n, number: `JV-${n}`, voucherType: "journal", narration: "x", memo: null, debit: d, credit: c });
    const l = buildLedger(5_000, [line(1, 1_000, 0), line(2, 0, 3_000), line(3, 500, 0)]);
    expect(l.rows.map((r) => r.balance)).toEqual([6_000, 3_000, 3_500]);
    expect(l.closingBalance).toBe(3_500);
    expect(l.totalDebit).toBe(1_500);
    expect(l.totalCredit).toBe(3_000);
  });
});

describe("profit and loss", () => {
  const during = bal({ sales: [0, 100_000], sales_returns: [10_000, 0], discount_allowed: [5_000, 0], purchases: [40_000, 0], purchase_returns: [0, 4_000], other_income: [0, 2_000], round_off: [100, 0], other_expense: [8_000, 0] });

  it("nets sales, returns and discounts; applies the periodic stock method", () => {
    const pl = buildProfitLoss(accounts, during, { opening: 30_000, closing: 50_000 }, { from: "2026-10-01", to: "2026-10-31" });
    const sales = pl.sections.find((s) => s.key === "sales")!;
    expect(sales.total).toBe(85_000);
    const cogs = pl.sections.find((s) => s.key === "cogs")!;
    // purchases 40,000 - returns 4,000 = 36,000; stock rose by 20,000
    expect(cogs.total).toBe(16_000);
    expect(pl.grossProfit).toBe(69_000);
    expect(pl.netProfit).toBe(69_000 + 2_000 - 8_100);
  });

  it("works with no stock valuation", () => {
    const pl = buildProfitLoss(accounts, during, { opening: 0, closing: 0 }, { from: "2026-10-01", to: "2026-10-31" });
    expect(pl.grossProfit).toBe(85_000 - 36_000);
  });

  it("adds a comparison column", () => {
    const earlier = bal({ sales: [0, 60_000], purchases: [20_000, 0] });
    const pl = buildProfitLoss(accounts, during, { opening: 0, closing: 0 }, { from: "2026-10-01", to: "2026-10-31" }, { balances: earlier, stock: { opening: 0, closing: 0 }, from: "2026-09-01", to: "2026-09-30" });
    expect(pl.compareGrossProfit).toBe(40_000);
    expect(profitLossTable(pl, "Shop").columns).toHaveLength(3);
  });
});

describe("balance sheet", () => {
  it("balances: stock revaluation and profit carry to equity", () => {
    // capital 1,000 in cash; buy goods 400 on credit; sell 300 + 54 GST for cash; live stock worth 250.
    const balances = bal({
      capital: [0, 100_000],
      cash: [100_000 + 35_400, 0],
      purchases: [40_000, 0],
      creditors: [0, 40_000],
      sales: [0, 30_000],
      gst_out_cgst: [0, 2_700],
      gst_out_sgst: [0, 2_700],
    });
    // cash is net, not gross: fix the line so debits = credits
    const bs = buildBalanceSheet(accounts, balances, 25_000, "2026-10-31");
    expect(bs.balanced).toBe(true);
    expect(bs.stockValue).toBe(25_000);
    // profit = sales 300 - purchases 400 + stock 250 = 150
    expect(bs.profitToDate).toBe(30_000 - 40_000 + 25_000);
    expect(bs.totalAssets).toBe(135_400 + 25_000);
    expect(bs.totalLiabilities).toBe(40_000 + 5_400);
    expect(balanceSheetTable(bs, "Shop").rows.length).toBeGreaterThan(5);
  });

  it("an opening stock balance in the ledger is replaced by the live value, never counted twice", () => {
    const balances = bal({ stock: [20_000, 0], capital: [0, 20_000] });
    const bs = buildBalanceSheet(accounts, balances, 20_000, "2026-10-31");
    expect(bs.balanced).toBe(true);
    expect(bs.profitToDate).toBe(0);
    expect(bs.totalAssets).toBe(20_000);
  });
});

describe("GST ledger", () => {
  it("shows output, input and net per head", () => {
    const g = buildGstLedger(accounts, bal({ gst_out_cgst: [0, 9_000], gst_out_sgst: [0, 9_000], gst_in_cgst: [4_000, 0], gst_in_sgst: [4_000, 0], gst_out_igst: [500, 2_500] }), { from: "2026-10-01", to: "2026-10-31" }, 0);
    expect(g.output).toMatchObject({ cgst: 9_000, sgst: 9_000, igst: 2_000, total: 20_000 });
    expect(g.input.total).toBe(8_000);
    expect(g.net).toBe(12_000);
  });
});
