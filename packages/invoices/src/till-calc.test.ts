import { describe, expect, it } from "vitest";
import { billRange, cashByCategory, cashEntryTotals, countTotal, expectedCash, mergeTaxRows, tillReport } from "./till-calc";

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

  it("totals pay-in / pay-out by category; entries without one read as other", () => {
    const rows = cashByCategory([
      { amount: -5_000, category: "petty_expense" },
      { amount: -2_000, category: "petty_expense" },
      { amount: 10_000, category: "change_float" },
      { amount: -30_000, category: "owner_drawing" },
      { amount: -1_000 },
      { amount: 0, category: "other" },
    ]);
    expect(rows).toEqual([
      { category: "owner_drawing", cashIn: 0, cashOut: 30_000, count: 1 },
      { category: "change_float", cashIn: 10_000, cashOut: 0, count: 1 },
      { category: "petty_expense", cashIn: 0, cashOut: 7_000, count: 2 },
      { category: "other", cashIn: 0, cashOut: 1_000, count: 1 },
    ]);
  });

  it("adds tax rows of one GST rate together, ordered by rate", () => {
    const rows = mergeTaxRows([
      { gstRate: 18, taxable: 1_000, cgst: 90, sgst: 90, igst: 0 },
      { gstRate: 5, taxable: 2_000, cgst: 50, sgst: 50, igst: 0 },
      { gstRate: 18, taxable: 500, cgst: 45, sgst: 45, igst: 0 },
    ]);
    expect(rows).toEqual([
      { gstRate: 5, taxable: 2_000, cgst: 50, sgst: 50, igst: 0 },
      { gstRate: 18, taxable: 1_500, cgst: 135, sgst: 135, igst: 0 },
    ]);
  });

  it("finds the first and last bill number by year and sequence, not by text", () => {
    expect(billRange([{ number: "INV/26-27/0009", fy: "2026-27", seq: 9 }, { number: "INV/26-27/0010", fy: "2026-27", seq: 10 }, { number: "INV/26-27/0002", fy: "2026-27", seq: 2 }])).toEqual({
      from: "INV/26-27/0002",
      to: "INV/26-27/0010",
    });
    expect(billRange([{ number: null }, { number: null }])).toEqual({ from: null, to: null });
    // Without sequence numbers (offline slips) the numbers sort naturally.
    expect(billRange([{ number: "OFF-10" }, { number: "OFF-9" }])).toEqual({ from: "OFF-9", to: "OFF-10" });
  });

  it("Z report: discounts, voids, returns tax, tax by rate, bill range and handover differences", () => {
    const r = tillReport({
      openingCash: 100_000,
      cashEntries: [{ amount: -5_000, category: "petty_expense" }],
      payments: [{ method: "cash", amount: 105_000, source: "manual" }],
      bills: [
        { status: "paid", total: 105_000, balance: 0, number: "B/2", fy: "2026-27", seq: 2, discount: 10_000, taxBreakup: [{ gstRate: 5, taxable: 100_000, cgst: 2_500, sgst: 2_500, igst: 0 }] },
        { status: "paid", total: 52_500, balance: 0, number: "B/1", fy: "2026-27", seq: 1, discount: 0, taxBreakup: [{ gstRate: 5, taxable: 50_000, cgst: 1_250, sgst: 1_250, igst: 0 }] },
        { status: "cancelled", total: 9_900, balance: 0, number: "B/3", fy: "2026-27", seq: 3 },
      ],
      creditNotes: [{ total: 10_500, taxBreakup: [{ gstRate: 5, taxable: 10_000, cgst: 250, sgst: 250, igst: 0 }] }],
      handoverDifferences: [-3_000, 500],
    });
    expect(r.voids).toEqual({ count: 1, total: 9_900 });
    expect(r.discounts).toEqual({ total: 10_000, bills: 1 });
    expect(r.taxByRate).toEqual([{ gstRate: 5, taxable: 150_000, cgst: 3_750, sgst: 3_750, igst: 0 }]);
    expect(r.returnsTaxByRate).toEqual([{ gstRate: 5, taxable: 10_000, cgst: 250, sgst: 250, igst: 0 }]);
    expect(r.billRange).toEqual({ from: "B/1", to: "B/2" });
    expect(r.cashByCategory).toEqual([{ category: "petty_expense", cashIn: 0, cashOut: 5_000, count: 1 }]);
    // A cancelled bill is not in the range or the tax; handover differences move the expected cash.
    expect(r.cash.handoverAdjust).toBe(-2_500);
    expect(r.cash.expected).toBe(100_000 + 105_000 - 5_000 - 2_500);
  });

  it("an empty session expects just the float", () => {
    const r = tillReport({ openingCash: 50_000, cashEntries: [], payments: [], bills: [], creditNotes: [] });
    expect(r.cash.expected).toBe(50_000);
    expect(r.payments).toEqual([]);
  });
});
