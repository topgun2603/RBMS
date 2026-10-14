import { timestamps } from "@srirealtime/db";
import { jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { BrandTokensPatch } from "./tokens";

/** One row per tenant. `tokens` stores only the tenant's overrides; defaults are merged at read time. */
export const tenantBranding = pgTable("tenant_branding", {
  tenantId: uuid("tenant_id").primaryKey(),
  appName: text("app_name"),
  logoUrl: text("logo_url"),
  logoDarkUrl: text("logo_dark_url"),
  faviconUrl: text("favicon_url"),
  tokens: jsonb("tokens").$type<BrandTokensPatch>().notNull().default({}),
  ...timestamps(),
});

export type TenantBrandingRow = typeof tenantBranding.$inferSelect;
