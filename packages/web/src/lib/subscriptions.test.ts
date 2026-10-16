import { describe, expect, it } from "vitest";
import {
  bannerState,
  isUpgradeError,
  changeKind,
  daysUntil,
  normalizeCurrent,
  planBlockFrom,
  planGrants,
  planThatUnlocks,
  trialProgress,
  yearlySavingPercent,
  type PlanInfo,
  type Subscription,
  type SubscriptionCurrent,
} from "./subscriptions";
import { ApiError } from "./api";

const NOW = Date.parse("2026-10-16T06:30:00.000Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const plan = (id: string, monthly: number, extra: Partial<PlanInfo> = {}): PlanInfo => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  description: null,
  priceMonthlyPaise: monthly,
  priceYearlyPaise: monthly * 10,
  modules: [],
  limits: {},
  features: {},
  isPublic: true,
  ...extra,
});

const PLANS = [
  plan("free", 0, { sort: 0, modules: ["invoices"], limits: { invoices_per_month: 50, staff: 1 } }),
  plan("starter", 49_900, { sort: 1, modules: ["invoices.*", "inventory"], limits: { invoices_per_month: 1000, staff: 5 } }),
  plan("pro", 149_900, { sort: 2, modules: ["invoices.*", "inventory.*", "chat"], limits: { invoices_per_month: -1, staff: 25 } }),
  plan("secret", 1, { sort: 3, isPublic: false, modules: ["*"] }),
];

const sub = (s: Partial<Subscription>): Subscription => ({
  id: "s1",
  tenantId: "t1",
  planId: "starter",
  interval: "monthly",
  status: "active",
  trialEndsAt: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  graceEndsAt: null,
  provider: "mock",
  authUrl: null,
  pendingPlanId: null,
  pendingInterval: null,
  ...s,
});
const cur = (s: Partial<Subscription> | null, extra: Partial<SubscriptionCurrent> = {}): SubscriptionCurrent => ({
  subscription: s ? sub(s) : null,
  plan: PLANS[1]!,
  trialDaysLeft: null,
  usage: [],
  canTrial: false,
  ...extra,
});

describe("daysUntil / trialProgress", () => {
  it("rounds up and floors at zero", () => {
    expect(daysUntil(iso(NOW + 2.2 * DAY), NOW)).toBe(3);
    expect(daysUntil(iso(NOW - DAY), NOW)).toBe(0);
    expect(daysUntil(null, NOW)).toBe(0);
    expect(daysUntil("nope", NOW)).toBe(0);
  });
  it("measures the share of a 14-day trial used", () => {
    expect(trialProgress({ trialEndsAt: iso(NOW + 7 * DAY) }, NOW)).toBeCloseTo(0.5);
    expect(trialProgress({ trialEndsAt: iso(NOW - DAY) }, NOW)).toBe(1);
    expect(trialProgress({ trialEndsAt: iso(NOW + 10 * DAY), trialStartedAt: iso(NOW - 10 * DAY) }, NOW)).toBeCloseTo(0.5);
    expect(trialProgress(null, NOW)).toBe(0);
  });
});

describe("bannerState", () => {
  it("is hidden for a healthy or missing subscription", () => {
    expect(bannerState(cur({ status: "active" }), NOW)).toBeNull();
    expect(bannerState(cur(null), NOW)).toBeNull();
    expect(bannerState(undefined, NOW)).toBeNull();
    expect(bannerState(cur({ status: "cancelled" }), NOW)).toBeNull();
  });
  it("counts trial days, preferring the server's number", () => {
    expect(bannerState(cur({ status: "trialing", trialEndsAt: iso(NOW + 5 * DAY) }), NOW)).toEqual({ kind: "trial", daysLeft: 5, hasMandate: false });
    expect(bannerState(cur({ status: "trialing", trialEndsAt: iso(NOW + 5 * DAY) }, { trialDaysLeft: 4 }), NOW)).toMatchObject({ daysLeft: 4 });
  });
  it("stays quiet during a trial that already has a mandate until the last 3 days", () => {
    const paid = { status: "trialing" as const, providerSubscriptionId: "sub_x", authUrl: null };
    expect(bannerState(cur({ ...paid, trialEndsAt: iso(NOW + 9 * DAY) }), NOW)).toBeNull();
    expect(bannerState(cur({ ...paid, trialEndsAt: iso(NOW + 2 * DAY) }), NOW)).toMatchObject({ kind: "trial", hasMandate: true });
  });
  it("is red with grace days when past due, and on expiry", () => {
    expect(bannerState(cur({ status: "past_due", graceEndsAt: iso(NOW + 6.5 * DAY) }), NOW)).toEqual({ kind: "past_due", graceDaysLeft: 7 });
    expect(bannerState(cur({ status: "expired" }), NOW)).toEqual({ kind: "expired" });
  });
});

describe("normalizeCurrent", () => {
  it("accepts usage as { items } and fills gaps", () => {
    const n = normalizeCurrent({ subscription: null, plan: null, usage: { items: [{ key: "staff", used: 2, limit: 5 }, { nope: 1 }] } });
    expect(n.usage).toEqual([{ key: "staff", used: 2, limit: 5, period: undefined, remaining: null }]);
    expect(n.canTrial).toBe(false);
    expect(n.trialDaysLeft).toBeNull();
  });
});

describe("plan maths", () => {
  it("yearly saving", () => {
    expect(yearlySavingPercent({ priceMonthlyPaise: 50_000, priceYearlyPaise: 500_000 })).toBe(17);
    expect(yearlySavingPercent({ priceMonthlyPaise: 0, priceYearlyPaise: 0 })).toBe(0);
    expect(yearlySavingPercent({ priceMonthlyPaise: 100, priceYearlyPaise: 1300 })).toBe(0);
  });
  it("upgrade vs downgrade by yearly spend, then sort (mirrors the server)", () => {
    const [free, starter, pro] = PLANS;
    expect(changeKind(starter!, "monthly", pro!, "monthly")).toBe("upgrade");
    expect(changeKind(pro!, "monthly", starter!, "monthly")).toBe("downgrade");
    expect(changeKind(starter!, "monthly", free!, "monthly")).toBe("downgrade");
    expect(changeKind(starter!, "monthly", starter!, "monthly")).toBe("same");
    // Same plan: monthly → yearly is an upgrade, yearly → monthly a downgrade (docs/batch5.md "As built").
    expect(changeKind(starter!, "monthly", starter!, "yearly")).toBe("upgrade");
    expect(changeKind(starter!, "yearly", starter!, "monthly")).toBe("downgrade");
    // Without ids it falls back to yearly spend.
    const { id: _a, ...anon } = starter!;
    expect(changeKind(anon, "monthly", { ...anon }, "yearly")).toBe("downgrade");
    const flat = { priceMonthlyPaise: 100, priceYearlyPaise: 1200 };
    expect(changeKind(flat, "monthly", flat, "yearly")).toBe("upgrade");
  });
});

describe("plan errors", () => {
  it("reads the 402 details", () => {
    expect(planBlockFrom({ key: "staff", limit: 1, used: 1 })).toEqual({ kind: "limit", key: "staff", limit: 1, used: 1 });
    expect(planBlockFrom({ feature: "inventory.purchases", reason: "plan" })).toEqual({ kind: "feature", feature: "inventory.purchases" });
    expect(planBlockFrom({ module: "chat" })).toEqual({ kind: "module", module: "chat" });
    expect(planBlockFrom(undefined)).toEqual({ kind: "plan" });
  });
  it("grants by key, module wildcard or *", () => {
    expect(planGrants(["invoices.*"], "invoices.credit-book")).toBe(true);
    expect(planGrants(["invoices.*"], "invoices")).toBe(true);
    expect(planGrants(["inventory"], "inventory.purchases")).toBe(false);
    expect(planGrants(["*"], "x.y")).toBe(true);
  });
  it("finds the cheapest public plan above the current one that lifts the block", () => {
    expect(planThatUnlocks(PLANS, { kind: "limit", key: "invoices_per_month", used: 50, limit: 50 }, "free")?.id).toBe("starter");
    expect(planThatUnlocks(PLANS, { kind: "limit", key: "invoices_per_month", used: 1000, limit: 1000 }, "starter")?.id).toBe("pro");
    expect(planThatUnlocks(PLANS, { kind: "feature", feature: "inventory.purchases" }, "free")?.id).toBe("pro");
    expect(planThatUnlocks(PLANS, { kind: "module", module: "chat" }, "starter")?.id).toBe("pro");
    expect(planThatUnlocks(PLANS, { kind: "module", module: "sso" }, "pro")).toBeNull();
    expect(planThatUnlocks(PLANS, { kind: "plan" }, "free")).toBeNull();
  });
  it("opens the upgrade dialog only for writes blocked by the plan", () => {
    const e402 = new ApiError(402, "plan_limit", "x", { key: "staff" });
    expect(isUpgradeError({ error: e402, method: "POST" })).toBe(true);
    expect(isUpgradeError({ error: e402, method: "GET" })).toBe(false);
    expect(isUpgradeError({ error: new ApiError(403, "feature_disabled", "x", { reason: "plan" }), method: "PATCH" })).toBe(true);
    expect(isUpgradeError({ error: new ApiError(403, "feature_disabled", "x", { reason: "shop" }), method: "POST" })).toBe(false);
    expect(isUpgradeError({ error: new ApiError(400, "bad_request", "x"), method: "POST" })).toBe(false);
  });
});
