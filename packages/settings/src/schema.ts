import { pk, timestamps } from "@srirealtime/db";
import { index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

/**
 * One row per (namespace, scope). Scope:
 * - tenant_id NULL, user_id NULL  → app-level config
 * - tenant_id set,  user_id NULL  → tenant override
 * - tenant_id set,  user_id set   → user override inside that tenant
 * `value` holds only the overridden keys of that layer.
 */
export const settingsValues = pgTable(
  "settings_values",
  {
    id: pk(),
    /** NULL = app level. Queries on tenant rows always filter by tenant_id. */
    tenantId: uuid("tenant_id"),
    userId: uuid("user_id"),
    namespace: text("namespace").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [
    unique("settings_values_scope_uq").on(t.namespace, t.tenantId, t.userId).nullsNotDistinct(),
    index("settings_values_tenant_idx").on(t.tenantId),
  ],
);

export type SettingsValueRow = typeof settingsValues.$inferSelect;
