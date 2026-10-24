import { describe, expect, it } from "vitest";
import { DISHES } from "../demo-stores/theneer-menu";
import { THENEER } from "../demo-stores/theneer";
import { PROFILES, getProfile, profileForBusinessType } from "./profiles";

describe("tea_stall profile (store #19, Theneer Kadai)", () => {
  const p = getProfile("tea_stall");

  it("is found by its trade and sells exactly the demo store's items (one entry per size)", () => {
    expect(profileForBusinessType("tea_stall")).toBe(p);
    expect(PROFILES.tea_stall).toBe(p);
    expect(p.catalogue).toHaveLength(DISHES.reduce((n, d) => n + d.rows.length, 0));
    expect(new Set(p.catalogue.map((c) => c.name)).size).toBe(p.catalogue.length);
    expect(THENEER.products).toHaveLength(DISHES.length);
    // Sized items are named "<item> – <size>" like the billing items the store's variants become.
    expect(p.catalogue.some((c) => c.name === "Tea – Small")).toBe(true);
    expect(p.catalogue.some((c) => c.name === "Tea – Large")).toBe(true);
  });

  it("is counter-first: hundreds of small bills a day, no dining flow, two counters, milk and fruit every day", () => {
    expect(p.hook).toBe("none");
    for (const n of p.billsByWeekday) expect(n).toBeGreaterThanOrEqual(250);
    for (const n of p.billsByWeekday) expect(n).toBeLessThanOrEqual(400);
    expect(p.registers).toHaveLength(2);
    expect(p.weeklyExpenses.filter((w) => w.weekday === "daily").length).toBeGreaterThanOrEqual(3);
    expect(p.payments.cash + p.payments.upi + p.payments.card).toBeCloseTo(1, 5);
    // Prices are small: the dearest single line is a 2-litre office flask.
    expect(Math.max(...p.catalogue.map((c) => c.rate))).toBeLessThan(20_000);
  });
});
