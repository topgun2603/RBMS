import { describe, expect, it } from "vitest";
import { stockInBoxes } from "@rbms/gst";
import { baseMilliOf, mergePurchaseLines } from "./logic";

describe("purchases in alternate units (docs/price-lists-units.md)", () => {
  it("brings stock in in the base unit", () => {
    expect(baseMilliOf({ qty: 2, unitFactor: 12 })).toBe(24_000);
    expect(baseMilliOf({ qty: 2.5 })).toBe(2_500);
    expect(baseMilliOf({ qty: 1500, unitFactor: 0.001 })).toBe(1_500);
    // 2 boxes of 12 and 6 loose pieces: 30 pieces, cost spread over all of them.
    expect(mergePurchaseLines([
      { itemId: "a", qty: 2, unitFactor: 12, taxable: 96000 },
      { itemId: "a", qty: 6, taxable: 24000 },
    ])).toEqual([{ itemId: "a", milli: 30_000, taxable: 120000 }]);
  });
});

describe("area stock (docs/market-plan.md Batch 10)", () => {
  it("moves stock by box in sq ft: 10 boxes of 15.5 in, 2 sold, shown back as boxes", () => {
    const inMilli = baseMilliOf({ qty: 10, unitFactor: 15.5 });
    const outMilli = baseMilliOf({ qty: 2, unitFactor: 15.5 });
    expect(inMilli).toBe(155_000);
    expect(outMilli).toBe(31_000);
    expect(stockInBoxes((inMilli - outMilli) / 1000, 15.5)).toEqual({ boxes: 8, loose: 0 });
    // 20 sq ft sold off the open box by area: 104 sq ft left = 6 boxes and 11 sq ft loose
    expect(stockInBoxes((inMilli - outMilli - 20_000) / 1000, 15.5)).toEqual({ boxes: 6, loose: 11 });
  });
  it("counts a sq m line of a sq ft item in sq ft", () => {
    expect(baseMilliOf({ qty: 2, unitFactor: 10.76391 })).toBe(21_528);
  });
});
