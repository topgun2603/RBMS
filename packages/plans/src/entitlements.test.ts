import { describe, expect, it } from "vitest";
import {
  CORE_MODULES,
  hasModuleIn,
  isMonthlyKey,
  limitIn,
  offeredBy,
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

describe("add-ons in entitlements", () => {
  const extraStaff = { id: "extra-staff", kind: "limit" as const, quantity: 2, limits: { staff: 5 }, modules: [] };
  const storage = { id: "storage", kind: "limit" as const, quantity: 1, limits: { storage_mb: 10_000 }, modules: [] };
  const marketplace = { id: "marketplace", kind: "feature" as const, quantity: 1, limits: {}, modules: ["marketplace.*", "kyc"] };
  const smsPack = { id: "sms", kind: "credits" as const, quantity: 3, limits: { sms_per_month: 5000 }, modules: [] };

  it("limit add-ons add per unit × quantity; an unlimited limit stays unlimited; a missing key starts from 0", () => {
    const e = resolveEntitlements(starter, null, CORE_MODULES, { addons: [extraStaff, storage, { ...extraStaff, id: "wa", limits: { whatsapp_per_month: 1000 }, quantity: 1 }] });
    expect(e.limits.staff).toBe(15);
    expect(e.limits.storage_mb).toBe(-1);
    expect(e.limits.whatsapp_per_month).toBe(1000);
    expect(e.addonLimits).toEqual({ staff: 10, whatsapp_per_month: 1000 });
    expect(e.addons).toEqual([
      { id: "extra-staff", quantity: 2 },
      { id: "storage", quantity: 1 },
      { id: "wa", quantity: 1 },
    ]);
  });

  it("adds on top of an override limit", () => {
    const override: OverrideLike = { addModules: [], removeModules: [], limits: { staff: 8 }, features: {} };
    expect(resolveEntitlements(starter, override, CORE_MODULES, { addons: [extraStaff] }).limits.staff).toBe(18);
  });

  it("feature add-ons unlock only what the app offers; a manual block still wins", () => {
    const offered = (k: string) => k === "kyc";
    const e = resolveEntitlements(starter, null, CORE_MODULES, { addons: [marketplace], offered });
    expect(hasModuleIn(e, "kyc")).toBe(true);
    expect(hasModuleIn(e, "marketplace.*")).toBe(false);
    const blocked = resolveEntitlements(starter, { addModules: [], removeModules: ["kyc"], limits: {}, features: {} }, CORE_MODULES, { addons: [marketplace] });
    expect(hasModuleIn(blocked, "kyc")).toBe(false);
    expect(hasModuleIn(blocked, "marketplace.*")).toBe(true);
  });

  it("credits packs and zero quantities change nothing", () => {
    const e = resolveEntitlements(starter, null, CORE_MODULES, { addons: [smsPack, { ...extraStaff, quantity: 0 }] });
    expect(e).toEqual(resolveEntitlements(starter, null));
    expect(e.addons).toBeUndefined();
  });

  it("offeredBy: exact keys, module wildcards, wildcards only through wildcards, no profile offers all", () => {
    expect(offeredBy(["marketplace.*", "chat"], "marketplace.sellers")).toBe(true);
    expect(offeredBy(["marketplace.*"], "marketplace")).toBe(true);
    expect(offeredBy(["marketplace"], "marketplace.*")).toBe(false);
    expect(offeredBy(["marketplace.*"], "marketplace.*")).toBe(true);
    expect(offeredBy(["chat"], "custom-domain")).toBe(false);
    expect(offeredBy(null, "anything")).toBe(true);
  });
});
