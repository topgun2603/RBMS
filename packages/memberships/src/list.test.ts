import { AppError } from "@rbms/core";
import { createDb } from "@rbms/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { membershipMembers } from "./schema";
import { checkinInput, MEMBER_SORT, memberInput, memberListQuery, MembershipsService, planInput } from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const svc = new MembershipsService({ db });

const where = (q: Record<string, unknown>, withStatus = true) =>
  db.select().from(membershipMembers).where(svc.listConditions(T, memberListQuery.parse(q), "2026-10-20", 7, withStatus)).toSQL();

describe("member list query", () => {
  it("pages 25 / 100 and accepts comma lists of statuses", () => {
    expect(memberListQuery.parse({}).limit).toBe(25);
    expect(() => memberListQuery.parse({ limit: "101" })).toThrow(ZodError);
    expect(memberListQuery.parse({ status: "active,expiring" }).status).toEqual(["active", "expiring"]);
    expect(() => memberListQuery.parse({ status: "gold" })).toThrow(ZodError);
  });

  it("filters by tenant, status window and search", () => {
    const s = where({ status: "expiring,none", q: "meena" });
    expect(s.sql).toContain('"membership_members"."tenant_id" = $1');
    expect(s.sql).toContain("between");
    expect(s.sql).toContain("is null");
    expect(s.sql).toContain("ilike");
    expect(s.params).toEqual(expect.arrayContaining([T, "2026-10-20", "2026-10-27", "%meena%"]));
    expect(where({ status: "expired" }, false).sql).not.toContain("is null");
  });

  it("sorts by known keys only", () => {
    expect(MEMBER_SORT.keys).toEqual(expect.arrayContaining(["name", "code", "endsOn", "lastVisit", "joined"]));
    expect(() => MEMBER_SORT.orderBy("phone")).toThrow(AppError);
    expect(MEMBER_SORT.orderBy("-endsOn").length).toBeGreaterThan(1);
  });
});

describe("inputs", () => {
  it("validates plans", () => {
    expect(planInput.parse({ name: "Gym monthly", durationDays: 30, price: 150000 })).toMatchObject({ gstRate: 18, freezeDaysAllowed: 0 });
    expect(() => planInput.parse({ name: "X", durationDays: 30, price: 100, gstRate: 7 })).toThrow(ZodError);
    expect(() => planInput.parse({ name: "X", durationDays: 0, price: 100 })).toThrow(ZodError);
  });

  it("normalises the member's mobile and refuses bad ones", () => {
    expect(memberInput.parse({ name: "Meena", phone: "98765 43210" }).phone).toBe("+919876543210");
    expect(memberInput.parse({ name: "Meena", phone: "" }).phone).toBeNull();
    expect(() => memberInput.parse({ name: "Meena", phone: "12345" })).toThrow(ZodError);
  });

  it("needs a member id or a code to check in", () => {
    expect(() => checkinInput.parse({})).toThrow(ZodError);
    expect(checkinInput.parse({ code: "M-0042" }).code).toBe("M-0042");
  });
});
