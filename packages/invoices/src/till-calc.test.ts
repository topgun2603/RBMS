import { describe, expect, it } from "vitest";
import { cashEntryTotals, countTotal, expectedCash, tillReport } from "./till-calc";

describe("till maths", () => {
  it("counts notes and coins in paise, ignoring unknown denominations and bad counts", () => {
    expect(countTotal({ 2000: 1, 500: 3, 10: 4, 1: 7 })).toBe((2000 + 1500 + 40 + 7) * 100);
    expect(countTotal({ 3: 5, 100: -1, 50: 1.5, 20: 2 })).toBe(4000);
    expect(countTotal(null)).toBe(0);
  });

  it("expected cash = opening + cash sales − cash refunds + cash in − cash out", () => {
    const { cashIn, cashOut } = cashEntryTotals([{ amount: 20_000 }, { amount: -5_000 }, { amount: -1_000 }]);
    expect({ cashIn, cashOut }).toEqual({ cashIn: 20_000, cashOut: 6_000 });
    expect(expectedCash({ openingCash: 100_000, cashSales: 250_000, cashRefunds: 30_000, cashIn, cashOut })).toBe(334_000);
  });

  it("X report: money in and out by method, bills, notes, what was left on credit", () => {
    const r = tillReport({
      openingCash: 100_000,
      cashEntries: [{ amount: -5_000 }, { amount: 10_000 }],
      payments: [
        { method: "cash", amount: 120_000, source: "manual" },
        { method: "cash", amount: 30_000, source: "manual" },
        { method: "upi", amount: 50_000, source: "manual" },
        { method: "cash", amount: -20_000, source: "refund" },
        { method: "upi", amount: -10_000, source: "refund" },
      ],
      bills: [
        { status: "paid", total: 150_000, balance: 0 },
        { status: "partially_paid", total: 80_000, balance: 30_000 },
        { status: "cancelled", total: 9_900, balance: 0 },
      ],
      creditNotes: [{ total: 20_000 }, { total: 10_000 }],
    });
    expect(r.bills).toEqual({ count: 2, total: 230_000, cancelled: 1 });
    expect(r.payments).toEqual([
      { method: "cash", amount: 150_000, count: 2 },
      { method: "upi", amount: 50_000, count: 1 },
    ]);
    expect(r.refunds).toEqual([
      { method: "cash", amount: 20_000, count: 1 },
      { method: "upi", amount: 10_000, count: 1 },
    ]);
    expect(r.creditNotes).toEqual({ count: 2, total: 30_000 });
    expect(r.onCredit).toBe(30_000);
    expect(r.collected).toBe(200_000);
    expect(r.refunded).toBe(30_000);
    expect(r.cash).toEqual({ opening: 100_000, sales: 150_000, refunds: 20_000, cashIn: 10_000, cashOut: 5_000, expected: 235_000 });
  });

  it("an empty session expects just the float", () => {
    const r = tillReport({ openingCash: 50_000, cashEntries: [], payments: [], bills: [], creditNotes: [] });
    expect(r.cash.expected).toBe(50_000);
    expect(r.payments).toEqual([]);
  });
});
