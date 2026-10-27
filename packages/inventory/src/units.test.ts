import { describe, expect, it } from "vitest";
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
