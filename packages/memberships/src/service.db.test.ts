/**
 * Database test of the memberships service: plans, members and their codes, selling and renewing a plan (dates worked
 * by hand), freezing and unfreezing, cancelling, billing, the front-desk check-in with its refusals, the member list
 * and reports, expiry reminders, and that one shop never sees another's members. Runs only with
 * `MEMBERSHIPS_TEST_DATABASE_URL` set (a development Postgres with the memberships tables migrated); it copies them
 * into a throw-away schema and drops it afterwards. The clock is moved by the tests; days are India calendar days.
 *   PowerShell: $env:MEMBERSHIPS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { randomUUID } from "node:crypto";
import { AppError, emptyContext, type RequestContext, type TenantRef } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { MembershipsSettings } from "./logic";
import type { BillingPort, ExpiringMembership, SoldMembership } from "./ports";
import { membershipsRoutes } from "./routes";
import { MembershipsService } from "./service";

const URL_ = process.env.MEMBERSHIPS_TEST_DATABASE_URL;
const SCHEMA = `memberships_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["membership_plans", "membership_members", "membership_subscriptions", "membership_checkins"];
const GHOST = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const ref = (id: string): TenantRef => ({ id, slug: "t", planId: "pro", appId: "BL" });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? `${e.status}:${e.code}` : e instanceof ZodError ? "zod" : String(e);
  }
  return "ok";
};

describe.skipIf(!URL_)("memberships service against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: MembershipsService;
  let clock = new Date("2026-11-05T10:00:00Z"); // 15:30 on 5 Nov 2026 in India
  const at = (iso: string) => void (clock = new Date(iso));
  const stored = new Map<string, Partial<MembershipsSettings>>();
  const bills: { tenant: string; lines: { description: string; rate: number; gstRate: number; itemId: string | null }[]; customer: unknown; notes: string | null }[] = [];
  let billingFails = false;
  const sold: SoldMembership[] = [];
  const reminders: { tenantId: string; list: ExpiringMembership[] }[] = [];
  let remindersFail = false;
  const warns: string[] = [];
  const errors: string[] = [];

  /** A fresh shop with a monthly plan (30 days, Rs 1,500, GST 18, 10 freeze days). */
  const newShop = async () => {
    const t = randomUUID();
    const plan = await svc.createPlan(t, { name: "Gym monthly", durationDays: 30, price: 150_000, freezeDaysAllowed: 10 });
    return { t, tenant: ref(t), plan };
  };
  const member = (t: string, name: string, phone?: string) => svc.createMember(ref(t), { name, phone });

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    const billing: BillingPort = {
      createBill: async (tenant, input) => {
        if (billingFails) throw new Error("invoices down");
        bills.push({ tenant: tenant.id, lines: input.lines, customer: input.customer, notes: input.notes });
        return { id: randomUUID(), number: `INV-${bills.length}`, total: 0 };
      },
    };
    svc = new MembershipsService({
      db,
      billing,
      now: () => clock,
      log: { info() {}, warn: (_o, m) => void warns.push(m ?? ""), error: (_o, m) => void errors.push(m ?? "") },
      settings: {
        get: async (t) => stored.get(t) ?? {},
        set: async (t, patch) => void stored.set(t, { ...(stored.get(t) ?? {}), ...patch }),
      },
      notify: { sold: (_t, n) => void sold.push(n) },
      reminders: {
        expiring: async (tenantId, list) => {
          if (remindersFail) throw new Error("whatsapp down");
          reminders.push({ tenantId, list });
        },
      },
    });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("plans: unique names per shop, GST rate and length checks, switched-off plans hidden, used plans can't be deleted", async () => {
    const { t, plan } = await newShop();
    expect(plan).toMatchObject({ durationDays: 30, price: 150_000, gstRate: 18, sessions: null, freezeDaysAllowed: 10, active: true });
    expect(await code(svc.createPlan(t, { name: "Gym monthly", durationDays: 30, price: 1 }))).toBe("409:conflict");
    // The same name in another shop is fine.
    await newShop();
    expect(await code(svc.createPlan(t, { name: "X", durationDays: 0, price: 1 }))).toBe("zod");
    expect(await code(svc.createPlan(t, { name: "X", durationDays: 30, price: 1, gstRate: 17 }))).toBe("zod");
    expect(await code(svc.createPlan(t, { name: "X", durationDays: 30, price: -1 }))).toBe("zod");
    expect(await code(svc.createPlan(t, { name: "X", durationDays: 30, price: 1, surprise: true }))).toBe("zod");
    const pt = await svc.createPlan(t, { name: "PT 12", durationDays: 90, price: 600_000, sessions: 12, sort: 1 });
    expect(pt.sessions).toBe(12);
    expect((await svc.plans(t)).map((p) => p.name)).toEqual(["Gym monthly", "PT 12"]);

    expect(await code(svc.updatePlan(t, pt.id, { name: "Gym monthly" }))).toBe("409:conflict");
    expect(await code(svc.updatePlan(ref(randomUUID()).id, pt.id, { price: 1 }))).toBe("404:not_found");
    expect((await svc.updatePlan(t, pt.id, { price: 550_000, active: false })).price).toBe(550_000);
    expect((await svc.plans(t)).map((p) => p.name)).toEqual(["Gym monthly"]);
    expect((await svc.plans(t, { includeInactive: true })).map((p) => p.name)).toEqual(["Gym monthly", "PT 12"]);
    // A switched-off plan can't be sold.
    const m = await member(t, "Lata");
    expect(await code(svc.sell(ref(t), m.id, { planId: pt.id }))).toBe("409:plan_inactive");

    await svc.sell(ref(t), m.id, { planId: plan.id });
    expect(await code(svc.deletePlan(t, plan.id))).toBe("409:plan_in_use");
    await svc.deletePlan(t, pt.id);
    expect(await code(svc.deletePlan(t, pt.id))).toBe("404:not_found");
  });

  it("members: codes count up per shop, phones are normalised and unique, other shops are separate", async () => {
    const { t } = await newShop();
    const other = await newShop();
    const a = await member(t, "Meena", "98765 43210");
    expect(a).toMatchObject({ memberNo: 1, memberCode: "M-0001", phone: "+919876543210", status: "none", current: null, subscriptions: [], checkins: [] });
    const b = await member(t, "Nitin", "+91 91234 56780");
    expect(b.memberCode).toBe("M-0002");
    // Shop two starts again at 1.
    expect((await member(other.t, "Oviya")).memberCode).toBe("M-0001");

    const dup = await svc.createMember(ref(t), { name: "Copy", phone: "09876543210" }).catch((e) => e);
    expect(dup).toMatchObject({ status: 409, code: "phone_taken", details: { memberId: a.id } });
    // The same number in another shop is fine.
    await member(other.t, "Same number", "9876543210");
    expect(await code(member(t, "Bad", "12345"))).toBe("zod");
    expect(await code(member(t, "", undefined))).toBe("zod");

    expect(await code(svc.updateMember(t, b.id, { phone: "9876543210" }))).toBe("409:phone_taken");
    expect((await svc.updateMember(t, b.id, { name: "Nitin K", notes: "likes mornings" })).name).toBe("Nitin K");
    expect((await svc.updateMember(t, b.id, { phone: null })).phone).toBeNull();
    // Keeping one's own number is not a clash.
    expect((await svc.updateMember(t, a.id, { phone: "98765-43210" })).phone).toBe("+919876543210");
    expect(await code(svc.updateMember(other.t, a.id, { name: "Hijack" }))).toBe("404:not_found");
    expect(await code(svc.getMember(other.t, a.id))).toBe("404:not_found");
    expect(await code(svc.deleteMember(other.t, a.id))).toBe("404:not_found");
    await svc.deleteMember(t, b.id);
    expect(await code(svc.getMember(t, b.id))).toBe("404:not_found");
  });

  it("selling: the plan runs 30 days counting the start day, bills at the plan's GST, and a second plan can't overlap", async () => {
    at("2026-11-05T10:00:00Z");
    const { t, tenant, plan } = await newShop();
    const meena = await svc.createMember(tenant, { name: "Meena", phone: "9876543210", plan: { planId: plan.id, billNow: true } });
    // 5 Nov + 29 days = 4 Dec.
    expect(meena.current).toMatchObject({ startDate: "2026-11-05", endDate: "2026-12-04", state: "active", daysLeft: 29, price: 150_000, sessionsLeft: null, freezeDaysLeft: 10, planName: "Gym monthly" });
    expect(meena.current!.invoiceId).toBeTruthy();
    expect(meena.status).toBe("active");
    expect(bills.at(-1)).toMatchObject({
      tenant: t,
      notes: "Membership M-0001",
      customer: { name: "Meena", phone: "+919876543210" },
      lines: [{ description: "Gym monthly · M-0001 · 2026-11-05 to 2026-12-04", rate: 150_000, gstRate: 18, itemId: null }],
    });
    expect(sold.at(-1)).toMatchObject({ memberCode: "M-0001", planName: "Gym monthly", endDate: "2026-12-04", renewal: false, phone: "+919876543210" });

    const clash = await svc.sell(tenant, meena.id, { planId: plan.id }).catch((e) => e);
    expect(clash).toMatchObject({ status: 409, code: "has_plan" });
    expect(clash.message).toContain("2026-12-04");
    // Starting on the day after the last day is fine; one day earlier is not.
    expect(await code(svc.sell(tenant, meena.id, { planId: plan.id, startDate: "2026-11-06" }))).toBe("409:has_plan");
    const next = await svc.sell(tenant, meena.id, { planId: plan.id, startDate: "2026-12-05", price: 120_000 });
    expect(next).toMatchObject({ startDate: "2026-12-05", endDate: "2027-01-03", state: "upcoming", price: 120_000, invoiceId: null });
    expect(await code(svc.sell(tenant, meena.id, { planId: plan.id, startDate: "2026-02-30" }))).toBe("zod");
    expect(await code(svc.sell(tenant, meena.id, { planId: GHOST }))).toBe("404:not_found");
    expect(await code(svc.sell(tenant, GHOST, { planId: plan.id }))).toBe("404:not_found");
    // Another shop can't sell this shop's plan or to its member.
    expect(await code(svc.sell(ref(randomUUID()), meena.id, { planId: plan.id }))).toBe("404:not_found");

    // A one-day plan starts and ends on the same day.
    const day = await svc.createPlan(t, { name: "Day pass", durationDays: 1, price: 20_000 });
    const guest = await member(t, "Guest");
    expect(await svc.sell(tenant, guest.id, { planId: day.id })).toMatchObject({ startDate: "2026-11-05", endDate: "2026-11-05", daysLeft: 0, state: "active" });
  });

  it("billing: unavailable billing refuses 'bill now' but keeps the member; a failed bill removes the new plan; bill later bills once", async () => {
    at("2026-11-05T10:00:00Z");
    const { t, tenant, plan } = await newShop();
    const bare = new MembershipsService({ db, now: () => clock });
    const created = await bare.createMember(tenant, { name: "Kavi", plan: { planId: plan.id, billNow: true } }).catch((e) => e);
    expect(created).toMatchObject({ status: 501, code: "billing_unavailable" });
    // The member exists, without a plan.
    const [kavi] = (await svc.listMembers(t, {})).items;
    expect(kavi).toMatchObject({ name: "Kavi", current: null });
    expect(await code(bare.billLater(tenant, GHOST, {}))).toBe("501:billing_unavailable");

    billingFails = true;
    expect(await code(svc.sell(tenant, kavi!.id, { planId: plan.id, billNow: true }))).toContain("invoices down");
    billingFails = false;
    expect(errors).toContain("memberships: billing failed, plan not sold");
    expect((await svc.getMember(t, kavi!.id)).subscriptions).toEqual([]);

    const unbilled = await svc.sell(tenant, kavi!.id, { planId: plan.id });
    expect(unbilled.invoiceId).toBeNull();
    const before = bills.length;
    const billed = await svc.billLater(tenant, unbilled.id, {});
    expect(billed.invoiceId).toBeTruthy();
    expect(bills).toHaveLength(before + 1);
    expect(bills.at(-1)!.lines[0]).toMatchObject({ description: `Gym monthly · M-0001 · 2026-11-05 to 2026-12-04`, rate: 150_000, gstRate: 18 });
    expect(await svc.billLater(tenant, unbilled.id, {}).catch((e) => e)).toMatchObject({ status: 409, code: "already_billed" });
    expect(await code(svc.billLater(tenant, GHOST, {}))).toBe("404:not_found");
    expect(await code(svc.billLater(ref(randomUUID()), unbilled.id, {}))).toBe("404:not_found");
    await svc.cancel(t, unbilled.id, { reason: "Changed mind" });
    const second = await svc.sell(tenant, kavi!.id, { planId: plan.id });
    await svc.cancel(t, second.id, { reason: "oops" });
    expect(await code(svc.billLater(tenant, second.id, {}))).toBe("409:cancelled");
  });

  it("renewing continues the day after the plan ends, or from today once it has ended, and only once", async () => {
    at("2026-11-05T10:00:00Z");
    const { t, tenant, plan } = await newShop();
    const m = await svc.createMember(tenant, { name: "Ravi", plan: { planId: plan.id } });
    const first = m.current!;
    sold.length = 0;
    const r1 = await svc.renew(tenant, first.id, {});
    // Plan ran 5 Nov - 4 Dec, so the renewal runs 5 Dec - 3 Jan.
    expect(r1).toMatchObject({ startDate: "2026-12-05", endDate: "2027-01-03", renewedFromId: first.id, state: "upcoming" });
    expect(sold.at(-1)).toMatchObject({ renewal: true, startDate: "2026-12-05" });
    expect(await svc.renew(tenant, first.id, {}).catch((e) => e)).toMatchObject({ status: 409, code: "already_renewed", details: { subscriptionId: r1.id } });
    expect(await code(svc.renew(ref(randomUUID()), r1.id, {}))).toBe("404:not_found");

    // On 20 Jan the last plan (ended 3 Jan) is renewed from today at a new price on another plan.
    at("2027-01-20T10:00:00Z");
    const quarter = await svc.createPlan(t, { name: "Gym quarterly", durationDays: 90, price: 400_000 });
    const r2 = await svc.renew(tenant, r1.id, { planId: quarter.id, price: 380_000 });
    expect(r2).toMatchObject({ startDate: "2027-01-20", endDate: "2027-04-19", price: 380_000, planName: "Gym quarterly", state: "active" });
    expect((await svc.getMember(t, m.id)).subscriptions.map((s) => s.startDate)).toEqual(["2027-01-20", "2026-12-05", "2026-11-05"]);

    // Cancelled and frozen plans can't be renewed.
    const x = await svc.createMember(tenant, { name: "Xavier", plan: { planId: plan.id, startDate: "2027-01-20" } });
    await svc.freeze(t, x.current!.id, {});
    expect(await code(svc.renew(tenant, x.current!.id, {}))).toBe("409:frozen");
    await svc.cancel(t, x.current!.id, { reason: "left town" });
    expect(await code(svc.renew(tenant, x.current!.id, {}))).toBe("409:cancelled");
    at("2026-11-05T10:00:00Z");
  });

  it("freezing: the end date moves out by the days frozen, capped at the allowance", async () => {
    at("2026-11-05T10:00:00Z");
    const { t, tenant, plan } = await newShop();
    const m = await svc.createMember(tenant, { name: "Fatima", plan: { planId: plan.id } }); // 5 Nov - 4 Dec, 10 freeze days
    const id = m.current!.id;

    expect(await code(svc.freeze(t, id, { from: "2026-11-06" }))).toBe("400:bad_request"); // not in the future
    expect(await code(svc.freeze(t, id, { from: "2026-11-04" }))).toBe("400:bad_request"); // not before it started
    expect(await code(svc.unfreeze(t, id))).toBe("409:not_frozen");
    at("2026-11-10T10:00:00Z");
    const frozen = await svc.freeze(t, id, {});
    expect(frozen).toMatchObject({ status: "frozen", state: "frozen", frozenFrom: "2026-11-10" });
    expect(await code(svc.freeze(t, id, {}))).toBe("409:already_frozen");
    expect(await code(svc.freeze(ref(randomUUID()).id, id, {}))).toBe("404:not_found");
    // Frozen for 6 days (10 -> 16 Nov): end 4 Dec becomes 10 Dec, 4 freeze days left.
    at("2026-11-16T10:00:00Z");
    const back = await svc.unfreeze(t, id);
    expect(back).toMatchObject({ status: "active", frozenFrom: null, endDate: "2026-12-10", freezeDaysUsed: 6, freezeDaysLeft: 4, credited: 6, frozenDays: 6 });

    // A 14-day freeze only earns the 4 days left: 17 Nov -> 1 Dec, end 10 Dec becomes 14 Dec.
    at("2026-11-17T10:00:00Z");
    await svc.freeze(t, id, {});
    at("2026-12-01T10:00:00Z");
    expect(await svc.unfreeze(t, id)).toMatchObject({ endDate: "2026-12-14", credited: 4, frozenDays: 14, freezeDaysUsed: 10, freezeDaysLeft: 0 });
    expect(await code(svc.freeze(t, id, {}))).toBe("409:no_freeze_days");

    // Freezing and unfreezing on the same day credits nothing.
    const other = await svc.createMember(tenant, { name: "Gopal", plan: { planId: plan.id, startDate: "2026-12-01" } });
    await svc.freeze(t, other.current!.id, {});
    expect(await svc.unfreeze(t, other.current!.id)).toMatchObject({ endDate: "2026-12-30", credited: 0, freezeDaysUsed: 0 });

    // A plan with no freeze allowance, and one that has ended, can't be frozen.
    const strict = await svc.createPlan(t, { name: "No freeze", durationDays: 10, price: 1 });
    const h = await svc.createMember(tenant, { name: "Hari", plan: { planId: strict.id, startDate: "2026-12-01" } });
    expect(await code(svc.freeze(t, h.current!.id, {}))).toBe("409:no_freeze_days");
    at("2027-01-30T10:00:00Z");
    expect(await code(svc.freeze(t, h.current!.id, {}))).toBe("409:not_active");
    at("2026-11-05T10:00:00Z");
  });

  it("cancelling keeps the record, says why, frees the member to buy again, and is safe to repeat", async () => {
    at("2026-11-05T10:00:00Z");
    const { t, tenant, plan } = await newShop();
    const m = await svc.createMember(tenant, { name: "Chitra", plan: { planId: plan.id } });
    const id = m.current!.id;
    expect(await code(svc.cancel(t, id, { reason: "x" }))).toBe("zod");
    expect(await code(svc.cancel(ref(randomUUID()).id, id, { reason: "not yours" }))).toBe("404:not_found");
    const c = await svc.cancel(t, id, { reason: "Moved away" });
    expect(c).toMatchObject({ status: "cancelled", state: "cancelled", cancelReason: "Moved away" });
    expect(c.cancelledAt).toEqual(clock);
    expect((await svc.cancel(t, id, { reason: "again" })).cancelReason).toBe("Moved away");
    const detail = await svc.getMember(t, m.id);
    expect(detail.status).toBe("none"); // a cancelled plan doesn't count
    expect(detail.current).toBeNull();
    expect(detail.subscriptions).toHaveLength(1);
    await svc.sell(tenant, m.id, { planId: plan.id }); // no overlap with a cancelled plan
    expect(await code(svc.deleteMember(t, m.id))).toBe("409:member_has_history");
  });

  it("member list: status buckets follow each member's last plan end, with facets, search and sorting", async () => {
    at("2026-11-05T10:00:00Z");
    const { t, tenant, plan } = await newShop();
    const sell = async (name: string, start: string | null, phone?: string) => {
      const m = await member(t, name, phone);
      if (start) await svc.sell(tenant, m.id, { planId: plan.id, startDate: start });
      return m;
    };
    await sell("Asha", "2026-11-05", "9000000001"); // ends 4 Dec: active
    await sell("Bala", "2026-10-10", "9000000002"); // ends 8 Nov: expiring (within 7 days)
    await sell("Chitra", "2026-09-01", "9000000003"); // ended 30 Sep: expired
    await sell("Dev", null, "9000000004"); // no plan

    const all = await svc.listMembers(t, {});
    expect(all.total).toBe(4);
    expect(all.items.map((m) => [m.name, m.status])).toEqual([["Asha", "active"], ["Bala", "expiring"], ["Chitra", "expired"], ["Dev", "none"]]);
    expect(all.facets.status).toEqual({ active: 1, expiring: 1, expired: 1, none: 1 });
    expect(all.items[1]!.current).toMatchObject({ endDate: "2026-11-08", daysLeft: 3 });

    const some = await svc.listMembers(t, { status: "expiring,expired" });
    expect(some.items.map((m) => m.name)).toEqual(["Bala", "Chitra"]);
    expect(some.total).toBe(2);
    expect(some.facets.status).toEqual({ active: 1, expiring: 1, expired: 1, none: 1 }); // facets ignore the status filter
    expect((await svc.listMembers(t, { status: "none" })).items.map((m) => m.name)).toEqual(["Dev"]);
    // A 30-day window makes Asha (ends 4 Dec) "expiring" too.
    const wide = await svc.listMembers(t, { within: "30" });
    expect(wide.facets.status).toEqual({ active: 0, expiring: 2, expired: 1, none: 1 });
    expect((await svc.listMembers(t, { status: "active,expiring", sort: "endsOn" })).items.map((m) => m.name)).toEqual(["Bala", "Asha"]);
    expect((await svc.listMembers(t, { q: "bal" })).items.map((m) => m.name)).toEqual(["Bala"]);
    expect((await svc.listMembers(t, { q: "9000000003" })).items.map((m) => m.name)).toEqual(["Chitra"]); // phones are stored as +91..., search matches inside
    expect((await svc.listMembers(t, { q: "+919000000003" })).items.map((m) => m.name)).toEqual(["Chitra"]);
    expect((await svc.listMembers(t, { q: "m-0004" })).items.map((m) => m.name)).toEqual(["Dev"]);
    expect((await svc.listMembers(t, { limit: "2", offset: "2" })).items.map((m) => m.name)).toEqual(["Chitra", "Dev"]);
    expect(await code(svc.listMembers(t, { status: "gold" }))).toBe("zod");
    // The shop's own setting for the window applies when the request gives none.
    await svc.updateSettings(t, { expiringDays: 30 });
    expect((await svc.listMembers(t, {})).facets.status).toEqual({ active: 0, expiring: 2, expired: 1, none: 1 });
    expect((await svc.listMembers(randomUUID(), {})).total).toBe(0);

    // Reports for the same shop (window 30 days from the setting).
    expect(await svc.summary(t, 7)).toEqual({ within: 7, activeMembers: 2, frozenMembers: 0, expiring: 1, checkinsToday: 0 });
    expect((await svc.summary(t)).within).toBe(30);
    expect((await svc.expiring(t, { within: 7 })).map((e) => [e.name, e.endDate, e.daysLeft])).toEqual([["Bala", "2026-11-08", 3]]);
    expect((await svc.expiring(t, { within: 30 })).map((e) => [e.name, e.daysLeft])).toEqual([["Bala", 3], ["Asha", 29]]);
    expect(await svc.expiring(randomUUID())).toEqual([]);
  });

  it("an expiring list leaves out members who already renewed, and reminders go out for plans ending exactly N days ahead", async () => {
    at("2026-11-05T10:00:00Z");
    const { t, tenant, plan } = await newShop();
    // Ends 20 Nov (start 22 Oct): renewed for 21 Nov - 20 Dec, so no reminder.
    const renewed = await svc.createMember(tenant, { name: "Renewed", phone: "9111111111", plan: { planId: plan.id, startDate: "2026-10-22" } });
    await svc.renew(tenant, renewed.current!.id, {});
    // Ends 20 Nov too, not renewed.
    await svc.createMember(tenant, { name: "Lapsing", phone: "9111111112", plan: { planId: plan.id, startDate: "2026-10-22" } });
    // A cancelled plan ending the same day.
    const gone = await svc.createMember(tenant, { name: "Gone", plan: { planId: plan.id, startDate: "2026-10-22" } });
    await svc.cancel(t, gone.current!.id, { reason: "left gym" });

    expect((await svc.expiring(t, { from: "2026-11-20", to: "2026-11-20" })).map((e) => e.name)).toEqual(["Lapsing"]);
    reminders.length = 0;
    expect(await svc.remindExpiring(t, 15)).toBe(1);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.tenantId).toBe(t);
    expect(reminders[0]!.list[0]).toMatchObject({ name: "Lapsing", phone: "+919111111112", endDate: "2026-11-20", daysLeft: 15, planName: "Gym monthly", memberCode: "M-0002" });
    // Nothing ends 14 days ahead: no call.
    expect(await svc.remindExpiring(t, 14)).toBe(0);
    expect(reminders).toHaveLength(1);
    expect(await svc.tenantsWithPlansEnding("2026-11-20", "2026-11-20")).toContain(t);
    expect(await svc.tenantsWithPlansEnding("2020-01-01", "2020-01-02")).toEqual([]);

    // The daily job: this shop is among those reminded, and a failing sender is logged, not thrown.
    reminders.length = 0;
    const run = await svc.remindAllExpiring(15);
    expect(run.tenants).toBeGreaterThanOrEqual(1);
    expect(reminders.some((r) => r.tenantId === t && r.list.length === 1)).toBe(true);
    remindersFail = true;
    errors.length = 0;
    expect(await svc.remindExpiring(t, 15)).toBe(0);
    expect(errors).toContain("memberships: expiry reminders failed");
    remindersFail = false;
    const without = new MembershipsService({ db, now: () => clock });
    expect(await without.remindExpiring(t, 15)).toBe(0);
    expect(await without.remindAllExpiring(15)).toEqual({ tenants: 0, reminded: 0 });
  });

  it("front-desk check-in: finds the member by phone, code or number; one visit a day unless the shop allows more", async () => {
    at("2026-11-03T10:00:00Z");
    const { t, tenant, plan } = await newShop();
    const kiran = await svc.createMember(tenant, { name: "Kiran", phone: "9222222222", plan: { planId: plan.id, startDate: "2026-11-01" } }); // 1 - 30 Nov
    const none = await member(t, "No plan");

    const first = await svc.checkIn(t, { code: "9222222222" }, null);
    expect(first).toMatchObject({ ok: true, reason: null, daysLeft: 27, sessionsLeft: null, lastCheckinAt: null });
    expect(first.checkin!.at).toEqual(clock);
    expect(first.member.name).toBe("Kiran");

    at("2026-11-04T10:00:00Z");
    expect((await svc.checkIn(t, { code: "M-0001" })).ok).toBe(true);
    for (const typed of ["m0001", "1", "M-1", " 9222222222 ", "+91 92222 22222"]) {
      const r = await svc.checkIn(t, { code: typed });
      expect(r, typed).toMatchObject({ ok: false, reason: "already_checked_in" });
      expect(r.member.id).toBe(kiran.id);
      expect(r.checkin).toBeNull();
    }
    expect((await svc.checkIn(t, { memberId: kiran.id })).reason).toBe("already_checked_in");
    expect(await svc.checkIn(t, { code: "M-0002" })).toMatchObject({ ok: false, reason: "no_active_plan", subscription: null, daysLeft: null });

    // The shop allows two visits a day (another visit an hour later).
    await svc.updateSettings(t, { allowMultipleCheckins: true });
    at("2026-11-04T11:00:00Z");
    const again = await svc.checkIn(t, { memberId: kiran.id, note: "evening class" });
    expect(again.ok).toBe(true);
    expect(again.lastCheckinAt).toEqual(new Date("2026-11-04T10:00:00Z"));
    await svc.updateSettings(t, { allowMultipleCheckins: false });

    expect(await svc.checkIn(t, { code: "NOPE-9999" }).catch((e) => e)).toMatchObject({ status: 404, code: "member_not_found" });
    expect(await svc.checkIn(t, { code: "!!!" }).catch((e) => e)).toMatchObject({ status: 404, code: "member_not_found" });
    expect(await code(svc.checkIn(t, {}))).toBe("zod");
    expect(await code(svc.checkIn(t, { memberId: GHOST }))).toBe("404:not_found");
    // Another shop can't check this shop's member in, by code or by id.
    const stranger = randomUUID();
    expect(await svc.checkIn(stranger, { code: "9222222222" }).catch((e) => e)).toMatchObject({ code: "member_not_found" });
    expect(await code(svc.checkIn(stranger, { memberId: kiran.id }))).toBe("404:not_found");

    // Visits on a day, latest first; 00:30 on 6 Nov in India still belongs to the 6th.
    at("2026-11-05T19:00:00Z");
    expect((await svc.checkIn(t, { memberId: kiran.id })).ok).toBe(true);
    const nov4 = await svc.checkinsOn(t, { date: "2026-11-04" });
    expect(nov4.items.map((i) => [i.memberCode, i.planName, i.note])).toEqual([["M-0001", "Gym monthly", "evening class"], ["M-0001", "Gym monthly", null]]);
    expect((await svc.checkinsOn(t, { date: "2026-11-05" })).items).toEqual([]);
    expect((await svc.checkinsOn(t)).date).toBe("2026-11-06");
    expect((await svc.checkinsOn(t)).items).toHaveLength(1);
    expect(await code(svc.checkinsOn(t, { date: "2026-13-01" }))).toBe("zod");
    expect((await svc.checkinsOn(stranger, { date: "2026-11-04" })).items).toEqual([]);

    // Visits per day over a week, zeros filled in (3 Nov: 1, 4 Nov: 2, 6 Nov: 1).
    const week = await svc.checkinsPerDay(t, { days: 7 });
    expect(week).toMatchObject({ from: "2026-10-31", to: "2026-11-06" });
    expect(week.days.map((d) => d.count)).toEqual([0, 0, 0, 1, 2, 0, 1]);
    expect(await code(svc.checkinsPerDay(t, { days: 0 }))).toBe("zod");
    expect((await svc.summary(t, 7)).checkinsToday).toBe(1);

    // Member card: last visit and plan; the detail shows the latest visits first.
    const detail = await svc.getMember(t, kiran.id);
    expect(detail.checkins).toHaveLength(4);
    expect(detail.lastVisitAt).toBe(detail.checkins[0]!.at.toISOString());
    at("2026-11-05T10:00:00Z");
  });

  it("session packs use one session a visit, refuse when none are left, and an undone visit gives the session back", async () => {
    at("2026-11-05T10:00:00Z");
    const { t, tenant } = await newShop();
    await svc.updateSettings(t, { allowMultipleCheckins: true });
    const pack = await svc.createPlan(t, { name: "Spa x3", durationDays: 60, price: 300_000, sessions: 3 });
    const m = await svc.createMember(tenant, { name: "Sita", plan: { planId: pack.id } });
    expect(m.current).toMatchObject({ sessionsTotal: 3, sessionsUsed: 0, sessionsLeft: 3 });

    const v1 = await svc.checkIn(t, { memberId: m.id });
    expect(v1).toMatchObject({ ok: true, sessionsLeft: 2 });
    const v2 = await svc.checkIn(t, { memberId: m.id });
    expect(v2.sessionsLeft).toBe(1);
    const v3 = await svc.checkIn(t, { memberId: m.id });
    expect(v3.sessionsLeft).toBe(0);
    expect(await svc.checkIn(t, { memberId: m.id })).toMatchObject({ ok: false, reason: "no_sessions_left", sessionsLeft: 0, checkin: null });

    await svc.undoCheckin(t, v3.checkin!.id);
    expect((await svc.getMember(t, m.id)).current).toMatchObject({ sessionsUsed: 2, sessionsLeft: 1 });
    expect(await code(svc.undoCheckin(t, v3.checkin!.id))).toBe("404:not_found");
    expect(await code(svc.undoCheckin(randomUUID(), v1.checkin!.id))).toBe("404:not_found");
    expect((await svc.checkIn(t, { memberId: m.id })).ok).toBe(true);

    // Unlimited plans: undoing a visit doesn't touch sessions.
    const { t: t2, tenant: tenant2, plan } = await newShop();
    const u = await svc.createMember(tenant2, { name: "Uma", plan: { planId: plan.id } });
    const visit = await svc.checkIn(t2, { memberId: u.id });
    await svc.undoCheckin(t2, visit.checkin!.id);
    expect((await svc.getMember(t2, u.id)).current).toMatchObject({ sessionsUsed: 0, sessionsLeft: null });
    expect((await svc.checkIn(t2, { memberId: u.id })).ok).toBe(true); // the day's visit was undone, so they can come in again
  });

  it("check-in is refused for a frozen, upcoming, cancelled or ended plan, with the plan in the answer", async () => {
    at("2026-11-05T10:00:00Z");
    const { t, tenant, plan } = await newShop();
    const frozen = await svc.createMember(tenant, { name: "Frozen", plan: { planId: plan.id } });
    await svc.freeze(t, frozen.current!.id, {});
    const f = await svc.checkIn(t, { memberId: frozen.id });
    expect(f).toMatchObject({ ok: false, reason: "frozen", subscription: { state: "frozen" } });

    const upcoming = await svc.createMember(tenant, { name: "Upcoming", plan: { planId: plan.id, startDate: "2026-11-20" } });
    const up = await svc.checkIn(t, { memberId: upcoming.id });
    expect(up).toMatchObject({ ok: false, reason: "no_active_plan", daysLeft: 44 });
    expect(up.subscription!.state).toBe("upcoming");

    const cancelled = await svc.createMember(tenant, { name: "Cancelled", plan: { planId: plan.id } });
    await svc.cancel(t, cancelled.current!.id, { reason: "refund" });
    expect(await svc.checkIn(t, { memberId: cancelled.id })).toMatchObject({ ok: false, reason: "no_active_plan", subscription: null });

    const ended = await svc.createMember(tenant, { name: "Ended", plan: { planId: plan.id, startDate: "2026-09-01" } });
    const e = await svc.checkIn(t, { memberId: ended.id });
    expect(e).toMatchObject({ ok: false, reason: "no_active_plan", daysLeft: -36 });
    expect(e.subscription!.state).toBe("expired");
    // Frozen members count as active members in the summary and are counted as frozen.
    expect(await svc.summary(t, 7)).toMatchObject({ activeMembers: 1, frozenMembers: 1 });
  });

  it("settings: defaults, validated patches, a custom member-code prefix, and a broken settings source falls back to defaults", async () => {
    const t = randomUUID();
    expect(await svc.getSettings(t)).toEqual({ allowMultipleCheckins: false, expiringDays: 7, memberCodePrefix: "M" });
    expect(await svc.updateSettings(t, { memberCodePrefix: "GYM", expiringDays: 14 })).toEqual({ allowMultipleCheckins: false, expiringDays: 14, memberCodePrefix: "GYM" });
    expect(await code(svc.updateSettings(t, { expiringDays: 0 }))).toBe("zod");
    expect(await code(svc.updateSettings(t, { memberCodePrefix: "A B" }))).toBe("zod");
    expect(await code(svc.updateSettings(t, { colour: "red" }))).toBe("zod");
    expect((await svc.getSettings(t)).expiringDays).toBe(14);
    const m = await member(t, "Prefix");
    expect(m.memberCode).toBe("GYM-0001");
    expect((await svc.findMember(t, "gym0001"))?.id).toBe(m.id);
    // Values that don't pass validation are ignored in favour of the default.
    stored.set(t, { expiringDays: 500 as never });
    expect((await svc.getSettings(t)).expiringDays).toBe(7);

    const noSet = new MembershipsService({ db, now: () => clock, settings: { get: async () => ({}) } });
    expect(await code(noSet.updateSettings(t, { expiringDays: 3 }))).toBe("400:bad_request");
    warns.length = 0;
    const broken = new MembershipsService({ db, now: () => clock, log: { info() {}, error() {}, warn: (_o, m) => void warns.push(m ?? "") }, settings: { get: async () => { throw new Error("down"); } } });
    expect((await broken.getSettings(t)).expiringDays).toBe(7);
    expect(warns).toContain("memberships: settings unavailable, using defaults");
    expect((await new MembershipsService({ db }).getSettings(t)).memberCodePrefix).toBe("M");
  });

  it("a notification that fails never stops a sale", async () => {
    at("2026-11-05T10:00:00Z");
    const { t, tenant, plan } = await newShop();
    warns.length = 0;
    const loud = new MembershipsService({
      db,
      now: () => clock,
      log: { info() {}, error() {}, warn: (_o, m) => void warns.push(m ?? "") },
      notify: { sold: () => Promise.reject(new Error("sms down")) },
    });
    const m = await loud.createMember(tenant, { name: "Notify", plan: { planId: plan.id } });
    expect(m.current).not.toBeNull();
    const sync = new MembershipsService({
      db,
      now: () => clock,
      log: { info() {}, error() {}, warn: (_o, m) => void warns.push(m ?? "") },
      notify: { sold: () => { throw new Error("sync boom"); } },
    });
    const m2 = await sync.createMember(tenant, { name: "Notify two", plan: { planId: plan.id } });
    expect(m2.current).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(warns.filter((w) => w === "memberships: notify failed").length).toBe(2);
    void t;
  });

  describe("routes", () => {
    let app: FastifyInstance;
    let ctx: RequestContext;
    const who = (roles: string[], tenant: string) => ({ ...emptyContext(), tenant: ref(tenant), user: { id: randomUUID(), sessionId: "s", platformRoles: [], tenantRoles: roles } }) as RequestContext;
    beforeAll(async () => {
      app = Fastify();
      app.decorateRequest("ctx", null as never);
      app.addHook("onRequest", async (req) => {
        req.ctx = ctx;
      });
      app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
        reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
      });
      await app.register(membershipsRoutes(svc), { prefix: "/v1/memberships" });
    });
    afterAll(() => app?.close());

    it("sells, checks in and reports over HTTP; staff only; one shop can't read another's members", async () => {
      at("2026-11-05T10:00:00Z");
      const t = randomUUID();
      ctx = who(["owner"], t);
      const plan = (await app.inject({ method: "POST", url: "/v1/memberships/plans", payload: { name: "Yoga", durationDays: 30, price: 100_000 } })).json();
      expect(plan.gstRate).toBe(18);
      const mem = (await app.inject({ method: "POST", url: "/v1/memberships/members", payload: { name: "Zara", phone: "9333333333", plan: { planId: plan.id } } })).json();
      expect(mem).toMatchObject({ memberCode: "M-0001", status: "active" });
      expect(mem.current.endDate).toBe("2026-12-04");

      const checkin = (await app.inject({ method: "POST", url: "/v1/memberships/checkins", payload: { code: "9333333333" } })).json();
      expect(checkin).toMatchObject({ ok: true, daysLeft: 29 });
      expect((await app.inject({ method: "POST", url: "/v1/memberships/checkins", payload: { code: "M-0001" } })).json().reason).toBe("already_checked_in");
      expect((await app.inject({ method: "GET", url: "/v1/memberships/checkins/today" })).json().items).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: "/v1/memberships/reports/summary" })).json()).toMatchObject({ activeMembers: 1, checkinsToday: 1 });
      expect((await app.inject({ method: "GET", url: "/v1/memberships/reports/checkins?days=3" })).json().days).toHaveLength(3);
      expect((await app.inject({ method: "GET", url: "/v1/memberships/reports/expiring?within=30" })).json().items).toHaveLength(1);
      expect((await app.inject({ method: "PUT", url: "/v1/memberships/settings", payload: { expiringDays: 10 } })).json().expiringDays).toBe(10);
      expect((await app.inject({ method: "GET", url: "/v1/memberships/settings" })).json().expiringDays).toBe(10);
      expect((await app.inject({ method: "PUT", url: "/v1/memberships/settings", payload: { expiringDays: 999 } })).statusCode).toBe(400);
      expect((await app.inject({ method: "GET", url: "/v1/memberships/plans?all=1" })).json().items).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: "/v1/memberships/members?status=active" })).json().total).toBe(1);

      const subId = mem.current.id;
      expect((await app.inject({ method: "POST", url: `/v1/memberships/subscriptions/${subId}/freeze`, payload: {} })).statusCode).toBe(409); // plan has no freeze days
      expect((await app.inject({ method: "POST", url: `/v1/memberships/subscriptions/${subId}/bill`, payload: {} })).json().invoiceId).toBeTruthy();
      expect((await app.inject({ method: "POST", url: `/v1/memberships/subscriptions/${subId}/renew`, payload: {} })).json().startDate).toBe("2026-12-05");
      expect((await app.inject({ method: "POST", url: `/v1/memberships/subscriptions/${subId}/cancel`, payload: { reason: "test" } })).json().status).toBe("cancelled");
      expect((await app.inject({ method: "DELETE", url: `/v1/memberships/checkins/${checkin.checkin.id}` })).json()).toEqual({ ok: true });
      expect((await app.inject({ method: "PATCH", url: `/v1/memberships/members/${mem.id}`, payload: { notes: "vip" } })).json().notes).toBe("vip");
      expect((await app.inject({ method: "POST", url: `/v1/memberships/members/${mem.id}/subscriptions`, payload: { planId: plan.id, startDate: "2027-03-01" } })).json().endDate).toBe("2027-03-30");
      expect((await app.inject({ method: "DELETE", url: `/v1/memberships/members/${mem.id}` })).statusCode).toBe(409);
      expect((await app.inject({ method: "PATCH", url: `/v1/memberships/plans/${plan.id}`, payload: { price: 90_000 } })).json().price).toBe(90_000);
      expect((await app.inject({ method: "DELETE", url: `/v1/memberships/plans/${plan.id}` })).statusCode).toBe(409);
      expect((await app.inject({ method: "GET", url: `/v1/memberships/members/${mem.id}` })).json().subscriptions).toHaveLength(3);
      expect((await app.inject({ method: "GET", url: "/v1/memberships/members/not-a-uuid" })).statusCode).toBe(404);

      ctx = who(["owner"], randomUUID());
      expect((await app.inject({ method: "GET", url: `/v1/memberships/members/${mem.id}` })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/v1/memberships/members" })).json().total).toBe(0);
      ctx = who(["customer"], t);
      expect((await app.inject({ method: "GET", url: "/v1/memberships/members" })).statusCode).toBe(403);
    });
  });
});
