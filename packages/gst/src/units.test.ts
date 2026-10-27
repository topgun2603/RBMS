import { describe, expect, it } from "vitest";
import { baseQtyOf, baseUnitOf, computeLine, lineGstRate } from "./index";

describe("alternate-unit lines (docs/price-lists-units.md)", () => {
  it("counts the line in base units", () => {
    expect(baseQtyOf({ qty: 2, unitFactor: 12 })).toBe(24);
    expect(baseQtyOf({ qty: 1.5, unitFactor: 0.001 })).toBe(0.002);
    expect(baseQtyOf({ qty: 3 })).toBe(3);
    expect(baseQtyOf({ qty: 3, unitFactor: 1 })).toBe(3);
    expect(baseUnitOf({ unit: "box", unitFactor: 12, baseUnit: "pcs" })).toBe("pcs");
    expect(baseUnitOf({ unit: "box" })).toBe("box");
  });

  it("bands price-band GST per piece, not per box", () => {
    const rule = { kind: "price-band" as const, threshold: 250000, below: 5 as const, above: 18 as const };
    // A box of 6 shirts at ₹7,200 is ₹1,200 a shirt: 5%, not 18%.
    expect(lineGstRate({ qty: 1, rate: 720000, gstRate: 5, gstRule: rule, unitFactor: 6 })).toBe(5);
    expect(lineGstRate({ qty: 1, rate: 720000, gstRate: 5, gstRule: rule })).toBe(18);
  });

  it("keeps the factor on computed lines (GST amounts unchanged)", () => {
    const l = computeLine({ description: "Soap", qty: 2, unit: "box", rate: 60000, gstRate: 18, unitFactor: 12, baseUnit: "pcs" }, false);
    expect(l).toMatchObject({ unitFactor: 12, baseUnit: "pcs", taxable: 120000, cgst: 10800, sgst: 10800 });
  });
});
