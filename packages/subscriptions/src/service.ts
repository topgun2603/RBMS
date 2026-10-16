import { AppError, badRequest, conflict, notFound, sha256 } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import {
  addDays,
  addInterval,
  changeKind,
  chargeAmount,
  daysLeft,
  financialYearLong,
  GRACE_DAYS,
  gstSplit,
  invoiceAmounts,
  isAwaitingPayment,
  isPaid,
  istDate,
  lifecycleAction,
  monthlyValue,
  pendingExpiresAt,
  platformInvoiceLines,
  prorationCredit,
  upgradeQuote,
  PLATFORM_GST_RATE,
  PLATFORM_SAC,
  planPrice,
  platformInvoiceNumber,
  TRIAL_DAYS,
  type GstSplit,
  type InvoiceLine,
  type LifecycleAction,
} from "./logic";
import {
  noopLogger,
  type AuditPort,
  type DocumentsPort,
  type LoggerPort,
  type NotifyPort,
  type PlanInfo,
  type PlansPort,
  type ShopDetailsPort,
  type SubscriptionsConfig,
  type TenancyPort,
  type TenantInfo,
} from "./ports";
import type { SubscriptionProvider } from "./provider";
import {
  platformInvoices,
  platformInvoiceSeries,
  providerPlans,
  subscriptionEvents,
  subscriptions,
  type BillingInterval,
  type PlatformInvoiceRow,
  type SubscriptionRow,
  type SubscriptionStatus,
} from "./schema";

export interface SubscriptionsDeps {
  db: Db;
  config: SubscriptionsConfig;
  /** Razorpay (platform account) or the mock. */
  provider: SubscriptionProvider;
  plans: PlansPort;
  tenancy: TenancyPort;
  shop: ShopDetailsPort;
  notify?: NotifyPort;
  documents?: DocumentsPort;
  audit?: AuditPort;
  log?: LoggerPort;
  /** Injectable clock (tests). */
  clock?: () => Date;
}

/** The subscription as the API returns it (internal bookkeeping left out). */
export interface SubscriptionView {
  id: string;
  tenantId: string;
  planId: string;
  interval: BillingInterval;
  status: SubscriptionStatus;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  graceEndsAt: Date | null;
  provider: SubscriptionRow["provider"];
  providerSubscriptionId: string | null;
  authUrl: string | null;
  checkoutPlanId: string | null;
  checkoutInterval: BillingInterval | null;
  pendingPlanId: string | null;
  pendingInterval: BillingInterval | null;
  /** `downgrade` (at the period end) or `awaiting_payment` (an upgrade applied once paid); null without a pending plan. */
  pendingReason: "downgrade" | "awaiting_payment" | null;
  pendingSince: Date | null;
  /** An unpaid upgrade lapses at this time (48 h after it was asked for). */
  pendingExpiresAt: Date | null;
  /** The upgrade's mandate: authorise at `pendingAuthUrl` (the current plan's mandate keeps running meanwhile). */
  pendingProviderSubscriptionId: string | null;
  pendingAuthUrl: string | null;
  /** End of the upgrade's first period once it applies. */
  pendingPeriodEnd: Date | null;
  /** Proration credit (taxable paise) taken off the upgrade's first charge. */
  pendingCreditPaise: number;
  /** What the upgrade charges now, GST included. */
  pendingChargePaise: number;
  /** Credit (taxable paise) owed to the shop: a discount line on the next platform invoice. */
  creditBalancePaise: number;
  createdAt: Date;
  updatedAt: Date;
}

/** `POST /change/preview` answer: what choosing a plan does, before confirming. Money in paise. */
export interface ChangePreview {
  planId: string;
  interval: BillingInterval;
  /** upgrade / downgrade / same, or `trial` (a trial switch or a new trial), `start` (pay from free), `free`. */
  kind: "upgrade" | "downgrade" | "same" | "trial" | "start" | "free";
  /** `now` (no payment), `period_end` (a downgrade), `after_payment` (applies once the mandate/charge succeeds), `none`. */
  applies: "now" | "period_end" | "after_payment" | "none";
  /** True when `/change` won't do it and `/checkout` is needed (free plan, no trial left). */
  requiresCheckout: boolean;
  /** New plan price for one period (taxable). */
  planPricePaise: number;
  /** Proration credit (taxable) for the unused days of the current paid period, plus any credit balance. */
  creditPaise: number;
  unusedDays: number;
  periodDays: number;
  /** Credit the first charge can't absorb (kept for the next invoice). */
  carryoverPaise: number;
  /** Taxable value charged now (after the credit). */
  taxablePaise: number;
  /** Amount due now, GST included. */
  chargeTodayPaise: number;
  gst: GstSplit & { ratePercent: number };
  /** When the new plan starts (now, the period end, or once paid). */
  startsAt: Date | null;
  /** The next recurring charge after today's. */
  nextChargeAt: Date | null;
}

export const toView = (s: SubscriptionRow): SubscriptionView => ({
  id: s.id,
  tenantId: s.tenantId,
  planId: s.planId,
  interval: s.interval,
  status: s.status,
  trialStartedAt: s.trialStartedAt,
  trialEndsAt: s.trialEndsAt,
  currentPeriodStart: s.currentPeriodStart,
  currentPeriodEnd: s.currentPeriodEnd,
  cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  graceEndsAt: s.graceEndsAt,
  provider: s.provider,
  providerSubscriptionId: s.providerSubscriptionId,
  authUrl: s.authUrl,
  checkoutPlanId: s.checkoutPlanId,
  checkoutInterval: s.checkoutInterval,
  pendingPlanId: s.pendingPlanId,
  pendingInterval: s.pendingInterval,
  pendingReason: s.pendingPlanId ? (s.pendingReason ?? "downgrade") : null,
  pendingSince: s.pendingSince,
  pendingExpiresAt: pendingExpiresAt(s),
  pendingProviderSubscriptionId: s.pendingProviderSubscriptionId,
  pendingAuthUrl: s.pendingAuthUrl,
  pendingPeriodEnd: s.pendingPeriodEnd,
  pendingCreditPaise: s.pendingCreditPaise,
  pendingChargePaise: s.pendingChargePaise,
  creditBalancePaise: s.creditBalancePaise,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/** A platform invoice as the API returns it: the row plus its plan and credit lines. */
export type PlatformInvoiceView = PlatformInvoiceRow & { lines: InvoiceLine[] };

/** Clears any pending plan change (a downgrade or an upgrade waiting for payment). */
const NO_PENDING = {
  pendingPlanId: null,
  pendingInterval: null,
  pendingReason: null,
  pendingSince: null,
  pendingProviderSubscriptionId: null,
  pendingProviderPlanId: null,
  pendingAuthUrl: null,
  pendingPeriodEnd: null,
  pendingCreditPaise: 0,
  pendingCarryoverPaise: 0,
  pendingChargePaise: 0,
  pendingCreditLabel: null,
} satisfies Partial<typeof subscriptions.$inferInsert>;

/** A Razorpay-shaped webhook event (the mock builds the same shape). */
export interface ProviderEvent {
  event: string;
  payload?: {
    subscription?: { entity?: Record<string, unknown> };
    payment?: { entity?: Record<string, unknown> };
  };
  created_at?: number;
}

export interface Actor {
  userId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

const SYSTEM: Actor = { userId: null };
const LIVE: SubscriptionStatus[] = ["trialing", "active", "past_due"];
const CHARGING = (p: SubscriptionRow["provider"]) => p === "razorpay" || p === "mock";
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const fromUnix = (v: unknown) => (typeof v === "number" && v > 0 ? new Date(v * 1000) : null);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const rupees = (paise: number) => `Rs.${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (d: Date | null | undefined) => (d ? istDate(d) : "");

export class SubscriptionsService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  readonly freePlanId: string;
  private readonly trialDays: number;
  private readonly graceDays: number;
  private readonly prefix: string;

  constructor(private readonly deps: SubscriptionsDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.clock ?? (() => new Date());
    this.freePlanId = deps.config.freePlanId ?? "free";
    this.trialDays = deps.config.trialDays ?? TRIAL_DAYS;
    this.graceDays = deps.config.graceDays ?? GRACE_DAYS;
    this.prefix = deps.config.invoicePrefix ?? "SR";
  }

  get allowMock() {
    return this.deps.config.allowMock;
  }
  get providerName() {
    return this.deps.provider.name;
  }

  // ================================================================ reads

  async get(tenantId: string): Promise<SubscriptionRow | null> {
    const [row] = await this.db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).limit(1);
    return row ?? null;
  }

  /** The subscription a provider subscription id belongs to: its current mandate, or a pending upgrade's. */
  private async getByProviderId(providerSubscriptionId: string): Promise<SubscriptionRow | null> {
    const [row] = await this.db
      .select()
      .from(subscriptions)
      .where(or(eq(subscriptions.providerSubscriptionId, providerSubscriptionId), eq(subscriptions.pendingProviderSubscriptionId, providerSubscriptionId)))
      .limit(1);
    return row ?? null;
  }

  /** True when `providerSubscriptionId` is the mandate of `sub`'s pending upgrade (not its current one). */
  private isPendingMandate(sub: SubscriptionRow, providerSubscriptionId: string | null) {
    return !!providerSubscriptionId && sub.pendingProviderSubscriptionId === providerSubscriptionId && sub.providerSubscriptionId !== providerSubscriptionId;
  }

  private async plan(id: string): Promise<PlanInfo> {
    const p = await this.deps.plans.getPlan(id);
    if (!p) throw badRequest(`Unknown plan "${id}"`);
    return p;
  }

  /**
   * The tenant's subscription, created on first use for shops that predate subscriptions (their current plan, as a
   * `manual` open-ended subscription, or the free plan). A free/manual subscription follows the tenant's plan when a
   * super-admin or a seed changed the plan directly.
   */
  async ensure(tenantId: string): Promise<SubscriptionRow> {
    const tenant = await this.deps.tenancy.getTenant(tenantId);
    if (!tenant) throw notFound("Shop");
    let sub = await this.get(tenantId);
    if (!sub) {
      const planId = tenant.planId ?? this.freePlanId;
      const paid = isPaid(await this.deps.plans.getPlan(planId));
      await this.db
        .insert(subscriptions)
        .values({ tenantId, planId, status: "active", provider: paid ? "manual" : null, currentPeriodStart: this.now() })
        .onConflictDoNothing();
      sub = (await this.get(tenantId))!;
      return sub;
    }
    const tenantPlan = tenant.planId ?? this.freePlanId;
    if (sub.status === "active" && (sub.provider === null || sub.provider === "manual") && sub.planId !== tenantPlan && !sub.cancelAtPeriodEnd) {
      const paid = isPaid(await this.deps.plans.getPlan(tenantPlan));
      const [row] = await this.db
        .update(subscriptions)
        .set({ planId: tenantPlan, provider: paid ? "manual" : null, ...NO_PENDING })
        .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.planId, sub.planId)))
        .returning();
      if (row) sub = row;
    }
    return sub;
  }

  /** One trial per owner: false once any shop of this user started a trial. */
  async canTrial(userId: string | null | undefined, exceptTenantId?: string): Promise<boolean> {
    if (!userId) return false;
    const conds: SQL[] = [eq(subscriptions.ownerUserId, userId), isNotNull(subscriptions.trialStartedAt)];
    if (exceptTenantId) conds.push(ne(subscriptions.tenantId, exceptTenantId));
    const [row] = await this.db.select({ n: count() }).from(subscriptions).where(and(...conds));
    return (row?.n ?? 0) === 0;
  }

  /** `GET /current`. */
  async current(tenantId: string, userId?: string | null) {
    const sub = await this.ensure(tenantId);
    const now = this.now();
    const [plan, usage] = await Promise.all([this.deps.plans.getPlan(sub.planId), this.deps.plans.usage(tenantId)]);
    const pendingPlan = sub.pendingPlanId ? await this.deps.plans.getPlan(sub.pendingPlanId) : null;
    const canTrial = !sub.trialStartedAt && (await this.canTrial(sub.ownerUserId ?? userId, tenantId));
    return {
      subscription: toView(sub),
      plan,
      pendingPlan,
      trialDaysLeft: sub.status === "trialing" ? daysLeft(sub.trialEndsAt, now) : null,
      graceDaysLeft: sub.status === "past_due" ? daysLeft(sub.graceEndsAt, now) : null,
      usage,
      canTrial,
    };
  }

  // ================================================================ sign-up

  /**
   * The subscription of a shop that was just created (sign-up's on-tenant-created hook): a paid plan starts a 14-day
   * trial when the owner has not had one, otherwise the shop starts on the free plan; the free plan is active free.
   */
  async startForNewTenant(input: { tenantId: string; ownerUserId: string; planId: string; interval: BillingInterval }) {
    const existing = await this.get(input.tenantId);
    if (existing) return { subscription: existing, trial: existing.status === "trialing" };
    const plan = await this.plan(input.planId);
    const now = this.now();
    const trial = isPaid(plan) && (await this.canTrial(input.ownerUserId));
    const values: typeof subscriptions.$inferInsert = trial
      ? {
          tenantId: input.tenantId,
          ownerUserId: input.ownerUserId,
          planId: plan.id,
          interval: input.interval,
          status: "trialing",
          trialStartedAt: now,
          trialEndsAt: addDays(now, this.trialDays),
          currentPeriodStart: now,
        }
      : { tenantId: input.tenantId, ownerUserId: input.ownerUserId, planId: this.freePlanId, interval: input.interval, status: "active", currentPeriodStart: now };
    await this.db.insert(subscriptions).values(values).onConflictDoNothing();
    const sub = (await this.get(input.tenantId))!;
    await this.syncTenantPlan(sub);
    await this.audit(sub, SYSTEM, "subscription.start", trial ? `Trial of ${plan.id} started` : `Started on ${sub.planId}`);
    return { subscription: sub, trial };
  }

  // ================================================================ shop actions

  /** `POST /change`: in a trial, switches the trial plan; on a paid plan, upgrades now or downgrades at period end. */
  async change(tenantId: string, input: { planId: string; interval: BillingInterval }, actor: Actor = SYSTEM) {
    let sub = await this.ensure(tenantId);
    const target = await this.plan(input.planId);
    if (!target.isPublic && target.id !== sub.planId) throw badRequest("That plan isn't available");
    const now = this.now();
    const current = await this.deps.plans.getPlan(sub.planId);
    const result = (applied: "now" | "period_end" | "after_payment" | "none", s: SubscriptionRow, extra: { authUrl?: string | null; requiresCheckout?: boolean } = {}) => ({
      subscription: toView(s),
      applied,
      authUrl: extra.authUrl ?? null,
      requiresCheckout: extra.requiresCheckout ?? false,
    });

    // ---- to the free plan
    if (!isPaid(target)) {
      if (sub.planId === target.id && sub.status === "active" && !sub.pendingPlanId) return result("none", sub);
      if (isAwaitingPayment(sub)) sub = await this.dropPendingUpgrade(sub, actor, "Upgrade replaced by a move to the free plan");
      if (sub.status === "active" && CHARGING(sub.provider) && !sub.authUrl && sub.currentPeriodEnd && sub.currentPeriodEnd > now) {
        // Paid until the period end: the free plan starts then.
        await this.providerCall(() => this.deps.provider.cancel(sub.providerSubscriptionId!, true));
        sub = await this.update(sub, { pendingPlanId: target.id, pendingInterval: input.interval, pendingReason: "downgrade" }, actor, "subscription.downgrade", `Moves to ${target.id} at the period end`);
        return result("period_end", sub);
      }
      await this.cancelProviderNow(sub);
      sub = await this.update(
        sub,
        {
          planId: target.id,
          interval: input.interval,
          status: "active",
          provider: null,
          providerSubscriptionId: null,
          providerPlanId: null,
          authUrl: null,
          checkoutPlanId: null,
          checkoutInterval: null,
          ...NO_PENDING,
          cancelAtPeriodEnd: false,
          graceEndsAt: null,
          trialEndsAt: sub.status === "trialing" ? now : sub.trialEndsAt,
          currentPeriodStart: now,
          currentPeriodEnd: null,
        },
        actor,
        "subscription.change",
        `Moved to ${target.id}`,
      );
      return result("now", sub);
    }

    // ---- to a paid plan
    if (sub.status === "trialing") {
      if (sub.providerSubscriptionId) await this.cancelProviderNow(sub);
      sub = await this.update(
        sub,
        { planId: target.id, interval: input.interval, providerSubscriptionId: null, providerPlanId: null, authUrl: null, checkoutPlanId: null, checkoutInterval: null, cancelAtPeriodEnd: false },
        actor,
        "subscription.change",
        `Trial plan changed to ${target.id}`,
      );
      return result("now", sub);
    }

    if ((sub.status === "active" || sub.status === "past_due") && CHARGING(sub.provider) && current && isPaid(current)) {
      const kind = changeKind(current, sub.interval, target, input.interval);
      if (kind === "same") {
        // Back to the current plan: drops an upgrade waiting for payment, or undoes a scheduled downgrade/cancel.
        if (isAwaitingPayment(sub)) {
          sub = await this.dropPendingUpgrade(sub, actor, "Upgrade cancelled; staying on the current plan");
          return result("none", sub);
        }
        if (!sub.pendingPlanId && !sub.cancelAtPeriodEnd) return result("none", sub);
        const r = await this.resume(tenantId, actor);
        return result("now", (await this.get(tenantId))!, { authUrl: r.authUrl });
      }
      if (kind === "downgrade" && sub.status === "active") {
        if (isAwaitingPayment(sub)) sub = await this.dropPendingUpgrade(sub, actor, "Upgrade replaced by a downgrade");
        const providerPlanId = await this.ensureProviderPlan(target, input.interval);
        const id = sub.providerSubscriptionId;
        const change = this.deps.provider.changePlan;
        if (id && change) await this.providerCall(() => change.call(this.deps.provider, id, providerPlanId));
        sub = await this.update(sub, { pendingPlanId: target.id, pendingInterval: input.interval, pendingReason: "downgrade" }, actor, "subscription.downgrade", `Moves to ${target.id} at the period end`);
        return result("period_end", sub);
      }
      // Upgrade (or any change while past due): pending until the new mandate is authorised / its first charge
      // succeeds. The current plan and its mandate carry on meanwhile; the unused part of the paid period is credited
      // against the first charge.
      const { authUrl } = await this.startUpgrade(sub, target, input.interval, actor);
      return result("after_payment", (await this.get(tenantId))!, { authUrl });
    }

    // Free, manual, cancelled or expired: a trial if this owner never had one, otherwise payment first.
    if (sub.status === "active" && !CHARGING(sub.provider) && !sub.trialStartedAt && (await this.canTrial(sub.ownerUserId ?? actor.userId, tenantId))) {
      sub = await this.update(
        sub,
        {
          planId: target.id,
          interval: input.interval,
          status: "trialing",
          provider: null,
          ownerUserId: sub.ownerUserId ?? actor.userId,
          trialStartedAt: now,
          trialEndsAt: addDays(now, this.trialDays),
          currentPeriodStart: now,
          currentPeriodEnd: null,
        },
        actor,
        "subscription.trial",
        `Trial of ${target.id} started`,
      );
      return result("now", sub);
    }
    return result("none", sub, { requiresCheckout: true });
  }

  /** `POST /change/preview`: what `/change` (or the checkout it leads to) would do and charge, without changing anything. */
  async preview(tenantId: string, input: { planId: string; interval: BillingInterval }, actor: Actor = SYSTEM): Promise<ChangePreview> {
    const sub = await this.ensure(tenantId);
    const target = await this.plan(input.planId);
    if (!target.isPublic && target.id !== sub.planId) throw badRequest("That plan isn't available");
    const now = this.now();
    const current = await this.deps.plans.getPlan(sub.planId);
    const price = planPrice(target, input.interval);
    const buyerState = (await this.deps.shop.buyer(tenantId)).stateCode;
    const sellerState = this.deps.config.seller.stateCode;
    const gstOf = (chargePaise: number) => ({ ...gstSplit(chargePaise, sellerState, buyerState), ratePercent: PLATFORM_GST_RATE });
    const out = (p: Partial<ChangePreview> & Pick<ChangePreview, "kind" | "applies">): ChangePreview => ({
      planId: target.id,
      interval: input.interval,
      requiresCheckout: false,
      planPricePaise: price,
      creditPaise: 0,
      unusedDays: 0,
      periodDays: 0,
      carryoverPaise: 0,
      taxablePaise: 0,
      chargeTodayPaise: 0,
      gst: gstOf(0),
      startsAt: null,
      nextChargeAt: null,
      ...p,
    });
    const paidNow = (start: Date | null): Partial<ChangePreview> => ({
      taxablePaise: price,
      chargeTodayPaise: chargeAmount(price),
      gst: gstOf(chargeAmount(price)),
      startsAt: start,
      nextChargeAt: addInterval(now, input.interval),
    });

    if (!isPaid(target)) {
      if (sub.planId === target.id && sub.status === "active" && !sub.pendingPlanId) return out({ kind: "same", applies: "none" });
      if (sub.status === "active" && CHARGING(sub.provider) && !sub.authUrl && sub.currentPeriodEnd && sub.currentPeriodEnd > now) {
        return out({ kind: "free", applies: "period_end", startsAt: sub.currentPeriodEnd });
      }
      return out({ kind: "free", applies: "now", startsAt: now });
    }
    if (sub.status === "trialing") {
      return out({ kind: "trial", applies: "now", startsAt: now, nextChargeAt: hasMandateRow(sub) ? sub.trialEndsAt : null });
    }
    if ((sub.status === "active" || sub.status === "past_due") && CHARGING(sub.provider) && current && isPaid(current)) {
      const kind = changeKind(current, sub.interval, target, input.interval);
      if (kind === "same") return out({ kind, applies: "none", nextChargeAt: sub.currentPeriodEnd });
      if (kind === "downgrade" && sub.status === "active") return out({ kind, applies: "period_end", startsAt: sub.currentPeriodEnd, nextChargeAt: sub.currentPeriodEnd });
      const q = await this.quoteUpgrade(sub, target, input.interval, now);
      return out({
        kind,
        applies: "after_payment",
        creditPaise: q.quote.creditPaise,
        unusedDays: q.unusedDays,
        periodDays: q.periodDays,
        carryoverPaise: q.quote.carryoverPaise,
        taxablePaise: q.quote.taxablePaise,
        chargeTodayPaise: q.quote.chargeTodayPaise,
        gst: { ...q.quote.gst, ratePercent: PLATFORM_GST_RATE },
        startsAt: null,
        nextChargeAt: addInterval(now, input.interval),
      });
    }
    if (sub.status === "active" && !CHARGING(sub.provider) && !sub.trialStartedAt && (await this.canTrial(sub.ownerUserId ?? actor.userId, tenantId))) {
      return out({ kind: "trial", applies: "now", startsAt: now, nextChargeAt: addDays(now, this.trialDays) });
    }
    return out({ kind: "start", applies: "after_payment", requiresCheckout: true, ...paidNow(null) });
  }

  /** The paid invoice covering `now` in the current period (what a proration credit is based on). */
  private async paidInvoiceNow(sub: SubscriptionRow, now: Date): Promise<PlatformInvoiceRow | null> {
    const rows = await this.db
      .select()
      .from(platformInvoices)
      .where(and(eq(platformInvoices.subscriptionId, sub.id), eq(platformInvoices.status, "paid")))
      .orderBy(desc(platformInvoices.createdAt))
      .limit(5);
    return rows.find((r) => r.periodStart && r.periodEnd && r.periodStart <= now && r.periodEnd > now) ?? null;
  }

  /**
   * The upgrade's money: credit for the unused IST days of the paid period (from the invoice that paid it, taxable
   * value) plus any credit balance, taken off the new plan's first period.
   */
  private async quoteUpgrade(sub: SubscriptionRow, target: PlanInfo, interval: BillingInterval, now: Date) {
    const paid = sub.status === "active" ? await this.paidInvoiceNow(sub, now) : null;
    const pro = paid ? prorationCredit({ periodStart: paid.periodStart!, periodEnd: paid.periodEnd!, now, paidTaxablePaise: paid.subtotalPaise }) : { creditPaise: 0, unusedDays: 0, periodDays: 0 };
    const buyerState = (await this.deps.shop.buyer(sub.tenantId)).stateCode;
    const quote = upgradeQuote({
      planPricePaise: planPrice(target, interval),
      creditPaise: pro.creditPaise + Math.max(0, sub.creditBalancePaise),
      sellerState: this.deps.config.seller.stateCode,
      buyerState,
      upfront: !!this.deps.provider.supportsUpfront,
    });
    const from = paid ? ((await this.deps.plans.getPlan(paid.planId))?.name ?? paid.planId) : null;
    const parts: string[] = [];
    if (pro.creditPaise > 0 && from) parts.push(`${pro.unusedDays} unused of ${pro.periodDays} days of ${from} (${paid!.interval})`);
    if (sub.creditBalancePaise > 0) parts.push("earlier credit");
    const label = parts.length ? `Credit: ${parts.join(" and ")}` : null;
    return { quote, label, unusedDays: pro.unusedDays, periodDays: pro.periodDays };
  }

  /**
   * An upgrade of a running paid plan: a new mandate whose authorisation collects the first period minus the credit
   * (Razorpay `addons`; its own charges start one period later). Stored as pending `awaiting_payment`; the current
   * plan stays until the mandate is authorised or charged, and the upgrade lapses after 48 h.
   */
  private async startUpgrade(sub: SubscriptionRow, target: PlanInfo, interval: BillingInterval, actor: Actor) {
    if (planPrice(target, interval) <= 0) throw badRequest(`${target.name} has no ${interval} price`);
    const now = this.now();
    const { quote, label } = await this.quoteUpgrade(sub, target, interval, now);
    const providerPlanId = await this.ensureProviderPlan(target, interval);
    const upfront = !!this.deps.provider.supportsUpfront;
    const periodEnd = addInterval(now, interval);
    const created = await this.providerCall(() =>
      this.deps.provider.createSubscription({
        providerPlanId,
        interval,
        startAt: upfront ? periodEnd : now,
        notes: { tenantId: sub.tenantId, planId: target.id, interval, kind: "upgrade" },
        upfront: upfront && quote.chargeTodayPaise > 0 ? { amountPaise: quote.chargeTodayPaise, name: `${target.name} (${interval}), first period${quote.appliedCreditPaise ? " less credit" : ""}` } : null,
      }),
    );
    // A previous unpaid upgrade is replaced; a scheduled downgrade of the current mandate is undone.
    if (sub.pendingProviderSubscriptionId && sub.pendingProviderSubscriptionId !== created.id) await this.cancelProviderId(sub, sub.pendingProviderSubscriptionId);
    if (sub.pendingPlanId && !isAwaitingPayment(sub)) await this.revertScheduledChange(sub);
    const row = await this.update(
      sub,
      {
        pendingPlanId: target.id,
        pendingInterval: interval,
        pendingReason: "awaiting_payment",
        pendingSince: now,
        pendingProviderSubscriptionId: created.id,
        pendingProviderPlanId: providerPlanId,
        pendingAuthUrl: created.shortUrl,
        pendingPeriodEnd: upfront ? periodEnd : null,
        pendingCreditPaise: quote.appliedCreditPaise,
        pendingCarryoverPaise: quote.carryoverPaise,
        pendingChargePaise: quote.chargeTodayPaise,
        pendingCreditLabel: label,
      },
      actor,
      "subscription.upgrade_pending",
      `Upgrade to ${target.id} (${interval}) waits for payment of ${rupees(quote.chargeTodayPaise)}${quote.creditPaise ? ` (credit ${rupees(quote.creditPaise)})` : ""}`,
    );
    return { authUrl: created.shortUrl, providerSubscriptionId: created.id, subscription: row };
  }

  /** `POST /change/cancel`: drops an upgrade that is waiting for payment (the current plan carries on). */
  async cancelUpgrade(tenantId: string, actor: Actor = SYSTEM) {
    const sub = await this.ensure(tenantId);
    if (!isAwaitingPayment(sub)) throw badRequest("No upgrade is waiting for payment");
    const row = await this.dropPendingUpgrade(sub, actor, "Upgrade cancelled");
    return { subscription: toView(row) };
  }

  /** Cancels the pending upgrade's mandate and clears it (no-op without one). */
  private async dropPendingUpgrade(sub: SubscriptionRow, actor: Actor, summary: string): Promise<SubscriptionRow> {
    if (!isAwaitingPayment(sub)) return sub;
    if (sub.pendingProviderSubscriptionId) await this.cancelProviderId(sub, sub.pendingProviderSubscriptionId);
    return this.update(sub, { ...NO_PENDING }, actor, "subscription.upgrade_cancelled", summary);
  }

  /** Undoes a downgrade scheduled on the provider (back to the current plan at the next cycle). */
  private async revertScheduledChange(sub: SubscriptionRow) {
    const change = this.deps.provider.changePlan;
    if (!change || !sub.providerSubscriptionId || !CHARGING(sub.provider)) return;
    const plan = await this.deps.plans.getPlan(sub.planId);
    if (!plan || !isPaid(plan)) return;
    const providerPlanId = await this.ensureProviderPlan(plan, sub.interval);
    await this.providerCall(() => change.call(this.deps.provider, sub.providerSubscriptionId!, providerPlanId));
  }

  /** `POST /checkout`: creates the provider subscription (from the trial end while trialing) and returns its mandate URL. */
  async checkout(tenantId: string, input: { planId: string; interval: BillingInterval }, actor: Actor = SYSTEM) {
    const sub = await this.ensure(tenantId);
    const target = await this.plan(input.planId);
    if (!isPaid(target)) throw badRequest("The free plan needs no payment");
    if (!target.isPublic && target.id !== sub.planId) throw badRequest("That plan isn't available");
    if (planPrice(target, input.interval) <= 0) throw badRequest(`${target.name} has no ${input.interval} price`);
    if (sub.status === "active" && CHARGING(sub.provider) && !sub.authUrl && sub.planId === target.id && sub.interval === input.interval && !sub.cancelAtPeriodEnd) {
      throw conflict("This plan is already paid for");
    }
    const now = this.now();
    const startAt = sub.status === "trialing" && sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
    const r = await this.startCheckout(sub, target, input.interval, startAt, actor, { applyNow: sub.status === "trialing" });
    return { authUrl: r.authUrl, providerSubscriptionId: r.providerSubscriptionId, provider: this.deps.provider.name, subscription: toView((await this.get(tenantId))!) };
  }

  private async startCheckout(
    sub: SubscriptionRow,
    target: PlanInfo,
    interval: BillingInterval,
    startAt: Date,
    actor: Actor,
    opts: { applyNow: boolean },
  ) {
    if (planPrice(target, interval) <= 0) throw badRequest(`${target.name} has no ${interval} price`);
    const providerPlanId = await this.ensureProviderPlan(target, interval);
    const created = await this.providerCall(() =>
      this.deps.provider.createSubscription({
        providerPlanId,
        interval,
        startAt,
        notes: { tenantId: sub.tenantId, planId: target.id, interval },
      }),
    );
    // The old mandate stops once the new one exists (a re-checkout, a past-due shop paying again), and so does an
    // unpaid upgrade's.
    if (sub.providerSubscriptionId && CHARGING(sub.provider)) await this.cancelProviderNow(sub);
    if (sub.pendingProviderSubscriptionId) await this.cancelProviderId(sub, sub.pendingProviderSubscriptionId);
    const patch: Partial<typeof subscriptions.$inferInsert> = {
      provider: this.deps.provider.name,
      providerSubscriptionId: created.id,
      providerPlanId,
      authUrl: created.shortUrl,
      checkoutPlanId: target.id,
      checkoutInterval: interval,
      ...NO_PENDING,
      cancelAtPeriodEnd: false,
    };
    if (opts.applyNow) Object.assign(patch, { planId: target.id, interval });
    await this.update(sub, patch, actor, "subscription.checkout", `Mandate for ${target.id} (${interval}) created`);
    return { authUrl: created.shortUrl, providerSubscriptionId: created.id };
  }

  /** `POST /cancel`: ends at the period (or trial) end; a past-due subscription ends now. */
  async cancel(tenantId: string, actor: Actor = SYSTEM) {
    let sub = await this.ensure(tenantId);
    const now = this.now();
    if (sub.status === "cancelled" || sub.status === "expired" || (sub.status === "active" && sub.planId === this.freePlanId)) {
      throw badRequest("There is no paid plan to cancel");
    }
    if (isAwaitingPayment(sub)) sub = await this.dropPendingUpgrade(sub, actor, "Upgrade dropped by a cancellation");
    if (sub.cancelAtPeriodEnd) return { subscription: toView(sub) };
    if (sub.status === "trialing") {
      if (sub.providerSubscriptionId) await this.cancelProviderNow(sub);
      sub = await this.update(sub, { cancelAtPeriodEnd: true, providerSubscriptionId: null, authUrl: null, checkoutPlanId: null, checkoutInterval: null }, actor, "subscription.cancel", "Cancels at the trial end");
      return { subscription: toView(sub) };
    }
    if (sub.status === "past_due" || (sub.status === "active" && !sub.currentPeriodEnd)) {
      await this.cancelProviderNow(sub);
      sub = (await this.transition(sub, ["past_due", "active"], { status: "cancelled", endedAt: now, graceEndsAt: null, authUrl: null }, actor, "subscription.cancelled", "Cancelled"))!;
      await this.notifyOwners(sub, "subscription.cancelled");
      return { subscription: toView(sub) };
    }
    if (sub.providerSubscriptionId && CHARGING(sub.provider)) {
      await this.providerCall(() => this.deps.provider.cancel(sub.providerSubscriptionId!, true));
    }
    sub = await this.update(sub, { cancelAtPeriodEnd: true }, actor, "subscription.cancel", "Cancels at the period end");
    return { subscription: toView(sub) };
  }

  /**
   * `POST /resume`: clears a scheduled cancel or downgrade. A provider subscription that was set to cancel at the
   * cycle end can't be revived (Razorpay), so a new mandate starting at the period end is created: `authUrl` is set.
   */
  async resume(tenantId: string, actor: Actor = SYSTEM) {
    let sub = await this.ensure(tenantId);
    const downgrade = !!sub.pendingPlanId && !isAwaitingPayment(sub);
    if (!sub.cancelAtPeriodEnd && !downgrade) throw badRequest("Nothing to resume");
    let authUrl: string | null = null;
    const wasCancelled = sub.cancelAtPeriodEnd;
    if (sub.status === "active" && CHARGING(sub.provider) && wasCancelled && sub.providerSubscriptionId) {
      const plan = await this.plan(sub.planId);
      const startAt = sub.currentPeriodEnd && sub.currentPeriodEnd > this.now() ? sub.currentPeriodEnd : this.now();
      const r = await this.startCheckout(sub, plan, sub.interval, startAt, actor, { applyNow: false });
      authUrl = r.authUrl;
      sub = (await this.get(tenantId))!;
    } else if (downgrade && sub.providerSubscriptionId && CHARGING(sub.provider)) {
      await this.revertScheduledChange(sub);
    }
    sub = await this.update(sub, downgrade ? { cancelAtPeriodEnd: false, ...NO_PENDING } : { cancelAtPeriodEnd: false }, actor, "subscription.resume", "Resumed");
    return { subscription: toView(sub), authUrl };
  }

  // ================================================================ invoices

  async listInvoices(tenantId: string) {
    const rows = await this.db
      .select()
      .from(platformInvoices)
      .where(eq(platformInvoices.tenantId, tenantId))
      .orderBy(desc(platformInvoices.createdAt))
      .limit(200);
    const names = new Map((await this.deps.plans.listPlans()).map((p) => [p.id, p.name]));
    return { items: rows.map((r) => this.invoiceView(r, names.get(r.planId))) };
  }

  /** The row with its lines (plan at full value, then the credit as a negative line). */
  invoiceView(row: PlatformInvoiceRow, planName?: string): PlatformInvoiceView {
    return {
      ...row,
      lines: platformInvoiceLines({
        ...row,
        description: `${planName ?? row.planId} plan (${row.interval})`,
        sellerState: row.seller?.stateCode ?? this.deps.config.seller.stateCode,
      }),
    };
  }

  async getInvoice(id: string, tenantId?: string): Promise<PlatformInvoiceRow> {
    const conds: SQL[] = [eq(platformInvoices.id, id)];
    if (tenantId) conds.push(eq(platformInvoices.tenantId, tenantId));
    const [row] = await this.db.select().from(platformInvoices).where(and(...conds)).limit(1);
    if (!row) throw notFound("Invoice");
    return row;
  }

  async invoicePdf(id: string, tenantId?: string) {
    const invoice = await this.getInvoice(id, tenantId);
    if (!this.deps.documents) throw new AppError(503, "not_configured", "PDFs are not available");
    const plan = await this.deps.plans.getPlan(invoice.planId);
    const planName = plan?.name ?? invoice.planId;
    return this.deps.documents.platformInvoicePdf({ invoice, planName, sac: PLATFORM_SAC, lines: this.invoiceView(invoice, planName).lines });
  }

  /** Next "SR/2026-27/00001" number (atomic per financial year). */
  private async nextNumber(tx: Pick<Db, "insert">, date: string) {
    const fy = financialYearLong(date);
    const [row] = await tx
      .insert(platformInvoiceSeries)
      .values({ fy, seq: 1 })
      .onConflictDoUpdate({ target: platformInvoiceSeries.fy, set: { seq: sql`${platformInvoiceSeries.seq} + 1`, updatedAt: new Date() } })
      .returning({ seq: platformInvoiceSeries.seq });
    const seq = row!.seq;
    return { fy, seq, number: platformInvoiceNumber(this.prefix, fy, seq) };
  }

  /** A paid platform invoice for a charge (idempotent per provider payment id). */
  private async createInvoice(
    sub: SubscriptionRow,
    input: {
      amountPaise: number;
      paymentId: string;
      periodStart: Date;
      periodEnd: Date;
      planId: string;
      interval: BillingInterval;
      /** A credit the provider already took off `amountPaise` (an upgrade's upfront charge). */
      creditInChargePaise?: number;
      /** Credit balance still owed: taken off this invoice (what the provider charged above it is a refund due). */
      balancePaise?: number;
      creditLabel?: string | null;
    },
  ): Promise<{ invoice: PlatformInvoiceRow; created: boolean; balanceUsedPaise: number }> {
    const [existing] = await this.db
      .select()
      .from(platformInvoices)
      .where(and(eq(platformInvoices.provider, sub.provider ?? "manual"), eq(platformInvoices.providerPaymentId, input.paymentId)))
      .limit(1);
    if (existing) return { invoice: existing, created: false, balanceUsedPaise: 0 };
    const seller = this.deps.config.seller;
    const buyer = await this.deps.shop.buyer(sub.tenantId);
    const amounts = invoiceAmounts({
      chargedPaise: input.amountPaise,
      creditInChargePaise: input.creditInChargePaise,
      balancePaise: input.balancePaise,
      sellerState: seller.stateCode,
      buyerState: buyer.stateCode,
    });
    const split = amounts.split;
    const creditLabel = amounts.creditPaise ? (input.creditLabel ?? (amounts.balanceUsedPaise ? "Credit carried over from a plan change" : null)) : null;
    const date = istDate(this.now());
    const invoice = await this.db.transaction(async (tx) => {
      const n = await this.nextNumber(tx, date);
      const [row] = await tx
        .insert(platformInvoices)
        .values({
          number: n.number,
          fy: n.fy,
          seq: n.seq,
          tenantId: sub.tenantId,
          subscriptionId: sub.id,
          planId: input.planId,
          interval: input.interval,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          date,
          placeOfSupply: buyer.stateCode ?? seller.stateCode,
          gstRate: PLATFORM_GST_RATE,
          subtotalPaise: split.subtotalPaise,
          cgstPaise: split.cgstPaise,
          sgstPaise: split.sgstPaise,
          igstPaise: split.igstPaise,
          totalPaise: split.totalPaise,
          creditPaise: amounts.creditPaise,
          creditLabel,
          refundDuePaise: amounts.refundDuePaise,
          status: "paid",
          provider: sub.provider ?? "manual",
          providerPaymentId: input.paymentId,
          buyer,
          seller: { legalName: seller.legalName, gstin: seller.gstin, stateCode: seller.stateCode, address: seller.address },
        })
        .onConflictDoNothing()
        .returning();
      return row ?? null;
    });
    if (!invoice) {
      const [again] = await this.db
        .select()
        .from(platformInvoices)
        .where(and(eq(platformInvoices.provider, sub.provider ?? "manual"), eq(platformInvoices.providerPaymentId, input.paymentId)))
        .limit(1);
      return { invoice: again!, created: false, balanceUsedPaise: 0 };
    }
    if (amounts.refundDuePaise > 0) {
      this.log.warn({ tenantId: sub.tenantId, invoice: invoice.number, refundDuePaise: amounts.refundDuePaise }, "subscriptions: credit applied after the charge; refund due");
    }
    return { invoice, created: true, balanceUsedPaise: amounts.balanceUsedPaise };
  }

  // ================================================================ webhooks

  /** `POST /webhooks/razorpay`: signature check (raw body), dedup by event id, then the event. */
  async handleWebhook(raw: Buffer, signature: string | undefined, eventIdHeader: string | undefined) {
    if (!this.deps.provider.verifyWebhook(raw, signature)) throw new AppError(400, "invalid_signature", "Webhook signature is invalid");
    let event: ProviderEvent;
    try {
      event = JSON.parse(raw.toString("utf8")) as ProviderEvent;
    } catch {
      throw badRequest("Webhook body is not JSON");
    }
    if (!event || typeof event.event !== "string") throw badRequest("Not a webhook event");
    const eventId = eventIdHeader?.trim() || `body_${sha256(raw.toString("utf8")).slice(0, 40)}`;
    return this.processEvent(this.deps.provider.name, eventId, event);
  }

  /** Records the event (once per provider + id) and applies it. Duplicate deliveries return `{ duplicate: true }`. */
  async processEvent(provider: string, eventId: string, event: ProviderEvent) {
    const subEntity = event.payload?.subscription?.entity ?? {};
    const payEntity = event.payload?.payment?.entity ?? {};
    const providerSubId = str(subEntity.id) ?? str(payEntity.subscription_id) ?? str((payEntity.notes as Record<string, unknown> | undefined)?.subscription_id);
    const sub = providerSubId ? await this.getByProviderId(providerSubId) : null;
    const [rec] = await this.db
      .insert(subscriptionEvents)
      .values({ provider, eventId, type: event.event, tenantId: sub?.tenantId ?? null, providerSubscriptionId: providerSubId, payload: event as unknown })
      .onConflictDoNothing()
      .returning({ id: subscriptionEvents.id });
    if (!rec) return { ok: true, duplicate: true, outcome: "duplicate" };
    let outcome: string;
    try {
      outcome = !sub
        ? "ignored: unknown subscription"
        : this.isPendingMandate(sub, providerSubId)
          ? await this.applyPendingEvent(sub, providerSubId!, event, payEntity)
          : await this.applyEvent(sub, event, subEntity, payEntity);
    } catch (err) {
      outcome = `error: ${(err as Error).message}`.slice(0, 500);
      this.log.error({ err, eventId, type: event.event, outcome }, "subscriptions: webhook handling failed");
      // Let the provider retry: the dedup row is removed so the retry is processed.
      await this.db.delete(subscriptionEvents).where(eq(subscriptionEvents.id, rec.id));
      throw err;
    }
    await this.db.update(subscriptionEvents).set({ outcome, processedAt: new Date() }).where(eq(subscriptionEvents.id, rec.id));
    return { ok: true, duplicate: false, outcome };
  }

  /**
   * Events of a pending upgrade's mandate. Authorised (`subscription.authenticated` / `activated`) or charged — in
   * either order — applies the upgrade once: the new plan and period start, the old mandate is cancelled, and the
   * upfront payment gets its invoice (with the credit line). Failures leave it pending (it lapses after 48 h); a
   * cancelled mandate drops it.
   */
  private async applyPendingEvent(sub: SubscriptionRow, providerSubId: string, event: ProviderEvent, payEntity: Record<string, unknown>): Promise<string> {
    switch (event.event) {
      case "subscription.authenticated":
      case "subscription.activated":
      case "subscription.charged":
        return this.applyUpgrade(sub, providerSubId, event, payEntity);
      case "payment.failed":
      case "subscription.pending":
      case "subscription.halted":
        return "ignored: upgrade payment failed (still pending)";
      case "subscription.cancelled":
      case "subscription.completed": {
        const [row] = await this.db
          .update(subscriptions)
          .set({ ...NO_PENDING })
          .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.pendingProviderSubscriptionId, providerSubId)))
          .returning();
        if (row) await this.audit(row, SYSTEM, "subscription.upgrade_cancelled", `Upgrade mandate ${event.event}`, sub);
        return "applied: pending upgrade dropped";
      }
      default:
        return `ignored: ${event.event}`;
    }
  }

  private async applyUpgrade(sub: SubscriptionRow, providerSubId: string, event: ProviderEvent, payEntity: Record<string, unknown>): Promise<string> {
    const now = this.now();
    const planId = sub.pendingPlanId!;
    const interval = sub.pendingInterval ?? sub.interval;
    const upfront = !!this.deps.provider.supportsUpfront;
    const start = sub.pendingSince ?? now;
    const end = sub.pendingPeriodEnd ?? addInterval(now, interval);
    // Upfront providers collect the first period with the authorisation: the authorised event is the payment.
    // Otherwise the first charge comes as `subscription.charged` and is invoiced by the normal path below.
    const paymentId = str(payEntity.id);
    const charged = event.event === "subscription.charged" || (upfront && sub.pendingChargePaise > 0);
    const [row] = await this.db
      .update(subscriptions)
      .set({
        status: "active",
        planId,
        interval,
        provider: this.deps.provider.name,
        providerSubscriptionId: providerSubId,
        providerPlanId: sub.pendingProviderPlanId,
        authUrl: null,
        checkoutPlanId: null,
        checkoutInterval: null,
        graceEndsAt: null,
        cancelAtPeriodEnd: false,
        endedAt: null,
        currentPeriodStart: upfront ? start : now,
        currentPeriodEnd: upfront ? end : addInterval(now, interval),
        convertedAt: sub.convertedAt ?? now,
        creditBalancePaise: sub.pendingCarryoverPaise,
        ...NO_PENDING,
      })
      .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.pendingProviderSubscriptionId, providerSubId)))
      .returning();
    if (!row) return "ignored: upgrade already applied";
    // The old plan's mandate stops now that the new one is paid.
    if (sub.providerSubscriptionId && sub.providerSubscriptionId !== providerSubId && CHARGING(sub.provider)) await this.cancelProviderId(sub, sub.providerSubscriptionId);
    await this.audit(row, SYSTEM, "subscription.upgraded", `Upgrade to ${planId} (${interval}) paid (${event.event})`, sub);
    await this.syncTenantPlan(row);
    let outcome = "applied: upgraded";
    if (charged) {
      const amount = typeof payEntity.amount === "number" ? payEntity.amount : upfront ? sub.pendingChargePaise : chargeAmount(planPrice(await this.plan(planId), interval));
      if (amount > 0) {
        const r = await this.createInvoice(row, {
          amountPaise: amount,
          paymentId: paymentId ?? `upfront_${providerSubId}`,
          periodStart: row.currentPeriodStart ?? now,
          periodEnd: row.currentPeriodEnd ?? end,
          planId,
          interval,
          creditInChargePaise: upfront ? sub.pendingCreditPaise : 0,
          balancePaise: upfront ? 0 : row.creditBalancePaise,
          creditLabel: sub.pendingCreditLabel,
        });
        if (r.balanceUsedPaise > 0) await this.db.update(subscriptions).set({ creditBalancePaise: sql`greatest(${subscriptions.creditBalancePaise} - ${r.balanceUsedPaise}, 0)` }).where(eq(subscriptions.id, row.id));
        if (r.created) await this.sendInvoice(row, r.invoice);
        outcome = `applied: upgraded, invoice ${r.invoice.number}`;
      }
    }
    await this.notifyOwners(row, "subscription.activated");
    return outcome;
  }

  private async applyEvent(sub: SubscriptionRow, event: ProviderEvent, subEntity: Record<string, unknown>, payEntity: Record<string, unknown>): Promise<string> {
    const now = this.now();
    switch (event.event) {
      case "subscription.authenticated":
      case "subscription.activated": {
        if (sub.status === "active" && !sub.authUrl && !sub.checkoutPlanId) return "ignored: already active";
        const planId = sub.checkoutPlanId ?? sub.planId;
        const interval = sub.checkoutInterval ?? sub.interval;
        const entStart = fromUnix(subEntity.current_start);
        const entEnd = fromUnix(subEntity.current_end);
        // A trial's mandate starts charging at the trial end; otherwise the period starts now.
        const keepPeriod = sub.status === "active" && sub.currentPeriodEnd && sub.currentPeriodEnd > now && planId === sub.planId;
        const start = entStart ?? (keepPeriod ? sub.currentPeriodStart! : sub.status === "trialing" && sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now);
        const end = entEnd ?? (keepPeriod ? sub.currentPeriodEnd! : addInterval(start, interval));
        const updated = await this.transition(
          sub,
          ["trialing", "active", "past_due", "cancelled", "expired"],
          {
            status: "active",
            planId,
            interval,
            authUrl: null,
            checkoutPlanId: null,
            checkoutInterval: null,
            graceEndsAt: null,
            cancelAtPeriodEnd: false,
            endedAt: null,
            currentPeriodStart: start,
            currentPeriodEnd: end,
            convertedAt: sub.convertedAt ?? now,
          },
          SYSTEM,
          "subscription.activated",
          `Mandate authorised (${planId}, ${interval})`,
        );
        if (updated) await this.notifyOwners(updated, "subscription.activated");
        return "applied: active";
      }
      case "subscription.charged": {
        const paymentId = str(payEntity.id) ?? `pay_${sha256(JSON.stringify(event)).slice(0, 16)}`;
        const amount = typeof payEntity.amount === "number" ? payEntity.amount : chargeAmount(planPrice(await this.plan(sub.checkoutPlanId ?? sub.planId), sub.checkoutInterval ?? sub.interval));
        const planId = sub.checkoutPlanId ?? sub.planId;
        const interval = sub.checkoutInterval ?? sub.interval;
        const start = fromUnix(subEntity.current_start) ?? now;
        const end = fromUnix(subEntity.current_end) ?? addInterval(start, interval);
        // An upgrade's upfront payment was invoiced when it applied (under a placeholder id when the provider's event
        // carried none); the same payment delivered again as a charge isn't a second invoice.
        if (paymentId && (await this.adoptUpfrontInvoice(sub, paymentId, amount, now))) return "ignored: upfront payment already invoiced";
        const { invoice, created, balanceUsedPaise } = await this.createInvoice(sub, {
          amountPaise: amount,
          paymentId,
          periodStart: start,
          periodEnd: end,
          planId,
          interval,
          balancePaise: sub.creditBalancePaise,
        });
        if (!created) return `ignored: payment already invoiced (${invoice.number})`;
        if (balanceUsedPaise > 0) {
          await this.db.update(subscriptions).set({ creditBalancePaise: sql`greatest(${subscriptions.creditBalancePaise} - ${balanceUsedPaise}, 0)` }).where(eq(subscriptions.id, sub.id));
        }
        const updated = await this.transition(
          sub,
          ["trialing", "active", "past_due", "cancelled", "expired"],
          {
            status: "active",
            planId,
            interval,
            authUrl: null,
            checkoutPlanId: null,
            checkoutInterval: null,
            graceEndsAt: null,
            endedAt: null,
            currentPeriodStart: start,
            currentPeriodEnd: end,
            convertedAt: sub.convertedAt ?? now,
          },
          SYSTEM,
          "subscription.charged",
          `Charged ${rupees(amount)} (${invoice.number})`,
        );
        if (created && updated) await this.sendInvoice(updated, invoice);
        return `applied: invoice ${invoice.number}`;
      }
      case "payment.failed":
      case "subscription.pending":
      case "subscription.halted": {
        if (!LIVE.includes(sub.status)) return `ignored: ${sub.status}`;
        const updated = await this.transition(
          sub,
          ["trialing", "active", "past_due"],
          { status: "past_due", graceEndsAt: sub.graceEndsAt ?? addDays(now, this.graceDays) },
          SYSTEM,
          "subscription.past_due",
          `Payment failed (${event.event})`,
        );
        if (updated && sub.status !== "past_due") await this.notifyOwners(updated, "subscription.payment_failed");
        return "applied: past_due";
      }
      case "subscription.cancelled":
      case "subscription.completed": {
        if (sub.status === "cancelled" || sub.status === "expired") return `ignored: ${sub.status}`;
        // A trial keeps running when only its (unauthorised) mandate went away.
        if (sub.status === "trialing") {
          await this.update(sub, { providerSubscriptionId: null, authUrl: null, checkoutPlanId: null, checkoutInterval: null }, SYSTEM, "subscription.mandate_cancelled", "Mandate cancelled");
          return "applied: mandate cleared";
        }
        const updated = await this.transition(sub, ["active", "past_due"], { status: "cancelled", endedAt: now, cancelAtPeriodEnd: false, graceEndsAt: null }, SYSTEM, "subscription.cancelled", `Provider ${event.event}`);
        if (updated) await this.notifyOwners(updated, "subscription.cancelled");
        return "applied: cancelled";
      }
      default:
        return `ignored: ${event.event}`;
    }
  }

  /** Renames a placeholder `upfront_<sub>` invoice to the real payment id when the same amount arrives within days of it. */
  private async adoptUpfrontInvoice(sub: SubscriptionRow, paymentId: string, amount: number, now: Date): Promise<boolean> {
    if (!sub.providerSubscriptionId) return false;
    const placeholder = `upfront_${sub.providerSubscriptionId}`;
    const [row] = await this.db
      .update(platformInvoices)
      .set({ providerPaymentId: paymentId })
      .where(
        and(
          eq(platformInvoices.subscriptionId, sub.id),
          eq(platformInvoices.providerPaymentId, placeholder),
          eq(platformInvoices.totalPaise, amount),
          gt(platformInvoices.periodStart, addDays(now, -3)),
        ),
      )
      .returning({ id: platformInvoices.id });
    return !!row;
  }

  // ================================================================ mock provider (development only)

  private assertMock() {
    if (!this.allowMock || this.deps.provider.name !== "mock") throw notFound("Route");
  }

  private async mockSub(providerSubscriptionId: string) {
    this.assertMock();
    const sub = await this.getByProviderId(providerSubscriptionId);
    if (!sub) throw notFound("Subscription");
    return sub;
  }

  private mockEventId = (kind: string) => `evt_mock_${kind}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  /**
   * The customer authorised the mandate (`subscription.authenticated`). For an upgrade's mandate the upfront amount
   * is collected with it, as Razorpay does with `addons`: the event carries that payment.
   */
  async mockAuthorize(providerSubscriptionId: string) {
    const sub = await this.mockSub(providerSubscriptionId);
    const upfront = this.isPendingMandate(sub, providerSubscriptionId) ? sub.pendingChargePaise : 0;
    const payload: ProviderEvent["payload"] = { subscription: { entity: { id: providerSubscriptionId, status: "authenticated", notes: { tenantId: sub.tenantId } } } };
    if (upfront > 0) payload.payment = { entity: { id: `pay_mock_up_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, amount: upfront, currency: "INR", status: "captured", method: "upi" } };
    const r = await this.processEvent("mock", this.mockEventId("auth"), { event: "subscription.authenticated", payload });
    const [invoice] = payload.payment ? await this.db.select().from(platformInvoices).where(eq(platformInvoices.providerPaymentId, String(payload.payment.entity!.id))).limit(1) : [];
    return { ...r, invoice: invoice ? this.invoiceView(invoice) : null, subscription: toView((await this.get(sub.tenantId))!) };
  }

  /** A successful cycle charge (`subscription.charged`) for the current period (the next one once it was invoiced). */
  async mockCharge(providerSubscriptionId: string, opts: { amountPaise?: number } = {}) {
    const sub = await this.mockSub(providerSubscriptionId);
    if (this.isPendingMandate(sub, providerSubscriptionId)) return this.mockChargePending(sub, providerSubscriptionId, opts);
    const planId = sub.checkoutPlanId ?? sub.planId;
    const interval = sub.checkoutInterval ?? sub.interval;
    const plan = await this.plan(planId);
    // Continue from this mandate's last charge (its events), else its current period: invoices can't tell mandates
    // on the same subscription row apart.
    const [last] = await this.db
      .select({ payload: subscriptionEvents.payload })
      .from(subscriptionEvents)
      .where(and(eq(subscriptionEvents.providerSubscriptionId, providerSubscriptionId), eq(subscriptionEvents.type, "subscription.charged"), sql`${subscriptionEvents.outcome} like 'applied%'`))
      .orderBy(desc(subscriptionEvents.createdAt))
      .limit(1);
    const lastEnd = fromUnix((last?.payload as ProviderEvent | undefined)?.payload?.subscription?.entity?.current_end);
    const start = lastEnd ?? sub.currentPeriodStart ?? this.now();
    const end = addInterval(start, interval);
    const amount = opts.amountPaise ?? chargeAmount(planPrice(plan, interval));
    const paymentId = `pay_mock_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const r = await this.processEvent("mock", this.mockEventId("charge"), {
      event: "subscription.charged",
      payload: {
        subscription: { entity: { id: providerSubscriptionId, status: "active", current_start: Math.floor(start.getTime() / 1000), current_end: Math.floor(end.getTime() / 1000) } },
        payment: { entity: { id: paymentId, amount, currency: "INR", status: "captured", method: "upi" } },
      },
    });
    const [invoice] = await this.db.select().from(platformInvoices).where(eq(platformInvoices.providerPaymentId, paymentId)).limit(1);
    return { ...r, invoice: invoice ? this.invoiceView(invoice) : null, subscription: toView((await this.get(sub.tenantId))!) };
  }

  /** A pending upgrade's first charge arriving before (or without) the authorised event. */
  private async mockChargePending(sub: SubscriptionRow, providerSubscriptionId: string, opts: { amountPaise?: number }) {
    const interval = sub.pendingInterval ?? sub.interval;
    const start = sub.pendingSince ?? this.now();
    const end = sub.pendingPeriodEnd ?? addInterval(start, interval);
    const amount = opts.amountPaise ?? (sub.pendingChargePaise || chargeAmount(planPrice(await this.plan(sub.pendingPlanId!), interval)));
    const paymentId = `pay_mock_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const r = await this.processEvent("mock", this.mockEventId("charge"), {
      event: "subscription.charged",
      payload: {
        subscription: { entity: { id: providerSubscriptionId, status: "active", current_start: Math.floor(start.getTime() / 1000), current_end: Math.floor(end.getTime() / 1000) } },
        payment: { entity: { id: paymentId, amount, currency: "INR", status: "captured", method: "upi" } },
      },
    });
    const [invoice] = await this.db.select().from(platformInvoices).where(eq(platformInvoices.providerPaymentId, paymentId)).limit(1);
    return { ...r, invoice: invoice ? this.invoiceView(invoice) : null, subscription: toView((await this.get(sub.tenantId))!) };
  }

  /** A failed renewal (`subscription.pending`). */
  async mockFail(providerSubscriptionId: string) {
    const sub = await this.mockSub(providerSubscriptionId);
    const r = await this.processEvent("mock", this.mockEventId("fail"), {
      event: "subscription.pending",
      payload: { subscription: { entity: { id: providerSubscriptionId, status: "pending" } }, payment: { entity: { id: `pay_mock_failed_${Date.now().toString(36)}`, status: "failed" } } },
    });
    return { ...r, subscription: toView((await this.get(sub.tenantId))!) };
  }

  // ================================================================ lifecycle job

  /**
   * Job `subscriptions.lifecycle` (daily 09:00 IST): trial reminders and ends, grace expiry, scheduled cancels and
   * downgrades at the period end, overdue renewals, comp ends and yearly renewal reminders. `now` defaults to the
   * clock; `tenantId` limits the run to one shop (tests). Each change is a guarded update, so re-runs are no-ops.
   */
  async runLifecycle(opts: { now?: Date; tenantId?: string } = {}) {
    const now = opts.now ?? this.now();
    const conds: SQL[] = [inArray(subscriptions.status, LIVE)];
    if (opts.tenantId) conds.push(eq(subscriptions.tenantId, opts.tenantId));
    const rows = await this.db.select().from(subscriptions).where(and(...conds)).orderBy(asc(subscriptions.createdAt));
    const summary: Record<string, number> = { checked: rows.length };
    for (const sub of rows) {
      const action = lifecycleAction(sub, now, { freePlanId: this.freePlanId });
      if (!action) continue;
      try {
        const done = await this.applyLifecycle(sub, action, now);
        if (done) summary[action.kind] = (summary[action.kind] ?? 0) + 1;
      } catch (err) {
        summary.errors = (summary.errors ?? 0) + 1;
        this.log.error({ err, tenantId: sub.tenantId, action: action.kind }, "subscriptions: lifecycle step failed");
      }
    }
    return summary;
  }

  private async applyLifecycle(sub: SubscriptionRow, action: LifecycleAction, now: Date): Promise<boolean> {
    switch (action.kind) {
      case "remind": {
        const [row] = await this.db
          .update(subscriptions)
          .set({ reminders: sql`array_append(${subscriptions.reminders}, ${action.key})` })
          .where(and(eq(subscriptions.id, sub.id), sql`NOT (${action.key} = ANY(${subscriptions.reminders}))`))
          .returning();
        if (!row) return false;
        await this.notifyOwners(row, action.template, { days: String(action.days) });
        return true;
      }
      case "trial_end": {
        if (sub.providerSubscriptionId) await this.cancelProviderNow(sub);
        const status = sub.cancelAtPeriodEnd ? "cancelled" : "expired";
        const row = await this.transition(
          sub,
          ["trialing"],
          { status, endedAt: now, cancelAtPeriodEnd: false, authUrl: null, checkoutPlanId: null, checkoutInterval: null, providerSubscriptionId: null },
          SYSTEM,
          `subscription.trial_${status}`,
          "Trial ended without a payment method",
        );
        if (!row) return false;
        await this.notifyOwners(row, status === "cancelled" ? "subscription.cancelled" : "subscription.trial_ended");
        return true;
      }
      case "grace_expired":
      case "comp_ended": {
        await this.cancelProviderNow(sub);
        const row = await this.transition(
          sub,
          action.kind === "grace_expired" ? ["past_due"] : ["active"],
          { status: "expired", endedAt: now, graceEndsAt: null, authUrl: null },
          SYSTEM,
          "subscription.expired",
          action.kind === "grace_expired" ? "Grace period over without payment" : "Complimentary plan ended",
        );
        if (!row) return false;
        await this.notifyOwners(row, "subscription.expired");
        return true;
      }
      case "period_end_cancel": {
        await this.cancelProviderNow(sub);
        const row = await this.transition(sub, ["active"], { status: "cancelled", endedAt: now, cancelAtPeriodEnd: false }, SYSTEM, "subscription.cancelled", "Cancelled at the period end");
        if (!row) return false;
        await this.notifyOwners(row, "subscription.cancelled");
        return true;
      }
      case "apply_pending": {
        const target = await this.deps.plans.getPlan(sub.pendingPlanId!);
        const interval = sub.pendingInterval ?? sub.interval;
        const toFree = !target || !isPaid(target);
        if (toFree) await this.cancelProviderNow(sub);
        const start = sub.currentPeriodEnd ?? now;
        const row = await this.transition(
          sub,
          ["active"],
          toFree
            ? { planId: target?.id ?? this.freePlanId, interval, ...NO_PENDING, provider: null, providerSubscriptionId: null, providerPlanId: null, currentPeriodStart: now, currentPeriodEnd: null }
            : { planId: target.id, interval, ...NO_PENDING, currentPeriodStart: start, currentPeriodEnd: addInterval(start, interval) },
          SYSTEM,
          "subscription.downgraded",
          `Moved to ${target?.id ?? this.freePlanId} at the period end`,
        );
        return Boolean(row);
      }
      case "pending_expired": {
        if (sub.pendingProviderSubscriptionId) await this.cancelProviderId(sub, sub.pendingProviderSubscriptionId);
        const [row] = await this.db
          .update(subscriptions)
          .set({ ...NO_PENDING })
          .where(and(eq(subscriptions.id, sub.id), eq(subscriptions.pendingReason, "awaiting_payment"), eq(subscriptions.pendingSince, sub.pendingSince!)))
          .returning();
        if (!row) return false;
        await this.audit(row, SYSTEM, "subscription.upgrade_expired", `Upgrade to ${sub.pendingPlanId} not paid within 48 hours`, sub);
        return true;
      }
      case "overdue": {
        const row = await this.transition(sub, ["active"], { status: "past_due", graceEndsAt: addDays(now, this.graceDays) }, SYSTEM, "subscription.past_due", "Renewal payment overdue");
        if (!row) return false;
        await this.notifyOwners(row, "subscription.payment_failed");
        return true;
      }
    }
  }

  // ================================================================ super-admin

  async adminList(opts: { status?: SubscriptionStatus; q?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const conds: SQL[] = [];
    if (opts.status) conds.push(eq(subscriptions.status, opts.status));
    if (opts.q?.trim()) {
      const ids = await this.deps.tenancy.search(opts.q.trim());
      const q = `%${escapeLike(opts.q.trim())}%`;
      conds.push(ids.length ? or(inArray(subscriptions.tenantId, ids), ilike(subscriptions.planId, q))! : ilike(subscriptions.planId, q));
    }
    const where = conds.length ? and(...conds) : undefined;
    const [rows, totals] = await Promise.all([
      this.db.select().from(subscriptions).where(where).orderBy(desc(subscriptions.updatedAt)).limit(limit).offset(offset),
      this.db.select({ n: count() }).from(subscriptions).where(where),
    ]);
    const [tenants, plans] = await Promise.all([this.deps.tenancy.getTenants(rows.map((r) => r.tenantId)), this.deps.plans.listPlans()]);
    const tenantBy = new Map(tenants.map((t) => [t.id, t]));
    const planBy = new Map(plans.map((p) => [p.id, p]));
    return {
      items: rows.map((r) => {
        const t: TenantInfo | undefined = tenantBy.get(r.tenantId);
        const p = planBy.get(r.planId);
        return {
          ...toView(r),
          tenant: t ? { id: t.id, slug: t.slug, name: t.name, appId: t.appId, status: t.status } : null,
          plan: p ? { id: p.id, name: p.name } : { id: r.planId, name: r.planId },
          mrrPaise: this.mrrOf(r, p),
        };
      }),
      total: totals[0]?.n ?? 0,
    };
  }

  /** MRR contribution (GST-exclusive): paying subscriptions (active or past due, Razorpay or mock) only. */
  private mrrOf(r: SubscriptionRow, p: PlanInfo | undefined) {
    if (!p || !CHARGING(r.provider) || (r.status !== "active" && r.status !== "past_due") || r.authUrl) return 0;
    return monthlyValue(p, r.interval);
  }

  async adminStats() {
    const now = this.now();
    const rows = await this.db.select().from(subscriptions);
    const plans = new Map((await this.deps.plans.listPlans()).map((p) => [p.id, p]));
    const paidPlan = (id: string) => isPaid(plans.get(id));
    let mrr = 0;
    const counts = { active: 0, trialing: 0, pastDue: 0, cancelled: 0, expired: 0, free: 0, comp: 0 };
    let churned30d = 0;
    let trialsEnded = 0;
    let trialsConverted = 0;
    const since = addDays(now, -30);
    for (const r of rows) {
      mrr += this.mrrOf(r, plans.get(r.planId));
      if (r.status === "trialing") counts.trialing++;
      else if (r.status === "past_due") counts.pastDue++;
      else if (r.status === "cancelled") counts.cancelled++;
      else if (r.status === "expired") counts.expired++;
      else if (r.status === "active") {
        if (!paidPlan(r.planId)) counts.free++;
        else if (r.provider === "manual") counts.comp++;
        else counts.active++;
      }
      if ((r.status === "cancelled" || r.status === "expired") && r.endedAt && r.endedAt >= since && r.convertedAt) churned30d++;
      if (r.trialStartedAt && r.status !== "trialing") {
        trialsEnded++;
        if (r.convertedAt) trialsConverted++;
      }
    }
    return {
      mrrPaise: mrr,
      arrPaise: mrr * 12,
      active: counts.active,
      trialing: counts.trialing,
      pastDue: counts.pastDue,
      cancelled: counts.cancelled,
      expired: counts.expired,
      free: counts.free,
      comp: counts.comp,
      churned30d,
      trialsEnded,
      trialsConverted,
      /** Share (0–1) of ended trials that became paid; null before any trial ended. */
      trialConversion: trialsEnded ? trialsConverted / trialsEnded : null,
      total: rows.length,
    };
  }

  /** Adds days to a trial; an expired trial is re-opened for `days` from now. */
  async extendTrial(tenantId: string, days: number, actor: Actor) {
    if (!Number.isInteger(days) || days < 1 || days > 365) throw badRequest("Days must be 1 to 365");
    let sub = await this.ensure(tenantId);
    const now = this.now();
    if (sub.status === "trialing") {
      const base = sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
      sub = await this.update(sub, { trialEndsAt: addDays(base, days), reminders: [] }, actor, "subscription.extend_trial", `Trial extended by ${days} days`);
    } else if (sub.status === "expired" || sub.status === "cancelled" || (sub.status === "active" && !CHARGING(sub.provider))) {
      const plan = await this.plan(sub.planId === this.freePlanId ? (sub.checkoutPlanId ?? sub.planId) : sub.planId);
      if (!isPaid(plan)) throw badRequest("Choose a paid plan for this shop first (comp or change plan)");
      sub = (await this.transition(
        sub,
        [sub.status],
        { status: "trialing", planId: plan.id, provider: null, trialStartedAt: sub.trialStartedAt ?? now, trialEndsAt: addDays(now, days), endedAt: null, cancelAtPeriodEnd: false, reminders: [] },
        actor,
        "subscription.extend_trial",
        `Trial re-opened for ${days} days`,
      ))!;
    } else {
      throw badRequest("Only trials can be extended");
    }
    return { subscription: toView(sub) };
  }

  /** Complimentary plan (provider `manual`, no charge) until a date (null = open-ended). */
  async comp(tenantId: string, input: { planId: string; until: Date | null }, actor: Actor) {
    const plan = await this.plan(input.planId);
    let sub = await this.ensure(tenantId);
    const now = this.now();
    if (input.until && input.until <= now) throw badRequest("The end date must be in the future");
    await this.cancelProviderNow(sub);
    if (sub.pendingProviderSubscriptionId) await this.cancelProviderId(sub, sub.pendingProviderSubscriptionId);
    sub = (await this.transition(
      sub,
      [sub.status],
      {
        status: "active",
        planId: plan.id,
        provider: isPaid(plan) ? "manual" : null,
        providerSubscriptionId: null,
        providerPlanId: null,
        authUrl: null,
        checkoutPlanId: null,
        checkoutInterval: null,
        ...NO_PENDING,
        cancelAtPeriodEnd: false,
        graceEndsAt: null,
        endedAt: null,
        currentPeriodStart: now,
        currentPeriodEnd: input.until,
      },
      actor,
      "subscription.comp",
      `Complimentary ${plan.id}${input.until ? ` until ${istDate(input.until)}` : ""}`,
    ))!;
    return { subscription: toView(sub) };
  }

  async adminInvoices(opts: { status?: "paid" | "void"; tenantId?: string; q?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const conds: SQL[] = [];
    if (opts.status) conds.push(eq(platformInvoices.status, opts.status));
    if (opts.tenantId) conds.push(eq(platformInvoices.tenantId, opts.tenantId));
    if (opts.q?.trim()) {
      const ids = await this.deps.tenancy.search(opts.q.trim());
      const q = ilike(platformInvoices.number, `%${escapeLike(opts.q.trim())}%`);
      conds.push(ids.length ? or(q, inArray(platformInvoices.tenantId, ids))! : q);
    }
    const where = conds.length ? and(...conds) : undefined;
    const [rows, totals] = await Promise.all([
      this.db.select().from(platformInvoices).where(where).orderBy(desc(platformInvoices.createdAt)).limit(limit).offset(offset),
      this.db.select({ n: count() }).from(platformInvoices).where(where),
    ]);
    const tenants = new Map((await this.deps.tenancy.getTenants([...new Set(rows.map((r) => r.tenantId))])).map((t) => [t.id, t]));
    return {
      items: rows.map((r) => {
        const t = tenants.get(r.tenantId);
        return { ...this.invoiceView(r), tenant: t ? { id: t.id, slug: t.slug, name: t.name } : null };
      }),
      total: totals[0]?.n ?? 0,
    };
  }

  async voidInvoice(id: string, reason: string | null, actor: Actor) {
    const invoice = await this.getInvoice(id);
    if (invoice.status === "void") return invoice;
    const [row] = await this.db
      .update(platformInvoices)
      .set({ status: "void", voidedAt: this.now(), voidReason: reason })
      .where(and(eq(platformInvoices.id, id), eq(platformInvoices.status, "paid")))
      .returning();
    // Only the call that actually voided it is recorded (a concurrent void, or an unpaid invoice, matched no row).
    if (row) await this.deps.audit?.record({
      tenantId: invoice.tenantId,
      actorUserId: actor.userId,
      action: "subscription.invoice_void",
      entityType: "platform_invoice",
      entityId: id,
      summary: `${invoice.number} voided${reason ? `: ${reason}` : ""}`,
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    });
    return row ?? (await this.getInvoice(id));
  }

  // ================================================================ internals

  /** Cached provider plan id for (plan, interval, GST-inclusive amount). */
  private async ensureProviderPlan(plan: PlanInfo, interval: BillingInterval): Promise<string> {
    const provider = this.deps.provider.name;
    const amountPaise = chargeAmount(planPrice(plan, interval));
    const key = and(eq(providerPlans.provider, provider), eq(providerPlans.planId, plan.id), eq(providerPlans.interval, interval), eq(providerPlans.amountPaise, amountPaise));
    const [hit] = await this.db.select().from(providerPlans).where(key).limit(1);
    if (hit) return hit.providerPlanId;
    const created = await this.providerCall(() => this.deps.provider.createPlan({ planId: plan.id, name: `${plan.name} (${interval})`, interval, amountPaise }));
    await this.db.insert(providerPlans).values({ provider, planId: plan.id, interval, amountPaise, providerPlanId: created.id }).onConflictDoNothing();
    const [row] = await this.db.select().from(providerPlans).where(key).limit(1);
    return row?.providerPlanId ?? created.id;
  }

  private async providerCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.log.error({ err }, "subscriptions: provider call failed");
      throw new AppError(502, "provider_error", `Payment provider error: ${(err as Error).message}`);
    }
  }

  /** Stops the provider subscription right away (best effort: a failure is logged, the local change proceeds). */
  private async cancelProviderNow(sub: SubscriptionRow) {
    if (!sub.providerSubscriptionId || !CHARGING(sub.provider)) return;
    await this.cancelProviderId(sub, sub.providerSubscriptionId);
  }

  /** Best-effort immediate cancel of one provider subscription (a current or a pending upgrade's mandate). */
  private async cancelProviderId(sub: SubscriptionRow, providerSubscriptionId: string) {
    try {
      await this.deps.provider.cancel(providerSubscriptionId, false);
    } catch (err) {
      this.log.warn({ err, tenantId: sub.tenantId, providerSubscriptionId }, "subscriptions: provider cancel failed");
    }
  }

  /** Unconditional update of the row + audit + tenant plan sync. */
  private async update(sub: SubscriptionRow, patch: Partial<typeof subscriptions.$inferInsert>, actor: Actor, action: string, summary: string) {
    const [row] = await this.db.update(subscriptions).set(patch).where(eq(subscriptions.id, sub.id)).returning();
    if (!row) throw notFound("Subscription");
    await this.audit(row, actor, action, summary, sub);
    await this.syncTenantPlan(row);
    return row;
  }

  /** Guarded state change: applies only while the status is one of `from` (idempotent re-runs return null). */
  private async transition(
    sub: SubscriptionRow,
    from: SubscriptionStatus[],
    patch: Partial<typeof subscriptions.$inferInsert>,
    actor: Actor,
    action: string,
    summary: string,
  ): Promise<SubscriptionRow | null> {
    const [row] = await this.db
      .update(subscriptions)
      .set(patch)
      .where(and(eq(subscriptions.id, sub.id), inArray(subscriptions.status, from)))
      .returning();
    if (!row) return null;
    await this.audit(row, actor, action, summary, sub);
    await this.syncTenantPlan(row);
    return row;
  }

  /** Tenant plan = the subscription's plan while it is live, else the free plan. */
  private async syncTenantPlan(sub: SubscriptionRow) {
    const want = LIVE.includes(sub.status) ? sub.planId : this.freePlanId;
    const tenant = await this.deps.tenancy.getTenant(sub.tenantId);
    if (tenant && tenant.planId !== want) await this.deps.tenancy.setPlan(sub.tenantId, want);
  }

  private async audit(row: SubscriptionRow, actor: Actor, action: string, summary: string, before?: SubscriptionRow) {
    const pick = (s: SubscriptionRow) => ({
      status: s.status,
      planId: s.planId,
      interval: s.interval,
      provider: s.provider,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      pendingPlanId: s.pendingPlanId,
      pendingReason: s.pendingReason,
      creditBalancePaise: s.creditBalancePaise,
    });
    await this.deps.audit?.record({
      tenantId: row.tenantId,
      actorUserId: actor.userId,
      action,
      entityType: "subscription",
      entityId: row.id,
      summary,
      before: before ? pick(before) : undefined,
      after: pick(row),
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    });
  }

  private async messageVars(sub: SubscriptionRow, extra: Record<string, string> = {}) {
    const [tenant, plan] = await Promise.all([this.deps.tenancy.getTenant(sub.tenantId), this.deps.plans.getPlan(sub.planId)]);
    const link = (await this.deps.config.billingPageUrl?.(sub.tenantId).catch(() => "")) ?? "";
    const price = plan ? planPrice(plan, sub.interval) : 0;
    return {
      shop: tenant?.name ?? "",
      plan: plan?.name ?? sub.planId,
      interval: sub.interval,
      amount: rupees(chargeAmount(price)),
      date: dateText(sub.status === "trialing" ? sub.trialEndsAt : sub.currentPeriodEnd),
      grace: dateText(sub.graceEndsAt),
      days: String(daysLeft(sub.status === "trialing" ? sub.trialEndsAt : sub.currentPeriodEnd, this.now()) ?? ""),
      link,
      ...extra,
    };
  }

  private async notifyOwners(sub: SubscriptionRow, template: string, extra: Record<string, string> = {}, attachments?: { filename: string; contentType: string; content: string }[]) {
    if (!this.deps.notify) return;
    try {
      await this.deps.notify.toOwners({ tenantId: sub.tenantId, template, vars: await this.messageVars(sub, extra), attachments });
    } catch (err) {
      this.log.warn({ err, tenantId: sub.tenantId, template }, "subscriptions: notification failed");
    }
  }

  /** The `subscription.charged` message with the invoice PDF attached (sent without it when the PDF fails). */
  private async sendInvoice(sub: SubscriptionRow, invoice: PlatformInvoiceRow) {
    let attachments: { filename: string; contentType: string; content: string }[] | undefined;
    if (this.deps.documents) {
      try {
        const plan = await this.deps.plans.getPlan(invoice.planId);
        const planName = plan?.name ?? invoice.planId;
        const doc = await this.deps.documents.platformInvoicePdf({ invoice, planName, sac: PLATFORM_SAC, lines: this.invoiceView(invoice, planName).lines });
        attachments = [{ filename: doc.filename, contentType: "application/pdf", content: doc.pdf.toString("base64") }];
      } catch (err) {
        this.log.warn({ err, invoice: invoice.number }, "subscriptions: invoice PDF failed; sending without it");
      }
    }
    await this.notifyOwners(sub, "subscription.charged", { number: invoice.number, amount: rupees(invoice.totalPaise), date: dateText(invoice.periodEnd) }, attachments);
  }
}

/** Validates an "until" for comps: ISO date/datetime or null. */
export function parseUntil(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59+05:30` : v);
  if (Number.isNaN(d.getTime())) throw badRequest("Invalid date");
  return d;
}

export const isTerminal = (s: SubscriptionStatus) => s === "cancelled" || s === "expired";

/** A mandate that is authorised (not waiting at its URL). */
const hasMandateRow = (s: SubscriptionRow) => !!s.providerSubscriptionId && !s.authUrl && CHARGING(s.provider);
