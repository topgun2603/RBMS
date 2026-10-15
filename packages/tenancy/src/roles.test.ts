import { AppError } from "@srirealtime/core";
import { describe, expect, it } from "vitest";
import { baseLevel, customRoleKeys, normalizeMemberRoles } from "./roles";

describe("normalizeMemberRoles", () => {
  it("keeps existing plain roles valid", () => {
    expect(normalizeMemberRoles(["staff"])).toEqual(["staff"]);
    expect(normalizeMemberRoles(["owner"])).toEqual(["owner"]);
    expect(normalizeMemberRoles(["member"])).toEqual(["member"]);
  });

  it("accepts custom roles after one base level (sorted, unique)", () => {
    expect(normalizeMemberRoles(["role:cashier", "staff", "role:accountant", "role:cashier"])).toEqual([
      "staff",
      "role:accountant",
      "role:cashier",
    ]);
  });

  it("collapses several base levels to the strongest", () => {
    expect(normalizeMemberRoles(["staff", "admin"])).toEqual(["admin"]);
    expect(normalizeMemberRoles(["member", "owner", "staff"])).toEqual(["owner"]);
  });

  it.each([
    [[], "no base"],
    [["role:cashier"], "custom only"],
    [["manager"], "unknown plain role"],
    [["staff", "role:Cashier"], "uppercase key"],
    [["staff", "role:c"], "key too short"],
    [["staff", "role:1abc"], "starts with digit"],
    [["staff", `role:${"a".repeat(33)}`], "key too long"],
    [["staff", "role:cash_ier"], "underscore"],
  ])("rejects %j (%s)", (roles) => {
    expect(() => normalizeMemberRoles(roles as string[])).toThrow(AppError);
    try {
      normalizeMemberRoles(roles as string[]);
    } catch (err) {
      expect((err as AppError).status).toBe(400);
    }
  });

  it("helpers", () => {
    expect(baseLevel(["role:x", "staff"])).toBe("staff");
    expect(baseLevel(["admin", "staff"])).toBe("admin");
    expect(baseLevel(["role:x"])).toBeNull();
    expect(customRoleKeys(["staff", "role:cashier", "role:delivery"])).toEqual(["cashier", "delivery"]);
  });
});
