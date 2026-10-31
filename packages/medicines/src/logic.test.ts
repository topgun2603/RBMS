import { describe, expect, it } from "vitest";
import { addDays, chosenBatches, expiryStatus, fefoAllocate, normalizeExpiry, qtyByItem } from "./logic";

describe("normalizeExpiry", () => {
  it("takes month expiries to the month's last day", () => {
    expect(normalizeExpiry("2027-02")).toBe("2027-02-28");
    expect(normalizeExpiry("02/2028")).toBe("2028-02-29");
    expect(normalizeExpiry("11/27")).toBe("2027-11-30");
  });
  it("keeps full dates and rejects nonsense", () => {
    expect(normalizeExpiry("2027-03-15")).toBe("2027-03-15");
    expect(normalizeExpiry("2027-02-30")).toBeNull();
    expect(normalizeExpiry("13/2027")).toBeNull();
    expect(normalizeExpiry("soon")).toBeNull();
  });
});

describe("expiryStatus", () => {
  it("splits expired, expiring and ok", () => {
    expect(expiryStatus("2026-10-19", "2026-10-20", 90)).toBe("expired");
    expect(expiryStatus("2026-10-20", "2026-10-20", 90)).toBe("expiring");
    expect(expiryStatus(addDays("2026-10-20", 90), "2026-10-20", 90)).toBe("expiring");
    expect(expiryStatus(addDays("2026-10-20", 91), "2026-10-20", 90)).toBe("ok");
  });
});

describe("fefoAllocate", () => {
  const today = "2026-10-20";
  const batches = [
    { id: "late", expiry: "2027-12-31", qty: 10 },
    { id: "soon", expiry: "2026-12-31", qty: 3 },
    { id: "gone", expiry: "2026-09-30", qty: 50 },
    { id: "empty", expiry: "2026-11-30", qty: 0 },
  ];
  it("takes the soonest unexpired batch first and skips expired / empty ones", () => {
    expect(fefoAllocate(batches, 5, today)).toEqual({
      allocations: [
        { batchId: "soon", qty: 3 },
        { batchId: "late", qty: 2 },
      ],
      short: 0,
    });
  });
  it("reports what the batches can't cover", () => {
    expect(fefoAllocate(batches, 14.5, today)).toEqual({
      allocations: [
        { batchId: "soon", qty: 3 },
        { batchId: "late", qty: 10 },
      ],
      short: 1.5,
    });
  });
  it("handles loose (fractional) quantities without float drift", () => {
    const r = fefoAllocate([{ id: "a", expiry: "2027-01-31", qty: 0.3 }, { id: "b", expiry: "2027-02-28", qty: 1 }], 0.7, today);
    expect(r).toEqual({ allocations: [{ batchId: "a", qty: 0.3 }, { batchId: "b", qty: 0.4 }], short: 0 });
  });
});

describe("fefoAllocate with a chosen batch", () => {
  const today = "2026-10-20";
  const batches = [
    { id: "late", expiry: "2027-12-31", qty: 10 },
    { id: "soon", expiry: "2026-12-31", qty: 3 },
    { id: "gone", expiry: "2026-09-30", qty: 50 },
  ];
  it("takes the chosen batch first, then first-expiry-first-out for the rest", () => {
    expect(fefoAllocate(batches, 4, today, [{ batchId: "late", qty: 4 }])).toEqual({ allocations: [{ batchId: "late", qty: 4 }], short: 0 });
    expect(fefoAllocate(batches, 6, today, [{ batchId: "late", qty: 4 }])).toEqual({
      allocations: [
        { batchId: "late", qty: 4 },
        { batchId: "soon", qty: 2 },
      ],
      short: 0,
    });
  });
  it("never sells an expired chosen batch, and falls back when the chosen one has too little", () => {
    expect(fefoAllocate(batches, 2, today, [{ batchId: "gone", qty: 2 }])).toEqual({ allocations: [{ batchId: "soon", qty: 2 }], short: 0 });
    expect(fefoAllocate(batches, 5, today, [{ batchId: "soon", qty: 5 }])).toEqual({
      allocations: [
        { batchId: "soon", qty: 3 },
        { batchId: "late", qty: 2 },
      ],
      short: 0,
    });
  });
  it("chosenBatches sums per item and batch and skips lines without a choice", () => {
    const m = chosenBatches([
      { itemId: "i1", qty: 2, batchId: "b1" },
      { itemId: "i1", qty: 1, batchId: "b1" },
      { itemId: "i1", qty: 1, batchId: "b2" },
      { itemId: "i2", qty: 4 },
      { itemId: null, qty: 1, batchId: "b3" },
    ]);
    expect([...m]).toEqual([["i1", [{ batchId: "b1", qty: 3 }, { batchId: "b2", qty: 1 }]]]);
  });
});

describe("qtyByItem", () => {
  it("sums repeated items and ignores free-text lines", () => {
    const m = qtyByItem([
      { itemId: "x", qty: 1 },
      { itemId: null, qty: 4 },
      { itemId: "x", qty: 0.5 },
      { itemId: "y", qty: 2 },
    ]);
    expect([...m]).toEqual([
      ["x", 1.5],
      ["y", 2],
    ]);
  });
});
