import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  mrrSql,
  PLATFORM_INVOICE_SORT,
  platformInvoiceListConditions,
  platformInvoiceListQuerySchema,
  subscriptionListConditions,
  subscriptionListQuerySchema,
  subscriptionSort,
} from "./list";
import type { PlanInfo } from "./ports";
import { platformInvoices, subscriptions } from "./schema";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const SHOP = "11111111-1111-4111-8111-111111111111";
const plan = (id: string, monthly: number, yearly: number, sort: number): PlanInfo => ({
  id,
  name: id,
  description: null,
  priceMonthlyPaise: monthly,
  priceYearlyPaise: yearly,
  modules: [],
  limits: {},
  features: {},
  isPublic: true,
  sort,
});
const PLANS = [plan("free", 0, 0, 0), plan("starter", 49_900, 499_000, 10), plan("pro", 149_900, 1_499_000, 20)];

const subWhere = (q: Record<string, unknown>, shopIds: string[] = [], omit?: "status" | "plan" | "provider") =>
  db.select().from(subscriptions).where(subscriptionListConditions(subscriptionListQuerySchema.parse(q), shopIds, omit)).toSQL();
const invWhere = (q: Record<string, unknown>, shopIds: string[] = [], omit?: "status") =>
  db.select().from(platformInvoices).where(platformInvoiceListConditions(platformInvoiceListQuerySchema.parse(q), shopIds, omit)).toSQL();

describe("subscription list query", () => {
  it("keeps the 50/200 limits, the single-status form and comma lists", () => {
    expect(subscriptionListQuerySchema.parse({}).limit).toBe(50);
    expect(() => subscriptionListQuerySchema.parse({ limit: "201" })).toThrow(ZodError);
    expect(subscriptionListQuerySchema.parse({ status: "past_due" }).status).toEqual(["past_due"]);
    const p = subscriptionListQuerySchema.parse({ status: "active,trialing", plan: "starter,pro", provider: "razorpay,none" });
    expect(p.plan).toEqual(["starter", "pro"]);
    expect(p.provider).toEqual(["razorpay", "none"]);
    expect(() => subscriptionListQuerySchema.parse({ status: "paused" })).toThrow(ZodError);
    expect(() => subscriptionListQuerySchema.parse({ provider: "stripe" })).toThrow(ZodError);
    expect(() => subscriptionListQuerySchema.parse({ plan: "DROP TABLE" })).toThrow(ZodError);
  });

  it("filters status, plan and provider (`none` = no provider)", () => {
    const q = subWhere({ status: "active", plan: "pro", provider: "manual,none" });
    expect(q.sql).toContain('"subscriptions"."status" in ($');
    expect(q.sql).toContain('"subscriptions"."plan_id" in ($');
    expect(q.sql).toContain('"subscriptions"."provider" in ($');
    expect(q.sql).toContain('"subscriptions"."provider" is null');
    expect(q.params).toEqual(["active", "pro", "manual"]);
  });

  it("searches the plan id and the shops tenancy found", () => {
    const q = subWhere({ q: "meena" }, [SHOP]);
    expect(q.sql).toContain('"subscriptions"."plan_id" ilike $');
    expect(q.sql).toContain('"subscriptions"."tenant_id" in ($');
    expect(q.params).toEqual(["%meena%", SHOP]);
    expect(subWhere({ q: "meena" }).sql).not.toContain('"subscriptions"."tenant_id" in');
  });

  it("leaves one filter out for its facet counts", () => {
    expect(subWhere({ status: "active", plan: "pro", provider: "mock" }, [], "provider").params).toEqual(["active", "pro"]);
    expect(subWhere({ status: "active", plan: "pro" }, [], "status").params).toEqual(["pro"]);
  });

  it("sorts by the whitelisted fields; plan by catalogue order, MRR by the paying rule", () => {
    const SORT = subscriptionSort(PLANS);
    const render = (s?: string) => db.select().from(subscriptions).orderBy(...SORT.orderBy(s)).toSQL();
    expect(SORT.keys).toEqual(["shop", "plan", "status", "next", "mrr", "updated"]);
    expect(SORT.default).toBe("-updated");
    expect(render().sql).toContain('order by "subscriptions"."updated_at" desc nulls last, "subscriptions"."id" desc');
    expect(render("shop").sql).toContain('(select lower(t.name) from tenants t where t.id = "subscriptions"."tenant_id") asc nulls last');
    expect(render("next").sql).toContain(`when 'trialing' then "subscriptions"."trial_ends_at"`);
    const mrr = render("-mrr");
    expect(mrr.sql).toContain(`"subscriptions"."provider" in ('razorpay', 'mock')`);
    expect(mrr.sql).toContain('"subscriptions"."auth_url" is null');
    // Free plans drop out; yearly is the monthly share (rounded) like monthlyValue().
    expect(mrr.params).toEqual(["starter", 41_583, 49_900, "pro", 124_917, 149_900]);
    expect(render("plan").params).toEqual(["free", 0, "starter", 10, "pro", 20]);
    expect(() => render("tenantId")).toThrow(AppError);
  });

  it("MRR is a constant 0 without paid plans", () => {
    expect(db.select().from(subscriptions).orderBy(mrrSql([plan("free", 0, 0, 0)])).toSQL().sql).toContain("order by 0");
  });
});

describe("platform invoice list query", () => {
  it("parses status, shop and an ordered date range", () => {
    const p = platformInvoiceListQuerySchema.parse({ status: "paid,void", tenantId: SHOP, from: "2026-10-01", to: "2026-10-31" });
    expect(p.status).toEqual(["paid", "void"]);
    expect(p.limit).toBe(50);
    expect(() => platformInvoiceListQuerySchema.parse({ from: "2026-10-02", to: "2026-10-01" })).toThrow(ZodError);
    expect(() => platformInvoiceListQuerySchema.parse({ status: "draft" })).toThrow(ZodError);
    expect(() => platformInvoiceListQuerySchema.parse({ from: "01-10-2026" })).toThrow(ZodError);
  });

  it("filters dates, status and shop; searches number, buyer and shops", () => {
    const q = invWhere({ status: "void", tenantId: SHOP, from: "2026-10-01", to: "2026-10-31", q: "SR/2026" }, [SHOP]);
    expect(q.sql).toContain('"platform_invoices"."date" >= $');
    expect(q.sql).toContain('"platform_invoices"."date" <= $');
    expect(q.sql).toContain(`"platform_invoices"."buyer"->>'legalName' ilike`);
    expect(q.params).toEqual(expect.arrayContaining(["void", SHOP, "2026-10-01", "2026-10-31", "%SR/2026%"]));
    expect(invWhere({ status: "paid", q: "x" }, [], "status").params).not.toContain("paid");
  });

  it("sorts by number (FY, sequence), date and total only", () => {
    const render = (s?: string) => db.select().from(platformInvoices).orderBy(...PLATFORM_INVOICE_SORT.orderBy(s)).toSQL().sql;
    expect(PLATFORM_INVOICE_SORT.keys).toEqual(["number", "date", "total"]);
    expect(render()).toContain('order by "platform_invoices"."date" desc nulls last, "platform_invoices"."created_at" desc, "platform_invoices"."id" desc');
    expect(render("number")).toContain('("platform_invoices"."fy", "platform_invoices"."seq") asc nulls last');
    expect(render("-total")).toContain('"platform_invoices"."total_paise" desc nulls last');
    expect(() => render("shop")).toThrow(AppError);
  });
});
