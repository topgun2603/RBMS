import { pk, tenantId, timestamps } from "@srirealtime/db";
import { boolean, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Platform-wide plan catalogue (not tenant-scoped). Each app (Billing, Ecommerce, Pharmacy …) has its own plans
 * (`app_id`), one per tier; a plan without an app is shared (legacy) and offered only to apps that have none.
 */
export const plans = pgTable(
  "plans",
  {
  id: text("id").primaryKey(),
  /** The app (tenants.app_id) whose shops can take this plan; null = any app without plans of its own. */
  appId: text("app_id"),
  /** free | starter | pro | enterprise: the same tier of another app is where a shop lands when it moves app. */
  tier: text("tier"),
  name: text("name").notNull(),
  description: text("description"),
  priceMonthlyPaise: integer("price_monthly_paise").notNull().default(0),
  priceYearlyPaise: integer("price_yearly_paise").notNull().default(0),
  /** Catalogue module ids enabled by this plan, e.g. "chat", "invoices". */
  modules: text("modules").array().notNull().default([]),
  /** Usage limits; -1 = unlimited. Keys ending in `_per_month` reset monthly. */
  limits: jsonb("limits").$type<Record<string, number>>().notNull().default({}),
  features: jsonb("features").$type<Record<string, boolean>>().notNull().default({}),
  isPublic: boolean("is_public").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  ...timestamps(),
  },
  (t) => [index("plans_app_idx").on(t.appId, t.tier)],
);

/** Per-tenant tweaks on top of the plan (deals, add-ons, manual blocks). */
export const tenantPlanOverrides = pgTable("tenant_plan_overrides", {
  tenantId: uuid("tenant_id").primaryKey(),
  addModules: text("add_modules").array().notNull().default([]),
  removeModules: text("remove_modules").array().notNull().default([]),
  limits: jsonb("limits").$type<Record<string, number>>().notNull().default({}),
  features: jsonb("features").$type<Record<string, boolean>>().notNull().default({}),
  ...timestamps(),
});

/** Usage per tenant, key and period ("2026-10" for monthly keys, "lifetime" otherwise). */
export const usageCounters = pgTable(
  "usage_counters",
  {
    id: pk(),
    tenantId: tenantId(),
    key: text("key").notNull(),
    period: text("period").notNull(),
    value: integer("value").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("usage_counters_tenant_key_period_uq").on(t.tenantId, t.key, t.period)],
);

/** Add-on kinds: `limit` raises usage limits, `feature` unlocks module/feature keys, `credits` is a one-time pack. */
export const ADDON_KINDS = ["limit", "feature", "credits"] as const;
export type AddonKind = (typeof ADDON_KINDS)[number];

/**
 * Paid add-ons on top of a plan (platform catalogue, docs/verticals.md "Plan add-ons"). An app's own add-on replaces
 * the shared add-on (no app) with the same `code` for that app's shops.
 */
export const planAddons = pgTable(
  "plan_addons",
  {
    id: text("id").primaryKey(),
    /** Groups an app's own add-on with the shared one it replaces, e.g. "extra-staff". */
    code: text("code").notNull(),
    /** The app (tenants.app_id) whose shops can buy it; null = every app without its own add-on of this code. */
    appId: text("app_id"),
    kind: text("kind", { enum: ADDON_KINDS }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /**
     * Per unit: `limit` adds these to the plan's limits (`{ staff: 5 }`); `credits` grants these credits per pack
     * (`{ sms_per_month: 5000 }`: used after the monthly allowance, never reset).
     */
    limits: jsonb("limits").$type<Record<string, number>>().notNull().default({}),
    /** `feature`: module ids / feature keys / `module.*` it unlocks (only those the shop's app offers). */
    modules: text("modules").array().notNull().default([]),
    priceMonthlyPaise: integer("price_monthly_paise").notNull().default(0),
    priceYearlyPaise: integer("price_yearly_paise").notNull().default(0),
    /** `credits`: price of one pack, paid once. */
    priceOncePaise: integer("price_once_paise").notNull().default(0),
    minQuantity: integer("min_quantity").notNull().default(1),
    maxQuantity: integer("max_quantity").notNull().default(1),
    /** Plan tiers that may buy it (free | starter | pro | enterprise); empty = every tier. */
    tiers: text("tiers").array().notNull().default([]),
    isPublic: boolean("is_public").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    ...timestamps(),
  },
  (t) => [index("plan_addons_app_idx").on(t.appId, t.code)],
);

/** Credits from packs (or given by the platform): used after the monthly allowance of `key` runs out; never reset. */
export const usageCredits = pgTable(
  "usage_credits",
  {
    id: pk(),
    tenantId: tenantId(),
    key: text("key").notNull(),
    balance: integer("balance").notNull().default(0),
    /** Lifetime totals (the shop's page, support). */
    granted: integer("granted").notNull().default(0),
    used: integer("used").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("usage_credits_tenant_key_uq").on(t.tenantId, t.key)],
);

export type Plan = typeof plans.$inferSelect;
export type PlanAddon = typeof planAddons.$inferSelect;
export type UsageCredit = typeof usageCredits.$inferSelect;
export type TenantPlanOverride = typeof tenantPlanOverrides.$inferSelect;
export type UsageCounter = typeof usageCounters.$inferSelect;
