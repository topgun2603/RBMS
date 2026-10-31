/**
 * Optional database test of the transactional service (earn / redeem / reverse / adjust / expire, idempotency and
 * concurrent redemptions). Runs only with `LOYALTY_TEST_DATABASE_URL` set (a development Postgres); it works in a
 * throw-away schema and drops it afterwards.
 *   PowerShell: $env:LOYALTY_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5432/srikit"; pnpm test
 */
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOYALTY_SETTINGS_DEFAULTS, type LoyaltySettings } from "./logic";
import { LoyaltyService } from "./service";

const URL_ = process.env.LOYALTY_TEST_DATABASE_URL;
const SCHEMA = `loyalty_it_${Math.random().toString(36).slice(2, 10)}`;
const T = "11111111-1111-4111-8111-111111111111";
const T2 = "99999999-9999-4999-8999-999999999999";
const PHONE = "+919876543210";

const DDL = `
create table "${SCHEMA}".loyalty_members (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, member_key text not null, name text,
  points_balance integer not null default 0, lifetime_spend bigint not null default 0, tier text not null,
  joined_at timestamptz not null default now(), last_activity_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint loyalty_members_tenant_key_uq unique (tenant_id, member_key));
create table "${SCHEMA}".loyalty_ledger (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  member_id uuid not null references "${SCHEMA}".loyalty_members(id) on delete cascade,
  type text not null, points integer not null, amount_paise bigint not null default 0, remaining integer not null default 0,
  ref_type text not null, ref_id text not null, expires_at timestamptz, note text, created_by uuid,
  created_at timestamptz not null default now(),
  constraint loyalty_ledger_ref_uq unique (tenant_id, ref_type, ref_id, type));
`;

describe.skipIf(!URL_)("service against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let clock = new Date("2026-10-15T06:00:00Z");
  let settings: LoyaltySettings = LOYALTY_SETTINGS_DEFAULTS;
  let svc: LoyaltyService;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    await db.execute(sql.raw(DDL));
    svc = new LoyaltyService({ db, settings: { get: async () => settings }, now: () => clock });
  });
  afterAll(async () => {
    if (!db) return;
    await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close();
  });

  const balanceInvariant = async (tenantId = T) => {
    const rows = await db.execute<{ id: string; points_balance: number; lots: string | null; total: string | null }>(
      sql.raw(`select m.id, m.points_balance,
        (select sum(remaining) from "${SCHEMA}".loyalty_ledger l where l.member_id = m.id and remaining > 0) as lots,
        (select sum(points) from "${SCHEMA}".loyalty_ledger l where l.member_id = m.id) as total
        from "${SCHEMA}".loyalty_members m where tenant_id = '${tenantId}'`),
    );
    for (const r of rows) {
      expect(Number(r.lots ?? 0)).toBe(r.points_balance);
      expect(r.points_balance).toBeGreaterThanOrEqual(0);
    }
    return rows;
  };

  it("earns idempotently, creating the member and moving tiers", async () => {
    const a = await svc.earn(T, { memberKey: "98765 43210", name: "Meena", amount: 2_000_000, refType: "invoice", refId: "inv-1" });
    expect(a).toMatchObject({ created: true, points: 200, balance: 200, tier: "Silver" });
    const again = await svc.earn(T, { memberKey: PHONE, amount: 2_000_000, refType: "invoice", refId: "inv-1" });
    expect(again).toMatchObject({ created: false, skipped: "already_earned", points: 200, balance: 200 });
    // ₹10,000 at Silver (tier before purchase) = 100; spend now ₹30,000 → Gold
    const b = await svc.earn(T, { memberKey: PHONE, amount: 1_000_000, refType: "order", refId: "ord-1" });
    expect(b).toMatchObject({ created: true, points: 100, balance: 300, tier: "Gold" });
    // next purchase earns at 1.5×
    const c = await svc.earn(T, { memberKey: PHONE, amount: 100_000, refType: "invoice", refId: "inv-2" });
    expect(c.points).toBe(15);
    const m = await svc.findMember(T, "+91 98765 43210");
    expect(m).toMatchObject({ name: "Meena", pointsBalance: 315, lifetimeSpend: 3_100_000, tier: "Gold", pointsValue: 31_500 });
    await balanceInvariant();
  });

  it("keeps tenants apart", async () => {
    expect(await svc.findMember(T2, PHONE)).toBeNull();
    expect((await svc.quote(T2, PHONE, 100_000)).reason).toBe("no_points");
  });

  it("quotes and redeems atomically and idempotently", async () => {
    const q = await svc.quote(T, PHONE, 40_000);
    expect(q).toMatchObject({ balance: 315, maxPoints: 200, maxDiscount: 20_000, canRedeem: true, earnPreview: 6 });
    await expect(svc.redeem(T, { memberKey: PHONE, points: 250, refType: "order", refId: "ord-2", orderAmount: 40_000 })).rejects.toMatchObject({
      status: 409,
      code: "loyalty_redeem",
      details: { reason: "too_many_points", maxPoints: 200 },
    });
    const r = await svc.redeem(T, { memberKey: PHONE, points: 150, refType: "order", refId: "ord-2", orderAmount: 40_000 });
    expect(r).toMatchObject({ created: true, points: 150, discount: 15_000, balance: 165 });
    const again = await svc.redeem(T, { memberKey: PHONE, points: 150, refType: "order", refId: "ord-2", orderAmount: 40_000 });
    expect(again).toMatchObject({ created: false, points: 150, discount: 15_000, balance: 165 });
    await balanceInvariant();
  });

  it("serialises concurrent redemptions so the balance can't be overspent", async () => {
    // 165 points; three tills each try 100 at once → only one succeeds.
    const tries = await Promise.allSettled(
      ["c1", "c2", "c3"].map((id) => svc.redeem(T, { memberKey: PHONE, points: 100, refType: "invoice", refId: id, orderAmount: 1_000_000 })),
    );
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(1);
    expect((await svc.findMember(T, PHONE))!.pointsBalance).toBe(65);
    await balanceInvariant();
  });

  it("reverses an order: gives redeemed points back, takes earned back (clamped, never negative)", async () => {
    // ord-1 earned 100 (mostly spent by now). Balance 65 → reversal can only take 65.
    const r = await svc.reverse(T, "order", "ord-1");
    expect(r).toMatchObject({ reversed: true, earnReversed: 65, shortfall: 35, points: -65, balance: 0 });
    expect(await svc.reverse(T, "order", "ord-1")).toMatchObject({ reversed: false, alreadyReversed: true });
    expect(await svc.earn(T, { memberKey: PHONE, amount: 1_000_000, refType: "order", refId: "ord-1" })).toMatchObject({ created: false, skipped: "already_earned" });
    // ord-2 redeemed 150 and earned nothing: cancel gives 150 back.
    expect(await svc.reverse(T, "order", "ord-2")).toMatchObject({ reversed: true, restored: 150, points: 150, balance: 150 });
    // A late earn event for the cancelled order earns nothing.
    expect(await svc.earn(T, { memberKey: PHONE, amount: 40_000, refType: "order", refId: "ord-2" })).toMatchObject({ created: false, skipped: "reversed" });
    const m = (await svc.findMember(T, PHONE))!;
    expect(m.lifetimeSpend).toBe(2_100_000); // ord-1's ₹10,000 removed
    expect(m.tier).toBe("Silver");
    const detail = await svc.get(T, m.id);
    const rev = detail.ledger.items.find((e) => e.type === "reverse" && e.refId === "ord-1")!;
    expect(rev.note).toContain("35 were already used");
    expect(await svc.reverse(T, "invoice", "never-existed")).toMatchObject({ reversed: false });
    await balanceInvariant();
  });

  it("adjusts with a reason and refuses taking more than the balance", async () => {
    const m = (await svc.findMember(T, PHONE))!;
    await expect(svc.adjust(T, m.id, { points: -1000, reason: "test" }, null)).rejects.toMatchObject({ status: 409, code: "loyalty_insufficient" });
    const a = await svc.adjust(T, m.id, { points: 50, reason: "Birthday bonus" }, "33333333-3333-4333-8333-333333333333");
    expect(a.member.pointsBalance).toBe(200);
    expect(a.entry).toMatchObject({ type: "adjust", points: 50, note: "Birthday bonus", refType: "manual" });
    const b = await svc.adjust(T, m.id, { points: -20, reason: "Wrong entry" }, null);
    expect(b.member.pointsBalance).toBe(180);
    await balanceInvariant();
  });

  it("expires unused lot points FIFO at IST month end, once", async () => {
    const m = (await svc.findMember(T, PHONE))!;
    // Earned in Oct 2026 → lots expire 31 Oct 2027 23:59:59.999 IST.
    const before = new Date("2027-10-31T18:29:59.000Z");
    expect(await svc.expireDue(before)).toMatchObject({ points: 0 });
    const after = new Date("2027-10-31T18:30:00.000Z");
    const r = await svc.expireDue(after);
    expect(r.points).toBe(180);
    expect((await svc.findMember(T, PHONE))!.pointsBalance).toBe(0);
    expect(await svc.expireDue(after)).toMatchObject({ points: 0, lots: 0 });
    const exp = (await svc.ledger(T, m.id, { type: "expire" })).items;
    expect(exp.reduce((s, e) => s + e.points, 0)).toBe(-180);
    expect(exp.every((e) => e.refType === "lot")).toBe(true);
    await balanceInvariant();
  });

  it("does not let points past expiry be redeemed before the job runs", async () => {
    clock = new Date("2027-11-10T06:00:00Z");
    await svc.earn(T, { memberKey: "9000000001", amount: 1_000_000, refType: "invoice", refId: "x-1" }); // 100 pts, exp Nov 2028
    clock = new Date("2028-12-01T06:00:00Z");
    expect((await svc.quote(T, "9000000001", 1_000_000)).reason).toBe("no_points");
    await expect(svc.redeem(T, { memberKey: "9000000001", points: 100, refType: "invoice", refId: "x-2" })).rejects.toMatchObject({ status: 409 });
    // The failed redeem rolled back, so the stored balance still shows the points until the job runs.
    expect((await svc.findMember(T, "9000000001"))!.pointsBalance).toBe(100);
    expect((await svc.expireDue(clock)).points).toBe(100);
    expect((await svc.findMember(T, "9000000001"))!.pointsBalance).toBe(0);
    await balanceInvariant();
  });

  it("lists, searches and exports members", async () => {
    settings = { ...LOYALTY_SETTINGS_DEFAULTS, pointValuePaise: 50 };
    const list = await svc.list(T, { q: "98765", sort: "-points" });
    expect(list.total).toBe(1);
    expect(list.items[0]!.memberKey).toBe(PHONE);
    expect((await svc.list(T, { q: "meena" })).total).toBe(1);
    expect((await svc.list(T, {})).total).toBe(2);
    const summary = await svc.summary(T);
    expect(summary.members).toBe(2);
    expect(summary.liability).toBe(summary.points * 50);
    expect((await svc.list(T, {})).facets?.tier).toBeDefined();
    const csv = await svc.exportCsv(T);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3);
  });
});
