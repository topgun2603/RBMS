import { describe, expect, it } from "vitest";
import { computeCreditNote } from "./credit-note";
import { computeInvoice, computeLine, exclusiveOf, type LineInput } from "./gst";
import {
  APPAREL_FOOTWEAR_GST_RULE as RULE,
  deadBandOf,
  effectiveGstRate,
  gstRateAtPrice,
  gstRateForInclusive,
  isGstRateRule,
  lineGstRate,
  priceBandRuleForHsn,
} from "./rate-rule";

const TN = "33";

describe("effectiveGstRate (taxable value per piece)", () => {
  it("is 5% up to and including ₹2,500.00, 18% from ₹2,500.01", () => {
    expect(effectiveGstRate(RULE, 249_999)).toBe(5);
    expect(effectiveGstRate(RULE, 250_000)).toBe(5);
    expect(effectiveGstRate(RULE, 250_001)).toBe(18);
    expect(effectiveGstRate(RULE, 1)).toBe(5);
  });
  it("passes a plain rate through", () => {
    expect(effectiveGstRate(12, 9_999_999)).toBe(12);
    expect(effectiveGstRate(null, 100)).toBe(0);
  });
  it("tests per piece, not per line, exactly", () => {
    expect(effectiveGstRate(RULE, 750_000, 3)).toBe(5); // 3 × ₹2,500.00
    expect(effectiveGstRate(RULE, 750_001, 3)).toBe(18); // ₹2,500.0033 a piece
    expect(effectiveGstRate(RULE, 500_000, 2.5)).toBe(5); // 2.5 sets at ₹2,000
  });
});

describe("gstRateForInclusive (MRP-style prices)", () => {
  it("₹2,625.00 inclusive is exactly ₹2,500 taxable at 5%", () => {
    expect(gstRateForInclusive(RULE, 262_500)).toEqual({ rate: 5, taxable: 250_000, deadBand: false });
  });
  it("₹2,625.01 is past the 5% ceiling: 18%, in the dead band", () => {
    expect(gstRateForInclusive(RULE, 262_501)).toEqual({ rate: 18, taxable: 222_458, deadBand: true });
  });
  it("₹2,800 has no consistent rate: charged at 18% and flagged", () => {
    const r = gstRateForInclusive(RULE, 280_000);
    expect(r.rate).toBe(18);
    expect(r.deadBand).toBe(true);
    expect(r.taxable).toBe(237_288);
  });
  it("₹2,950.00 is still the dead band (₹2,500.00 taxable at 18% would qualify for 5%)", () => {
    expect(gstRateForInclusive(RULE, 295_000)).toEqual({ rate: 18, taxable: 250_000, deadBand: true });
  });
  it("₹2,950.01 and above is cleanly 18%", () => {
    expect(gstRateForInclusive(RULE, 295_001)).toEqual({ rate: 18, taxable: 250_001, deadBand: false });
    expect(gstRateForInclusive(RULE, 349_900).deadBand).toBe(false);
  });
  it("below the band it is 5%", () => {
    expect(gstRateForInclusive(RULE, 99_900)).toEqual({ rate: 5, taxable: 95_143, deadBand: false });
  });
  it("tests per piece on a multi-piece line", () => {
    expect(gstRateForInclusive(RULE, 525_000, 2).rate).toBe(5); // 2 × ₹2,625
    expect(gstRateForInclusive(RULE, 525_001, 2).rate).toBe(18);
  });
  it("dead band bounds", () => {
    expect(deadBandOf(RULE)).toEqual({ from: 262_500, to: 295_000 });
    expect(deadBandOf(null)).toBeNull();
  });
  it("gstRateAtPrice picks the basis", () => {
    expect(gstRateAtPrice(RULE, 260_000, true)).toBe(5);
    expect(gstRateAtPrice(RULE, 260_000, false)).toBe(18);
    expect(gstRateAtPrice(5, 900_000, false)).toBe(5);
  });
});

describe("isGstRateRule", () => {
  it("accepts the apparel rule and rejects malformed ones", () => {
    expect(isGstRateRule(RULE)).toBe(true);
    expect(isGstRateRule({ kind: "price-band", threshold: 250_000, below: 18, above: 5 })).toBe(false);
    expect(isGstRateRule({ kind: "price-band", threshold: 2500.5, below: 5, above: 18 })).toBe(false);
    expect(isGstRateRule({ kind: "price-band", threshold: 250_000, below: 7, above: 18 })).toBe(false);
    expect(isGstRateRule({ kind: "flat" })).toBe(false);
    expect(isGstRateRule(null)).toBe(false);
  });
});

describe("computeLine with a rule", () => {
  const shirt: LineInput = { description: "Linen shirt", qty: 1, rate: 250_000, gstRate: 5, gstRule: RULE };

  it("₹2,500.00 taxable is 5%", () => {
    expect(computeLine(shirt, false)).toMatchObject({ gstRate: 5, taxable: 250_000, cgst: 6_250, sgst: 6_250, total: 262_500 });
  });
  it("₹2,500.01 taxable is 18%, whatever gstRate the client sent", () => {
    expect(computeLine({ ...shirt, rate: 250_001 }, false)).toMatchObject({ gstRate: 18, taxable: 250_001, cgst: 22_500, sgst: 22_500 });
  });
  it("a discount that brings the piece under ₹2,500 makes it 5%", () => {
    // ₹2,999 kurta, ₹600 off on the bill → ₹2,399 taxable.
    const l = computeLine({ ...shirt, rate: 299_900, gstRate: 18, discount: 60_000 }, false);
    expect(l).toMatchObject({ gstRate: 5, taxable: 239_900, cgst: 5_998, sgst: 5_998 });
  });
  it("a discount that stops one paisa short keeps it at 18%", () => {
    expect(computeLine({ ...shirt, rate: 300_000, discount: 49_999 }, true)).toMatchObject({ gstRate: 18, taxable: 250_001, igst: 45_000 });
  });
  it("tax-inclusive lines are banded on the inclusive total", () => {
    expect(computeLine({ ...shirt, rate: exclusiveOf(262_500, 5, true), inclusiveTotal: 262_500 }, false)).toMatchObject({ gstRate: 5, taxable: 250_000, total: 262_500 });
    expect(computeLine({ ...shirt, rate: exclusiveOf(349_900, 18, true), inclusiveTotal: 349_900 }, false)).toMatchObject({ gstRate: 18, taxable: 296_525, total: 349_900 });
    // ₹3,200 MRP with ₹600 off → ₹2,600 charged: 5%.
    expect(computeLine({ ...shirt, rate: exclusiveOf(320_000, 18, true), discount: 50_847, inclusiveTotal: 260_000 }, false)).toMatchObject({ gstRate: 5, taxable: 247_619, total: 260_000 });
  });
  it("lineGstRate agrees with computeLine", () => {
    expect(lineGstRate({ ...shirt, rate: 299_900, discount: 60_000 })).toBe(5);
    expect(lineGstRate({ qty: 1, rate: 999_999, gstRate: 12 })).toBe(12);
  });
  it("lines without a rule are unchanged", () => {
    const plain: LineInput = { description: "Saree", qty: 1, rate: 400_000, gstRate: 5 };
    expect({ ...computeLine({ ...plain, gstRule: null }, false), gstRule: undefined }).toEqual({ ...computeLine(plain, false), gstRule: undefined });
    expect(computeLine(plain, false).gstRate).toBe(5);
  });
});

describe("invoices with mixed bands", () => {
  const lines: LineInput[] = [
    { description: "Cotton kurta", hsn: "6211", qty: 2, rate: 120_000, gstRate: 5, gstRule: RULE },
    { description: "Silk sherwani", hsn: "6203", qty: 1, rate: 800_000, gstRate: 5, gstRule: RULE },
    { description: "Leather sandals", hsn: "6403", qty: 1, rate: 280_000, discount: 40_000, gstRate: 18, gstRule: RULE },
    { description: "Gift box", hsn: "4819", qty: 1, rate: 10_000, gstRate: 12 },
  ];
  const t = computeInvoice(lines, { sellerState: TN, placeOfSupply: TN });

  it("taxes each line at its own band", () => {
    expect(t.lines.map((l) => l.gstRate)).toEqual([5, 18, 5, 12]);
    expect(t.taxable).toBe(240_000 + 800_000 + 240_000 + 10_000);
    expect(t.cgst).toBe(6_000 + 72_000 + 6_000 + 600);
    expect(t.total).toBe(t.taxable + t.cgst + t.sgst + t.roundOff);
  });
  it("rate-wise breakup groups by the effective rate", () => {
    expect(t.taxBreakup).toEqual([
      { gstRate: 5, taxable: 480_000, cgst: 12_000, sgst: 12_000, igst: 0 },
      { gstRate: 12, taxable: 10_000, cgst: 600, sgst: 600, igst: 0 },
      { gstRate: 18, taxable: 800_000, cgst: 72_000, sgst: 72_000, igst: 0 },
    ]);
  });
  it("a credit note credits at the original line's rate", () => {
    const cn = computeCreditNote({
      invoiceLines: t.lines,
      prior: [],
      requests: [{ line: 1, qty: 1 }, { line: 2, qty: 1 }],
      interState: false,
      invoiceTotal: t.total,
      priorCreditedTotal: 0,
      allowValue: false,
      restockByDefault: true,
    });
    expect(cn.lines.map((l) => l.gstRate)).toEqual([18, 5]);
    expect(cn.lines[0]).toMatchObject({ taxable: 800_000, cgst: 72_000, sgst: 72_000 });
  });
});

describe("priceBandRuleForHsn", () => {
  it("covers chapters 61, 62, 63 (with exclusions) and footwear 6401–6405", () => {
    for (const h of ["61", "6109", "62034200", "6214", "6307", "63026010", "6401", "6403", "640510"]) expect(priceBandRuleForHsn(h), h).toBe(RULE);
    for (const h of ["6309", "63053200", "63053300", "6406", "64", "5007", "4819", "", null, "61a"]) expect(priceBandRuleForHsn(h), String(h)).toBeNull();
  });
});
