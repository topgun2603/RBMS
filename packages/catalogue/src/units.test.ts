import { describe, expect, it } from "vitest";
import { AppError } from "@rbms/core";
import { areaQuoteInputSchema, findUnit, itemUnitsInputSchema, quoteByArea, scaledPrice, toItemUnit, unitProblems } from "./units";

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

describe("area units (docs/market-plan.md Batch 10)", () => {
  // A vitrified tile sold at ₹90 a sq ft, in boxes of 15.5 sq ft (₹1,395 a box).
  const tile = {
    baseUnit: "sqft",
    price: 9000,
    units: [
      toItemUnit({ unit: "box", factor: "15.5", barcode: null, price: null, mrp: null }, { price: 9000 }, { gstRate: 18, gstRule: null, taxInclusive: true }),
    ],
  };
  it("sells whole boxes for a room, with wastage", () => {
    const q = quoteByArea(tile, { area: 120, wastagePct: 10 });
    expect(q).toMatchObject({ mode: "box", line: { unit: "box", qty: 9 }, boxes: 9, coverage: 15.5, needed: 132, covered: 139.5, unitPrice: 139500, total: 1_255_500 });
    expect(quoteByArea(tile, { area: 120 })).toMatchObject({ boxes: 8, spare: 4, total: 8 * 139500 });
  });
  it("takes the room in sq m", () => {
    expect(quoteByArea(tile, { area: 10, areaUnit: "sqm" })).toMatchObject({ boxes: 7, areaUnit: "sqm" });
  });
  it("sells by area when the item has no box unit", () => {
    const q = quoteByArea({ ...tile, units: [] }, { area: 100.2, wastagePct: 5 });
    expect(q).toMatchObject({ mode: "area", boxes: null, line: { unit: "sqft", qty: 105.21 }, unitPrice: 9000 });
    expect(q.total).toBe(Math.round(105.21 * 9000));
  });
  it("an item priced per sq m converts a sq ft room", () => {
    const q = quoteByArea({ baseUnit: "sqm", price: 96000, units: [] }, { area: 107.6391, areaUnit: "sqft" });
    expect(q.line.qty).toBe(10);
  });
  it("refuses an item that isn't sold by area, and a box unit it doesn't have", () => {
    expect(() => quoteByArea({ baseUnit: "pcs", price: 100, units: [] }, { area: 10 })).toThrow(AppError);
    expect(() => quoteByArea(tile, { area: 10, boxUnit: "carton" })).toThrow(AppError);
  });
  it("checks the input", () => {
    expect(areaQuoteInputSchema.safeParse({ area: 120, wastagePct: 10 }).success).toBe(true);
    expect(areaQuoteInputSchema.safeParse({ area: 0 }).success).toBe(false);
    expect(areaQuoteInputSchema.safeParse({ area: 5, wastagePct: 120 }).success).toBe(false);
    expect(areaQuoteInputSchema.safeParse({ area: 5, areaUnit: "acre" }).success).toBe(false);
  });
  it("only accepts the right factor for sq m on a sq ft item", () => {
    expect(unitProblems([{ unit: "box", factor: 15.5 }, { unit: "sqm", factor: 10.76391 }], "sqft")).toEqual([]);
    expect(unitProblems([{ unit: "sq m", factor: 10 }], "sqft")).toHaveLength(1);
  });
});
