import { pk, tenantId, timestamps } from "@rbms/db";
import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Shop branches. Every tenant that uses branches has exactly one default branch (partial unique index), created
 * lazily from the billing seller profile and the inventory default location (`BranchesService.ensureDefault`).
 * Branches are never deleted, only deactivated (bills and stock moves keep pointing at them).
 */
export const branches = pgTable(
  "branches",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** Short upper-case code, unique per tenant (e.g. MAIN, MDU1). Accepted in the `x-branch` header. */
    code: text("code").notNull(),
    address: text("address"),
    city: text("city"),
    pincode: text("pincode"),
    phone: text("phone"),
    /** May differ per branch (one GSTIN per state). Its first two digits must equal `state_code`. */
    gstin: text("gstin"),
    /** 2-digit GST state code of the branch (seller state on its bills). */
    stateCode: text("state_code"),
    /** The inventory stock location this branch sells from (no FK: inventory is a separate module). */
    stockLocationId: uuid("stock_location_id"),
    /** Bill number prefix (A-Z, 0-9, "-", max 6), unique per tenant so branch series never collide. */
    invoicePrefix: text("invoice_prefix").notNull(),
    active: boolean("active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique("branches_tenant_code_uq").on(t.tenantId, t.code),
    unique("branches_tenant_prefix_uq").on(t.tenantId, t.invoicePrefix),
    uniqueIndex("branches_tenant_default_uq")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
    uniqueIndex("branches_tenant_location_uq")
      .on(t.tenantId, t.stockLocationId)
      .where(sql`${t.stockLocationId} is not null`),
  ],
);

/**
 * Which staff work at which branch. `is_default` marks the user's home branch (at most one per user and tenant),
 * used when a request sends no `x-branch` header. Owners and admins need no rows: they may use every branch.
 */
export const branchUsers = pgTable(
  "branch_users",
  {
    id: pk(),
    tenantId: tenantId(),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    unique("branch_users_branch_user_uq").on(t.branchId, t.userId),
    index("branch_users_tenant_user_idx").on(t.tenantId, t.userId),
    uniqueIndex("branch_users_tenant_user_default_uq")
      .on(t.tenantId, t.userId)
      .where(sql`${t.isDefault}`),
  ],
);

export type BranchRow = typeof branches.$inferSelect;
export type BranchUserRow = typeof branchUsers.$inferSelect;
