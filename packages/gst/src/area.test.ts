import { describe, expect, it } from "vitest";
import { areaOfBoxes, areaUnitFactor, boxesForArea, convertArea, isAreaUnit, normaliseAreaUnit, parseCoverage, stockInBoxes } from "./area";

describe("area units", () => {
  it("reads the names shops type", () => {
    for (const n of ["sqft", "Sq Ft", "sq.ft", "SFT", "square feet"]) expect(normaliseAreaUnit(n), n).toBe("sqft");
    for (const n of ["sqm", "Sq. M", "m2", "m²", "sq mtr"]) expect(normaliseAreaUnit(n), n).toBe("sqm");
    expect(normaliseAreaUnit("box")).toBeNull();
    expect(isAreaUnit("kg")).toBe(false);
    expect(isAreaUnit(null)).toBe(false);
  });
  it("converts between sq ft and sq m", () => {
    expect(convertArea(10, "sqm", "sqft")).toBeCloseTo(107.6391, 4);
    expect(convertArea(107.6391, "sqft", "sqm")).toBeCloseTo(10, 4);
    expect(convertArea(5, "sqft", "sqft")).toBe(5);
    expect(areaUnitFactor("sqft", "sqm")).toBe(10.76391);
  });
});

describe("boxesForArea", () => {
  const box = { coverage: 15.5, coverageUnit: "sqft" as const };
  it("rounds up to whole boxes: a 120 sq ft room takes 8 boxes of 15.5", () => {
    expect(boxesForArea({ area: 120, areaUnit: "sqft", ...box })).toEqual({ boxes: 8, covered: 124, needed: 120, spare: 4 });
  });
  it("adds wastage before rounding", () => {
    // 120 + 10 % = 132 sq ft → 8.52 boxes → 9
    expect(boxesForArea({ area: 120, areaUnit: "sqft", ...box, wastagePct: 10 })).toMatchObject({ boxes: 9, needed: 132, covered: 139.5 });
  });
  it("does not add a box for float noise", () => {
    expect(boxesForArea({ area: 120, areaUnit: "sqft", coverage: 15, coverageUnit: "sqft" }).boxes).toBe(8);
    expect(boxesForArea({ area: 0.3, areaUnit: "sqm", coverage: 0.1, coverageUnit: "sqm" }).boxes).toBe(3);
  });
  it("takes the room in sq m and the box in sq ft", () => {
    // 10 sq m = 107.64 sq ft → 6.94 boxes of 15.5 → 7; covered reported in sq m
    const r = boxesForArea({ area: 10, areaUnit: "sqm", ...box });
    expect(r.boxes).toBe(7);
    expect(r.covered).toBeCloseTo(10.081, 2);
  });
  it("refuses nonsense", () => {
    expect(() => boxesForArea({ area: 0, areaUnit: "sqft", ...box })).toThrow(RangeError);
    expect(() => boxesForArea({ area: 10, areaUnit: "sqft", coverage: 0, coverageUnit: "sqft" })).toThrow(RangeError);
    expect(() => boxesForArea({ area: 10, areaUnit: "sqft", ...box, wastagePct: 101 })).toThrow(RangeError);
    expect(() => boxesForArea({ area: Number.NaN, areaUnit: "sqft", ...box })).toThrow(RangeError);
  });
});

describe("boxes and stock", () => {
  it("area of boxes, in either unit", () => {
    expect(areaOfBoxes(8, 15.5, "sqft")).toBe(124);
    expect(areaOfBoxes(8, 15.5, "sqft", "sqm")).toBeCloseTo(11.52, 2);
  });
  it("shows area stock as boxes and loose area", () => {
    expect(stockInBoxes(155, 15.5)).toEqual({ boxes: 10, loose: 0 });
    expect(stockInBoxes(170, 15.5)).toEqual({ boxes: 10, loose: 15 });
    expect(stockInBoxes(7, 15.5)).toEqual({ boxes: 0, loose: 7 });
    expect(() => stockInBoxes(10, 0)).toThrow(RangeError);
  });
  it("reads coverage text", () => {
    expect(parseCoverage("15.5")).toBe(15.5);
    expect(parseCoverage("15,5 sq ft")).toBe(15.5);
    expect(parseCoverage("1.44 sqm")).toBeCloseTo(15.5, 1);
    expect(parseCoverage("1.44 sqm", "sqm")).toBe(1.44);
    expect(parseCoverage("abc")).toBeNull();
    expect(parseCoverage("5 kg")).toBeNull();
    expect(parseCoverage("")).toBeNull();
  });
});
