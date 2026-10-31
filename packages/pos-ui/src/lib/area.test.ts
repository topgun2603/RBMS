import { describe, expect, it } from "vitest";
import { boxesToCover, type PosUnit } from "./units";

const box: PosUnit = { unit: "box", factor: 15.5, barcode: null, price: 139500 };
const tile = { unit: "sqft", baseUnit: "sqft", units: [box] };

describe("selling by area at the counter", () => {
  it("works out the boxes for a room with wastage", () => {
    expect(boxesToCover(tile, 120, "sqft", 10)).toEqual({ unit: "box", qty: 9, covered: 139.5, coverage: 15.5 });
    expect(boxesToCover(tile, 120)).toMatchObject({ qty: 8, covered: 124 });
  });
  it("takes sq m", () => {
    expect(boxesToCover(tile, 10, "sqm")?.qty).toBe(7);
  });
  it("is null for items not sold by area, without a box, or with bad input", () => {
    expect(boxesToCover({ unit: "pcs", baseUnit: "pcs", units: [{ ...box, unit: "carton", factor: 12 }] }, 100)).toBeNull();
    expect(boxesToCover({ unit: "sqft", baseUnit: "sqft", units: [] }, 100)).toBeNull();
    expect(boxesToCover(tile, 0)).toBeNull();
    expect(boxesToCover(tile, Number.NaN)).toBeNull();
    expect(boxesToCover(tile, 10, "sqft", 150)).toBeNull();
  });
});
