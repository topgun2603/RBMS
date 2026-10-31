/**
 * Database test of plan add-ons with the mock provider: buying (prorated payment link), renewals with add-on lines,
 * decreases at the period end, credits packs, upgrades and downgrades that end incompatible add-ons, cancel/resume.
 * Runs only with `SUBSCRIPTIONS_TEST_DATABASE_URL` set (a development Postgres with the subscriptions tables migrated);
 * it copies them into a throw-away schema and drops it afterwards.
 */
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addonProration } from "./addons";
import { addDays, chargeAmount } from "./logic";
import type { AddonInfo, PlanInfo, TenantInfo } from "./ports";
import { MockSubscriptionProvider } from "./provider";
import { SubscriptionsService } from "./service";

const URL_ = process.env.SUBSCRIPTIONS_TEST_DATABASE_URL;
const SCHEMA = `subs_addons_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["subscriptions", "subscription_events", "platform_invoices", "platform_invoice_series", "provider_plans", "subscription_addons", "subscription_addon_payments"];
const HOUR = 3_600_000;

const plan = (id: string, monthly: number, sort: number, modules: string[] = []): PlanInfo => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  description: null,
  priceMonthlyPaise: monthly,
  priceYearlyPaise: monthly * 10,
  modules,
  limits: {},
  features: {},
  isPublic: true,
  sort,
  tier: id,
});
const PLANS = [plan("free", 0, 0), plan("starter", 49_900, 10), plan("pro", 149_900, 20, ["custom-domain"])];
const addon = (a: Partial<AddonInfo> & Pick<AddonInfo, "id" | "kind" | "name">): AddonInfo => ({
  code: a.id,
  appId: null,
  description: null,
  limits: {},
  modules: [],
  priceMonthlyPaise: 0,
  priceYearlyPaise: 0,
  priceOncePaise: 0,
  minQuantity: 1,
  maxQuantity: 1,
  tiers: [],
  isPublic: true,
  sort: 0,
  ...a,
});
const ADDONS: AddonInfo[] = [
  addon({ id: "extra-staff", kind: "limit", name: "Extra staff", limits: { staff: 5 }, priceMonthlyPaise: 19_900, priceYearlyPaise: 199_000, maxQuantity: 10, tiers: ["starter", "pro"] }),
  addon({ id: "custom-domain", kind: "feature", name: "Custom domain", modules: ["custom-domain"], priceMonthlyPaise: 14_900, priceYearlyPaise: 149_000, tiers: ["starter", "pro"] }),
  addon({ id: "wa-1000", kind: "limit", name: "WhatsApp 1,000", limits: { whatsapp_per_month: 1000 }, priceMonthlyPaise: 29_900, priceYearlyPaise: 299_000, maxQuantity: 5, tiers: ["pro"] }),
  addon({ id: "sms-5000", kind: "credits", name: "SMS pack", limits: { sms_per_month: 5000 }, priceOncePaise: 99_900, maxQuantity: 5 }),
];

describe.skipIf(!URL_)("plan add-ons against Postgres (mock provider)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let now = new Date("2026-10-16T04:30:00Z");
  const tenants = new Map<string, TenantInfo>();
  const credits = new Map<string, Record<string, number>>();
  const invalidated: string[] = [];
  const messages: { tenantId: string; template: string; vars: Record<string, string> }[] = [];
  const provider = new MockSubscriptionProvider({
    authUrl: (id) => `http://shop.localhost:3001/settings/plan?mockAuth=${id}`,
    payUrl: (id) => `http://shop.localhost:3001/settings/plan?mockPay=${id}`,
  });
  let svc: SubscriptionsService;

  /** A shop paying `planId` monthly (trial → mandate → first charge), the clock 10 IST days into the period. */
  async function paying(planId = "starter") {
    const tenantId = randomUUID();
    tenants.set(tenantId, { id: tenantId, slug: `a-${tenantId.slice(0, 6)}`, name: "Shop", planId: "free", appId: "BL", status: "active" });
    await svc.startForNewTenant({ tenantId, ownerUserId: randomUUID(), planId, interval: "monthly" });
    const co = await svc.checkout(tenantId, { planId, interval: "monthly" });
    await svc.mockAuthorize(co.providerSubscriptionId);
    now = new Date((await svc.get(tenantId))!.trialEndsAt!.getTime() + HOUR);
    await svc.mockCharge(co.providerSubscriptionId);
    now = addDays(now, 10);
    return { tenantId, mandate: co.providerSubscriptionId, sub: (await svc.get(tenantId))! };
  }

  /** Buys (or changes to) `quantity` and pays the link. */
  async function buy(tenantId: string, addonId: string, quantity: number) {
    const r = await svc.setAddon(tenantId, { addonId, quantity });
    expect(r.applied).toBe("after_payment");
    return { set: r, paid: await svc.mockPay(r.payment!.providerPaymentId!) };
  }

  const sumLines = (inv: { lines: { taxablePaise: number; totalPaise: number; cgstPaise: number; sgstPaise: number }[]; subtotalPaise: number; totalPaise: number; cgstPaise: number; sgstPaise: number }) => {
    expect(inv.lines.reduce((s, l) => s + l.taxablePaise, 0)).toBe(inv.subtotalPaise);
    expect(inv.lines.reduce((s, l) => s + l.totalPaise, 0)).toBe(inv.totalPaise);
    expect(inv.lines.reduce((s, l) => s + l.cgstPaise, 0)).toBe(inv.cgstPaise);
    expect(inv.lines.reduce((s, l) => s + l.sgstPaise, 0)).toBe(inv.sgstPaise);
  };

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
      config: { seller: { legalName: "RBMS", gstin: null, stateCode: "33", address: null }, allowMock: true },
      plans: {
        getPlan: async (id) => PLANS.find((p) => p.id === id) ?? null,
        listPlans: async () => PLANS,
        usage: async () => [],
        listAddons: async () => ADDONS,
        getAddon: async (id) => ADDONS.find((a) => a.id === id) ?? null,
        appFeatures: async () => null,
        invalidate: (tenantId) => invalidated.push(tenantId),
        credits: async (tenantId) => credits.get(tenantId) ?? {},
        grantCredits: async (tenantId, grants) => {
          const c = { ...(credits.get(tenantId) ?? {}) };
          for (const [k, n] of Object.entries(grants)) c[k] = (c[k] ?? 0) + n;
          credits.set(tenantId, c);
          return c;
        },
      },
      tenancy: {
        getTenant: async (id) => tenants.get(id) ?? null,
        getTenants: async (ids) => ids.map((id) => tenants.get(id)!).filter(Boolean),
        search: async () => [],
        setPlan: async (id, planId) => {
          tenants.set(id, { ...tenants.get(id)!, planId });
        },
      },
      shop: { buyer: async () => ({ legalName: "Shop", gstin: null, stateCode: "33", address: null }) },
      notify: { toOwners: async (m) => void messages.push(m) },
    });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("buy: prorated payment link, applied once paid, invoiced with GST, re-priced from the next cycle; renewals carry it", async () => {
    const { tenantId, mandate, sub } = await paying();
    const list = await svc.addons(tenantId);
    expect(list.billing).toBeNull();
    expect(Object.fromEntries(list.items.map((i) => [i.addon.id, i.block]))).toEqual({ "extra-staff": null, "custom-domain": null, "wa-1000": "tier", "sms-5000": null });

    const pro = addonProration({ periodStart: sub.currentPeriodStart!, periodEnd: sub.currentPeriodEnd!, now, unitPricePaise: 19_900, quantity: 2 });
    const pv = await svc.addonPreview(tenantId, { addonId: "extra-staff", quantity: 2 });
    expect(pv).toMatchObject({ kind: "buy", applies: "after_payment", fromQuantity: 0, taxablePaise: pro.taxablePaise, chargeTodayPaise: chargeAmount(pro.taxablePaise), recurringPaise: 39_800, nextRenewalPaise: 49_900 + 39_800 });
    expect(pro.unusedDays).toBeLessThan(pro.periodDays);

    const r = await svc.setAddon(tenantId, { addonId: "extra-staff", quantity: 2 });
    expect(r.payment).toMatchObject({ status: "pending", chargePaise: chargeAmount(pro.taxablePaise) });
    expect(r.authUrl).toContain("mockPay=plink_mock_");
    expect(await svc.effectiveAddons(tenantId)).toEqual([]);

    const paid = await svc.mockPay(r.payment!.providerPaymentId!);
    expect(paid.outcome).toMatch(/^applied: proration extra-staff, invoice /);
    expect(paid.invoice).toMatchObject({ kind: "addon", totalPaise: chargeAmount(pro.taxablePaise), subtotalPaise: pro.taxablePaise });
    expect(paid.invoice!.lines.map((l) => l.kind)).toEqual(["addon"]);
    sumLines(paid.invoice!);
    expect(await svc.effectiveAddons(tenantId)).toEqual([{ addonId: "extra-staff", quantity: 2 }]);
    expect(invalidated).toContain(tenantId);
    expect((await provider.fetch(mandate)).planId).toBe(`plan_mock_starter_monthly_${chargeAmount(49_900 + 39_800)}`);
    // Paying again changes nothing.
    expect((await svc.processEvent("mock", "evt_dup_pay", { event: "payment_link.paid", payload: { payment_link: { entity: { id: r.payment!.providerPaymentId } } } })).outcome).toBe("ignored: already paid");

    // Renewal: plan + add-on lines.
    now = new Date((await svc.get(tenantId))!.currentPeriodEnd!.getTime() + HOUR);
    const renewal = await svc.mockCharge(mandate);
    expect(renewal.invoice).toMatchObject({ kind: "plan", totalPaise: chargeAmount(49_900 + 39_800) });
    expect(renewal.invoice!.lines.map((l) => [l.kind, l.taxablePaise])).toEqual([
      ["plan", 49_900],
      ["addon", 39_800],
    ]);
    sumLines(renewal.invoice!);
    const [row] = await svc.addonViews(tenantId);
    expect(row).toMatchObject({ quantity: 2, nextQuantity: null, currentPeriodEnd: (await svc.get(tenantId))!.currentPeriodEnd });

    // Fewer from the next period; the current one keeps 2.
    now = addDays(now, 5);
    const d = await svc.setAddon(tenantId, { addonId: "extra-staff", quantity: 1 });
    expect(d.applied).toBe("period_end");
    expect(await svc.effectiveAddons(tenantId)).toEqual([{ addonId: "extra-staff", quantity: 2 }]);
    expect((await svc.addonPreview(tenantId, { addonId: "extra-staff", quantity: 2 })).kind).toBe("resume");
    now = new Date((await svc.get(tenantId))!.currentPeriodEnd!.getTime() + HOUR);
    expect(await svc.effectiveAddons(tenantId)).toEqual([{ addonId: "extra-staff", quantity: 1 }]);
    const next = await svc.mockCharge(mandate);
    expect(next.invoice!.totalPaise).toBe(chargeAmount(49_900 + 19_900));
    expect((await svc.addonViews(tenantId))[0]).toMatchObject({ quantity: 1, nextQuantity: null });

    // Cancel: ends at the period end, then the job ends it.
    expect((await svc.cancelAddon(tenantId, "extra-staff")).applied).toBe("period_end");
    expect((await svc.addonViews(tenantId))[0]).toMatchObject({ endsAtPeriodEnd: true, endReason: "cancelled" });
    const end = (await svc.get(tenantId))!.currentPeriodEnd!;
    const job = await svc.runLifecycle({ tenantId, now: new Date(end.getTime() + HOUR) });
    expect(job.addon_ended).toBe(1);
    expect(await svc.addonViews(tenantId)).toEqual([]);
  });

  it("credits packs: a one-time payment that grants credits, on any plan", async () => {
    const { tenantId } = await paying();
    const pv = await svc.addonPreview(tenantId, { addonId: "sms-5000", quantity: 2 });
    expect(pv).toMatchObject({ kind: "credits", taxablePaise: 199_800, chargeTodayPaise: chargeAmount(199_800), credits: { sms_per_month: 10_000 } });
    const { paid } = await buy(tenantId, "sms-5000", 2);
    expect(paid.invoice).toMatchObject({ kind: "credits", totalPaise: chargeAmount(199_800) });
    sumLines(paid.invoice!);
    expect(credits.get(tenantId)).toEqual({ sms_per_month: 10_000 });
    await expect(svc.setAddon(tenantId, { addonId: "sms-5000", quantity: 9 })).rejects.toMatchObject({ status: 400 });
  });

  it("an upgrade restarts the add-ons it can keep (credited and charged with it) and ends the ones its plan includes", async () => {
    const { tenantId } = await paying();
    await buy(tenantId, "extra-staff", 1);
    await buy(tenantId, "custom-domain", 1);
    const pv = await svc.preview(tenantId, { planId: "pro", interval: "monthly" });
    expect(pv).toMatchObject({ kind: "upgrade", addonsPricePaise: 19_900, planPricePaise: 149_900 + 19_900, endingAddons: ["Custom domain"] });
    const r = await svc.change(tenantId, { planId: "pro", interval: "monthly" });
    const a = await svc.mockAuthorize(r.subscription.pendingProviderSubscriptionId!);
    expect(a.invoice!.lines.map((l) => [l.kind, l.taxablePaise > 0])).toEqual([
      ["plan", true],
      ["addon", true],
      ["credit", false],
    ]);
    expect(a.invoice!.lines[0]!.taxablePaise).toBe(149_900);
    expect(a.invoice!.lines[1]!.taxablePaise).toBe(19_900);
    sumLines(a.invoice!);
    const views = await svc.addonViews(tenantId);
    expect(views.map((v) => v.addonId)).toEqual(["extra-staff"]);
    expect(views[0]!.currentPeriodEnd).toEqual((await svc.get(tenantId))!.currentPeriodEnd);
  });

  it("a downgrade ends add-ons the lower tier can't have at the period end, with a notice; taking it back keeps them", async () => {
    const { tenantId } = await paying("pro");
    await buy(tenantId, "wa-1000", 1);
    await buy(tenantId, "extra-staff", 1);
    const pv = await svc.preview(tenantId, { planId: "starter", interval: "monthly" });
    expect(pv).toMatchObject({ kind: "downgrade", applies: "period_end", endingAddons: ["WhatsApp 1,000"] });
    await svc.change(tenantId, { planId: "starter", interval: "monthly" });
    const views = await svc.addonViews(tenantId);
    expect(views.find((v) => v.addonId === "wa-1000")).toMatchObject({ endsAtPeriodEnd: true, endReason: "plan_change", activeQuantity: 1 });
    expect(views.find((v) => v.addonId === "wa-1000")!.notice).toMatch(/Not available on Starter/);
    expect(views.find((v) => v.addonId === "extra-staff")).toMatchObject({ endsAtPeriodEnd: false });
    expect(messages.some((m) => m.tenantId === tenantId && m.template === "subscription.addon_ending" && m.vars.addons === "WhatsApp 1,000")).toBe(true);
    const sub = (await svc.get(tenantId))!;
    expect((await provider.fetch(sub.providerSubscriptionId!)).planId).toBe(`plan_mock_starter_monthly_${chargeAmount(49_900 + 19_900)}`);
    // Can't be resumed while the downgrade stands.
    await expect(svc.setAddon(tenantId, { addonId: "wa-1000", quantity: 1 })).rejects.toMatchObject({ status: 400 });

    // Back to Pro: the add-on carries on.
    await svc.change(tenantId, { planId: "pro", interval: "monthly" });
    expect((await svc.addonViews(tenantId)).find((v) => v.addonId === "wa-1000")).toMatchObject({ endsAtPeriodEnd: false, endReason: null });

    // Downgrade again and let the period end: the job applies it and ends the add-on.
    await svc.change(tenantId, { planId: "starter", interval: "monthly" });
    await svc.runLifecycle({ tenantId, now: new Date(sub.currentPeriodEnd!.getTime() + HOUR) });
    expect((await svc.get(tenantId))!.planId).toBe("starter");
    expect((await svc.addonViews(tenantId)).map((v) => v.addonId)).toEqual(["extra-staff"]);
  });

  it("cancelling the plan ends add-ons with it; resume keeps them; billing blocks and unpaid links lapse", async () => {
    const { tenantId } = await paying();
    await buy(tenantId, "extra-staff", 1);
    await svc.cancel(tenantId);
    expect((await svc.addonViews(tenantId))[0]).toMatchObject({ endsAtPeriodEnd: true, endReason: "plan_ended" });
    expect((await svc.addons(tenantId)).billing).toBe("cancelling");
    await svc.resume(tenantId);
    expect((await svc.addonViews(tenantId))[0]).toMatchObject({ endsAtPeriodEnd: false });

    // An unpaid link lapses after 48 h.
    const resumed = (await svc.get(tenantId))!;
    if (resumed.authUrl) await svc.mockAuthorize(resumed.providerSubscriptionId!);
    const r = await svc.setAddon(tenantId, { addonId: "extra-staff", quantity: 3 });
    const job = await svc.runLifecycle({ tenantId, now: new Date(now.getTime() + 49 * HOUR) });
    expect(job.addon_payment_expired).toBe(1);
    expect((await svc.addons(tenantId)).payments).toEqual([]);
    expect(r.payment!.status).toBe("pending");

    // A trial can't take recurring add-ons.
    const trial = randomUUID();
    tenants.set(trial, { id: trial, slug: "trial-a", name: "Trial", planId: "free", appId: "BL", status: "active" });
    await svc.startForNewTenant({ tenantId: trial, ownerUserId: randomUUID(), planId: "starter", interval: "monthly" });
    expect((await svc.addons(trial)).billing).toBe("trial");
    await expect(svc.setAddon(trial, { addonId: "extra-staff", quantity: 1 })).rejects.toMatchObject({ status: 400, details: { reason: "trial" } });
  });

  it("super-admin comp: no charge, counted until it ends, not part of the recurring amount", async () => {
    const { tenantId, mandate } = await paying();
    const until = addDays(now, 5);
    await svc.compAddon(tenantId, { addonId: "wa-1000", quantity: 2, until }, { userId: null });
    expect(await svc.effectiveAddons(tenantId)).toEqual([{ addonId: "wa-1000", quantity: 2 }]);
    await expect(svc.setAddon(tenantId, { addonId: "wa-1000", quantity: 3 })).rejects.toMatchObject({ status: 409 });
    expect((await provider.fetch(mandate)).planId).not.toContain(String(chargeAmount(49_900 + 59_800)));
    await svc.compAddon(tenantId, { addonId: "sms-5000", quantity: 1, until: null }, { userId: null });
    expect(credits.get(tenantId)).toEqual({ sms_per_month: 5000 });
    const job = await svc.runLifecycle({ tenantId, now: addDays(until, 1) });
    expect(job.addon_ended).toBe(1);
    expect(await svc.effectiveAddons(tenantId)).toEqual([]);
    expect((await svc.adminAddons(tenantId)).items[0]).toMatchObject({ status: "ended", endReason: "comp_ended" });
  });
});
