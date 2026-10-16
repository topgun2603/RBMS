/**
 * Database test of the pending-upgrade state machine (pay first, then apply), proration credit and webhook ordering.
 * Runs only with `SUBSCRIPTIONS_TEST_DATABASE_URL` set (a development Postgres that has the subscriptions tables); it
 * copies them into a throw-away schema and drops it afterwards.
 *   PowerShell: $env:SUBSCRIPTIONS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5432/srikit"; pnpm test
 */
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, chargeAmount, prorationCredit } from "./logic";
import type { PlanInfo, TenantInfo } from "./ports";
import { MockSubscriptionProvider } from "./provider";
import { SubscriptionsService } from "./service";

const URL_ = process.env.SUBSCRIPTIONS_TEST_DATABASE_URL;
const SCHEMA = `subs_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["subscriptions", "subscription_events", "platform_invoices", "platform_invoice_series", "provider_plans"];
const HOUR = 3_600_000;

const plan = (id: string, monthly: number, yearly: number, sort: number): PlanInfo => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
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

describe.skipIf(!URL_)("pending upgrades against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let now = new Date("2026-10-16T04:30:00Z");
  const tenants = new Map<string, TenantInfo>();
  const buyerState = new Map<string, string>();
  const provider = new MockSubscriptionProvider({ authUrl: (id) => `http://shop.localhost:3001/settings/plan?mockAuth=${id}` });
  let svc: SubscriptionsService;

  /** A shop paying Starter monthly: trial → mandate → trial end → first charge; the clock is 10 IST days into the period. */
  async function payingStarter(state = "33") {
    const tenantId = randomUUID();
    tenants.set(tenantId, { id: tenantId, slug: `t-${tenantId.slice(0, 6)}`, name: "Shop", planId: "free", appId: "BL", status: "active" });
    buyerState.set(tenantId, state);
    await svc.startForNewTenant({ tenantId, ownerUserId: randomUUID(), planId: "starter", interval: "monthly" });
    const co = await svc.checkout(tenantId, { planId: "starter", interval: "monthly" });
    await svc.mockAuthorize(co.providerSubscriptionId);
    const sub = (await svc.get(tenantId))!;
    now = new Date(sub.trialEndsAt!.getTime() + HOUR);
    const charged = await svc.mockCharge(co.providerSubscriptionId);
    expect(charged.invoice?.totalPaise).toBe(chargeAmount(49_900));
    now = addDays(now, 10);
    return { tenantId, oldMandate: co.providerSubscriptionId, sub: (await svc.get(tenantId))! };
  }

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}".${t} (like public.${t} including all)`));
    svc = new SubscriptionsService({
      db,
      provider,
      clock: () => now,
      config: { seller: { legalName: "Srirealtime", gstin: null, stateCode: "33", address: null }, allowMock: true },
      plans: { getPlan: async (id) => PLANS.find((p) => p.id === id) ?? null, listPlans: async () => PLANS, usage: async () => [] },
      tenancy: {
        getTenant: async (id) => tenants.get(id) ?? null,
        getTenants: async (ids) => ids.map((id) => tenants.get(id)!).filter(Boolean),
        search: async () => [],
        setPlan: async (id, planId) => {
          tenants.set(id, { ...tenants.get(id)!, planId });
        },
      },
      shop: { buyer: async (id) => ({ legalName: "Shop", gstin: null, stateCode: buyerState.get(id) ?? "33", address: null }) },
    });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("an upgrade waits for payment, keeps the current plan, and applies with the credit once authorised", async () => {
    const { tenantId, oldMandate, sub } = await payingStarter();
    const expected = prorationCredit({ periodStart: sub.currentPeriodStart!, periodEnd: sub.currentPeriodEnd!, now, paidTaxablePaise: 49_900 });
    expect(expected.unusedDays).toBeGreaterThan(0);

    const preview = await svc.preview(tenantId, { planId: "pro", interval: "monthly" });
    expect(preview).toMatchObject({ kind: "upgrade", applies: "after_payment", creditPaise: expected.creditPaise, taxablePaise: 149_900 - expected.creditPaise });
    expect(preview.chargeTodayPaise).toBe(chargeAmount(149_900 - expected.creditPaise));
    expect(preview.gst.cgstPaise + preview.gst.sgstPaise + preview.gst.subtotalPaise).toBe(preview.chargeTodayPaise);

    const r = await svc.change(tenantId, { planId: "pro", interval: "monthly" });
    expect(r.applied).toBe("after_payment");
    expect(r.authUrl).toContain("mockAuth=");
    expect(r.subscription).toMatchObject({ planId: "starter", pendingPlanId: "pro", pendingReason: "awaiting_payment", pendingChargePaise: preview.chargeTodayPaise, pendingCreditPaise: expected.creditPaise });
    expect(tenants.get(tenantId)!.planId).toBe("starter");
    expect((await provider.fetch(oldMandate)).status).toBe("created"); // still running

    const a = await svc.mockAuthorize(r.subscription.pendingProviderSubscriptionId!);
    expect(a.subscription).toMatchObject({ planId: "pro", status: "active", pendingPlanId: null, pendingReason: null, providerSubscriptionId: r.subscription.pendingProviderSubscriptionId });
    expect(tenants.get(tenantId)!.planId).toBe("pro");
    expect((await provider.fetch(oldMandate)).status).toBe("cancelled");
    expect(a.invoice).toMatchObject({ totalPaise: preview.chargeTodayPaise, subtotalPaise: 149_900 - expected.creditPaise, creditPaise: expected.creditPaise, igstPaise: 0 });
    expect(a.invoice!.lines.map((l) => l.kind)).toEqual(["plan", "credit"]);
    expect(a.invoice!.lines[0]!.taxablePaise).toBe(149_900);
    expect(a.invoice!.creditLabel).toMatch(/unused of \d+ days of Starter/);

    // A redelivered authorisation and a later charge event for the same upfront payment change nothing.
    const again = await svc.mockAuthorize(r.subscription.pendingProviderSubscriptionId!);
    expect(again.outcome).toBe("ignored: already active");
    const { items } = await svc.listInvoices(tenantId);
    expect(items).toHaveLength(2);
  });

  it("charged before activated: the charge applies the upgrade; the late activation is ignored", async () => {
    const { tenantId } = await payingStarter("29");
    const r = await svc.change(tenantId, { planId: "pro", interval: "monthly" });
    const id = r.subscription.pendingProviderSubscriptionId!;
    const c = await svc.mockCharge(id);
    expect(c.outcome).toMatch(/^applied: upgraded, invoice /);
    expect(c.subscription).toMatchObject({ planId: "pro", pendingPlanId: null });
    expect(c.invoice).toMatchObject({ cgstPaise: 0, sgstPaise: 0, placeOfSupply: "29", totalPaise: r.subscription.pendingChargePaise });
    expect(c.invoice!.lines.every((l) => l.cgstPaise === 0 && l.sgstPaise === 0)).toBe(true);
    const late = await svc.processEvent("mock", `evt_late_${id}`, { event: "subscription.activated", payload: { subscription: { entity: { id } } } });
    expect(late.outcome).toBe("ignored: already active");
    expect((await svc.listInvoices(tenantId)).items).toHaveLength(2);
  });

  it("a failed payment keeps it pending; after 48 h the job drops it and cancels its mandate", async () => {
    const { tenantId } = await payingStarter();
    const r = await svc.change(tenantId, { planId: "pro", interval: "yearly" });
    const id = r.subscription.pendingProviderSubscriptionId!;
    expect((await svc.mockFail(id)).outcome).toBe("ignored: upgrade payment failed (still pending)");
    expect((await svc.get(tenantId))!.status).toBe("active");
    const early = await svc.runLifecycle({ tenantId, now: new Date(now.getTime() + 47 * HOUR) });
    expect(early.pending_expired).toBeUndefined();
    const job = await svc.runLifecycle({ tenantId, now: new Date(now.getTime() + 49 * HOUR) });
    expect(job.pending_expired).toBe(1);
    const after = (await svc.get(tenantId))!;
    expect(after).toMatchObject({ planId: "starter", pendingPlanId: null, pendingProviderSubscriptionId: null, status: "active" });
    expect((await provider.fetch(id)).status).toBe("cancelled");
    expect((await svc.runLifecycle({ tenantId, now: new Date(now.getTime() + 50 * HOUR) })).pending_expired).toBeUndefined();
    // A late authorisation of the lapsed mandate matches nothing.
    const late = await svc.processEvent("mock", `evt_lapsed_${id}`, { event: "subscription.authenticated", payload: { subscription: { entity: { id } } } });
    expect(late.outcome).toBe("ignored: unknown subscription");
  });

  it("cancel upgrade, a replaced upgrade, and back to the current plan", async () => {
    const { tenantId } = await payingStarter();
    const first = await svc.change(tenantId, { planId: "pro", interval: "monthly" });
    const second = await svc.change(tenantId, { planId: "pro", interval: "yearly" });
    expect(second.subscription.pendingInterval).toBe("yearly");
    expect((await provider.fetch(first.subscription.pendingProviderSubscriptionId!)).status).toBe("cancelled");
    const back = await svc.change(tenantId, { planId: "starter", interval: "monthly" });
    expect(back).toMatchObject({ applied: "none", subscription: { pendingPlanId: null } });
    await svc.change(tenantId, { planId: "pro", interval: "monthly" });
    const c = await svc.cancelUpgrade(tenantId);
    expect(c.subscription).toMatchObject({ planId: "starter", pendingPlanId: null });
    await expect(svc.cancelUpgrade(tenantId)).rejects.toMatchObject({ status: 400 });
  });

  it("trial switches stay instant, downgrades still wait for the period end, free needs checkout", async () => {
    const tenantId = randomUUID();
    tenants.set(tenantId, { id: tenantId, slug: "trial", name: "Trial", planId: "free", appId: "BL", status: "active" });
    await svc.startForNewTenant({ tenantId, ownerUserId: randomUUID(), planId: "starter", interval: "monthly" });
    expect(await svc.preview(tenantId, { planId: "pro", interval: "monthly" })).toMatchObject({ applies: "now", chargeTodayPaise: 0 });
    const t = await svc.change(tenantId, { planId: "pro", interval: "monthly" });
    expect(t).toMatchObject({ applied: "now", subscription: { planId: "pro", status: "trialing", pendingPlanId: null } });

    const { tenantId: paying } = await payingStarter();
    const p = await svc.preview(paying, { planId: "free", interval: "monthly" });
    expect(p.applies).toBe("period_end");
    const d = await svc.change(paying, { planId: "free", interval: "monthly" });
    expect(d).toMatchObject({ applied: "period_end", subscription: { pendingReason: "downgrade", planId: "starter" } });
  });

  it("a credit larger than the first charge carries over to the next invoice", async () => {
    // Starter yearly paid today; moving to Pro monthly credits ~Rs.4,990 against Rs.1,499.
    const tenantId = randomUUID();
    tenants.set(tenantId, { id: tenantId, slug: "yearly", name: "Yearly", planId: "free", appId: "BL", status: "active" });
    buyerState.set(tenantId, "33");
    await svc.startForNewTenant({ tenantId, ownerUserId: randomUUID(), planId: "starter", interval: "yearly" });
    const co = await svc.checkout(tenantId, { planId: "starter", interval: "yearly" });
    await svc.mockAuthorize(co.providerSubscriptionId);
    now = new Date((await svc.get(tenantId))!.trialEndsAt!.getTime() + HOUR);
    await svc.mockCharge(co.providerSubscriptionId);
    const pv = await svc.preview(tenantId, { planId: "pro", interval: "monthly" });
    expect(pv).toMatchObject({ applies: "after_payment", chargeTodayPaise: 0, taxablePaise: 0 });
    expect(pv.carryoverPaise).toBe(pv.creditPaise - 149_900);
    const r = await svc.change(tenantId, { planId: "pro", interval: "monthly" });
    const a = await svc.mockAuthorize(r.subscription.pendingProviderSubscriptionId!);
    expect(a.invoice).toBeNull(); // nothing charged now
    expect(a.subscription).toMatchObject({ planId: "pro", creditBalancePaise: pv.carryoverPaise });
    // The next renewal: the balance comes off as a credit line, GST on the net.
    now = addDays(now, 31);
    const next = await svc.mockCharge(r.subscription.pendingProviderSubscriptionId!);
    expect(next.invoice).toMatchObject({ creditPaise: 149_900, subtotalPaise: 0, totalPaise: 0, refundDuePaise: chargeAmount(149_900) });
    expect(next.subscription.creditBalancePaise).toBe(pv.carryoverPaise - 149_900);
  });
});
