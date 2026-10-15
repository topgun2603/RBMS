import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const COUPON_TYPES = ["percent", "flat", "free_shipping"] as const;
export type CouponType = (typeof COUPON_TYPES)[number];

export const COUPON_APPLIES_TO = ["all", "categories", "products"] as const;
export type CouponAppliesTo = (typeof COUPON_APPLIES_TO)[number];

/** Where a coupon may be used. Order channels plus "billing" (counter bills, ref_type invoice). */
export const COUPON_CHANNELS = ["store", "manual", "pos", "marketplace", "billing"] as const;
export type CouponChannel = (typeof COUPON_CHANNELS)[number];

export const REDEMPTION_REF_TYPES = ["order", "invoice"] as const;
export type RedemptionRefType = (typeof REDEMPTION_REF_TYPES)[number];

export const REDEMPTION_STATUSES = ["active", "released"] as const;
export type RedemptionStatus = (typeof REDEMPTION_STATUSES)[number];

export const coupons = pgTable(
  "coupons",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Upper-case, unique per tenant. */
    code: text("code").notNull(),
    description: text("description"),
    type: text("type").$type<CouponType>().notNull(),
    /** percent: 1–100; flat: paise; free_shipping: 0. */
    value: integer("value").notNull().default(0),
    /** Paise; caps percent (and flat) discounts. Null = no cap. */
    maxDiscount: integer("max_discount"),
    /** Paise; compared with the eligible subtotal. */
    minOrder: integer("min_order").notNull().default(0),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** Total active redemptions allowed. Null = unlimited. */
    usageLimit: integer("usage_limit"),
    /** Active redemptions allowed per customer key. Null = unlimited. */
    perCustomerLimit: integer("per_customer_limit"),
    firstOrderOnly: boolean("first_order_only").notNull().default(false),
    appliesTo: text("applies_to").$type<CouponAppliesTo>().notNull().default("all"),
    /** Category or product ids, by `applies_to`. */
    targetIds: uuid("target_ids").array().notNull().default(sql`'{}'::uuid[]`),
    channels: text("channels").array().$type<CouponChannel[]>().notNull().default(sql`'{store}'::text[]`),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("coupons_tenant_code_uq").on(t.tenantId, t.code), index("coupons_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: pk(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    tenantId: tenantId(),
    refType: text("ref_type").$type<RedemptionRefType>().notNull(),
    refId: uuid("ref_id").notNull(),
    /** Who used it: "acct:<id>", "ph:+91…" or "em:…" (chosen by the caller). */
    customerKey: text("customer_key"),
    /** Paise discounted (goods + waived shipping). */
    amount: integer("amount").notNull().default(0),
    status: text("status").$type<RedemptionStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("coupon_redemptions_ref_uq").on(t.couponId, t.refType, t.refId),
    index("coupon_redemptions_coupon_status_idx").on(t.couponId, t.status),
    index("coupon_redemptions_tenant_ref_idx").on(t.tenantId, t.refType, t.refId),
  ],
);

export type CouponRow = typeof coupons.$inferSelect;
export type CouponRedemptionRow = typeof couponRedemptions.$inferSelect;
