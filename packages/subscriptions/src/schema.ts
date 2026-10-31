import { pk, timestamps } from "@rbms/db";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Platform plan subscriptions (docs/batch5.md). Platform-owned: rows are keyed by `tenant_id`, but super-admin reads
 * span every tenant. Shop-side service methods always filter by the request's tenant.
 */

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "cancelled", "expired"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];
export const SUBSCRIPTION_PROVIDERS = ["razorpay", "mock", "manual"] as const;
export type SubscriptionProviderName = (typeof SUBSCRIPTION_PROVIDERS)[number];
/**
 * Why `pendingPlanId` is set: `downgrade` (applies at the period end; a null reason on older rows means the same) or
 * `awaiting_payment` (an upgrade that applies once its new mandate is authorised / first charge succeeds).
 */
export const PENDING_REASONS = ["downgrade", "awaiting_payment"] as const;
export type PendingReason = (typeof PENDING_REASONS)[number];

/** One current row per tenant. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    planId: text("plan_id").notNull(),
    interval: text("interval", { enum: BILLING_INTERVALS }).notNull().default("monthly"),
    status: text("status", { enum: SUBSCRIPTION_STATUSES }).notNull(),
    /** The user who signed the shop up (one trial per owner). */
    ownerUserId: uuid("owner_user_id"),
    trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    /** Null = open-ended (free plan, or a manual subscription without an end). */
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    /** Null for the free plan (nothing to charge). */
    provider: text("provider", { enum: SUBSCRIPTION_PROVIDERS }),
    providerSubscriptionId: text("provider_subscription_id"),
    providerPlanId: text("provider_plan_id"),
    /** Mandate short URL while a checkout waits for authorisation; cleared once authorised. */
    authUrl: text("auth_url"),
    /** The plan/interval a checkout (mandate) is for, applied when the mandate is authorised. */
    checkoutPlanId: text("checkout_plan_id"),
    checkoutInterval: text("checkout_interval", { enum: BILLING_INTERVALS }),
    /** A downgrade that applies at the period end, or an upgrade waiting for its payment (`pendingReason`). */
    pendingPlanId: text("pending_plan_id"),
    pendingInterval: text("pending_interval", { enum: BILLING_INTERVALS }),
    pendingReason: text("pending_reason", { enum: PENDING_REASONS }),
    /** When the pending upgrade was asked for (it expires 48 h later if unpaid). */
    pendingSince: timestamp("pending_since", { withTimezone: true }),
    /** The upgrade's new mandate, kept apart while the current plan's mandate keeps running. */
    pendingProviderSubscriptionId: text("pending_provider_subscription_id"),
    pendingProviderPlanId: text("pending_provider_plan_id"),
    pendingAuthUrl: text("pending_auth_url"),
    /** End of the upgrade's first period (its mandate's first recurring charge). */
    pendingPeriodEnd: timestamp("pending_period_end", { withTimezone: true }),
    /** Proration credit (taxable paise) taken off the upgrade's first charge. */
    pendingCreditPaise: integer("pending_credit_paise").notNull().default(0),
    /** Credit (taxable paise) the first charge could not absorb; moves to `creditBalancePaise` when the upgrade applies. */
    pendingCarryoverPaise: integer("pending_carryover_paise").notNull().default(0),
    /** The credit line's text for the upgrade's first invoice. */
    pendingCreditLabel: text("pending_credit_label"),
    /** What the upgrade charges up front (GST included): new plan price − credit, + 18% GST. */
    pendingChargePaise: integer("pending_charge_paise").notNull().default(0),
    /** Unused proration credit (taxable paise), a discount line on the next platform invoice. */
    creditBalancePaise: integer("credit_balance_paise").notNull().default(0),
    /** First move from a trial to a paid, authorised subscription (trial conversion). */
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    /** When the subscription last became cancelled or expired (churn). */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Reminder keys already sent (idempotent job), e.g. "trial_3d:2026-10-30T…". */
    reminders: text("reminders").array().notNull().default([]),
    ...timestamps(),
  },
  (t) => [
    unique("subscriptions_tenant_uq").on(t.tenantId),
    index("subscriptions_status_idx").on(t.status),
    index("subscriptions_provider_sub_idx").on(t.providerSubscriptionId),
    index("subscriptions_pending_provider_sub_idx").on(t.pendingProviderSubscriptionId),
    index("subscriptions_owner_idx").on(t.ownerUserId),
  ],
);

/** Provider webhook events (dedup by provider + event id) with the raw payload. */
export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: pk(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    tenantId: uuid("tenant_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    payload: jsonb("payload").$type<unknown>().notNull(),
    /** What handling did: "applied", "ignored: …", "error: …". */
    outcome: text("outcome"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("subscription_events_provider_event_uq").on(t.provider, t.eventId), index("subscription_events_tenant_idx").on(t.tenantId)],
);

/** Buyer (the shop) or seller (the platform) as printed on a platform invoice. */
export interface InvoiceParty {
  legalName: string;
  gstin: string | null;
  stateCode: string | null;
  address: string | null;
}

/** An add-on on a platform invoice (taxable paise, before GST). */
export interface AddonInvoiceLine {
  addonId: string;
  description: string;
  quantity: number;
  taxablePaise: number;
}

/** Tax invoices the platform issues to shops for their plan (18% GST, SAC 998314). */
export const platformInvoices = pgTable(
  "platform_invoices",
  {
    id: pk(),
    /** "SR/2026-27/00001": one series per financial year. */
    number: text("number").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    tenantId: uuid("tenant_id").notNull(),
    subscriptionId: uuid("subscription_id"),
    planId: text("plan_id").notNull(),
    interval: text("interval", { enum: BILLING_INTERVALS }).notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    /** Invoice date (IST), "YYYY-MM-DD". */
    date: text("date").notNull(),
    placeOfSupply: text("place_of_supply").notNull(),
    gstRate: integer("gst_rate").notNull().default(18),
    /** Taxable value (after any proration credit). */
    subtotalPaise: integer("subtotal_paise").notNull(),
    /** Proration credit (taxable paise) shown as its own line; the plan line is `subtotalPaise + creditPaise`. */
    creditPaise: integer("credit_paise").notNull().default(0),
    /** The credit line's text, e.g. "Credit for 12 unused days of Starter (monthly)". */
    creditLabel: text("credit_label"),
    /** Charged by the provider above this invoice's total (a balance credit it could not take off): to refund. */
    refundDuePaise: integer("refund_due_paise").notNull().default(0),
    cgstPaise: integer("cgst_paise").notNull().default(0),
    sgstPaise: integer("sgst_paise").notNull().default(0),
    igstPaise: integer("igst_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    status: text("status", { enum: ["paid", "void"] }).notNull().default("paid"),
    /** `plan` (a plan period, add-ons included), `addon` (more of an add-on for the rest of a period), `credits` (a pack). */
    kind: text("kind", { enum: ["plan", "addon", "credits"] }).notNull().default("plan"),
    /** Add-on lines (taxable paise each); the plan line is the rest of the taxable value. */
    addonLines: jsonb("addon_lines").$type<AddonInvoiceLine[]>().notNull().default([]),
    provider: text("provider"),
    providerPaymentId: text("provider_payment_id"),
    buyer: jsonb("buyer").$type<InvoiceParty>().notNull(),
    seller: jsonb("seller").$type<InvoiceParty>().notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    ...timestamps(),
  },
  (t) => [
    unique("platform_invoices_number_uq").on(t.number),
    unique("platform_invoices_payment_uq").on(t.provider, t.providerPaymentId),
    index("platform_invoices_tenant_idx").on(t.tenantId),
  ],
);

/** Next invoice sequence per financial year. */
export const platformInvoiceSeries = pgTable("platform_invoice_series", {
  fy: text("fy").primaryKey(),
  seq: integer("seq").notNull().default(0),
  ...timestamps(),
});

/** Provider plan ids per (plan, interval, amount): a price change creates a new provider plan. */
export const providerPlans = pgTable(
  "provider_plans",
  {
    id: pk(),
    provider: text("provider").notNull(),
    planId: text("plan_id").notNull(),
    interval: text("interval", { enum: BILLING_INTERVALS }).notNull(),
    /** What the provider charges each cycle (GST included). */
    amountPaise: integer("amount_paise").notNull(),
    providerPlanId: text("provider_plan_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("provider_plans_key_uq").on(t.provider, t.planId, t.interval, t.amountPaise)],
);

/**
 * A shop's add-ons (docs/verticals.md "Plan add-ons"): one row per tenant and add-on. `plan` rows are billed with the
 * plan's mandate (same interval and period); `comp` rows are complimentary (super-admin), until `currentPeriodEnd`.
 */
export const ADDON_SOURCES = ["plan", "comp"] as const;
export type AddonSource = (typeof ADDON_SOURCES)[number];
export const ADDON_STATUSES = ["active", "ended"] as const;
export type AddonStatus = (typeof ADDON_STATUSES)[number];
/** Why an add-on ends (or ended): the shop's cancel, a plan change it can't go with, the plan ending, a comp ending, removed by the platform. */
export const ADDON_END_REASONS = ["cancelled", "plan_change", "plan_ended", "comp_ended", "removed"] as const;
export type AddonEndReason = (typeof ADDON_END_REASONS)[number];

export const subscriptionAddons = pgTable(
  "subscription_addons",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    subscriptionId: uuid("subscription_id"),
    addonId: text("addon_id").notNull(),
    source: text("source", { enum: ADDON_SOURCES }).notNull().default("plan"),
    status: text("status", { enum: ADDON_STATUSES }).notNull().default("active"),
    /** Paid (or given) quantity in the current period. */
    quantity: integer("quantity").notNull().default(0),
    /** The quantity from the next period: null = renews as is, 0 = ends at the period end. */
    nextQuantity: integer("next_quantity"),
    interval: text("interval", { enum: BILLING_INTERVALS }).notNull().default("monthly"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    /** The plan's period end (`plan`), the comp's end (`comp`, null = open-ended). */
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    endReason: text("end_reason", { enum: ADDON_END_REASONS }),
    /** A note for the shop's page, e.g. "Not available on Starter: ends on 16 Nov". */
    notice: text("notice"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [unique("subscription_addons_tenant_addon_uq").on(t.tenantId, t.addonId), index("subscription_addons_status_idx").on(t.status)],
);

/** One-time add-on payments: the prorated rest of the period for more of an add-on, or a credits pack. */
export const ADDON_PAYMENT_KINDS = ["proration", "credits"] as const;
export type AddonPaymentKind = (typeof ADDON_PAYMENT_KINDS)[number];
export const ADDON_PAYMENT_STATUSES = ["pending", "paid", "cancelled", "expired"] as const;
export type AddonPaymentStatus = (typeof ADDON_PAYMENT_STATUSES)[number];

export const addonPayments = pgTable(
  "subscription_addon_payments",
  {
    id: pk(),
    tenantId: uuid("tenant_id").notNull(),
    subscriptionId: uuid("subscription_id"),
    addonId: text("addon_id").notNull(),
    kind: text("kind", { enum: ADDON_PAYMENT_KINDS }).notNull(),
    /** proration: the active quantity before and after; credits: packs bought in `toQuantity`. */
    fromQuantity: integer("from_quantity").notNull().default(0),
    toQuantity: integer("to_quantity").notNull(),
    /** Taxable value and what is charged (GST included). */
    taxablePaise: integer("taxable_paise").notNull(),
    chargePaise: integer("charge_paise").notNull(),
    label: text("label").notNull(),
    /** proration: today → the plan's period end. */
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    provider: text("provider"),
    /** Payment link id (Razorpay `plink_…`, the mock's `plink_mock_…`). */
    providerPaymentId: text("provider_payment_id"),
    authUrl: text("auth_url"),
    status: text("status", { enum: ADDON_PAYMENT_STATUSES }).notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    invoiceId: uuid("invoice_id"),
    ...timestamps(),
  },
  (t) => [index("subscription_addon_payments_tenant_idx").on(t.tenantId), index("subscription_addon_payments_provider_idx").on(t.providerPaymentId)],
);

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type SubscriptionAddonRow = typeof subscriptionAddons.$inferSelect;
export type AddonPaymentRow = typeof addonPayments.$inferSelect;
export type SubscriptionEventRow = typeof subscriptionEvents.$inferSelect;
export type PlatformInvoiceRow = typeof platformInvoices.$inferSelect;
export type ProviderPlanRow = typeof providerPlans.$inferSelect;
