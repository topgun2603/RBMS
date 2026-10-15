import { describe, expect, it } from "vitest";
import {
  adjustmentDelta,
  fromMilli,
  mergePurchaseLines,
  mergeQtyLines,
  milliToDecimal,
  movingAverageCost,
  netByItem,
  paiseToRupees,
  stockStatus,
  stockValue,
  toMilli,
  unitCostOf,
} from "./logic";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

describe("quantity math in thousandths", () => {
  it("converts numbers and numeric strings without float drift", () => {
    expect(toMilli(2.5)).toBe(2500);
    expect(toMilli("1.005")).toBe(1005);
    expect(toMilli(1.005)).toBe(1005);
    expect(toMilli("12.345")).toBe(12345);
    expect(toMilli("-0.500")).toBe(-500);
    expect(toMilli(null)).toBe(0);
    expect(toMilli("")).toBe(0);
    expect(Object.is(toMilli(-0.0001), 0)).toBe(true);
    expect(() => toMilli("abc")).toThrow(RangeError);
  });
  it("adds exactly where floats drift", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(fromMilli(toMilli(0.1) + toMilli(0.2))).toBe(0.3);
    let m = 0;
    for (let i = 0; i < 1000; i++) m += toMilli(0.001);
    expect(fromMilli(m)).toBe(1);
  });
  it("formats exact decimals for numeric columns", () => {
    expect(milliToDecimal(2500)).toBe("2.500");
    expect(milliToDecimal(1)).toBe("0.001");
    expect(milliToDecimal(-1)).toBe("-0.001");
    expect(milliToDecimal(-12345)).toBe("-12.345");
    expect(milliToDecimal(0)).toBe("0.000");
    expect(() => milliToDecimal(1.5)).toThrow(RangeError);
  });
  it("computes adjustment deltas", () => {
    expect(adjustmentDelta("add", 2500, 1000)).toBe(2500);
    expect(adjustmentDelta("remove", 2500, 1000)).toBe(-2500);
    expect(adjustmentDelta("set", 2500, 1000)).toBe(1500);
    expect(adjustmentDelta("set", 0, -3000)).toBe(3000);
  });
});

describe("cost", () => {
  it("unit cost = taxable / qty (GST excluded)", () => {
    expect(unitCostOf(25000, 2500)).toBe(10000); // ₹250 for 2.5 m → ₹100/m
    expect(unitCostOf(10000, 3000)).toBe(3333);
    expect(unitCostOf(20000, 3000)).toBe(6667);
    expect(unitCostOf(100, 0)).toBe(0);
  });
  it("moving average", () => {
    // 10 @ ₹100 + 10 @ ₹120 → ₹110
    expect(movingAverageCost(10_000, 10000, 10_000, 12000)).toBe(11000);
    // 2.5 @ 100 + 0.5 @ 101 → (250 + 50.5)/3 = 100.1666 → 100
    expect(movingAverageCost(2500, 100, 500, 101)).toBe(100);
    // rounds half up: (1×1 + 1×2)/2 = 1.5 → 2
    expect(movingAverageCost(1000, 1, 1000, 2)).toBe(2);
  });
  it("takes the new cost when there is no stock or no known cost", () => {
    expect(movingAverageCost(0, 5000, 1000, 7000)).toBe(7000);
    expect(movingAverageCost(-2000, 5000, 1000, 7000)).toBe(7000);
    expect(movingAverageCost(3000, null, 1000, 7000)).toBe(7000);
  });
  it("keeps the old cost when nothing comes in", () => {
    expect(movingAverageCost(3000, 5000, 0, 7000)).toBe(5000);
    expect(movingAverageCost(3000, null, -1, 7000)).toBeNull();
  });
  it("stays exact for large quantities and costs", () => {
    // 1,000,000 units @ ₹99,999.99 + 1,000,000 @ ₹1 — products exceed 2^53 in paise × milli.
    expect(movingAverageCost(1e9, 9_999_999, 1e9, 100)).toBe(5_000_050);
  });
  it("values stock", () => {
    expect(stockValue(2500, 10000)).toBe(25000);
    expect(stockValue(1, 333)).toBe(0);
    expect(stockValue(-1000, 500)).toBe(0);
    expect(stockValue(1000, null)).toBe(0);
  });
});

describe("stockStatus", () => {
  it("out at or below zero", () => {
    expect(stockStatus(0, 0)).toBe("out");
    expect(stockStatus(-500, 5000)).toBe("out");
  });
  it("low at or below the reorder level", () => {
    expect(stockStatus(5000, 5000)).toBe("low");
    expect(stockStatus(4999, 5000)).toBe("low");
    expect(stockStatus(5001, 5000)).toBe("ok");
  });
  it("ok without a reorder level", () => {
    expect(stockStatus(1, 0)).toBe("ok");
  });
});

describe("line merging", () => {
  it("merges sale lines per item, drops non-positive totals and sorts by id", () => {
    const merged = mergeQtyLines([
      { itemId: B, qty: 1 },
      { itemId: A, qty: 0.1 },
      { itemId: A, qty: 0.2 },
      { itemId: B, qty: 2.5 },
      { itemId: "", qty: 4 },
    ]);
    expect(merged).toEqual([
      { itemId: A, milli: 300 },
      { itemId: B, milli: 3500 },
    ]);
    expect(mergeQtyLines([])).toEqual([]);
  });
  it("nets movements per item", () => {
    expect(
      netByItem([
        { itemId: A, delta: "-2.500" },
        { itemId: B, delta: "-1.000" },
        { itemId: B, delta: "1.000" },
        { itemId: A, delta: "-0.500" },
      ]),
    ).toEqual([{ itemId: A, milli: -3000 }]);
  });
  it("merges purchase lines with qty and taxable", () => {
    expect(
      mergePurchaseLines([
        { itemId: A, qty: 2, taxable: 20000 },
        { itemId: null, qty: 5, taxable: 500 },
        { itemId: A, qty: 1, taxable: 13000 },
      ]),
    ).toEqual([{ itemId: A, milli: 3000, taxable: 33000 }]);
  });
});

describe("paiseToRupees", () => {
  it("formats for CSV", () => {
    expect(paiseToRupees(123456)).toBe("1234.56");
    expect(paiseToRupees(5)).toBe("0.05");
    expect(paiseToRupees(-150)).toBe("-1.50");
    expect(paiseToRupees(null)).toBe("");
  });
});
