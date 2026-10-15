import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { seedPlans } from "./seed";
import { consumeStatement, planInputSchema } from "./service";

// postgres-js connects lazily, so building SQL with toSQL() never touches a database.
const { db, close } = createDb("postgres://user:pass@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

describe("consumeStatement", () => {
  it("is a single conditional upsert", () => {
    const { sql, params } = consumeStatement(db, { tenantId: "t1", key: "sms_per_month", period: "2026-10", amount: 3, limit: 100 }).toSQL();
    expect(sql).toMatch(/^insert into "usage_counters"/);
    expect(sql).toContain('on conflict ("tenant_id","key","period") do update set');
    expect(sql).toContain('"usage_counters"."value" + $');
    expect(sql).toMatch(/where "usage_counters"\."value" \+ \$\d+ <= \$\d+/);
    expect(sql).toContain('returning "value"');
    expect(params).toContain(100);
    expect(params).toContain(3);
  });

  it("skips the limit check when unlimited", () => {
    const { sql } = consumeStatement(db, { tenantId: "t1", key: "staff", period: "lifetime", amount: 1, limit: -1 }).toSQL();
    expect(sql).toContain("do update set");
    expect(sql).not.toContain("<=");
  });
});

describe("seedPlans", () => {
  it("are all valid plan inputs", () => {
    for (const p of seedPlans) expect(planInputSchema.safeParse(p).success).toBe(true);
  });

  it("have the expected catalogue", () => {
    const byId = Object.fromEntries(seedPlans.map((p) => [p.id, planInputSchema.parse(p)]));
    expect(Object.keys(byId)).toEqual(["free", "starter", "pro", "enterprise"]);
    expect(byId.free!.priceMonthlyPaise).toBe(0);
    expect(byId.starter!.priceMonthlyPaise).toBe(49_900);
    expect(byId.pro!.priceMonthlyPaise).toBe(149_900);
    expect(byId.pro!.modules).toEqual(expect.arrayContaining(["custom-domain", "whatsapp"]));
    expect(byId.enterprise!.isPublic).toBe(false);
    expect(Object.values(byId.enterprise!.limits).every((v) => v === -1)).toBe(true);
  });

  it("grant billing features as in docs/features.md", () => {
    const byId = Object.fromEntries(seedPlans.map((p) => [p.id, planInputSchema.parse(p)]));
    const free = ["invoices", "invoices.whatsapp", "invoices.reports"];
    expect(byId.free!.modules).toEqual(free);
    expect(byId.starter!.modules).toEqual(
      expect.arrayContaining([...free, "invoices.credit-book", "invoices.gst-reports", "inventory", "payments"]),
    );
    expect(byId.starter!.modules).not.toContain("invoices.reminders");
    for (const id of ["pro", "enterprise"]) {
      // Whole billing modules via wildcards; no individual feature keys.
      expect(byId[id]!.modules).toEqual(expect.arrayContaining(["invoices.*", "inventory.*", "payments.*"]));
      expect(byId[id]!.modules.filter((m) => m.includes(".") && !m.endsWith(".*"))).toEqual([]);
    }
  });

  it("accept feature keys in modules and features", () => {
    const ok = planInputSchema.safeParse({ id: "x", name: "X", modules: ["invoices.credit-book"], features: { "invoices.reminders": false } });
    expect(ok.success).toBe(true);
    expect(planInputSchema.safeParse({ id: "x", name: "X", modules: ["a.b.c"] }).success).toBe(false);
  });
});
