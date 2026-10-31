import { describe, expect, it } from "vitest";
import { computeCreditNote, creditState, type CreditNoteCalcInput } from "./credit-note";
import { foreignToPaise, formatForeign, formatRate, normalizeRate, paiseToForeign, currencyDef } from "./currency";
import { computeInvoice, computeLine, exclusiveOf, isInterState, lineAmount, taxableOfInclusive, type LineInput } from "./gst";

// Hand-checkable money: every figure below is integer paise worked out by hand in the comment next to it.

const L = (over: Partial<LineInput> = {}): LineInput => ({ description: "Item", qty: 1, rate: 100_000, gstRate: 18, ...over });

describe("place of supply decides CGST + SGST or IGST", () => {
  it("same state (Tamil Nadu 33 → 33) is intra-state, a different state (33 → 29) inter-state", () => {
    expect(isInterState("33", "33")).toBe(false);
    expect(isInterState("33", "29")).toBe(true);
  });

  it("pads single-digit codes and ignores surrounding spaces", () => {
    // Jammu & Kashmir is 01; "1" and " 01 " are the same state.
    expect(isInterState("1", " 01 ")).toBe(false);
    expect(isInterState("7", "07")).toBe(false);
    expect(isInterState("7", "09")).toBe(true);
  });

  it("an export (place of supply 96) is inter-state: IGST only", () => {
    const t = computeInvoice([L()], { sellerState: "33", placeOfSupply: "96" });
    // ₹1,000 @ 18% = ₹180 IGST.
    expect(t).toMatchObject({ cgst: 0, sgst: 0, igst: 18_000, total: 118_000 });
  });

  it("the same bill is ₹90 + ₹90 inside the state and ₹180 IGST outside it, same grand total", () => {
    const intra = computeInvoice([L()], { sellerState: "33", placeOfSupply: "33" });
    const inter = computeInvoice([L()], { sellerState: "33", placeOfSupply: "29" });
    expect(intra).toMatchObject({ cgst: 9_000, sgst: 9_000, igst: 0, total: 118_000 });
    expect(inter).toMatchObject({ cgst: 0, sgst: 0, igst: 18_000, total: 118_000 });
  });
});

describe("paise rounding", () => {
  it("rounds CGST and SGST each to the paisa, half away from zero", () => {
    // taxable 25 paise @ 18%: each half is 2.25 → 2, so CGST 2 + SGST 2 = 4; IGST is 4.5 → 5.
    expect(computeLine(L({ rate: 25 }), false)).toMatchObject({ taxable: 25, cgst: 2, sgst: 2, igst: 0, total: 29 });
    expect(computeLine(L({ rate: 25 }), true)).toMatchObject({ taxable: 25, igst: 5, total: 30 });
    // taxable 50 paise @ 5%: each half 1.25 → 1; IGST 2.5 → 3.
    expect(computeLine(L({ rate: 50, gstRate: 5 }), false)).toMatchObject({ cgst: 1, sgst: 1 });
    expect(computeLine(L({ rate: 50, gstRate: 5 }), true)).toMatchObject({ igst: 3 });
  });

  it("multiplies 3-decimal quantities without float drift", () => {
    // 1.005 kg × ₹100.00 = ₹100.50 exactly (1.005 × 10000 in floats is 10049.999…).
    expect(lineAmount(1.005, 10_000)).toBe(10_050);
    // 0.333 m × ₹3.00 = 99.9 paise → 100.
    expect(lineAmount(0.333, 300)).toBe(100);
    // 2.5 × ₹0.01 = 2.5 paise → 3 (half up).
    expect(lineAmount(2.5, 1)).toBe(3);
  });

  it("totals are the sum of the rounded lines, never a re-rounding of the whole", () => {
    // Three lines of 25 paise @ 18% intra: each line CGST 2 / SGST 2, total tax 12 (not round(75 × 18%) = 14).
    const t = computeInvoice([L({ rate: 25 }), L({ rate: 25 }), L({ rate: 25 })], { sellerState: "33", placeOfSupply: "33", roundToRupee: false });
    expect(t).toMatchObject({ taxable: 75, cgst: 6, sgst: 6, total: 87, roundOff: 0 });
    expect(t.taxBreakup).toEqual([{ gstRate: 18, taxable: 75, cgst: 6, sgst: 6, igst: 0 }]);
  });

  it("rounds the grand total to the rupee and records the round-off both ways", () => {
    // ₹10.49 taxable @ 0% → round-off −49 paise, total ₹10.
    expect(computeInvoice([L({ rate: 1_049, gstRate: 0 })], { sellerState: "33", placeOfSupply: "33" })).toMatchObject({ roundOff: -49, total: 1_000 });
    // ₹10.50 → +50 paise, total ₹11.
    expect(computeInvoice([L({ rate: 1_050, gstRate: 0 })], { sellerState: "33", placeOfSupply: "33" })).toMatchObject({ roundOff: 50, total: 1_100 });
  });

  it("takes GST out of a tax-inclusive price: ₹118 at 18% is ₹100 + ₹9 + ₹9", () => {
    expect(taxableOfInclusive(11_800, 18)).toBe(10_000);
    expect(exclusiveOf(11_800, 18, true)).toBe(10_000);
    expect(computeLine(L({ rate: 10_000, inclusiveTotal: 11_800 }), false)).toMatchObject({ taxable: 10_000, cgst: 900, sgst: 900, total: 11_800 });
    // ₹100 at 5% inter-state: taxable round(10000 / 1.05) = 9524, IGST the remaining 476.
    expect(computeLine(L({ rate: 9_524, gstRate: 5, inclusiveTotal: 10_000 }), true)).toMatchObject({ taxable: 9_524, igst: 476, total: 10_000 });
    // An odd tax paisa goes to CGST: ₹1 at 3% → taxable 97, tax 3 → CGST 2, SGST 1.
    expect(computeLine(L({ rate: 97, gstRate: 3, inclusiveTotal: 100 }), false)).toMatchObject({ taxable: 97, cgst: 2, sgst: 1, total: 100 });
  });
});

describe("exempt / nil-rated (0%) lines", () => {
  it("carry no tax and keep their own row in the tax breakup", () => {
    const t = computeInvoice([L({ rate: 50_000, gstRate: 0 }), L({ rate: 100_000, gstRate: 5 })], { sellerState: "33", placeOfSupply: "33" });
    // ₹500 exempt + ₹1,000 @ 5% (₹25 + ₹25) = ₹1,550.
    expect(t).toMatchObject({ taxable: 150_000, cgst: 2_500, sgst: 2_500, total: 155_000 });
    expect(t.taxBreakup).toEqual([
      { gstRate: 0, taxable: 50_000, cgst: 0, sgst: 0, igst: 0 },
      { gstRate: 5, taxable: 100_000, cgst: 2_500, sgst: 2_500, igst: 0 },
    ]);
  });

  it("0% stays 0% even with a tax-inclusive price", () => {
    expect(computeLine(L({ rate: 5_000, gstRate: 0, inclusiveTotal: 5_000 }), true)).toMatchObject({ taxable: 5_000, igst: 0, total: 5_000 });
    expect(exclusiveOf(5_000, 0, true)).toBe(5_000);
  });

  it("the tax breakup always adds up to the invoice totals", () => {
    const lines = [L({ rate: 33_333, gstRate: 12 }), L({ rate: 777, gstRate: 28, qty: 3 }), L({ rate: 4_999, gstRate: 0 }), L({ rate: 12_345, gstRate: 12, discount: 345 })];
    for (const pos of ["33", "29"]) {
      const t = computeInvoice(lines, { sellerState: "33", placeOfSupply: pos });
      const sum = (k: "taxable" | "cgst" | "sgst" | "igst") => t.taxBreakup.reduce((s, r) => s + r[k], 0);
      expect([sum("taxable"), sum("cgst"), sum("sgst"), sum("igst")]).toEqual([t.taxable, t.cgst, t.sgst, t.igst]);
      expect(t.total).toBe(t.taxable + t.cgst + t.sgst + t.igst + t.roundOff);
      expect(t.subtotal - t.discount).toBe(t.taxable);
    }
  });
});

describe("credit notes against a bill", () => {
  // One line: 3 × ₹100 @ 18% intra-state = ₹300 + ₹27 + ₹27 = ₹354.
  const bill = computeInvoice([L({ qty: 3, rate: 10_000, itemId: "it1" })], { sellerState: "33", placeOfSupply: "33" });
  const input = (over: Partial<CreditNoteCalcInput>): CreditNoteCalcInput => ({
    invoiceLines: bill.lines,
    invoiceTotal: bill.total,
    interState: false,
    priorCreditedTotal: 0,
    prior: [],
    requests: [],
    allowValue: true,
    restockByDefault: true,
    ...over,
  });

  it("returning 1 of 3 credits exactly a third: ₹100 + ₹9 + ₹9 = ₹118", () => {
    const n = computeCreditNote(input({ requests: [{ line: 0, qty: 1 }] }));
    expect(n.lines[0]).toMatchObject({ kind: "qty", qty: 1, taxable: 10_000, cgst: 900, sgst: 900, igst: 0, total: 11_800, restock: true });
    expect(n.total).toBe(11_800);
    expect(n.completesInvoice).toBe(false);
  });

  it("a price correction of ₹10 (before GST) adds ₹0.90 + ₹0.90 and rounds the note to ₹12", () => {
    const n = computeCreditNote(input({ requests: [{ line: 0, taxable: 1_000 }] }));
    expect(n.lines[0]).toMatchObject({ kind: "value", qty: 0, taxable: 1_000, cgst: 90, sgst: 90, restock: false });
    expect(n.totals).toMatchObject({ taxable: 1_000, cgst: 90, sgst: 90, roundOff: 20, total: 1_200 });
  });

  it("an inter-state price correction credits IGST only", () => {
    const inter = computeInvoice([L({ qty: 3, rate: 10_000 })], { sellerState: "33", placeOfSupply: "29" });
    const n = computeCreditNote(input({ invoiceLines: inter.lines, invoiceTotal: inter.total, interState: true, requests: [{ line: 0, taxable: 1_000 }] }));
    expect(n.lines[0]).toMatchObject({ taxable: 1_000, cgst: 0, sgst: 0, igst: 180 });
  });

  it("the note that clears the bill nets the bill to zero, round-off included", () => {
    // ₹10.49 @ 0%: billed ₹10 after a −49 paise round-off.
    const odd = computeInvoice([L({ rate: 1_049, gstRate: 0 })], { sellerState: "33", placeOfSupply: "33" });
    expect(odd.total).toBe(1_000);
    const n = computeCreditNote(input({ invoiceLines: odd.lines, invoiceTotal: odd.total, requests: [{ line: 0, qty: 1 }] }));
    expect(n.completesInvoice).toBe(true);
    expect(n.total).toBe(1_000);
    expect(n.totals.roundOff).toBe(-49);
  });

  it("three single returns of a 3-unit line add up to the bill to the paisa", () => {
    // ₹1.00 @ 5% intra per unit, 3 units: taxable 300, CGST/SGST round(7.5) = 8 each.
    const b = computeInvoice([L({ qty: 3, rate: 100, gstRate: 5 })], { sellerState: "33", placeOfSupply: "33", roundToRupee: false });
    expect(b.lines[0]).toMatchObject({ taxable: 300, cgst: 8, sgst: 8 });
    const prior: CreditNoteCalcInput["prior"][number][] = [];
    let credited = 0;
    for (let i = 0; i < 3; i++) {
      const n = computeCreditNote({ ...input({ invoiceLines: b.lines, invoiceTotal: b.total, prior, priorCreditedTotal: credited, roundToRupee: false }), requests: [{ line: 0, qty: 1 }] });
      prior.push(...n.lines);
      credited += n.total;
    }
    const sum = (k: "taxable" | "cgst" | "sgst") => prior.reduce((s, l) => s + l[k], 0);
    expect([sum("taxable"), sum("cgst"), sum("sgst")]).toEqual([300, 8, 8]);
    expect(credited).toBe(b.total);
    expect(creditState(b.lines, prior)[0]).toMatchObject({ remainingQty: 0, returnedQty: 3, remaining: { total: 0 } });
  });

  it("never credits more than is left on the bill", () => {
    expect(() => computeCreditNote(input({ requests: [{ line: 0, qty: 4 }] }))).toThrow(/only 3/);
    expect(() => computeCreditNote(input({ requests: [{ line: 0, taxable: 30_001 }] }))).toThrow(/at most 30000 paise/);
    expect(() => computeCreditNote(input({ requests: [{ line: 0, qty: 2 }, { line: 0, qty: 2 }] }))).toThrow(/only 1/);
    expect(() => computeCreditNote(input({ requests: [{ line: 0, taxable: 10.5 }] }))).toThrow(/whole paise/);
  });
});

describe("foreign currency on export bills", () => {
  it("converts minor units at a 4-decimal rate, half away from zero", () => {
    // $10.00 at ₹83.25 = ₹832.50.
    expect(foreignToPaise(1_000, 83.25, "USD")).toBe(83_250);
    // $0.01 at ₹83.2475 = 83.2475 paise → 83.
    expect(foreignToPaise(1, 83.2475, "USD")).toBe(83);
    // ¥1,000 (no minor unit) at ₹0.5612 = ₹561.20.
    expect(foreignToPaise(1_000, 0.5612, "JPY")).toBe(56_120);
    // KWD 1.000 (3 digits) at ₹270.10 = ₹270.10.
    expect(foreignToPaise(1_000, 270.1, "KWD")).toBe(27_010);
  });

  it("converts rupees back to the bill's currency", () => {
    // ₹832.50 at ₹83.25 = $10.00; ₹100 at ₹83.25 = $1.2012… → 120 cents.
    expect(paiseToForeign(83_250, 83.25, "USD")).toBe(1_000);
    expect(paiseToForeign(10_000, 83.25, "USD")).toBe(120);
    expect(paiseToForeign(10_000, 0, "USD")).toBe(0);
  });

  it("accepts only positive, finite, sane exchange rates", () => {
    expect(normalizeRate("83.24756")).toBe(83.2476);
    expect(normalizeRate(" 1 ")).toBe(1);
    for (const bad of [0, -1, "abc", Number.NaN, Number.POSITIVE_INFINITY, 100_001, null, undefined]) expect(normalizeRate(bad)).toBeNull();
    expect(formatRate(83.25)).toBe("83.25");
  });

  it("formats amounts in the currency's own minor unit", () => {
    expect(formatForeign(123_456, "USD")).toBe("USD 1,234.56");
    expect(formatForeign(1_234, "JPY")).toBe("JPY 1,234");
    expect(formatForeign(1_005, "KWD")).toBe("KWD 1.005");
    expect(formatForeign(-5, "USD")).toBe("−USD 0.05");
    expect(currencyDef("XYZ")).toBeNull();
  });
});
