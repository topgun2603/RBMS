/**
 * What choosing a plan card does (pure; mirrors the lifecycle rules in docs/batch5.md and packages/subscriptions):
 * - `trial`: while trialing, just switches the trial plan (POST /change, no payment).
 * - `start`: nothing paid is live (free, expired, cancelled) → POST /checkout and open the mandate URL.
 * - `upgrade`: applies now (POST /change; may hand back a new mandate URL).
 * - `downgrade`: stored as pending, applies at the period end (POST /change).
 * - `current`: the plan and interval the shop already has.
 */
import { changeKind, isPaidPlan, type BillingInterval, type PlanInfo, type Subscription, type SubscriptionCurrent } from "@srirealtime/web";

export type PlanMode = "current" | "trial" | "start" | "upgrade" | "downgrade";

const LIVE: ReadonlySet<Subscription["status"]> = new Set(["trialing", "active", "past_due"]);

export const isLive = (sub: Subscription | null | undefined): sub is Subscription => !!sub && LIVE.has(sub.status);

/** The plan the shop is on now (the subscription's plan, else what /current reported). */
export function currentPlanOf(cur: SubscriptionCurrent, plans: readonly PlanInfo[]): PlanInfo | null {
  const id = cur.subscription && isLive(cur.subscription) ? cur.subscription.planId : (cur.plan?.id ?? null);
  return plans.find((p) => p.id === id) ?? (cur.plan && cur.plan.id === id ? cur.plan : null);
}

export function planMode(cur: SubscriptionCurrent, plans: readonly PlanInfo[], target: PlanInfo, interval: BillingInterval): PlanMode {
  const sub = cur.subscription;
  const current = currentPlanOf(cur, plans);
  const paidTarget = isPaidPlan(target);

  if (!isLive(sub)) {
    // On the free plan (or no subscription row): paid plans start a checkout, free is where the shop already is.
    if (!paidTarget) return "current";
    return "start";
  }
  if (sub.planId === target.id && (sub.interval === interval || !paidTarget)) return "current";
  // Free during a trial ends the trial at once (the server moves the shop to free now).
  if (sub.status === "trialing") return paidTarget ? "trial" : "downgrade";
  // A free or complimentary (manual) subscription has no mandate: a paid plan starts a trial or a checkout, and
  // moving to free applies at once.
  if ((!isPaidPlan(current) || sub.provider === "manual") && paidTarget) return "start";
  if (sub.provider === "manual") return "downgrade";
  const kind = current ? changeKind(current, sub.interval, target, interval) : "upgrade";
  return kind === "same" ? "current" : kind;
}

/** When the current period (or the trial) ends: the date a downgrade or cancellation takes effect. */
export function periodEndOf(sub: Subscription | null | undefined): string | null {
  if (!sub) return null;
  // A comp ends on its own date, but a change or cancellation applies at once.
  if (sub.provider === "manual") return null;
  if (sub.status === "trialing") return sub.trialEndsAt ?? sub.currentPeriodEnd;
  return sub.currentPeriodEnd ?? sub.trialEndsAt;
}

/** A trial that already has an authorised mandate (charges at trial end). */
export const hasMandate = (sub: Subscription | null | undefined) => !!sub?.providerSubscriptionId && !sub.authUrl && sub.provider !== "manual";

/** Limit keys in the order the plan cards list them. */
export const CARD_LIMITS = ["invoices_per_month", "staff", "whatsapp_per_month", "sms_per_month", "storage_mb"] as const;

/** Paid, live and not already ending: can be cancelled. */
export const canCancel = (cur: SubscriptionCurrent) =>
  isLive(cur.subscription) && !cur.subscription.cancelAtPeriodEnd && cur.subscription.provider !== "manual" && (isPaidPlan(cur.plan) || cur.subscription.status === "trialing");
