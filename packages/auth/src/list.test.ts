import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { USER_SORT, userListConditions, userListQuerySchema } from "./list";
import { users } from "./schema";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const where = (q: Record<string, unknown>, omit?: "status" | "role") =>
  db.select().from(users).where(userListConditions(userListQuerySchema.parse(q), omit)).toSQL();

describe("user list query", () => {
  it("keeps the 50/200 limits, a 254-char search and comma lists", () => {
    expect(userListQuerySchema.parse({}).limit).toBe(50);
    expect(() => userListQuerySchema.parse({ limit: "201" })).toThrow(ZodError);
    expect(userListQuerySchema.parse({ q: "a".repeat(254) }).q).toHaveLength(254);
    expect(() => userListQuerySchema.parse({ q: "a".repeat(255) })).toThrow(ZodError);
    const p = userListQuerySchema.parse({ status: "active,disabled", role: "superadmin" });
    expect(p.status).toEqual(["active", "disabled"]);
    expect(p.role).toEqual(["superadmin"]);
    expect(() => userListQuerySchema.parse({ status: "banned" })).toThrow(ZodError);
    expect(() => userListQuerySchema.parse({ role: "owner" })).toThrow(ZodError);
  });

  it("filters status and platform role (superadmin holders or no role)", () => {
    const q = where({ status: "disabled", role: "superadmin,none" });
    expect(q.sql).toContain('"users"."status" in ($');
    expect(q.sql).toContain('= any("users"."platform_roles")');
    expect(q.sql).toContain('cardinality("users"."platform_roles") = 0');
    expect(q.params).toEqual(["disabled", "superadmin"]);
  });

  it("searches email, name and phone, and matches a typed phone number exactly", () => {
    const q = where({ q: "98765 43210" });
    expect(q.sql).toContain('"users"."email" ilike $');
    expect(q.sql).toContain('"users"."name" ilike $');
    expect(q.sql).toContain('"users"."phone" = $');
    expect(q.params).toContain("+919876543210");
    expect(where({ q: "meena_k" }).params).toEqual(["%meena\\_k%", "%meena\\_k%", "%meena\\_k%"]);
  });

  it("leaves one filter out for its facet counts", () => {
    expect(where({ status: "active", role: "none" }, "status").params).toEqual([]);
    expect(where({ status: "active", role: "superadmin" }, "role").params).toEqual(["active"]);
  });

  it("sorts by the whitelisted fields only", () => {
    const render = (s?: string) => db.select().from(users).orderBy(...USER_SORT.orderBy(s)).toSQL().sql;
    expect(USER_SORT.keys).toEqual(["name", "email", "phone", "created", "lastActive"]);
    expect(render()).toContain('order by "users"."created_at" desc nulls last, "users"."id" desc');
    expect(render("-lastActive")).toContain('"users"."last_login_at" desc nulls last');
    expect(render("name")).toContain('lower("users"."name") asc nulls last');
    expect(() => render("platformRoles")).toThrow(AppError);
  });
});
