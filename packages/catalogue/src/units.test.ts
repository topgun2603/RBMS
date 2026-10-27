import { describe, expect, it } from "vitest";
import { findUnit, itemUnitsInputSchema, scaledPrice, toItemUnit, unitProblems } from "./units";

describe("alternate units (docs/price-lists-units.md)", () => {
  it("rejects the base unit, repeats, factor 1 and repeated barcodes", () => {
    expect(unitProblems([{ unit: "box", factor: 12 }, { unit: "bag", factor: 25 }], "pcs")).toEqual([]);
    expect(unitProblems([{ unit: "PCS", factor: 12 }], "pcs")).toHaveLength(1);
    expect(unitProblems([{ unit: "box", factor: 12 }, { unit: "Box", factor: 6 }], "pcs")).toHaveLength(1);
    expect(unitProblems([{ unit: "box", factor: 1 }], "pcs")).toHaveLength(1);
    expect(unitProblems([{ unit: "box", factor: 12, barcode: "X1" }, { unit: "case", factor: 48, barcode: "X1" }], "pcs")).toHaveLength(1);
  });

  it("validates the input", () => {
    expect(itemUnitsInputSchema.safeParse({ units: [{ unit: "box", factor: 12 }] }).success).toBe(true);
    expect(itemUnitsInputSchema.safeParse({ units: [{ unit: "box", factor: 0 }] }).success).toBe(false);
    expect(itemUnitsInputSchema.safeParse({ units: [{ unit: "g", factor: 0.001 }] }).success).toBe(true);
    expect(itemUnitsInputSchema.safeParse({ units: [{ unit: "box", factor: 1.0000001 }] }).success).toBe(false);
  });

  it("prices a unit at its own price, else factor × the item price; rate is GST-exclusive", () => {
    expect(scaledPrice(5000, 12)).toBe(60000);
    const v = { price: 11800, mrp: 12500 };
    const p = { gstRate: 18, gstRule: null, taxInclusive: true };
    expect(toItemUnit({ unit: "box", factor: "12", barcode: null, price: null, mrp: null }, v, p)).toEqual({
      unit: "box",
      factor: 12,
      barcode: null,
      ownPrice: null,
      price: 141600,
      rate: 120000,
      mrp: 150000,
    });
    expect(toItemUnit({ unit: "box", factor: "12", barcode: "B1", price: 130000, mrp: null }, v, p)).toMatchObject({ ownPrice: 130000, price: 130000, barcode: "B1" });
    expect(findUnit([{ unit: "Box" }], "box")).toEqual({ unit: "Box" });
    expect(findUnit([{ unit: "Box" }], "pcs")).toBeNull();
  });
});
