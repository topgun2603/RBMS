/**
 * Plan subscription API shapes (`/v1/subscriptions`, `/v1/plans`; docs/batch5.md) and the pure helpers the kit's trial
 * banner, upgrade dialog and the workspace Plan & billing page share. One place for these types: UI modules import
 * them from `@srirealtime/web`. Money is integer paise; dates arrive as ISO strings.
 */

/** Permission that opens Plan & billing and the trial banner (owners/admins hold it). */
export const SUBSCRIPTIONS_PERMISSION = "subscriptions.manage";
/** Settings path of the Plan & billing page (workspace-ui claims it): /settings/plan. */
export const PLAN_SETTINGS_PATH = "plan";
/** Query param the mock provider's authUrl comes back with (`?mockAuth=<subscriptionId>`). */
export const MOCK_AUTH_PARAM = "mockAuth";

export type BillingInterval = "monthly" | "yearly";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "cancelled" | "expired";
export type SubscriptionProvider = "razorpay" | "mock" | "manual";

export interface PlanInfo {
  id: string;
  name: string;
  description: string | null;
  priceMonthlyPaise: number;
  priceYearlyPaise: number;
  /** Feature keys and module wildcards ("invoices.*"), docs/features.md. */
  modules: string[];
  /** -1 = unlimited. Keys ending in `_per_month` reset monthly. */
  limits: Record<string, number>;
  features: Record<string, boolean>;
  isPublic?: boolean;
  sort?: number;
}

export interface UsageItem {
  key: string;
  used: number;
  /** -1 = unlimited. */
  limit: number;
  period?: string;
  remaining?: number | null;
}

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  interval: BillingInterval;
  status: SubscriptionStatus;
  trialStartedAt?: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  graceEndsAt: string | null;
  provider: SubscriptionProvider | null;
  providerSubscriptionId?: string | null;
  /** Mandate short URL while a checkout waits for authorisation. */
  authUrl: string | null;
  /** The plan/interval a pending checkout (mandate) is for. */
  checkoutPlanId?: string | null;
  checkoutInterval?: BillingInterval | null;
  /** A downgrade waiting for the period end, or an upgrade waiting for payment (`pendingReason`). */
  pendingPlanId: string | null;
  pendingInterval: BillingInterval | null;
  /** `awaiting_payment`: an upgrade that applies once its mandate is authorised; `downgrade`: at the period end. */
  pendingReason?: "downgrade" | "awaiting_payment" | null;
  pendingSince?: string | null;
  /** An unpaid upgrade lapses at this time (48 h after it was asked for). */
  pendingExpiresAt?: string | null;
  pendingProviderSubscriptionId?: string | null;
  /** Where the pending upgrade is paid (UPI Autopay / card mandate). */
  pendingAuthUrl?: string | null;
  pendingPeriodEnd?: string | null;
  /** Proration credit (taxable paise) taken off the upgrade's first charge. */
  pendingCreditPaise?: number;
  /** Due now for the upgrade, GST included. */
  pendingChargePaise?: number;
  /** Credit owed to the shop: a discount line on the next invoice. */
  creditBalancePaise?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** GET /v1/subscriptions/current, normalised by `normalizeCurrent`. */
export interface SubscriptionCurrent {
  subscription: Subscription | null;
  plan: PlanInfo | null;
  /** The plan a scheduled downgrade moves to. */
  pendingPlan?: PlanInfo | null;
  trialDaysLeft: number | null;
  graceDaysLeft?: number | null;
  usage: UsageItem[];
  /** This owner has never had a trial: choosing a paid plan from free starts one. */
  canTrial: boolean;
}

/** POST /change answer. `requiresCheckout`: nothing changed, the plan needs a payment first (POST /checkout). */
export interface ChangeResult {
  subscription?: Subscription;
  /** `after_payment`: an upgrade waiting for its payment (open `authUrl`). */
  applied?: "now" | "period_end" | "after_payment" | "none";
  authUrl?: string | null;
  requiresCheckout?: boolean;
}

/** POST /v1/subscriptions/change/preview: what a plan change would do and charge. Money in paise, dates ISO. */
export interface ChangePreview {
  planId: string;
  interval: BillingInterval;
  kind: "upgrade" | "downgrade" | "same" | "trial" | "start" | "free";
  applies: "now" | "period_end" | "after_payment" | "none";
  requiresCheckout: boolean;
  planPricePaise: number;
  /** Credit (taxable) for the unused days of the current paid period, plus any earlier credit. */
  creditPaise: number;
  unusedDays: number;
  periodDays: number;
  carryoverPaise: number;
  taxablePaise: number;
  chargeTodayPaise: number;
  gst: { subtotalPaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; interState: boolean; ratePercent: number };
  startsAt: string | null;
  nextChargeAt: string | null;
}

/** An upgrade waiting for its payment (the current plan is still on). */
export const isAwaitingPayment = (sub: Pick<Subscription, "pendingPlanId" | "pendingReason"> | null | undefined) =>
  !!sub?.pendingPlanId && sub.pendingReason === "awaiting_payment";

export interface PlatformInvoice {
  id: string;
  number: string;
  planId: string;
  interval: BillingInterval;
  periodStart: string | null;
  periodEnd: string | null;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  /** Proration credit (taxable paise), shown as its own line. */
  creditPaise: number;
  status: "paid" | "void";
  createdAt: string;
}

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function usageList(raw: unknown): UsageItem[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  return list
    .filter((u): u is Record<string, unknown> => !!u && typeof u === "object" && typeof (u as { key?: unknown }).key === "string")
    .map((u) => ({ key: u.key as string, used: num(u.used), limit: num(u.limit, -1), period: str(u.period) ?? undefined, remaining: (u.remaining as number | null | undefined) ?? null }));
}

/** Tolerant reader for `/subscriptions/current` (usage as an array or `{ items }`). */
export function normalizeCurrent(raw: unknown): SubscriptionCurrent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const sub = (r.subscription ?? null) as Subscription | null;
  return {
    subscription: sub ? { ...sub, cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd } : null,
    plan: (r.plan ?? null) as PlanInfo | null,
    pendingPlan: (r.pendingPlan ?? null) as PlanInfo | null,
    trialDaysLeft: typeof r.trialDaysLeft === "number" ? r.trialDaysLeft : sub?.status === "trialing" && sub.trialEndsAt ? daysUntil(sub.trialEndsAt) : null,
    graceDaysLeft: typeof r.graceDaysLeft === "number" ? r.graceDaysLeft : null,
    usage: usageList(r.usage),
    canTrial: !!r.canTrial,
  };
}

/** Invoice amounts may come as `cgstPaise` or `cgst`. */
export function normalizeInvoice(raw: Record<string, unknown>): PlatformInvoice {
  return {
    id: String(raw.id),
    number: String(raw.number ?? ""),
    planId: String(raw.planId ?? ""),
    interval: (raw.interval as BillingInterval) ?? "monthly",
    periodStart: str(raw.periodStart),
    periodEnd: str(raw.periodEnd),
    subtotalPaise: num(raw.subtotalPaise),
    cgstPaise: num(raw.cgstPaise ?? raw.cgst),
    sgstPaise: num(raw.sgstPaise ?? raw.sgst),
    igstPaise: num(raw.igstPaise ?? raw.igst),
    totalPaise: num(raw.totalPaise),
    creditPaise: num(raw.creditPaise),
    status: raw.status === "void" ? "void" : "paid",
    createdAt: String(raw.createdAt ?? raw.periodStart ?? ""),
  };
}

const DAY = 86_400_000;

/** Whole days from `now` until `iso`, rounded up (0 once it has passed). */
export function daysUntil(iso: string | null | undefined, now: number = Date.now()): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - now) / DAY));
}

export const TRIAL_DAYS = 14;

/** Share of the trial used (0–1): from `trialStartedAt` (else 14 days before the end) to `trialEndsAt`. */
export function trialProgress(sub: Pick<Subscription, "trialEndsAt" | "trialStartedAt"> | null, now: number = Date.now()): number {
  if (!sub?.trialEndsAt) return 0;
  const end = Date.parse(sub.trialEndsAt);
  const start = sub.trialStartedAt ? Date.parse(sub.trialStartedAt) : end - TRIAL_DAYS * DAY;
  const total = Math.max(DAY, end - (Number.isFinite(start) ? start : end - TRIAL_DAYS * DAY));
  return Math.min(1, Math.max(0, (now - (end - total)) / total));
}

export type BannerState =
  | { kind: "trial"; daysLeft: number; hasMandate: boolean }
  | { kind: "past_due"; graceDaysLeft: number }
  | { kind: "expired" }
  | null;

/**
 * What the shell banner should say. Hidden (null) for a healthy active subscription, a free plan, a trial that already
 * has an authorised mandate more than 3 days out, and a cancelled one (the plan page explains it).
 */
export function bannerState(cur: SubscriptionCurrent | null | undefined, now: number = Date.now()): BannerState {
  const sub = cur?.subscription;
  if (!sub) return null;
  if (sub.status === "past_due") return { kind: "past_due", graceDaysLeft: cur?.graceDaysLeft ?? daysUntil(sub.graceEndsAt, now) };
  if (sub.status === "expired") return { kind: "expired" };
  if (sub.status === "trialing") {
    const daysLeft = cur?.trialDaysLeft ?? daysUntil(sub.trialEndsAt, now);
    // Paid already set up (a mandate waits for the trial end): only nag in the last days.
    const hasMandate = !!sub.providerSubscriptionId && !sub.authUrl;
    if (hasMandate && daysLeft > 3) return null;
    return { kind: "trial", daysLeft, hasMandate };
  }
  return null;
}

export const isPaidPlan = (p: Pick<PlanInfo, "priceMonthlyPaise" | "priceYearlyPaise"> | null | undefined) =>
  !!p && (p.priceMonthlyPaise > 0 || p.priceYearlyPaise > 0);

export const isUnlimited = (limit: number | null | undefined) => limit === undefined || limit === null || limit < 0;

export const planPrice = (p: Pick<PlanInfo, "priceMonthlyPaise" | "priceYearlyPaise">, interval: BillingInterval) =>
  interval === "yearly" ? p.priceYearlyPaise : p.priceMonthlyPaise;

/** Yearly saving vs twelve monthly payments, as a whole percent (0 when none). */
export function yearlySavingPercent(p: Pick<PlanInfo, "priceMonthlyPaise" | "priceYearlyPaise">): number {
  const twelve = p.priceMonthlyPaise * 12;
  if (twelve <= 0 || p.priceYearlyPaise <= 0 || p.priceYearlyPaise >= twelve) return 0;
  return Math.round((1 - p.priceYearlyPaise / twelve) * 100);
}

/** Order plans by `sort`, then monthly price. */
export const sortPlans = <T extends Pick<PlanInfo, "priceMonthlyPaise"> & { sort?: number }>(plans: readonly T[]): T[] =>
  [...plans].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.priceMonthlyPaise - b.priceMonthlyPaise);

type PriceLike = Pick<PlanInfo, "priceMonthlyPaise" | "priceYearlyPaise"> & { id?: string; sort?: number };

/**
 * Upgrade (applies now) or downgrade (at period end), mirroring packages/subscriptions `changeKind`: compares yearly
 * spend (monthly × 12 vs yearly); equal spend → higher `sort` wins. The same plan: → yearly is an upgrade, → monthly a
 * downgrade, same interval "same".
 */
export function changeKind(from: PriceLike, fromInterval: BillingInterval, to: PriceLike, toInterval: BillingInterval): "upgrade" | "downgrade" | "same" {
  if (from.id !== undefined && from.id === to.id) return fromInterval === toInterval ? "same" : toInterval === "yearly" ? "upgrade" : "downgrade";
  const yearly = (p: PriceLike, i: BillingInterval) => (i === "yearly" ? p.priceYearlyPaise : p.priceMonthlyPaise * 12);
  const a = yearly(from, fromInterval);
  const b = yearly(to, toInterval);
  if (a !== b) return b > a ? "upgrade" : "downgrade";
  if ((to.sort ?? 0) !== (from.sort ?? 0)) return (to.sort ?? 0) > (from.sort ?? 0) ? "upgrade" : "downgrade";
  return fromInterval === toInterval ? "same" : "upgrade";
}

// ---------------------------------------------------------------- plan limit errors

/** What a 402 `plan_limit` (or `feature_disabled` with reason plan) is about. */
export type PlanBlock =
  | { kind: "limit"; key: string; used: number | null; limit: number | null }
  | { kind: "feature"; feature: string }
  | { kind: "module"; module: string }
  | { kind: "plan" };

/** Reads the error details the API sends (`{ key, limit, used }`, `{ feature, reason: "plan" }`, `{ module }`). */
export function planBlockFrom(details: unknown): PlanBlock {
  const d = (details ?? {}) as { key?: unknown; limit?: unknown; used?: unknown; feature?: unknown; module?: unknown };
  if (typeof d.key === "string") return { kind: "limit", key: d.key, used: typeof d.used === "number" ? d.used : null, limit: typeof d.limit === "number" ? d.limit : null };
  if (typeof d.feature === "string") return { kind: "feature", feature: d.feature };
  if (typeof d.module === "string") return { kind: "module", module: d.module };
  return { kind: "plan" };
}

/** True when a plan's `modules` list grants `key` (exact, `module.*`, or the bare module for a module id). */
export function planGrants(modules: readonly string[], key: string): boolean {
  const mod = key.split(".")[0]!;
  return modules.some((m) => m === key || m === "*" || m === `${mod}.*`);
}

/** Whether `plan` lifts `block`. */
export function planLifts(plan: PlanInfo, block: PlanBlock): boolean {
  switch (block.kind) {
    case "limit": {
      const l = plan.limits?.[block.key];
      if (l === undefined) return false;
      if (isUnlimited(l)) return true;
      return l > (block.used ?? block.limit ?? 0);
    }
    case "feature":
      return planGrants(plan.modules ?? [], block.feature) || plan.features?.[block.feature] === true;
    case "module":
      return planGrants(plan.modules ?? [], block.module);
    default:
      return false;
  }
}

/** The cheapest public plan above the current one that lifts `block` (null when none does). */
export function planThatUnlocks(plans: readonly PlanInfo[], block: PlanBlock, currentPlanId?: string | null): PlanInfo | null {
  const sorted = sortPlans(plans.filter((p) => p.isPublic !== false));
  const current = sorted.find((p) => p.id === currentPlanId);
  const above = sorted.filter((p) => p.id !== currentPlanId && (!current || changeKind(current, "monthly", p, "monthly") === "upgrade"));
  return above.find((p) => planLifts(p, block)) ?? null;
}

/**
 * True for errors the upgrade dialog handles: a 402 `plan_limit` (a usage limit, a module or a feature not in the
 * plan) or a `feature_disabled` whose reason is the plan. Only for writes: a GET that fails this way is a page or widget
 * loading, and the feature gate page already explains it.
 */
export function isUpgradeError(e: { error: { status: number; code: string; details?: unknown }; method: string }): boolean {
  if (e.method === "GET" || e.method === "HEAD") return false;
  const { status, code, details } = e.error;
  if (status === 402 || code === "plan_limit") return true;
  return code === "feature_disabled" && (details as { reason?: string } | undefined)?.reason === "plan";
}
