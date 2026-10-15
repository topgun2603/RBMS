import { describe, expect, it } from "vitest";
import { emptyContext, type RequestContext, type UserRef } from "./context";
import { AppError } from "./errors";
import { hasPermission, permissionMatches, permissionsAllow, requirePermission } from "./permissions";

const tenant = { id: "t1", slug: "sri", planId: null, appId: null };
const user = (tenantRoles: string[], permissions?: string[], platformRoles: string[] = []): UserRef => ({
  id: "u1",
  sessionId: "s1",
  platformRoles,
  tenantRoles,
  ...(permissions ? { permissions } : {}),
});
const ctx = (u: UserRef | null, t: RequestContext["tenant"] = tenant): RequestContext => ({ ...emptyContext(), tenant: t, user: u });

describe("permissionMatches", () => {
  it.each([
    ["*", "invoices.cancel", true],
    ["invoices.cancel", "invoices.cancel", true],
    ["invoices.cancel", "invoices.create", false],
    ["invoices.*", "invoices.cancel", true],
    ["invoices.*", "invoices", true],
    ["invoices.*", "invoices.reports.view", true],
    ["invoices.*", "inventory.adjust", false],
    ["invoices.*", "invoicesx.cancel", false],
    ["*.view", "reports.view", true],
    ["*.view", "reports.manage", false],
    ["*.view", "view", false],
    ["*.view", "a.b.view", false],
    ["orders.*.view", "orders.items.view", true],
    ["invoices", "invoices.cancel", false],
  ])("%s covers %s → %s", (g, k, expected) => {
    expect(permissionMatches(g, k)).toBe(expected);
  });

  it("permissionsAllow treats undefined as []", () => {
    expect(permissionsAllow(undefined, "x.y")).toBe(false);
    expect(permissionsAllow(["a.b", "x.*"], "x.y")).toBe(true);
  });
});

describe("hasPermission / requirePermission", () => {
  it("owner, admin and super-admin always pass", () => {
    expect(hasPermission(ctx(user(["owner"])), "invoices.cancel")).toBe(true);
    expect(hasPermission(ctx(user(["admin"], [])), "settings.manage")).toBe(true);
    const sa = user([], [], ["superadmin"]);
    expect(hasPermission(ctx(sa, null), "anything.at-all")).toBe(true);
    expect(requirePermission(ctx(sa, null), "x.y")).toBe(sa);
  });

  it("staff need a matching permission", () => {
    const cashier = ctx(user(["staff", "role:cashier"], ["invoices.create", "catalogue.view"]));
    expect(hasPermission(cashier, "invoices.create")).toBe(true);
    expect(hasPermission(cashier, "invoices.create", "invoices.cancel")).toBe(false);
    try {
      requirePermission(cashier, "invoices.create", "invoices.cancel");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).status).toBe(403);
      expect((err as AppError).code).toBe("permission_denied");
      expect((err as AppError).details).toEqual({ permission: "invoices.cancel" });
    }
  });

  it("staff without permissions (missing field) are denied", () => {
    expect(hasPermission(ctx(user(["staff"])), "invoices.create")).toBe(false);
  });

  it("needs a user and a tenant", () => {
    expect(hasPermission(ctx(null), "x.y")).toBe(false);
    expect(() => requirePermission(ctx(null), "x.y")).toThrow(expect.objectContaining({ status: 401 }));
    expect(hasPermission(ctx(user(["owner"]), null), "x.y")).toBe(false);
    expect(() => requirePermission(ctx(user(["owner"]), null), "x.y")).toThrow(expect.objectContaining({ code: "forbidden" }));
  });
});
