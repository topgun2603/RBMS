import { describe, expect, it } from "vitest";
import {
  addDays,
  dayCount,
  funnelRows,
  isEmptyOverview,
  pctDelta,
  pointsDelta,
  previousRange,
  productRows,
  rangeFor,
  series,
  sourceKey,
  sparkValues,
  todayIST,
  withShare,
} from "./analytics";

describe("date ranges", () => {
  it("uses the IST calendar date", () => {
    // 20:00 UTC on 14 Oct is 01:30 IST on 15 Oct
    expect(todayIST(new Date("2026-10-14T20:00:00Z"))).toBe("2026-10-15");
    expect(todayIST(new Date("2026-10-14T18:00:00Z"))).toBe("2026-10-14");
  });

  it("builds the presets, inclusive of today", () => {
    const today = "2026-10-15";
    expect(rangeFor("7d", today)).toEqual({ from: "2026-10-09", to: today });
    expect(rangeFor("30d", today)).toEqual({ from: "2026-09-16", to: today });
    expect(rangeFor("90d", today)).toEqual({ from: "2026-07-18", to: today });
    expect(rangeFor("month", today)).toEqual({ from: "2026-10-01", to: today });
    expect(dayCount(rangeFor("7d", today))).toBe(7);
    expect(dayCount(rangeFor("90d", today))).toBe(90);
  });

  it("compares against the same number of days just before", () => {
    expect(previousRange({ from: "2026-10-09", to: "2026-10-15" })).toEqual({ from: "2026-10-02", to: "2026-10-08" });
    expect(previousRange({ from: "2026-03-01", to: "2026-03-01" })).toEqual({ from: "2026-02-28", to: "2026-02-28" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("deltas", () => {
  it("percent change, null without a base", () => {
    expect(pctDelta(150, 100)).toBe(50);
    expect(pctDelta(50, 100)).toBe(-50);
    expect(pctDelta(5, 0)).toBeNull();
    expect(pctDelta(5, null)).toBeNull();
  });

  it("conversion compares in percentage points", () => {
    expect(pointsDelta(3.5, 2.25, 100)).toBe(1.25);
    expect(pointsDelta(1, 0, 0)).toBeNull();
  });
});

describe("funnel", () => {
  it("keeps step order, fills missing steps and computes drop-off", () => {
    const rows = funnelRows([
      { step: "purchase", count: 5 },
      { step: "visit", count: 200 },
      { step: "product_view", count: 120 },
      { step: "add_to_cart", count: 30 },
    ]);
    expect(rows.map((r) => r.step)).toEqual(["visit", "product_view", "add_to_cart", "begin_checkout", "purchase"]);
    expect(rows.map((r) => r.count)).toEqual([200, 120, 30, 0, 5]);
    expect(rows.map((r) => r.ofStart)).toEqual([100, 60, 15, 0, 2.5]);
    expect(rows.map((r) => r.dropOff)).toEqual([null, 40, 75, 100, null]);
  });

  it("handles an empty funnel", () => {
    const rows = funnelRows([]);
    expect(rows.every((r) => r.count === 0 && r.ofStart === 0)).toBe(true);
    expect(rows.map((r) => r.dropOff)).toEqual([null, null, null, null, null]);
  });
});

describe("shaping", () => {
  const trend = [
    { date: "2026-10-14", visitors: 3, purchases: 1, revenue: 49900 },
    { date: "2026-10-15", visitors: 5, purchases: 0, revenue: 0 },
  ];

  it("extracts one series per chart", () => {
    expect(series(trend, "visitors")).toEqual([
      { date: "2026-10-14", value: 3 },
      { date: "2026-10-15", value: 5 },
    ]);
    expect(series(trend, "revenue").map((d) => d.value)).toEqual([49900, 0]);
    expect(sparkValues({ trend })).toEqual([3, 5]);
    expect(sparkValues(undefined)).toEqual([]);
  });

  it("adds shares", () => {
    expect(withShare([{ s: 3 }, { s: 1 }], (x) => x.s).map((x) => x.share)).toEqual([75, 25]);
    expect(withShare([{ s: 0 }], (x) => x.s)[0]!.share).toBe(0);
  });

  it("product conversion per view", () => {
    expect(productRows([{ productId: "p", name: "A", views: 40, addToCart: 4, purchases: 2 }])[0]!.conversion).toBe(5);
    expect(productRows([{ productId: "p", name: "A", views: 0, addToCart: 0, purchases: 0 }])[0]!.conversion).toBe(0);
  });

  it("detects a store with no beacon data", () => {
    expect(isEmptyOverview({ sessions: 0, pageViews: 0, visitors: 0, purchases: 0 })).toBe(true);
    expect(isEmptyOverview({ sessions: 1, pageViews: 1, visitors: 1, purchases: 0 })).toBe(false);
  });

  it("names well-known traffic sources", () => {
    expect(sourceKey("direct")).toBe("direct");
    expect(sourceKey("www.google.com")).toBe("google");
    expect(sourceKey("l.facebook.com")).toBe("facebook");
    expect(sourceKey("instagram")).toBe("instagram");
    expect(sourceKey("wa.me")).toBe("whatsapp");
    expect(sourceKey("m.youtube.com")).toBe("youtube");
    expect(sourceKey("blog.example.in")).toBeNull();
  });
});
