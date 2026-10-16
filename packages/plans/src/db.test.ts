/**
 * Optional database test of plan usage with a real usage source (the `staff` seat count). Runs only with
 * `PLANS_TEST_DATABASE_URL` set (a development Postgres); it works in a throw-away schema and drops it afterwards.
 *   PowerShell: $env:PLANS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5432/srikit"; pnpm test
 */
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PlansService, type UsageSource } from "./service";

const URL_ = process.env.PLANS_TEST_DATABASE_URL;
const SCHEMA = `plans_it_${Math.random().toString(36).slice(2, 10)}`;
const T = { id: "11111111-1111-4111-8111-111111111111", slug: "t", planId: "starter", appId: null };
const T2 = { id: "99999999-9999-4999-8999-999999999999", slug: "t2", planId: "starter", appId: null };

const DDL = `
create table "${SCHEMA}".plans (
  id text primary key, name text not null, description text, price_monthly_paise integer not null default 0,
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
});
