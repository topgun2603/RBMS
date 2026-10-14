import { describe, expect, it } from "vitest";
import {
  CORE_MODULES,
  hasModuleIn,
  isMonthlyKey,
  limitIn,
  periodFor,
  resolveEntitlements,
  UNLIMITED,
  withinLimit,
  type OverrideLike,
  type PlanLike,
} from "./entitlements";

const starter: PlanLike = {
  id: "starter",
  modules: ["invoices", "orders"],
  limits: { staff: 5, sms_per_month: 500, storage_mb: -1 },
  features: { remove_branding: false },
};

const override = (o: Partial<OverrideLike>): OverrideLike => ({ addModules: [], removeModules: [], limits: {}, features: {}, ...o });

describe("resolveEntitlements", () => {
  it("always includes core modules", () => {
    const e = resolveEntitlements(null, null);
    expect(e.planId).toBeNull();
    for (const m of CORE_MODULES) expect(e.modules).toContain(m);
    expect(e.limits).toEqual({});
    expect(e.features).toEqual({});
  });

  it("adds plan modules, sorted and de-duplicated", () => {
    const e = resolveEntitlements({ ...starter, modules: ["orders", "invoices", "orders", "auth"] }, null);
    expect(e.planId).toBe("starter");
    expect(e.modules).toEqual([...new Set([...CORE_MODULES, "invoices", "orders"])].sort());
  });

  it("applies override add/remove, but never removes core modules", () => {
    const e = resolveEntitlements(starter, override({ addModules: ["chat"], removeModules: ["orders", "auth"] }));
    expect(hasModuleIn(e, "chat")).toBe(true);
    expect(hasModuleIn(e, "orders")).toBe(false);
    expect(hasModuleIn(e, "invoices")).toBe(true);
    expect(hasModuleIn(e, "auth")).toBe(true);
  });

  it("override limits and features replace plan values per key", () => {
    const e = resolveEntitlements(starter, override({ limits: { staff: 10, extra: 3 }, features: { remove_branding: true } }));
    expect(e.limits).toEqual({ staff: 10, sms_per_month: 500, storage_mb: -1, extra: 3 });
    expect(e.features).toEqual({ remove_branding: true });
  });

  it("accepts a custom core module list", () => {
    const e = resolveEntitlements(null, null, ["auth"]);
    expect(e.modules).toEqual(["auth"]);
  });

  it("does not mutate its inputs", () => {
    const plan = structuredClone(starter);
    resolveEntitlements(plan, override({ limits: { staff: 1 }, removeModules: ["orders"] }));
    expect(plan).toEqual(starter);
  });
});

describe("limitIn", () => {
  const e = resolveEntitlements(starter, null);
  it("returns the configured limit", () => expect(limitIn(e, "staff")).toBe(5));
  it("treats missing keys as 0", () => expect(limitIn(e, "nope")).toBe(0));
  it("normalizes negatives to unlimited", () => {
    expect(limitIn(e, "storage_mb")).toBe(UNLIMITED);
    expect(limitIn(resolveEntitlements({ ...starter, limits: { x: -5 } }, null), "x")).toBe(UNLIMITED);
  });
});

describe("withinLimit", () => {
  it("checks used + amount against the limit", () => {
    expect(withinLimit(5, 4, 1)).toBe(true);
    expect(withinLimit(5, 5, 1)).toBe(false);
    expect(withinLimit(0, 0, 1)).toBe(false);
    expect(withinLimit(-1, 1_000_000, 1)).toBe(true);
  });
});

describe("periodFor", () => {
  it("uses lifetime for non-monthly keys", () => {
    expect(isMonthlyKey("staff")).toBe(false);
    expect(periodFor("staff", new Date("2026-10-14T00:00:00Z"))).toBe("lifetime");
    expect(periodFor("per_month_total", new Date())).toBe("lifetime");
  });
  it("uses YYYY-MM for _per_month keys", () => {
    expect(isMonthlyKey("sms_per_month")).toBe(true);
    expect(periodFor("sms_per_month", new Date("2026-10-14T12:00:00Z"))).toBe("2026-10");
    expect(periodFor("sms_per_month", new Date("2026-01-01T00:00:00+05:30"))).toBe("2026-01");
  });
  it("rolls over at IST midnight by default", () => {
    // 2026-10-31 19:00 UTC is 2026-11-01 00:30 IST.
    expect(periodFor("sms_per_month", new Date("2026-10-31T19:00:00Z"))).toBe("2026-11");
    expect(periodFor("sms_per_month", new Date("2026-10-31T18:00:00Z"))).toBe("2026-10");
    // With a UTC offset of 0 it is still October.
    expect(periodFor("sms_per_month", new Date("2026-10-31T19:00:00Z"), 0)).toBe("2026-10");
    // Year boundary.
    expect(periodFor("sms_per_month", new Date("2026-12-31T20:00:00Z"))).toBe("2027-01");
  });
});
