import { describe, expect, it } from "vitest";
import {
  addDays,
  daysLeft,
  expiryStatus,
  fefoAllocate,
  isSaleBlocked,
  lineInTransit,
  lineVariance,
  mergeCounts,
  normalizeExpiry,
  splitMilli,
  suggestDiscount,
  transferStatusAfter,
} from "./batch-logic";
import { batchReasonFor } from "./batches";

describe("normalizeExpiry", () => {
  it("reads the formats printed on packs", () => {
    expect(normalizeExpiry("2027-03")).toBe("2027-03-31");
    expect(normalizeExpiry("03/2027")).toBe("2027-03-31");
    expect(normalizeExpiry("3-27")).toBe("2027-03-31");
    expect(normalizeExpiry("2028-02")).toBe("2028-02-29");
    expect(normalizeExpiry("15/03/2027")).toBe("2027-03-15");
    expect(normalizeExpiry("2027-03-15")).toBe("2027-03-15");
  });
  it("refuses nonsense", () => {
    for (const v of ["", "abc", "13/2027", "2027-02-30", "31/04/2027", "00/2027", "1999-01"]) expect(normalizeExpiry(v)).toBeNull();
  });
});

describe("expiry status", () => {
  const today = "2026-10-24";
  it("expired after its last day, expiring inside the window, none without a date", () => {
    expect(expiryStatus("2026-10-23", today, 30)).toBe("expired");
    expect(expiryStatus("2026-10-24", today, 30)).toBe("expiring");
    expect(expiryStatus("2026-11-23", today, 30)).toBe("expiring");
    expect(expiryStatus("2026-11-24", today, 30)).toBe("ok");
    expect(expiryStatus(null, today, 30)).toBe("none");
    expect(daysLeft("2026-10-30", today)).toBe(6);
    expect(daysLeft("2026-10-20", today)).toBe(-4);
    expect(daysLeft(null, today)).toBeNull();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("blocks only expired stock under the block rule", () => {
    expect(isSaleBlocked("2026-10-01", today, "block")).toBe(true);
    expect(isSaleBlocked("2026-10-01", today, "warn")).toBe(false);
    expect(isSaleBlocked("2026-11-01", today, "block")).toBe(false);
    expect(isSaleBlocked(null, today, "block")).toBe(false);
  });
});

describe("fefoAllocate", () => {
  const today = "2026-10-24";
  const b = (id: string, expiry: string | null, milli: number) => ({ id, expiry, milli });
  it("takes the soonest expiry first and leaves undated batches for last", () => {
    const r = fefoAllocate([b("c", null, 5000), b("b", "2027-01-01", 5000), b("a", "2026-12-01", 3000)], 6000, today);
    expect(r).toEqual({ allocations: [{ batchId: "a", milli: 3000 }, { batchId: "b", milli: 3000 }], short: 0 });
  });
  it("skips expired batches unless allowed and reports what is short", () => {
    const batches = [b("old", "2026-10-01", 4000), b("ok", "2027-01-01", 2000)];
    expect(fefoAllocate(batches, 5000, today)).toEqual({ allocations: [{ batchId: "ok", milli: 2000 }], short: 3000 });
    expect(fefoAllocate(batches, 5000, today, { allowExpired: true }).short).toBe(0);
  });
  it("takes the chosen batch first, then the rest in order", () => {
    const batches = [b("a", "2026-11-01", 5000), b("b", "2027-06-01", 5000)];
    const r = fefoAllocate(batches, 7000, today, { preferred: [{ batchId: "b", milli: 7000 }] });
    expect(r.allocations).toEqual([{ batchId: "b", milli: 5000 }, { batchId: "a", milli: 2000 }]);
  });
  it("ignores empty batches and ties break by id", () => {
    const r = fefoAllocate([b("z", "2027-01-01", 1000), b("y", "2027-01-01", 1000), b("x", "2027-01-01", 0)], 1500, today);
    expect(r.allocations).toEqual([{ batchId: "y", milli: 1000 }, { batchId: "z", milli: 500 }]);
  });
});

describe("near-expiry discount ladder", () => {
  it("picks the tightest step that covers the days left", () => {
    expect(suggestDiscount(10)).toBe(20);
    expect(suggestDiscount(30)).toBe(20);
    expect(suggestDiscount(31)).toBe(10);
    expect(suggestDiscount(75)).toBe(5);
    expect(suggestDiscount(120)).toBeNull();
    expect(suggestDiscount(-1)).toBeNull();
    expect(suggestDiscount(null)).toBeNull();
    expect(suggestDiscount(20, [{ days: 60, pct: 15 }])).toBe(15);
  });
});

describe("audit counting and variance", () => {
  it("adds up counters; a counter's set replaces only its own count", () => {
    expect(mergeCounts([])).toBeNull();
    expect(
      mergeCounts([
        { counter: "a", mode: "add", milli: 1000 },
        { counter: "b", mode: "add", milli: 2000 },
        { counter: "a", mode: "add", milli: 1000 },
      ]),
    ).toBe(4000);
    expect(
      mergeCounts([
        { counter: "a", mode: "add", milli: 1000 },
        { counter: "b", mode: "add", milli: 2000 },
        { counter: "a", mode: "set", milli: 5000 },
        { counter: "a", mode: "add", milli: 500 },
      ]),
    ).toBe(7500);
  });
  it("variance is counted minus system, valued at cost; uncounted lines have none", () => {
    expect(lineVariance({ systemMilli: 9000, countedMilli: 7000, unitCost: 700 })).toEqual({ varianceMilli: -2000, value: -1400 });
    expect(lineVariance({ systemMilli: 1000, countedMilli: 2500, unitCost: null })).toEqual({ varianceMilli: 1500, value: 0 });
    expect(lineVariance({ systemMilli: 1000, countedMilli: null, unitCost: 100 })).toEqual({ varianceMilli: 0, value: 0 });
    expect(lineVariance({ systemMilli: 0, countedMilli: 500, unitCost: 333 })).toEqual({ varianceMilli: 500, value: 167 });
  });
});

describe("transfers in transit", () => {
  it("what is still on the road, and the status after a receive", () => {
    expect(lineInTransit({ qty: 5 })).toBe(5);
    expect(lineInTransit({ qty: 5, received: 3, damaged: 1 })).toBe(1);
    expect(lineInTransit({ qty: 5, received: 3, damaged: 1, short: 1 })).toBe(0);
    expect(lineInTransit({ qty: 2.5, received: 0.5 })).toBe(2);
    expect(transferStatusAfter([{ qty: 5, received: 3 }, { qty: 2, received: 2 }])).toBe("partially_received");
    expect(transferStatusAfter([{ qty: 5, received: 3, short: 2 }, { qty: 2, received: 2 }])).toBe("closed");
  });
  it("splitMilli adds up exactly", () => {
    const parts = splitMilli(1000, [1, 1, 1]);
    expect(parts.reduce((a, c) => a + c, 0)).toBe(1000);
    expect(splitMilli(5, [0, 0])).toEqual([0, 0]);
  });
});

describe("batch ledger reasons", () => {
  it("maps stock reasons and defaults to adjustment", () => {
    expect(batchReasonFor("sale")).toBe("sale");
    expect(batchReasonFor("audit")).toBe("audit");
    expect(batchReasonFor("transfer_out")).toBe("transfer_out");
    expect(batchReasonFor("opening")).toBe("adjustment");
    expect(batchReasonFor("adjustment")).toBe("adjustment");
  });
});
