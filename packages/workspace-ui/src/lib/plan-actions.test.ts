import { describe, expect, it } from "vitest";
import { isAwaitingPayment, type PlanInfo, type Subscription, type SubscriptionCurrent } from "@rbms/web";
import { planMode } from "./plan-actions";

const plan = (id: string, monthly: number, sort: number): PlanInfo => ({
  id,
  name: id,
  description: null,
  priceMonthlyPaise: monthly,
  priceYearlyPaise: monthly * 10,
  modules: [],
  limits: {},
  features: {},
  sort,
});
const PLANS = [plan("free", 0, 0), plan("starter", 49_900, 10), plan("pro", 149_900, 20)];
const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: "s",
  tenantId: "t",
  planId: "starter",
  interval: "monthly",
  status: "active",
  trialEndsAt: null,
  currentPeriodStart: null,
  currentPeriodEnd: "2026-11-16T00:00:00Z",
  cancelAtPeriodEnd: false,
  graceEndsAt: null,
  provider: "mock",
  authUrl: null,
  pendingPlanId: null,
  pendingInterval: null,
  ...over,
});
const cur = (s: Subscription): SubscriptionCurrent => ({ subscription: s, plan: PLANS.find((p) => p.id === s.planId)!, trialDaysLeft: null, usage: [], canTrial: false });

describe("planMode with an upgrade waiting for payment", () => {
  it("marks the pending plan and interval as awaiting; other plans keep their mode", () => {
    const s = sub({ pendingPlanId: "pro", pendingInterval: "monthly", pendingReason: "awaiting_payment" });
    expect(isAwaitingPayment(s)).toBe(true);
    expect(planMode(cur(s), PLANS, PLANS[2]!, "monthly")).toBe("awaiting");
    expect(planMode(cur(s), PLANS, PLANS[2]!, "yearly")).toBe("upgrade");
    expect(planMode(cur(s), PLANS, PLANS[1]!, "monthly")).toBe("current");
    expect(planMode(cur(s), PLANS, PLANS[0]!, "monthly")).toBe("downgrade");
  });
  it("a scheduled downgrade is not awaiting payment", () => {
    const s = sub({ planId: "pro", pendingPlanId: "starter", pendingInterval: "monthly", pendingReason: "downgrade" });
    expect(isAwaitingPayment(s)).toBe(false);
    expect(planMode(cur(s), PLANS, PLANS[1]!, "monthly")).toBe("downgrade");
  });
  it("trial switches stay a trial", () => {
    expect(planMode(cur(sub({ status: "trialing", provider: null })), PLANS, PLANS[2]!, "monthly")).toBe("trial");
  });
});
