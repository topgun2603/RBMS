import { AppError, badRequest, conflict, notFound, sha256 } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import {
  addDays,
  addInterval,
  changeKind,
  chargeAmount,
  daysLeft,
  financialYearLong,
  GRACE_DAYS,
  gstSplit,
  isPaid,
  istDate,
  lifecycleAction,
  monthlyValue,
  PLATFORM_GST_RATE,
  PLATFORM_SAC,
  planPrice,
  platformInvoiceNumber,
  TRIAL_DAYS,
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
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

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

  private async getByProviderId(providerSubscriptionId: string): Promise<SubscriptionRow | null> {
    const [row] = await this.db.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, providerSubscriptionId)).limit(1);
    return row ?? null;
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
        .set({ planId: tenantPlan, provider: paid ? "manual" : null, pendingPlanId: null, pendingInterval: null })
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
    const result = (applied: "now" | "period_end" | "none", s: SubscriptionRow, extra: { authUrl?: string | null; requiresCheckout?: boolean } = {}) => ({
      subscription: toView(s),
      applied,
      authUrl: extra.authUrl ?? null,
      requiresCheckout: extra.requiresCheckout ?? false,
    });

    // ---- to the free plan
    if (!isPaid(target)) {
      if (sub.planId === target.id && sub.status === "active" && !sub.pendingPlanId) return result("none", sub);
      if (sub.status === "active" && CHARGING(sub.provider) && !sub.authUrl && sub.currentPeriodEnd && sub.currentPeriodEnd > now) {
        // Paid until the period end: the free plan starts then.
        await this.providerCall(() => this.deps.provider.cancel(sub.providerSubscriptionId!, true));
        sub = await this.update(sub, { pendingPlanId: target.id, pendingInterval: input.interval }, actor, "subscription.downgrade", `Moves to ${target.id} at the period end`);
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
          pendingPlanId: null,
          pendingInterval: null,
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
        if (!sub.pendingPlanId && !sub.cancelAtPeriodEnd) return result("none", sub);
        // Undo a scheduled downgrade/cancel: same as resume.
        const r = await this.resume(tenantId, actor);
        return result("now", (await this.get(tenantId))!, { authUrl: r.authUrl });
      }
      if (kind === "downgrade" && sub.status === "active") {
        const providerPlanId = await this.ensureProviderPlan(target, input.interval);
        const id = sub.providerSubscriptionId;
        const change = this.deps.provider.changePlan;
        if (id && change) await this.providerCall(() => change.call(this.deps.provider, id, providerPlanId));
        sub = await this.update(sub, { pendingPlanId: target.id, pendingInterval: input.interval }, actor, "subscription.downgrade", `Moves to ${target.id} at the period end`);
        return result("period_end", sub);
      }
      // Upgrade (or any change while past due): a new mandate starting now; the plan applies at once. Prorated credit
      // for the unused part of the old period is out of scope.
      const { authUrl } = await this.startCheckout(sub, target, input.interval, now, actor, { applyNow: true });
      return result("now", (await this.get(tenantId))!, { authUrl });
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
    // The old mandate stops once the new one exists (upgrades, a re-checkout, a past-due shop paying again).
    if (sub.providerSubscriptionId && CHARGING(sub.provider)) await this.cancelProviderNow(sub);
    const patch: Partial<typeof subscriptions.$inferInsert> = {
      provider: this.deps.provider.name,
      providerSubscriptionId: created.id,
      providerPlanId,
      authUrl: created.shortUrl,
      checkoutPlanId: target.id,
      checkoutInterval: interval,
      pendingPlanId: null,
      pendingInterval: null,
      cancelAtPeriodEnd: false,
    };
    if (opts.applyNow) Object.assign(patch, { planId: target.id, interval });
    // An upgrade of a running paid plan starts a new period now (no prorated credit for the old one).
    if (opts.applyNow && sub.status !== "trialing") {
      const now = this.now();
      Object.assign(patch, { currentPeriodStart: now, currentPeriodEnd: addInterval(now, interval) });
    }
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
    if (!sub.cancelAtPeriodEnd && !sub.pendingPlanId) throw badRequest("Nothing to resume");
    let authUrl: string | null = null;
    const wasCancelled = sub.cancelAtPeriodEnd;
    if (sub.status === "active" && CHARGING(sub.provider) && wasCancelled && sub.providerSubscriptionId) {
      const plan = await this.plan(sub.planId);
      const startAt = sub.currentPeriodEnd && sub.currentPeriodEnd > this.now() ? sub.currentPeriodEnd : this.now();
      const r = await this.startCheckout(sub, plan, sub.interval, startAt, actor, { applyNow: false });
      authUrl = r.authUrl;
      sub = (await this.get(tenantId))!;
    } else if (sub.pendingPlanId && sub.providerSubscriptionId && CHARGING(sub.provider)) {
      const plan = await this.plan(sub.planId);
      const providerPlanId = await this.ensureProviderPlan(plan, sub.interval);
      const change = this.deps.provider.changePlan;
      if (change) await this.providerCall(() => change.call(this.deps.provider, sub.providerSubscriptionId!, providerPlanId));
    }
    sub = await this.update(sub, { cancelAtPeriodEnd: false, pendingPlanId: null, pendingInterval: null }, actor, "subscription.resume", "Resumed");
    return { subscription: toView(sub), authUrl };
  }

  // ================================================================ invoices

  async listInvoices(tenantId: string) {
    const items = await this.db
      .select()
      .from(platformInvoices)
      .where(eq(platformInvoices.tenantId, tenantId))
      .orderBy(desc(platformInvoices.createdAt))
      .limit(200);
    return { items };
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
    return this.deps.documents.platformInvoicePdf({ invoice, planName: plan?.name ?? invoice.planId, sac: PLATFORM_SAC });
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
    input: { amountPaise: number; paymentId: string; periodStart: Date; periodEnd: Date; planId: string; interval: BillingInterval },
  ): Promise<{ invoice: PlatformInvoiceRow; created: boolean }> {
    const [existing] = await this.db
      .select()
      .from(platformInvoices)
      .where(and(eq(platformInvoices.provider, sub.provider ?? "manual"), eq(platformInvoices.providerPaymentId, input.paymentId)))
      .limit(1);
    if (existing) return { invoice: existing, created: false };
    const seller = this.deps.config.seller;
    const buyer = await this.deps.shop.buyer(sub.tenantId);
    const split = gstSplit(input.amountPaise, seller.stateCode, buyer.stateCode);
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
      return { invoice: again!, created: false };
    }
    return { invoice, created: true };
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
      outcome = sub ? await this.applyEvent(sub, event, subEntity, payEntity) : "ignored: unknown subscription";
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
        const { invoice, created } = await this.createInvoice(sub, { amountPaise: amount, paymentId, periodStart: start, periodEnd: end, planId, interval });
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

  /** The customer authorised the mandate (`subscription.authenticated`). */
  async mockAuthorize(providerSubscriptionId: string) {
    const sub = await this.mockSub(providerSubscriptionId);
    const r = await this.processEvent("mock", this.mockEventId("auth"), {
      event: "subscription.authenticated",
      payload: { subscription: { entity: { id: providerSubscriptionId, status: "authenticated", notes: { tenantId: sub.tenantId } } } },
    });
    return { ...r, subscription: toView((await this.get(sub.tenantId))!) };
  }

  /** A successful cycle charge (`subscription.charged`) for the current period (the next one once it was invoiced). */
  async mockCharge(providerSubscriptionId: string, opts: { amountPaise?: number } = {}) {
    const sub = await this.mockSub(providerSubscriptionId);
    const planId = sub.checkoutPlanId ?? sub.planId;
    const interval = sub.checkoutInterval ?? sub.interval;
    const plan = await this.plan(planId);
    const [last] = await this.db
      .select({ periodEnd: platformInvoices.periodEnd })
      .from(platformInvoices)
      .where(and(eq(platformInvoices.subscriptionId, sub.id), eq(platformInvoices.planId, planId)))
      .orderBy(desc(platformInvoices.createdAt))
      .limit(1);
    const start = last?.periodEnd ?? sub.currentPeriodStart ?? this.now();
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
    return { ...r, invoice: invoice ?? null, subscription: toView((await this.get(sub.tenantId))!) };
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
            ? { planId: target?.id ?? this.freePlanId, interval, pendingPlanId: null, pendingInterval: null, provider: null, providerSubscriptionId: null, providerPlanId: null, currentPeriodStart: now, currentPeriodEnd: null }
            : { planId: target.id, interval, pendingPlanId: null, pendingInterval: null, currentPeriodStart: start, currentPeriodEnd: addInterval(start, interval) },
          SYSTEM,
          "subscription.downgraded",
          `Moved to ${target?.id ?? this.freePlanId} at the period end`,
        );
        return Boolean(row);
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
        pendingPlanId: null,
        pendingInterval: null,
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
        return { ...r, tenant: t ? { id: t.id, slug: t.slug, name: t.name } : null };
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
    await this.deps.audit?.record({
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
    try {
      await this.deps.provider.cancel(sub.providerSubscriptionId, false);
    } catch (err) {
      this.log.warn({ err, tenantId: sub.tenantId, providerSubscriptionId: sub.providerSubscriptionId }, "subscriptions: provider cancel failed");
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
    const pick = (s: SubscriptionRow) => ({ status: s.status, planId: s.planId, interval: s.interval, provider: s.provider, cancelAtPeriodEnd: s.cancelAtPeriodEnd, pendingPlanId: s.pendingPlanId });
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
        const doc = await this.deps.documents.platformInvoicePdf({ invoice, planName: plan?.name ?? invoice.planId, sac: PLATFORM_SAC });
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
