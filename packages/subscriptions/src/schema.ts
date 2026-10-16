import { pk, timestamps } from "@srirealtime/db";
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
    /** A downgrade that applies at the period end. */
    pendingPlanId: text("pending_plan_id"),
    pendingInterval: text("pending_interval", { enum: BILLING_INTERVALS }),
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
    subtotalPaise: integer("subtotal_paise").notNull(),
    cgstPaise: integer("cgst_paise").notNull().default(0),
    sgstPaise: integer("sgst_paise").notNull().default(0),
    igstPaise: integer("igst_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull(),
    status: text("status", { enum: ["paid", "void"] }).notNull().default("paid"),
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

export type SubscriptionRow = typeof subscriptions.$inferSelect;
export type SubscriptionEventRow = typeof subscriptionEvents.$inferSelect;
export type PlatformInvoiceRow = typeof platformInvoices.$inferSelect;
export type ProviderPlanRow = typeof providerPlans.$inferSelect;
