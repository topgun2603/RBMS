import { describe, expect, it } from "vitest";
import { applyForeign, foreignInputSchema, foreignTotals, forcesIgst, splitForeignPayment, supplyPlace, taxSellerState, withoutPayment } from "./export-calc";
import { nextAfter, nextOnOrAfter, occurrence, planDue, previewDates, scheduleProblem, type Schedule } from "./recurring-calc";
import { recurringInputSchema } from "./recurring";

const monthly = (over: Partial<Schedule> = {}): Schedule => ({ frequency: "monthly", interval: 1, dayOfMonth: null, weekday: null, startDate: "2026-01-31", endDate: null, ...over });

describe("recurring schedule", () => {
  it("bills the 31st on the month's last day and goes back to the 31st", () => {
    const s = monthly({ dayOfMonth: 31 });
    expect([0, 1, 2, 3].map((k) => occurrence(s, k))).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(occurrence(monthly({ dayOfMonth: 31, startDate: "2028-01-31" }), 1)).toBe("2028-02-29");
  });

  it("starts a step later when the day is before the start day", () => {
    const s = monthly({ dayOfMonth: 5, startDate: "2026-10-20" });
    expect(nextOnOrAfter(s, "2026-10-20")).toBe("2026-11-05");
  });

  it("weekly on a weekday, every N weeks; quarterly and yearly", () => {
    const w: Schedule = { frequency: "weekly", interval: 2, dayOfMonth: null, weekday: 1, startDate: "2026-10-14", endDate: null };
    expect(previewDates(w, "2026-10-14", 3)).toEqual(["2026-10-19", "2026-11-02", "2026-11-16"]);
    expect(previewDates(monthly({ frequency: "quarterly", dayOfMonth: 1, startDate: "2026-04-01" }), "2026-10-14", 2)).toEqual(["2027-01-01", "2027-04-01"]);
    expect(previewDates(monthly({ frequency: "yearly", startDate: "2024-02-29" }), "2026-10-14", 2)).toEqual(["2027-02-28", "2028-02-29"]);
    expect(previewDates(monthly({ interval: 2, dayOfMonth: 10, startDate: "2026-01-10" }), "2026-10-14", 2)).toEqual(["2026-11-10", "2027-01-10"]);
  });

  it("stops at the end date and the bill count", () => {
    const s = monthly({ dayOfMonth: 1, startDate: "2026-01-01", endDate: "2026-03-15" });
    expect(nextAfter(s, "2026-03-01")).toBeNull();
    expect(previewDates(monthly({ dayOfMonth: 1, startDate: "2026-11-01" }), "2026-10-14", 10, 2)).toEqual(["2026-11-01", "2026-12-01"]);
  });

  it("plans a catch-up: latest 3 billed, older ones missed, never past the count limit", () => {
    const s = monthly({ dayOfMonth: 5, startDate: "2026-01-05" });
    expect(planDue(s, "2026-05-05", "2026-10-14", null)).toEqual({
      bill: ["2026-08-05", "2026-09-05", "2026-10-05"],
      missed: ["2026-05-05", "2026-06-05", "2026-07-05"],
      next: "2026-11-05",
    });
    expect(planDue(s, "2026-10-05", "2026-10-14", 1)).toEqual({ bill: ["2026-10-05"], missed: [], next: null });
    expect(planDue(s, "2026-11-05", "2026-10-14", null)).toEqual({ bill: [], missed: [], next: "2026-11-05" });
  });

  it("explains bad schedules", () => {
    expect(scheduleProblem({ ...monthly(), interval: 0 })).toMatch(/1 to 24/);
    expect(scheduleProblem({ ...monthly(), endDate: "2025-01-01" })).toMatch(/end date/);
    expect(scheduleProblem({ ...monthly({ dayOfMonth: 31, startDate: "2026-02-01", endDate: "2026-02-10" }) })).toMatch(/No bill/);
    expect(scheduleProblem(monthly())).toBeNull();
  });

  it("validates the profile input", () => {
    const ok = recurringInputSchema.parse({
      customerId: "11111111-1111-4111-8111-111111111111",
      lines: [{ description: "AMC", qty: 1, rate: 100_000, gstRate: 18 }],
      frequency: "monthly",
      startDate: "2026-11-01",
    });
    expect(ok).toMatchObject({ interval: 1, issueMode: "draft", priceMode: "fixed", sendChannel: "none" });
    expect(() => recurringInputSchema.parse({ ...ok, frequency: "daily" })).toThrow();
  });
});

describe("export supplies and foreign currency", () => {
  it("knows which supplies are zero-tax, IGST-only and placed in 96", () => {
    expect(withoutPayment("export_wopay")).toBe(true);
    expect(withoutPayment("sez_wpay")).toBe(false);
    expect(forcesIgst("sez_wpay")).toBe(true);
    expect(forcesIgst("domestic")).toBe(false);
    expect(taxSellerState("33", "sez_wopay")).not.toBe("33");
    expect(supplyPlace("export_wpay", "33")).toBe("96");
    expect(supplyPlace("sez_wpay", "33")).toBe("33");
  });

  it("converts foreign prices to rupee lines and keeps the foreign figures", () => {
    const f = foreignInputSchema.parse({ currency: "eur", exchangeRate: "90.1234", lines: [{ rate: 12_345, discount: 345 }] });
    expect(f).toEqual({ currency: "EUR", exchangeRate: 90.1234, lines: [{ rate: 12_345, discount: 345 }] });
    const [l] = applyForeign([{ description: "Brass lamp", qty: 3, rate: 1, gstRate: 18, inclusiveTotal: 5 }], f);
    expect(l).toEqual({ description: "Brass lamp", qty: 3, rate: 11_125_73, discount: 31_093, gstRate: 18 });
    const t = foreignTotals([{ qty: 3 }], f, { cgst: 0, sgst: 0, igst: 5_948_63 });
    expect(t).toMatchObject({ currency: "EUR", subtotal: 37_035, discount: 345, taxable: 36_690, tax: 6_601, total: 43_291 });
    expect(() => foreignInputSchema.parse({ currency: "XYZ", exchangeRate: 1, lines: [{ rate: 1 }] })).toThrow();
    expect(() => foreignInputSchema.parse({ currency: "USD", exchangeRate: 0, lines: [{ rate: 1 }] })).toThrow();
  });

  it("splits a foreign receipt into the settled amount and the exchange difference", () => {
    const bill = { currency: "USD", exchangeRate: 83.25, balance: 83_250_00, foreignBalance: 100_000 };
    expect(splitForeignPayment({ amount: 40_000, realisedRate: 84 }, bill)).toEqual({ settled: 33_300_00, received: 33_600_00, forexDiff: 300_00 });
    // The last payment clears the whole rupee balance.
    expect(splitForeignPayment({ amount: 100_000, realisedRate: 82.5 }, { ...bill, balance: 83_249_99 })).toEqual({ settled: 83_249_99, received: 82_500_00, forexDiff: -749_99 });
  });
});
