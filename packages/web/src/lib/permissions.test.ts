import { describe, expect, it } from "vitest";
import { permissionAllows, permissionMatches, permissionsAllow, roleAllows } from "./permissions";

describe("permissionMatches (mirrors @rbms/core)", () => {
  it.each([
    ["*", "orders.cancel", true],
    ["orders.cancel", "orders.cancel", true],
    ["orders.cancel", "orders.refund", false],
    ["orders.*", "orders.ship", true],
    ["orders.*", "orders.returns.approve", true],
    ["orders.*", "orders", true],
    ["orders.*", "ordersx.ship", false],
    ["orders.*", "coupons.manage", false],
    ["*.view", "reports.view", true],
    ["*.view", "audit.manage", false],
    ["*.view", "reports.sales.view", false],
    ["orders.*.approve", "orders.returns.approve", true],
    ["orders.*.approve", "orders.returns", false],
    ["orders", "orders.ship", false],
  ])("%s covers %s → %s", (g, k, expected) => {
    expect(permissionMatches(g, k)).toBe(expected);
  });

  it("checks a list of grants", () => {
    expect(permissionsAllow(["staff.manage", "orders.*"], "orders.ship")).toBe(true);
    expect(permissionsAllow(["staff.manage"], "orders.ship")).toBe(false);
    expect(permissionsAllow(undefined, "orders.ship")).toBe(false);
  });
});

describe("permissionAllows", () => {
  const staff = (permissions: string[] | null) => ({ fullAccess: false, permissions });

  it("passes when nothing is required", () => {
    expect(permissionAllows(staff([]), undefined)).toBe(true);
    expect(permissionAllows(staff([]), [])).toBe(true);
  });

  it("lets owners/admins/super-admins through whatever their list says", () => {
    expect(permissionAllows({ fullAccess: true, permissions: [] }, "staff.manage")).toBe(true);
  });

  it("treats an array as any-of", () => {
    expect(permissionAllows(staff(["reports.view"]), ["settings.manage", "reports.view"])).toBe(true);
    expect(permissionAllows(staff(["orders.view"]), ["settings.manage", "reports.view"])).toBe(false);
  });

  it("uses wildcards and fails open without a permission list", () => {
    expect(permissionAllows(staff(["*"]), "audit.view")).toBe(true);
    expect(permissionAllows(staff(["cms.*"]), "cms.manage")).toBe(true);
    expect(permissionAllows(staff(["cms.*"]), "reviews.manage")).toBe(false);
    expect(permissionAllows(staff(null), "audit.view")).toBe(true);
  });

  it("explicit mode ignores broad cross-module patterns", () => {
    expect(permissionAllows(staff(["*.view"]), "audit.view")).toBe(true);
    expect(permissionAllows(staff(["*.view"]), "audit.view", { explicit: true })).toBe(false);
    expect(permissionAllows(staff(["audit.*"]), "audit.view", { explicit: true })).toBe(true);
    expect(permissionAllows(staff(["*"]), "audit.view", { explicit: true })).toBe(true);
    expect(permissionAllows(staff(["audit.view"]), "audit.view", { explicit: true })).toBe(true);
  });
});

describe("roleAllows", () => {
  it("is any-of, empty = everyone", () => {
    expect(roleAllows(["staff"], undefined)).toBe(true);
    expect(roleAllows(["staff"], [])).toBe(true);
    expect(roleAllows(["staff"], ["owner", "admin"])).toBe(false);
    expect(roleAllows(["admin"], ["owner", "admin"])).toBe(true);
  });
});
