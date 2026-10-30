/**
 * Optional database test of plan usage with a real usage source (the `staff` seat count). Runs only with
 * `PLANS_TEST_DATABASE_URL` set (a development Postgres); it works in a throw-away schema and drops it afterwards.
 *   PowerShell: $env:PLANS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5432/srikit"; pnpm test
 */
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PlansService, type UsageSource } from "./service";

const URL_ = process.env.PLANS_TEST_DATABASE_URL;
const SCHEMA = `plans_it_${Math.random().toString(36).slice(2, 10)}`;
const T = { id: "11111111-1111-4111-8111-111111111111", slug: "t", planId: "starter", appId: null };
const T2 = { id: "99999999-9999-4999-8999-999999999999", slug: "t2", planId: "starter", appId: null };

const DDL = `
create table "${SCHEMA}".plans (
  id text primary key, app_id text, tier text, name text not null, description text, price_monthly_paise integer not null default 0,
  price_yearly_paise integer not null default 0, modules text[] not null default '{}', limits jsonb not null default '{}',
  features jsonb not null default '{}', is_public boolean not null default true, sort integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table "${SCHEMA}".tenant_plan_overrides (
  tenant_id uuid primary key, add_modules text[] not null default '{}', remove_modules text[] not null default '{}',
  limits jsonb not null default '{}', features jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table "${SCHEMA}".usage_counters (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, key text not null, period text not null,
  value integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint usage_counters_tenant_key_period_uq unique (tenant_id, key, period));
create table "${SCHEMA}".plan_addons (
  id text primary key, code text not null, app_id text, kind text not null, name text not null, description text,
  limits jsonb not null default '{}', modules text[] not null default '{}', price_monthly_paise integer not null default 0,
  price_yearly_paise integer not null default 0, price_once_paise integer not null default 0, min_quantity integer not null default 1,
  max_quantity integer not null default 1, tiers text[] not null default '{}', is_public boolean not null default true,
  sort integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table "${SCHEMA}".usage_credits (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, key text not null, balance integer not null default 0,
  granted integer not null default 0, used integer not null default 0, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), constraint usage_credits_tenant_key_uq unique (tenant_id, key));
`;

describe.skipIf(!URL_)("plan usage with a usage source, against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  /** The "real" seats per tenant, as tenancy would count them. */
  const seats = new Map<string, number>();
  const source: UsageSource = {
    count: async (tenantId) => seats.get(tenantId) ?? 0,
    countAll: async () => new Map([...seats].filter(([, n]) => n > 0)),
  };
  const svc = (settleMs = 0) => new PlansService({ db, usageSources: { staff: source }, reconcileSettleMs: settleMs });
  const counter = async (tenantId: string) => {
    const r = await db.execute<{ value: number }>(
      sql.raw(`select value from "${SCHEMA}".usage_counters where tenant_id = '${tenantId}' and key = 'staff'`),
    );
    return [...r][0]?.value ?? null;
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(sql.raw(DDL));
    await svc().upsertPlan({ id: "starter", name: "Starter", limits: { staff: 5 } });
  });
  beforeEach(async () => {
    seats.clear();
    await db.execute(sql.raw(`delete from "${SCHEMA}".usage_counters`));
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("shows seeded staff that never went through consume", async () => {
    seats.set(T.id, 3);
    const [staff] = await svc().usageSummary(T);
    expect(staff).toMatchObject({ key: "staff", limit: 5, used: 3, remaining: 2 });
    expect(await svc().usage(T, "staff")).toBe(3);
  });

  it("consumes from the real count, so the limit holds for seeded staff", async () => {
    const s = svc(60_000);
    seats.set(T.id, 4);
    expect(await s.consume(T, "staff")).toBe(5);
    seats.set(T.id, 5); // the membership row is inserted
    await expect(s.consume(T, "staff")).rejects.toMatchObject({ status: 402 });
  });

  it("refuses when the real count alone is already at the limit (and settles the counter to it)", async () => {
    seats.set(T.id, 5);
    await expect(svc().consume(T, "staff")).rejects.toMatchObject({ status: 402 });
    expect(await counter(T.id)).toBe(5);
  });

  it("concurrent consumes never exceed the limit", async () => {
    const s = svc(60_000);
    seats.set(T.id, 2);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => s.consume(T, "staff")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await counter(T.id)).toBe(5);
  });

  it("a stale-high counter is settled and the consume retried", async () => {
    // 5 counted, but two members were deleted without a release.
    await svc().consume(T, "staff", 5);
    seats.set(T.id, 3);
    await db.execute(sql.raw(`update "${SCHEMA}".usage_counters set updated_at = now() - interval '1 hour'`));
    expect(await svc(60_000).consume(T, "staff")).toBe(4);
  });

  it("reconcile leaves a freshly written counter alone (it may hold an in-flight reservation)", async () => {
    await svc().consume(T, "staff", 2);
    seats.set(T.id, 1);
    expect(await svc(60_000).reconcileUsage("staff", T.id)).toEqual({ checked: 1, fixed: 0 });
    expect(await counter(T.id)).toBe(2);
  });

  it("reconcileUsage() over all tenants is idempotent and zeroes tenants without seats", async () => {
    await svc().consume(T2, "staff", 2); // T2's members were all removed since
    seats.set(T.id, 3);
    const s = svc(0);
    expect(await s.reconcileUsage()).toEqual({ checked: 2, fixed: 2 });
    expect(await counter(T.id)).toBe(3);
    expect(await counter(T2.id)).toBe(0);
    expect(await s.reconcileUsage()).toEqual({ checked: 2, fixed: 0 });
  });

  it("release after a remove keeps usage at the real count", async () => {
    seats.set(T.id, 3);
    const s = svc(60_000);
    await s.consume(T, "staff"); // invite: counter 4
    seats.set(T.id, 4);
    seats.set(T.id, 3); // remove
    await s.release(T, "staff");
    expect(await s.usage(T, "staff")).toBe(3);
  });

  it("plans per app: own plans first, shared ones for apps without, the free tier as the default", async () => {
    const s = svc();
    await s.upsertPlan({ id: "free", tier: "free", name: "Free (shared)" });
    await s.upsertPlan({ id: "sv-free", appId: "SV", tier: "free", name: "Free" });
    await s.upsertPlan({ id: "sv-pro", appId: "SV", tier: "pro", name: "Pro", priceMonthlyPaise: 179_900 });
    await s.upsertPlan({ id: "ec-pro", appId: "EC", tier: "pro", name: "Pro", isPublic: false });

    expect((await s.listPlans({ appId: "SV" })).map((p) => p.id)).toEqual(["sv-free", "sv-pro"]);
    // No plans of its own (public ones): the shared plans
    expect((await s.listPlans({ appId: "RS", publicOnly: true })).map((p) => p.id)).toEqual(expect.arrayContaining(["free", "starter"]));
    expect((await s.listPlans({ appId: "RS" })).every((p) => p.appId === null)).toBe(true);

    expect(await s.offeredTo({ appId: "SV" }, "SV")).toBe(true);
    expect(await s.offeredTo({ appId: "SV" }, "EC")).toBe(false);
    expect(await s.offeredTo({ appId: null }, "SV")).toBe(false); // SV has its own plans
    expect(await s.offeredTo({ appId: null }, "RS")).toBe(true);

    expect((await s.planForTier("SV", "pro"))?.id).toBe("sv-pro");
    expect((await s.planForTier("RS", "free"))?.id).toBe("free");
    expect(await s.defaultPlanFor("SV")).toBe("sv-free");
    expect(await s.defaultPlanFor("RS")).toBe("free");

    const shop = { id: "33333333-3333-4333-8333-333333333333", slug: "x", planId: null, appId: "SV" };
    expect((await s.entitlements(shop)).planId).toBe("sv-free");
  });

  it("add-ons: an app's own add-on replaces the shared one of the same code; active add-ons raise limits", async () => {
    const active = new Map<string, { addonId: string; quantity: number }[]>();
    const invalidated: (string | undefined)[] = [];
    const s = new PlansService({ db, usageSources: { staff: source }, addons: async (id) => active.get(id) ?? [], onInvalidate: (id) => invalidated.push(id) });
    await s.upsertAddon({ id: "extra-staff", code: "extra-staff", kind: "limit", name: "Extra staff", limits: { staff: 5 }, priceMonthlyPaise: 19_900, maxQuantity: 10 });
    await s.upsertAddon({ id: "sv-extra-staff", code: "extra-staff", appId: "SV", kind: "limit", name: "Extra staff (SV)", limits: { staff: 3 }, priceMonthlyPaise: 14_900 });
    await s.upsertAddon({ id: "sms-5000", code: "sms-5000", kind: "credits", name: "SMS pack", limits: { sms_per_month: 5000 }, priceOncePaise: 99_900 });
    await expect(s.upsertAddon({ id: "bad", code: "bad", kind: "credits", name: "Bad", limits: { staff: 5 } })).rejects.toThrow();
    expect((await s.listAddons({ appId: "SV" })).map((a) => a.id)).toEqual(["sms-5000", "sv-extra-staff"]);
    expect((await s.listAddons({ appId: "EC" })).map((a) => a.id).sort()).toEqual(["extra-staff", "sms-5000"]);

    seats.set(T.id, 4);
    expect((await s.usageSummary(T)).find((u) => u.key === "staff")).toMatchObject({ limit: 5, base: 5, addon: 0 });
    active.set(T.id, [{ addonId: "extra-staff", quantity: 2 }]);
    s.invalidate(T.id);
    expect(invalidated).toContain(T.id);
    expect(await s.limit(T, "staff")).toBe(15);
    expect((await s.usageSummary(T)).find((u) => u.key === "staff")).toMatchObject({ limit: 15, base: 5, addon: 10, used: 4, remaining: 11 });
    // Unknown add-on ids are ignored.
    active.set(T.id, [{ addonId: "gone", quantity: 3 }]);
    s.invalidate(T.id);
    expect(await s.limit(T, "staff")).toBe(5);
  });

  it("credits: the monthly allowance first, then credits (split across both), never below zero", async () => {
    const s = svc();
    await s.upsertPlan({ id: "smsplan", name: "SMS", limits: { sms_per_month: 10 } });
    const shop = { id: "44444444-4444-4444-8444-444444444444", slug: "sms", planId: "smsplan", appId: null };
    await db.execute(sql.raw(`delete from "${SCHEMA}".usage_credits`));
    expect(await s.consume(shop, "sms_per_month", 8)).toBe(8);
    await expect(s.consume(shop, "sms_per_month", 5)).rejects.toMatchObject({ status: 402, details: expect.objectContaining({ credits: 0 }) });
    expect(await s.grantCredits(shop.id, { sms_per_month: 20 })).toEqual({ sms_per_month: 20 });
    // 2 left this month + 3 from credits.
    expect(await s.consume(shop, "sms_per_month", 5)).toBe(10);
    expect(await s.credits(shop.id)).toEqual({ sms_per_month: 17 });
    // Allowance used up: credits only; more than the allowance in one go works from credits too.
    await s.consume(shop, "sms_per_month", 15);
    expect(await s.credits(shop.id)).toEqual({ sms_per_month: 2 });
    await expect(s.consume(shop, "sms_per_month", 3)).rejects.toMatchObject({ status: 402 });
    expect(await s.credits(shop.id)).toEqual({ sms_per_month: 2 });
    expect((await s.usageSummary(shop)).find((u) => u.key === "sms_per_month")).toMatchObject({ limit: 10, used: 10, credits: 2 });
  });
});
