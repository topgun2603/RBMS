import { AppError } from "@rbms/core";
import { createDb } from "@rbms/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { TENANT_SORT, tenantListConditions, tenantListQuerySchema } from "./list";
import { tenants } from "./schema";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const where = (q: Record<string, unknown>, omit?: "status" | "plan" | "app") =>
  db.select().from(tenants).where(tenantListConditions(tenantListQuerySchema.parse(q), omit)).toSQL();

describe("tenant list query", () => {
  it("keeps the 50/200 limits and splits comma lists", () => {
    expect(tenantListQuerySchema.parse({}).limit).toBe(50);
    expect(tenantListQuerySchema.parse({ limit: "200" }).limit).toBe(200);
    expect(() => tenantListQuerySchema.parse({ limit: "201" })).toThrow(ZodError);
    const p = tenantListQuerySchema.parse({ status: "active,suspended", plan: "starter,none", app: "BL", q: "  " });
    expect(p.status).toEqual(["active", "suspended"]);
    expect(p.plan).toEqual(["starter", "none"]);
    expect(p.app).toEqual(["BL"]);
    expect(p.q).toBeUndefined();
    expect(() => tenantListQuerySchema.parse({ status: "deleted" })).toThrow(ZodError);
    expect(() => tenantListQuerySchema.parse({ plan: "Bad Plan" })).toThrow(ZodError);
    expect(() => tenantListQuerySchema.parse({ app: "a;b" })).toThrow(ZodError);
  });

  it("filters status, plan and app; `none` matches unset", () => {
    const q = where({ status: "suspended", plan: "starter,none", app: "none" });
    expect(q.sql).toContain('"tenants"."status" in ($');
    expect(q.sql).toContain('"tenants"."plan_id" in ($');
    expect(q.sql).toContain('"tenants"."plan_id" is null');
    expect(q.sql).toContain('"tenants"."app_id" is null');
    expect(q.sql).not.toContain('"tenants"."app_id" in');
    expect(q.params).toEqual(["suspended", "starter"]);
  });

  it("searches name and slug with LIKE wildcards escaped", () => {
    const q = where({ q: "50%_off" });
    expect(q.sql).toContain('"tenants"."name" ilike $');
    expect(q.sql).toContain('"tenants"."slug" ilike $');
    expect(q.params).toEqual(["%50\\%\\_off%", "%50\\%\\_off%"]);
  });

  it("leaves one filter out for its facet counts", () => {
    const q = where({ status: "active", plan: "pro", app: "EC" }, "plan");
    expect(q.params).toEqual(["active", "EC"]);
    expect(where({}).sql).not.toContain("where");
  });

  it("sorts by the whitelisted fields only", () => {
    const render = (s?: string) => db.select().from(tenants).orderBy(...TENANT_SORT.orderBy(s)).toSQL().sql;
    expect(TENANT_SORT.keys).toEqual(["name", "created", "plan", "status", "app"]);
    expect(TENANT_SORT.default).toBe("-created");
    expect(render()).toContain('order by "tenants"."created_at" desc nulls last, "tenants"."id" desc');
    expect(render("name")).toContain('order by lower("tenants"."name") asc nulls last');
    expect(render("-app")).toContain('"tenants"."app_id" desc nulls last');
    expect(() => render("slug")).toThrow(AppError);
  });
});
