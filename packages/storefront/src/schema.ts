import { pk, tenantId, timestamps } from "@srirealtime/db";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/** One line of a stored cart. `price` is the unit price when the line was last set (to flag later price changes). */
export interface StoredCartLine {
  variantId: string;
  qty: number;
  price?: number | null;
}

/** A shopper of one shop (one row per signed-in user per tenant, created lazily). Never a tenant member record. */
export const storeCustomers = pgTable(
  "store_customers",
  {
    id: pk(),
    tenantId: tenantId(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull().default(""),
    /** E.164 (+91…) when known. */
    phone: text("phone"),
    email: text("email"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    ordersCount: integer("orders_count").notNull().default(0),
    /** Paise, paid orders only. */
    totalSpent: integer("total_spent").notNull().default(0),
    lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [unique("store_customers_tenant_user_uq").on(t.tenantId, t.userId)],
);

export const storeAddresses = pgTable(
  "store_addresses",
  {
    id: pk(),
    tenantId: tenantId(),
    customerId: uuid("customer_id").notNull(),
    /** "Home", "Office"… */
    label: text("label"),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    landmark: text("landmark"),
    city: text("city").notNull(),
    district: text("district"),
    /** 2-digit GST state code ("33" = Tamil Nadu). */
    stateCode: text("state_code").notNull(),
    pincode: text("pincode").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    ...timestamps(),
  },
  (t) => [index("store_addresses_customer_idx").on(t.tenantId, t.customerId)],
);

export const storeCarts = pgTable(
  "store_carts",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Random url-safe token (24+ chars); the cart's only credential. */
    token: text("token").notNull().unique(),
    customerId: uuid("customer_id"),
    lines: jsonb("lines").$type<StoredCartLine[]>().notNull().default([]),
    couponCode: text("coupon_code"),
    pincode: text("pincode"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** 30 days after the last use. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("store_carts_customer_idx").on(t.tenantId, t.customerId), index("store_carts_expires_idx").on(t.expiresAt)],
);

export const storeWishlist = pgTable(
  "store_wishlist",
  {
    id: pk(),
    tenantId: tenantId(),
    customerId: uuid("customer_id").notNull(),
    productId: uuid("product_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("store_wishlist_uq").on(t.tenantId, t.customerId, t.productId)],
);

export type StoreCustomerRow = typeof storeCustomers.$inferSelect;
export type StoreAddressRow = typeof storeAddresses.$inferSelect;
export type StoreCartRow = typeof storeCarts.$inferSelect;
export type StoreWishlistRow = typeof storeWishlist.$inferSelect;
