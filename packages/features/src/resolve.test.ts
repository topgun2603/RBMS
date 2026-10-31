import type { FeatureDef } from "@rbms/core";
import { describe, expect, it } from "vitest";
import { grants, normalizeGrants, resolveFeatures, shopAllows, type ResolveInput } from "./resolve";

const def = (key: string, extra: Partial<FeatureDef> = {}): FeatureDef => ({
  key,
  module: key.split(".")[0]!,
  label: key,
  description: "",
  ...extra,
});

/** The billing registry from docs/features.md. */
const BILLING: FeatureDef[] = [
  def("invoices"),
  def("invoices.whatsapp", { dependsOn: ["invoices"], shopToggle: true }),
  def("invoices.reminders", { dependsOn: ["invoices.whatsapp"], shopToggle: true }),
  def("invoices.credit-book", { dependsOn: ["invoices"], shopToggle: true }),
  def("invoices.reports", { dependsOn: ["invoices"] }),
  def("invoices.gst-reports", { dependsOn: ["invoices.reports"] }),
  def("inventory", { dependsOn: ["invoices"], shopToggle: true }),
  def("inventory.purchases", { dependsOn: ["inventory"], shopToggle: true }),
  def("payments", { shopToggle: true }),
];

const ALL_PLAN = { modules: ["invoices.*", "inventory.*", "payments.*"], features: {} };

function run(over: Partial<ResolveInput> = {}) {
  const r = resolveFeatures({ registry: BILLING, app: null, plan: ALL_PLAN, toggles: {}, ...over });
  const by = Object.fromEntries(r.features.map((f) => [f.key, f]));
  return { ...r, by };
}

describe("grants", () => {
  it("grants by exact key", () => {
    expect(grants(["invoices.reports"], def("invoices.reports"))).toBe(true);
    expect(grants(["invoices.reports"], def("invoices.whatsapp"))).toBe(false);
  });

  it("module.* grants all of its features", () => {
    expect(grants(["invoices.*"], def("invoices"))).toBe(true);
    expect(grants(["invoices.*"], def("invoices.credit-book"))).toBe(true);
    expect(grants(["invoices.*"], def("inventory"))).toBe(false);
  });

  it("a bare module id is only the base feature (stock without purchases)", () => {
    expect(grants(["inventory"], def("inventory"))).toBe(true);
    expect(grants(["inventory"], def("inventory.purchases"))).toBe(false);
  });

  it("does not confuse modules sharing a prefix", () => {
    expect(grants(["invoices.*"], def("invoicesx.thing", { module: "invoicesx" }))).toBe(false);
  });
});

describe("resolveFeatures — app level", () => {
  it("no profile allows everything registered", () => {
    const { enabled } = run({ app: null });
    expect(enabled).toEqual(BILLING.map((d) => d.key));
  });

  it("a profile restricts to its grants with reason app", () => {
    const { by } = run({ app: ["invoices", "invoices.whatsapp", "invoices.reports", "invoices.gst-reports", "inventory", "payments"] });
    expect(by["invoices.credit-book"]).toMatchObject({ enabled: false, reason: "app", available: false });
    expect(by["invoices.reminders"]).toMatchObject({ enabled: false, reason: "app" });
    expect(by["invoices.gst-reports"]!.enabled).toBe(true);
    expect(by["payments"]!.enabled).toBe(true);
  });

  it("a module wildcard in a profile grants all its features", () => {
    const { by } = run({ app: ["invoices.*"] });
    expect(by["invoices.reminders"]!.enabled).toBe(true);
    expect(by["invoices.gst-reports"]!.enabled).toBe(true);
    expect(by["inventory"]).toMatchObject({ enabled: false, reason: "app" });
  });

  it("an empty profile turns everything off", () => {
    expect(run({ app: [] }).enabled).toEqual([]);
  });
});

describe("resolveFeatures — plan level", () => {
  it("plan module wildcard grants every feature of the module", () => {
    const { by } = run({ plan: { modules: ["invoices.*"], features: {} } });
    expect(by["invoices.credit-book"]!.enabled).toBe(true);
    expect(by["payments"]).toMatchObject({ enabled: false, reason: "plan" });
  });

  it("specific keys grant only those features", () => {
    const { by, enabled } = run({ plan: { modules: ["invoices", "invoices.whatsapp", "invoices.reports"], features: {} } });
    expect(enabled).toEqual(["invoices", "invoices.whatsapp", "invoices.reports"]);
    expect(by["invoices.credit-book"]).toMatchObject({ enabled: false, reason: "plan", available: false });
    expect(by["invoices.reminders"]).toMatchObject({ enabled: false, reason: "plan" });
  });

  it("starter: reminders and purchases are off with reason plan", () => {
    const starter = [
      "invoices",
      "invoices.whatsapp",
      "invoices.reports",
      "invoices.credit-book",
      "invoices.gst-reports",
      "inventory",
      "payments",
    ];
    const { by } = run({ plan: { modules: starter, features: {} } });
    expect(by["invoices.reminders"]).toMatchObject({ enabled: false, reason: "plan" });
    expect(by["invoices.credit-book"]!.enabled).toBe(true);
    expect(by["inventory.purchases"]).toMatchObject({ enabled: false, reason: "plan" });
  });

  it("features[key] === false denies even when the module is granted", () => {
    const { by } = run({ plan: { modules: ["invoices.*", "inventory.*", "payments.*"], features: { "invoices.reminders": false } } });
    expect(by["invoices.reminders"]).toMatchObject({ enabled: false, reason: "plan" });
    expect(by["invoices.whatsapp"]!.enabled).toBe(true);
  });

  it("features[key] === true does not grant by itself", () => {
    const { by } = run({ plan: { modules: [], features: { payments: true } } });
    expect(by["payments"]).toMatchObject({ enabled: false, reason: "plan" });
  });
});

describe("resolveFeatures — dependencies", () => {
  it("a dependency that is off disables the dependent with reason dependency", () => {
    // Plan grants reminders but not whatsapp.
    const { by } = run({ plan: { modules: ["invoices", "invoices.reminders"], features: {} } });
    expect(by["invoices.whatsapp"]).toMatchObject({ reason: "plan" });
    expect(by["invoices.reminders"]).toMatchObject({ enabled: false, reason: "dependency", available: false });
  });

  it("follows transitive chains", () => {
    // invoices off at plan → reports (dependency) → gst-reports (dependency).
    const { by } = run({ plan: { modules: ["invoices.reports", "invoices.gst-reports"], features: {} } });
    expect(by["invoices"]).toMatchObject({ reason: "plan" });
    expect(by["invoices.reports"]).toMatchObject({ reason: "dependency" });
    expect(by["invoices.gst-reports"]).toMatchObject({ reason: "dependency" });
  });

  it("a dependency switched off by the shop disables the dependent", () => {
    const { by } = run({ toggles: { "invoices.whatsapp": false } });
    expect(by["invoices.whatsapp"]).toMatchObject({ enabled: false, reason: "shop", available: true });
    expect(by["invoices.reminders"]).toMatchObject({ enabled: false, reason: "dependency", available: false });
    expect(by["inventory.purchases"]!.enabled).toBe(true);
  });

  it("an unregistered dependency disables the feature", () => {
    const registry = [def("a", { dependsOn: ["missing"] })];
    const r = resolveFeatures({ registry, app: null, plan: { modules: ["a"], features: {} }, toggles: {} });
    expect(r.features[0]).toMatchObject({ enabled: false, reason: "dependency" });
  });

  it("guards against cycles", () => {
    const registry = [
      def("a", { dependsOn: ["b"] }),
      def("b", { dependsOn: ["c"] }),
      def("c", { dependsOn: ["a"] }),
      def("d", { dependsOn: ["d"] }),
      def("e"),
    ];
    const r = resolveFeatures({ registry, app: null, plan: { modules: ["a", "b", "c", "d", "e"], features: {} }, toggles: {} });
    expect(r.features.map((f) => [f.key, f.reason])).toEqual([
      ["a", "dependency"],
      ["b", "dependency"],
      ["c", "dependency"],
      ["d", "dependency"],
      ["e", null],
    ]);
    expect(r.enabled).toEqual(["e"]);
  });
});

describe("resolveFeatures — shop switches", () => {
  it("defaults to on, and defaultOn: false defaults to off", () => {
    const registry = [def("x", { shopToggle: true }), def("y", { shopToggle: true, defaultOn: false })];
    const r = resolveFeatures({ registry, app: null, plan: { modules: ["x", "y"], features: {} }, toggles: {} });
    expect(r.features[0]).toMatchObject({ enabled: true, shopEnabled: null });
    expect(r.features[1]).toMatchObject({ enabled: false, reason: "shop", available: true, shopEnabled: null });
  });

  it("owner's switch wins over defaultOn", () => {
    const registry = [def("x", { shopToggle: true }), def("y", { shopToggle: true, defaultOn: false })];
    const r = resolveFeatures({ registry, app: null, plan: { modules: ["x", "y"], features: {} }, toggles: { x: false, y: true } });
    expect(r.features[0]).toMatchObject({ enabled: false, reason: "shop", shopEnabled: false });
    expect(r.features[1]).toMatchObject({ enabled: true, reason: null, shopEnabled: true });
  });

  it("defaultOnApps: on by default only in those apps (enquiries for schools)", () => {
    const registry = [def("enquiries", { shopToggle: true, defaultOnApps: ["SC"] })];
    const plan = { modules: ["enquiries"], features: {} };
    expect(resolveFeatures({ registry, app: null, plan, toggles: {}, appId: "SC" }).enabled).toEqual(["enquiries"]);
    expect(resolveFeatures({ registry, app: null, plan, toggles: {}, appId: "EC" }).features[0]).toMatchObject({ enabled: false, reason: "shop", available: true });
    expect(resolveFeatures({ registry, app: null, plan, toggles: {}, appId: null }).enabled).toEqual([]);
    expect(resolveFeatures({ registry, app: null, plan, toggles: { enquiries: true }, appId: "EC" }).enabled).toEqual(["enquiries"]);
  });

  it("ignores toggles for non-toggle features", () => {
    const { by } = run({ toggles: { invoices: false, "invoices.reports": false } });
    expect(by["invoices"]!.enabled).toBe(true);
    expect(by["invoices.reports"]).toMatchObject({ enabled: true, shopEnabled: null });
    expect(shopAllows(def("z"), { z: false })).toBe(true);
  });
});

describe("resolveFeatures — reason precedence", () => {
  it("app beats plan beats dependency beats shop", () => {
    const toggles = { "invoices.reminders": false, "invoices.whatsapp": false };
    // app denies → app
    expect(run({ app: ["invoices.*"], plan: { modules: [], features: {} }, toggles }).by["payments"]!.reason).toBe("app");
    // app allows, plan denies → plan (even with a failing dependency and a shop switch)
    expect(
      run({ plan: { modules: ["invoices", "invoices.whatsapp"], features: {} }, toggles }).by["invoices.reminders"]!.reason,
    ).toBe("plan");
    // app + plan allow, dependency off (shop) and own switch off → dependency
    expect(run({ toggles }).by["invoices.reminders"]!.reason).toBe("dependency");
    // only the own switch is off → shop
    expect(run({ toggles: { "invoices.reminders": false } }).by["invoices.reminders"]!.reason).toBe("shop");
  });

  it("available reflects app + plan + dependencies only", () => {
    const { by } = run({ toggles: { payments: false } });
    expect(by["payments"]).toMatchObject({ enabled: false, available: true, shopEnabled: false });
    const off = run({ app: ["invoices.*"] }).by["payments"]!;
    expect(off).toMatchObject({ available: false });
  });

  it("returns states in registry order with def details", () => {
    const { features } = run();
    expect(features.map((f) => f.key)).toEqual(BILLING.map((d) => d.key));
    expect(features[1]).toMatchObject({ module: "invoices", dependsOn: ["invoices"], shopToggle: true });
    expect(features[0]).toMatchObject({ dependsOn: [], shopToggle: false });
  });
});

describe("normalizeGrants", () => {
  it("rejects unknown keys", () => {
    expect(normalizeGrants(["invoices", "nope", "invoices.nope"], BILLING).unknown).toEqual(["nope", "invoices.nope"]);
  });

  it("accepts wildcards and keys, de-duplicated", () => {
    expect(normalizeGrants(["payments", "payments", "inventory.*"], BILLING).features).toEqual(["payments", "inventory.*", "invoices"]);
    expect(normalizeGrants(["inventory.purchase*"], BILLING).unknown).toEqual(["inventory.purchase*"]);
  });

  it("adds dependencies transitively", () => {
    const { features } = normalizeGrants(["invoices.reminders", "invoices.gst-reports"], BILLING);
    expect(features).toEqual(
      expect.arrayContaining(["invoices.reminders", "invoices.whatsapp", "invoices", "invoices.gst-reports", "invoices.reports"]),
    );
    expect(features).toHaveLength(5);
    // The normalized list still grants only the named invoices features.
    const r = resolveFeatures({ registry: BILLING, app: features, plan: ALL_PLAN, toggles: {} });
    expect(r.enabled).toEqual(["invoices", "invoices.whatsapp", "invoices.reminders", "invoices.reports", "invoices.gst-reports"]);
  });

  it("leaves complete lists unchanged", () => {
    const ec = ["invoices", "invoices.whatsapp", "invoices.reports", "invoices.gst-reports", "inventory", "payments"];
    expect(normalizeGrants(ec, BILLING)).toEqual({ features: ec, unknown: [] });
  });
});
