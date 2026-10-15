import { describe, expect, it } from "vitest";
import { lowStockEvents, lowStockTransition } from "./levels";

describe("lowStockTransition", () => {
  it("fires when stock gets worse across the reorder level or zero", () => {
    expect(lowStockTransition(10_000, 4_000, 5_000)).toBe("low");
    expect(lowStockTransition(10_000, 5_000, 5_000)).toBe("low");
    expect(lowStockTransition(10_000, 0, 5_000)).toBe("out");
    expect(lowStockTransition(4_000, 0, 5_000)).toBe("out");
    expect(lowStockTransition(1_000, -2_000, 0)).toBe("out");
  });

  it("stays quiet when the status doesn't get worse", () => {
    expect(lowStockTransition(10_000, 6_000, 5_000)).toBeNull();
    expect(lowStockTransition(4_000, 3_000, 5_000)).toBeNull();
    expect(lowStockTransition(0, -1_000, 5_000)).toBeNull();
    // No reorder level: only running out counts.
    expect(lowStockTransition(10_000, 1_000, 0)).toBeNull();
    // Improvements never fire.
    expect(lowStockTransition(0, 3_000, 5_000)).toBeNull();
  });
});

describe("lowStockEvents", () => {
  const d = (itemId: string, beforeMilli: number, afterMilli: number, reorderMilli = 5_000, locationId = "L1") => ({
    locationId,
    itemId,
    beforeMilli,
    afterMilli,
    reorderMilli,
  });

  it("reports items that got low or ran out, with qty in units", () => {
    expect(lowStockEvents([d("a", 10_000, 4_500), d("b", 10_000, 9_000), d("c", 2_000, 0)])).toEqual([
      { locationId: "L1", itemId: "a", qty: 4.5, reorderLevel: 5, status: "low" },
      { locationId: "L1", itemId: "c", qty: 0, reorderLevel: 5, status: "out" },
    ]);
  });

  it("merges changes per location and item (first before, last after)", () => {
    expect(lowStockEvents([d("a", 10_000, 7_000), d("a", 7_000, 3_000)])).toEqual([
      { locationId: "L1", itemId: "a", qty: 3, reorderLevel: 5, status: "low" },
    ]);
    // Same item at two locations: separate.
    expect(lowStockEvents([d("a", 10_000, 0, 0, "L1"), d("a", 10_000, 8_000, 0, "L2")]).map((e) => e.locationId)).toEqual(["L1"]);
  });

  it("leaves out untracked items", () => {
    expect(lowStockEvents([d("a", 10_000, 0)], new Set(["a"]))).toEqual([]);
    expect(lowStockEvents([])).toEqual([]);
  });
});
