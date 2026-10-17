import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { and, count, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { auditEvents } from "./schema";
import { AUDIT_SORT, auditConditions, auditListQuerySchema, auditPlatformQuerySchema, cappedMatches, MAX_COUNT } from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const U1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const where = (q: Record<string, unknown>) =>
  db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, T), ...auditConditions(auditListQuerySchema.parse(q))))
    .toSQL();

describe("audit list query", () => {
  it("defaults to 50 rows, accepts the old large limits (clamped later) and comma lists", () => {
    const p = auditListQuerySchema.parse({});
    expect(p.limit).toBe(50);
    expect(p.format).toBe("json");
    expect(auditListQuerySchema.parse({ limit: "500" }).limit).toBe(500);
    expect(() => auditListQuerySchema.parse({ limit: "10001" })).toThrow(ZodError);
    const l = auditListQuerySchema.parse({ actorUserId: `${U1},${U2}`, action: "invoices.*,invoice.*", entityType: "invoices,orders" });
    expect(l.actorUserId).toEqual([U1, U2]);
    expect(l.action).toEqual(["invoices.*", "invoice.*"]);
    expect(l.entityType).toEqual(["invoices", "orders"]);
    expect(auditListQuerySchema.parse({ entityId: "", actorUserId: "", q: " " })).toMatchObject({ entityId: undefined, actorUserId: undefined, q: undefined });
    expect(() => auditListQuerySchema.parse({ actorUserId: "nope" })).toThrow(ZodError);
    expect(() => auditListQuerySchema.parse({ from: "2026-10-02", to: "2026-10-01" })).toThrow(ZodError);
    expect(() => auditListQuerySchema.parse({ format: "pdf" })).toThrow(ZodError);
    expect(auditPlatformQuerySchema.parse({ tenantId: T }).tenantId).toBe(T);
  });

  it("keeps single values as equality and prefix actions as LIKE", () => {
    const q = where({ actorUserId: U1, entityType: "invoices", entityId: "inv-1", action: "invoices.*" });
    expect(q.sql).toContain('"audit_events"."actor_user_id" = $');
    expect(q.sql).toContain('"audit_events"."entity_type" = $');
    expect(q.sql).toContain('"audit_events"."entity_id" = $');
    expect(q.sql).toContain('"audit_events"."action" like $');
    expect(q.params).toEqual([T, "invoices", "inv-1", U1, "invoices.%"]);
  });

  it("ORs several actions, IN-lists actors and entity types, IST day bounds", () => {
    const q = where({ actorUserId: `${U1},${U2}`, entityType: "invoices,orders", action: "invoice.cancel,orders.*", from: "2026-10-01", to: "2026-10-31" });
    expect(q.sql).toContain('"audit_events"."actor_user_id" in ($');
    expect(q.sql).toContain('"audit_events"."entity_type" in ($');
    expect(q.sql).toMatch(/\("audit_events"\."action" = \$\d+ or "audit_events"\."action" like \$\d+\)/);
    expect(q.sql).toContain('"audit_events"."created_at" >= $');
    expect(q.sql).toContain('"audit_events"."created_at" < $');
    expect(q.params).toEqual(expect.arrayContaining(["invoice.cancel", "orders.%", U1, U2, "orders"]));
    const dates = q.params.filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T/.test(x));
    expect(dates).toEqual(["2026-09-30T18:30:00.000Z", "2026-10-31T18:30:00.000Z"]);
  });

  it("searches summary, action and entity id with LIKE wildcards escaped", () => {
    const q = where({ q: "50%_off" });
    expect(q.sql).toContain('"audit_events"."summary" ilike $');
    expect(q.sql).toContain('"audit_events"."action" ilike $');
    expect(q.sql).toContain('"audit_events"."entity_id" ilike $');
    expect(q.params).toContain("%50\\%\\_off%");
    expect(where({ action: "a_b*" }).params).toContain("a\\_b%");
  });

  it("caps the count with a limited subquery", () => {
    const sqlText = db.select({ n: count() }).from(cappedMatches(db, eq(auditEvents.tenantId, T))).toSQL();
    expect(sqlText.sql).toMatch(/select count\(\*\) from \(select 1 as "one" from "audit_events" where "audit_events"\."tenant_id" = \$1 limit \$2\) "matches"/);
    expect(sqlText.params).toEqual([T, MAX_COUNT + 1]);
  });

  it("sorts by time only (newest first by default, id as tie-breaker)", () => {
    const render = (s?: string) => db.select().from(auditEvents).orderBy(...AUDIT_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "audit_events"."created_at" desc nulls last, "audit_events"."id" desc');
    expect(render("time")).toContain('order by "audit_events"."created_at" asc nulls last, "audit_events"."id" asc');
    expect(() => render("-summary")).toThrow(AppError);
    expect(AUDIT_SORT.keys).toEqual(["time"]);
    expect(AUDIT_SORT.default).toBe("-time");
  });
});
