import { pk, tenantId, timestamps } from "@rbms/db";
import { boolean, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

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
    /**
     * Built-ins only: hash of the template permissions this row was last seeded/synced with (`templateHash`). While the
     * row's permissions still hash to it the owner hasn't edited them, so a newer template replaces them. Null = custom
     * role, or a built-in seeded before hashes were kept (then known older templates decide).
     */
    templateHash: text("template_hash"),
    ...timestamps(),
  },
  (t) => [unique("tenant_roles_tenant_key_uq").on(t.tenantId, t.key), index("tenant_roles_tenant_idx").on(t.tenantId)],
);

export type TenantRole = typeof tenantRoles.$inferSelect;

/**
 * Discount limits (`discount.ts`): per role (`subject` = role key) or per member (`subject` = user id), a max discount
 * percent (basis points) and/or a max discount per bill (paise). No row = no limit.
 */
export const discountLimits = pgTable(
  "staff_discount_limits",
  {
    id: pk(),
    tenantId: tenantId(),
    scope: text("scope").notNull(),
    subject: text("subject").notNull(),
    maxPercentBp: integer("max_percent_bp"),
    maxAmount: integer("max_amount"),
    updatedBy: uuid("updated_by"),
    ...timestamps(),
  },
  (t) => [unique("staff_discount_limits_uq").on(t.tenantId, t.scope, t.subject), index("staff_discount_limits_tenant_idx").on(t.tenantId)],
);

export type DiscountLimitRow = typeof discountLimits.$inferSelect;
