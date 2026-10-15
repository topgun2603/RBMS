import { describe, expect, it } from "vitest";
import { closeDay, expectedCash, holdBill, dropHold, openDay, recordSale, salesByMethod, pushRecent, toggleFavourite } from "./storage";
import { countTotal, DENOMINATIONS, EMPTY_TENDERS, fitPayments, paymentsFor, quickNotes, settle } from "./tender";

const ok = { upiConfirmed: true, hasCustomer: true, creditAllowed: true };

describe("split tender", () => {
  it("cash over the bill gives change", () => {
    const s = settle(84_700, { ...EMPTY_TENDERS, cash: 100_000 }, ok);
    expect(s).toMatchObject({ ok: true, cashApplied: 84_700, change: 15_300, remaining: 0, received: 84_700 });
  });

  it("short cash is not ok", () => {
    const s = settle(84_700, { ...EMPTY_TENDERS, cash: 50_000 }, ok);
    expect(s.ok).toBe(false);
    expect(s.remaining).toBe(34_700);
    expect(s.problems).toContain("short");
  });

  it("splits cash + UPI + card; change only from cash", () => {
    const s = settle(250_000, { cash: 60_000, upi: 100_000, card: 100_000, credit: 0 }, ok);
    expect(s).toMatchObject({ ok: true, nonCash: 200_000, cashApplied: 50_000, change: 10_000 });
  });

  it("UPI + card can't exceed the bill", () => {
    const s = settle(10_000, { ...EMPTY_TENDERS, upi: 8_000, card: 5_000 }, ok);
    expect(s.problems).toContain("overNonCash");
    expect(s.ok).toBe(false);
  });

  it("UPI must be confirmed as received", () => {
    const s = settle(10_000, { ...EMPTY_TENDERS, upi: 10_000 }, { ...ok, upiConfirmed: false });
    expect(s.problems).toEqual(["upiUnconfirmed"]);
  });

  it("credit needs a saved customer and the credit book", () => {
    const t = { ...EMPTY_TENDERS, cash: 4_000, credit: 6_000 };
    expect(settle(10_000, t, ok)).toMatchObject({ ok: true, credit: 6_000, received: 4_000, remaining: 0 });
    expect(settle(10_000, t, { ...ok, hasCustomer: false }).problems).toContain("creditNeedsCustomer");
    expect(settle(10_000, t, { ...ok, creditAllowed: false }).problems).toContain("creditUnavailable");
  });

  it("nothing to pay is flagged", () => {
    expect(settle(0, EMPTY_TENDERS, ok).problems).toContain("nothingToPay");
  });

  it("records UPI and card first, then the cash kept (after change)", () => {
    const t = { cash: 60_000, upi: 100_000, card: 100_000, credit: 0 };
    const s = settle(250_000, t, ok);
    expect(paymentsFor(s, t, { upi: " UTR123 ", card: "" })).toEqual([
      { method: "upi", amount: 100_000, reference: "UTR123" },
      { method: "card", amount: 100_000 },
      { method: "cash", amount: 50_000 },
    ]);
  });

  it("fits payments to the issued bill's balance", () => {
    const planned = [
      { method: "upi", amount: 50_000 },
      { method: "cash", amount: 40_000 },
    ];
    expect(fitPayments(planned, 90_000)).toEqual(planned);
    expect(fitPayments(planned, 85_000)).toEqual([
      { method: "upi", amount: 50_000 },
      { method: "cash", amount: 35_000 },
    ]);
    expect(fitPayments(planned, 30_000)).toEqual([{ method: "upi", amount: 30_000 }]);
    expect(fitPayments(planned, 0)).toEqual([]);
  });
});

describe("quick cash notes", () => {
  it("offers exact, then the next round amounts above it", () => {
    expect(quickNotes(18_750)).toEqual([18_750, 19_000, 20_000, 50_000, 200_000]);
    expect(quickNotes(20_000)).toEqual([20_000, 50_000, 200_000]);
    expect(quickNotes(123_400, 3)).toEqual([123_400, 124_000, 125_000]);
    expect(quickNotes(0)).toEqual([]);
  });
});

describe("denomination counter", () => {
  it("lists ₹2000 … ₹1 largest first", () => {
    expect(DENOMINATIONS).toEqual([2000, 500, 200, 100, 50, 20, 10, 5, 2, 1]);
  });

  it("totals a count in paise and ignores bad counts", () => {
    expect(countTotal({})).toBe(0);
    expect(countTotal({ 500: 3, 100: 2, 10: 7, 1: 4 })).toBe((1500 + 200 + 70 + 4) * 100);
    expect(countTotal({ 2000: 1, 50: -2, 20: 1.9 })).toBe((2000 + 20) * 100);
  });
});

describe("till day", () => {
  const day = openDay("2026-10-16", 200_000, "Kavitha", new Date("2026-10-16T03:30:00Z"));
  const withSales = recordSale(
    recordSale(day, { id: "1", number: "A/1", total: 84_700, at: "", payments: [{ method: "cash", amount: 84_700 }], credit: 0, customer: "Walk-in" }),
    { id: "2", number: "A/2", total: 250_000, at: "", payments: [{ method: "upi", amount: 100_000 }, { method: "cash", amount: 50_000 }], credit: 100_000, customer: "Ravi" },
  )!;

  it("sums this counter's sales by method", () => {
    expect(salesByMethod(withSales)).toEqual({ cash: 134_700, upi: 100_000, credit: 100_000 });
  });

  it("expects opening + cash sales + cash moves in the drawer", () => {
    expect(expectedCash(withSales)).toBe(334_700);
    expect(expectedCash({ ...withSales, cashMoves: [{ at: "", amount: -20_000, note: "tea" }] })).toBe(314_700);
  });

  it("closes with the counted cash and keeps the expected amount", () => {
    const closed = closeDay(withSales, { 2000: 1, 500: 2, 200: 1, 100: 1, 20: 2, 5: 1, 2: 1 }, "ok");
    expect(closed.closingCash).toBe(334_700);
    expect(closed.expectedCash).toBe(334_700);
    expect(closed.closedAt).toBeTruthy();
    expect(recordSale(closed, { id: "3", number: null, total: 1, at: "", payments: [], credit: 0, customer: "" })).toBe(closed);
    expect(recordSale(null, { id: "3", number: null, total: 1, at: "", payments: [], credit: 0, customer: "" })).toBeNull();
  });
});

describe("holds, recent and favourites", () => {
  const p = { itemId: "a", name: "A", unit: "pcs", price: 100, taxInclusive: false, gstRate: 0 };
  it("holds newest first and drops by id", () => {
    const one = holdBill([], { name: "Bill 1", note: "", lines: [], customer: { kind: "none" }, total: 100 });
    const two = holdBill(one, { name: "Bill 2", note: "n", lines: [], customer: { kind: "none" }, total: 200 });
    expect(two.map((h) => h.name)).toEqual(["Bill 2", "Bill 1"]);
    expect(dropHold(two, two[0]!.id).map((h) => h.name)).toEqual(["Bill 1"]);
  });

  it("keeps recent items unique, newest first", () => {
    const r = pushRecent(pushRecent(pushRecent([], p), { ...p, itemId: "b" }), p);
    expect(r.map((x) => x.itemId)).toEqual(["a", "b"]);
  });

  it("toggles favourites", () => {
    const f = toggleFavourite([], p);
    expect(f).toHaveLength(1);
    expect(toggleFavourite(f, p)).toHaveLength(0);
  });
});
