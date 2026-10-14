import { pk, timestamps } from "@srirealtime/db";
import { index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Label overrides. tenant_id NULL = app-wide override (managed by the platform);
 * app_id NULL = applies to every app. Tenant queries always filter by tenant_id.
 */
export const i18nOverrides = pgTable(
  "i18n_overrides",
  {
    id: pk(),
    tenantId: uuid("tenant_id"),
    appId: text("app_id"),
    locale: text("locale").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("i18n_overrides_scope_uq").on(t.tenantId, t.appId, t.locale, t.key).nullsNotDistinct(),
    index("i18n_overrides_tenant_idx").on(t.tenantId),
  ],
);

export type I18nOverride = typeof i18nOverrides.$inferSelect;
