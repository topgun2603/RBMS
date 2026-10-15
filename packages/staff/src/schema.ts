import { pk, tenantId, timestamps } from "@srirealtime/db";
import { boolean, index, pgTable, text, unique } from "drizzle-orm/pg-core";

/**
 * Custom roles of a tenant. Members reference them as `role:<key>` in `tenant_memberships.roles`.
 * Built-in templates (manager, cashier, ...) are seeded lazily per tenant with `builtin = true`: editable, not deletable.
 */
export const tenantRoles = pgTable(
  "tenant_roles",
  {
    id: pk(),
    tenantId: tenantId(),
    /** e.g. "cashier" (lowercase, [a-z][a-z0-9-]{1,31}). */
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** Permission patterns: "invoices.create", "orders.*", "*.view". */
    permissions: text("permissions").array().notNull().default([]),
    builtin: boolean("builtin").notNull().default(false),
    ...timestamps(),
  },
  (t) => [unique("tenant_roles_tenant_key_uq").on(t.tenantId, t.key), index("tenant_roles_tenant_idx").on(t.tenantId)],
);

export type TenantRole = typeof tenantRoles.$inferSelect;
