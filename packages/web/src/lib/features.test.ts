import { describe, expect, it } from "vitest";
import { featureChecker, grantAllows, normalizeFeatures } from "./features";
import type { FeatureState } from "./types";

const f = (key: string, enabled: boolean, reason: FeatureState["reason"] = null, dependsOn: string[] = []): FeatureState => ({
  key,
  module: key.split(".")[0]!,
  label: key,
  description: "",
  dependsOn,
  shopToggle: key !== "invoices",
  enabled,
  reason: enabled ? null : reason,
  available: enabled || reason === "shop",
  shopEnabled: null,
});

describe("grantAllows", () => {
  it("handles exact keys and module wildcards", () => {
    expect(grantAllows(["invoices"], "invoices")).toBe(true);
    expect(grantAllows(["invoices"], "invoices.reports")).toBe(false);
    expect(grantAllows(["invoices.*"], "invoices")).toBe(true);
    expect(grantAllows(["invoices.*"], "invoices.credit-book")).toBe(true);
    expect(grantAllows(["invoices.*"], "inventory")).toBe(false);
  });
});

describe("featureChecker", () => {
  const data = normalizeFeatures({
    appId: "EC",
    planId: "pro",
    features: [
      f("invoices", true),
      f("invoices.whatsapp", true, null, ["invoices"]),
      f("invoices.reminders", false, "app", ["invoices.whatsapp"]),
      f("invoices.credit-book", false, "app", ["invoices"]),
      f("invoices.reports", false, "shop", ["invoices"]),
      f("invoices.gst-reports", false, "dependency", ["invoices.reports"]),
      f("inventory", true, null, ["invoices"]),
      f("inventory.purchases", false, "plan", ["inventory"]),
    ],
  });
  const { check } = featureChecker(data);

  it("passes enabled features and requirements with no feature", () => {
    expect(check("invoices").ok).toBe(true);
    expect(check(undefined).ok).toBe(true);
    expect(check(["invoices", "inventory"]).ok).toBe(true);
  });

  it("reports the reason, following dependencies to the real cause", () => {
    expect(check("invoices.credit-book")).toMatchObject({ ok: false, reason: "app" });
    expect(check("inventory.purchases")).toMatchObject({ ok: false, reason: "plan" });
    expect(check("invoices.gst-reports")).toMatchObject({ ok: false, key: "invoices.gst-reports", cause: "invoices.reports", reason: "shop" });
    expect(check(["invoices", "inventory.purchases"])).toMatchObject({ ok: false, key: "inventory.purchases" });
  });

  it("treats unknown keys as off and applies a module's own restriction", () => {
    expect(check("unknown.thing")).toMatchObject({ ok: false, reason: "app" });
    expect(check("inventory", ["invoices.*"])).toMatchObject({ ok: false, reason: "app" });
    expect(check("invoices.whatsapp", ["invoices.*"]).ok).toBe(true);
  });

  it("fails open while the server hasn't answered (the API still enforces)", () => {
    const empty = featureChecker(undefined);
    expect(empty.check("inventory.purchases").ok).toBe(true);
    expect(empty.check("inventory", ["invoices"]).ok).toBe(false);
  });
});
