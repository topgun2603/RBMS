import { describe, expect, it } from "vitest";
import { computeInvoice, computeLine, exclusiveOf, isGstRate, isInterState, lineAmount, taxableOfInclusive, type LineInput } from "./gst";

const TN = "33";
const KA = "29";

describe("isInterState", () => {
  it("compares 2-digit state codes", () => {
    expect(isInterState("33", "33")).toBe(false);
    expect(isInterState("33", "29")).toBe(true);
    expect(isInterState("7", "07")).toBe(false);
  });
});

describe("lineAmount", () => {
  it("multiplies fractional quantities exactly", () => {
    expect(lineAmount(2.5, 12050)).toBe(30125); // 2.5 m × ₹120.50 = ₹301.25
    expect(lineAmount(1.005, 100)).toBe(101); // float 1.005*100 = 100.49999…; thousandths keep it 100.5 → 101
    expect(lineAmount(0.333, 300)).toBe(100); // 99.9 → 100
    expect(lineAmount(3, 0)).toBe(0);
  });
});

describe("computeLine", () => {
  const line: LineInput = { description: "Silk saree", qty: 2.5, rate: 12050, gstRate: 5 };

  it("splits CGST/SGST for intra-state", () => {
    const l = computeLine(line, false);
    expect(l).toMatchObject({ amount: 30125, discount: 0, taxable: 30125, cgst: 753, sgst: 753, igst: 0, total: 31631 });
  });

  it("charges IGST for inter-state", () => {
    const l = computeLine(line, true);
    expect(l).toMatchObject({ taxable: 30125, cgst: 0, sgst: 0, igst: 1506, total: 31631 });
  });

  it("applies the discount before tax", () => {
    const l = computeLine({ ...line, qty: 1, rate: 100000, discount: 10000, gstRate: 12 }, false);
    expect(l).toMatchObject({ amount: 100000, discount: 10000, taxable: 90000, cgst: 5400, sgst: 5400, total: 100800 });
  });

  it("handles 0.25% without float error", () => {
    const l = computeLine({ description: "Rough diamond", qty: 1, rate: 100000, gstRate: 0.25 }, false);
    expect(l).toMatchObject({ cgst: 125, sgst: 125 });
    expect(computeLine({ description: "x", qty: 1, rate: 100000, gstRate: 0.25 }, true).igst).toBe(250);
  });

  it("keeps the input fields", () => {
    const l = computeLine({ ...line, hsn: "5007", unit: "m" }, false);
    expect(l).toMatchObject({ description: "Silk saree", hsn: "5007", unit: "m", qty: 2.5, rate: 12050, gstRate: 5 });
  });

  it("carries the saved item id through", () => {
    const itemId = "4b0c2a4e-8f0e-4c1a-9d5e-0f6a1b2c3d4e";
    expect(computeLine({ ...line, itemId }, false).itemId).toBe(itemId);
    expect(computeInvoice([{ ...line, itemId }], { sellerState: "33", placeOfSupply: "29" }).lines[0]!.itemId).toBe(itemId);
    expect("itemId" in computeLine(line, false)).toBe(false);
  });

  describe("inclusiveTotal (tax-inclusive prices)", () => {
    const mrp: LineInput = { description: "Saree", qty: 1, rate: exclusiveOf(99900, 5, true), gstRate: 5 };

    it("forward from the rounded exclusive rate drifts a paisa (why inclusiveTotal exists)", () => {
      expect(computeLine(mrp, false).total).toBe(99901);
      expect(computeLine({ ...mrp, rate: exclusiveOf(89910, 5, true) }, false).total).toBe(89911);
    });

    it("takes GST out of the charged amount so the total is exact", () => {
      expect(computeLine({ ...mrp, inclusiveTotal: 99900 }, false)).toMatchObject({ amount: 95143, taxable: 95143, cgst: 2379, sgst: 2378, igst: 0, total: 99900 });
      expect(computeLine({ ...mrp, inclusiveTotal: 99900 }, true)).toMatchObject({ taxable: 95143, cgst: 0, sgst: 0, igst: 4757, total: 99900 });
    });

    it("keeps taxable = amount − discount with a discount", () => {
      const l = computeLine({ ...mrp, qty: 3, rate: 95143, discount: 4752, inclusiveTotal: 3 * 99900 - 4990 }, false);
      expect(l.total).toBe(3 * 99900 - 4990);
      expect(l.amount - (l.discount ?? 0)).toBe(l.taxable);
      expect(l.taxable + l.cgst + l.sgst).toBe(l.total);
    });

    it("0% and 0.25% rates", () => {
      expect(computeLine({ description: "x", qty: 1, rate: 500, gstRate: 0, inclusiveTotal: 500 }, false)).toMatchObject({ taxable: 500, cgst: 0, sgst: 0, total: 500 });
      expect(computeLine({ description: "x", qty: 1, rate: 99751, gstRate: 0.25, inclusiveTotal: 100000 }, false)).toMatchObject({ taxable: 99751, total: 100000 });
      expect(taxableOfInclusive(100000, 0.25)).toBe(99751);
    });

    it("an invoice of inclusive lines totals the sum charged", () => {
      const prices = [99900, 89910, 49900, 1999];
      const inv = computeInvoice(
        prices.map((p) => ({ description: "x", qty: 1, rate: exclusiveOf(p, 5, true), gstRate: 5 as const, inclusiveTotal: p })),
        { sellerState: "33", placeOfSupply: "33", roundToRupee: false },
      );
      expect(inv.total).toBe(prices.reduce((a, b) => a + b, 0));
      expect(inv.taxBreakup[0]!.taxable + inv.taxBreakup[0]!.cgst + inv.taxBreakup[0]!.sgst).toBe(inv.total);
    });
  });
});

describe("computeInvoice", () => {
  const lines: LineInput[] = [
    { description: "Cotton shirt", hsn: "6205", qty: 2, rate: 50000, gstRate: 5 },
    { description: "Silk saree", hsn: "5007", qty: 1, rate: 150000, discount: 10000, gstRate: 12 },
    { description: "Tailoring", hsn: "998821", qty: 3, rate: 20000, gstRate: 18 },
  ];

  it("totals multiple rates with a tax breakup (intra-state)", () => {
    const t = computeInvoice(lines, { sellerState: TN, placeOfSupply: TN });
    expect(t).toMatchObject({
      subtotal: 310000,
      discount: 10000,
      taxable: 300000,
      cgst: 16300,
      sgst: 16300,
      igst: 0,
      roundOff: 0,
      total: 332600,
    });
    expect(t.taxBreakup).toEqual([
      { gstRate: 5, taxable: 100000, cgst: 2500, sgst: 2500, igst: 0 },
      { gstRate: 12, taxable: 140000, cgst: 8400, sgst: 8400, igst: 0 },
      { gstRate: 18, taxable: 60000, cgst: 5400, sgst: 5400, igst: 0 },
    ]);
    expect(t.lines).toHaveLength(3);
  });

  it("uses IGST when the place of supply is another state", () => {
    const t = computeInvoice(lines, { sellerState: TN, placeOfSupply: KA });
    expect(t).toMatchObject({ cgst: 0, sgst: 0, igst: 32600, total: 332600 });
    expect(t.taxBreakup.map((r) => r.igst)).toEqual([5000, 16800, 10800]);
  });

  it("groups lines with the same rate", () => {
    const t = computeInvoice(
      [
        { description: "a", qty: 1, rate: 1000, gstRate: 5 },
        { description: "b", qty: 1, rate: 3000, gstRate: 5 },
      ],
      { sellerState: TN, placeOfSupply: TN },
    );
    expect(t.taxBreakup).toEqual([{ gstRate: 5, taxable: 4000, cgst: 100, sgst: 100, igst: 0 }]);
  });

  it("rounds the grand total down to the rupee", () => {
    const t = computeInvoice([{ description: "Saree", qty: 2.5, rate: 12050, gstRate: 5 }], { sellerState: TN, placeOfSupply: TN });
    expect(t.taxable + t.cgst + t.sgst).toBe(31631);
    expect(t.roundOff).toBe(-31);
    expect(t.total).toBe(31600);
  });

  it("rounds the grand total up to the rupee", () => {
    const t = computeInvoice([{ description: "Dhoti", qty: 1, rate: 10060, gstRate: 0 }], { sellerState: TN, placeOfSupply: TN });
    expect(t.roundOff).toBe(40);
    expect(t.total).toBe(10100);
  });

  it("rounds exactly 50 paise up", () => {
    const t = computeInvoice([{ description: "x", qty: 1, rate: 10050, gstRate: 0 }], { sellerState: TN, placeOfSupply: TN });
    expect(t).toMatchObject({ roundOff: 50, total: 10100 });
  });

  it("skips rounding when roundToRupee is false", () => {
    const t = computeInvoice([{ description: "x", qty: 1, rate: 10060, gstRate: 0 }], {
      sellerState: TN,
      placeOfSupply: TN,
      roundToRupee: false,
    });
    expect(t).toMatchObject({ roundOff: 0, total: 10060 });
  });

  it("handles zero-rated supplies", () => {
    const t = computeInvoice([{ description: "Handloom", qty: 4, rate: 25000, gstRate: 0 }], { sellerState: TN, placeOfSupply: KA });
    expect(t).toMatchObject({ taxable: 100000, cgst: 0, sgst: 0, igst: 0, total: 100000 });
    expect(t.taxBreakup).toEqual([{ gstRate: 0, taxable: 100000, cgst: 0, sgst: 0, igst: 0 }]);
  });

  it("handles an empty invoice", () => {
    const t = computeInvoice([], { sellerState: TN, placeOfSupply: TN });
    expect(t).toMatchObject({ subtotal: 0, total: 0, roundOff: 0, taxBreakup: [] });
  });
});

describe("isGstRate", () => {
  it("accepts only GST slabs", () => {
    for (const r of [0, 0.25, 3, 5, 12, 18, 28]) expect(isGstRate(r)).toBe(true);
    for (const r of [1, 7.5, 40, -5, "5"]) expect(isGstRate(r)).toBe(false);
  });
});

describe("exclusiveOf", () => {
  it("returns exclusive prices unchanged", () => {
    expect(exclusiveOf(105000, 5, false)).toBe(105000);
    expect(exclusiveOf(12345, 0, true)).toBe(12345);
  });
  it("takes GST out of tax-inclusive prices", () => {
    expect(exclusiveOf(105000, 5, true)).toBe(100000); // ₹1,050 MRP incl. 5% → ₹1,000
    expect(exclusiveOf(11800, 18, true)).toBe(10000);
    expect(exclusiveOf(999, 12, true)).toBe(892); // 891.96 → 892
    expect(exclusiveOf(10025, 0.25, true)).toBe(10000);
    expect(exclusiveOf(0, 28, true)).toBe(0);
  });
  it("adds back to (about) the inclusive price on a bill line", () => {
    const rate = exclusiveOf(49900, 12, true);
    const l = computeLine({ description: "Shirt", qty: 1, rate, gstRate: 12 }, false);
    expect(Math.abs(l.total - 49900)).toBeLessThanOrEqual(1);
  });
});
