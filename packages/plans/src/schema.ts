import { pk, tenantId, timestamps } from "@srirealtime/db";
import { boolean, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

/** Platform-wide plan catalogue (not tenant-scoped). */
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
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
});

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

export type Plan = typeof plans.$inferSelect;
export type TenantPlanOverride = typeof tenantPlanOverrides.$inferSelect;
export type UsageCounter = typeof usageCounters.$inferSelect;
