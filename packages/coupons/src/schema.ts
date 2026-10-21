import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

// ------------------------------------------------------------------ automatic offers and bundles

/**
 * Automatic offers (no code): buy X get Y (the cheapest in scope free or % off), tiered (by quantity or spend),
 * a free gift above a spend, and bundles (2+ products together at a fixed price or % off). Applied by `priceCart`.
 */
export const OFFER_KINDS = ["bxgy", "tiered", "free_gift", "bundle"] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

/** What an offer counts: every item, some categories, some collections or some products (bundles name their own items). */
export const OFFER_APPLIES_TO = ["all", "categories", "collections", "products"] as const;
export type OfferAppliesTo = (typeof OFFER_APPLIES_TO)[number];

export interface BxgyConfig {
  /** Units to buy. */
  buyQty: number;
  /** Units that get the reward (the cheapest in scope). */
  getQty: number;
  /** Percent off the reward units: 100 = free. */
  getPercent: number;
  /** Times the deal can repeat in one cart. Null = no limit. */
  maxApplications?: number | null;
}

export interface OfferTier {
  /** Units (basis qty) or paise (basis amount) needed. */
  min: number;
  type: "percent" | "flat";
  /** percent: 1–100; flat: paise. */
  value: number;
}

export interface TieredConfig {
  basis: "qty" | "amount";
  /** Ascending `min`; the highest tier reached applies. */
  tiers: OfferTier[];
}

export interface FreeGiftConfig {
  /** Paise spent on in-scope items (the gift itself doesn't count). */
  minAmount: number;
  giftProductId: string;
  giftVariantId: string;
  giftQty: number;
}

export interface BundleItem {
  productId: string;
  /** A specific variant, or null for any variant of the product. */
  variantId: string | null;
  qty: number;
}

export interface BundleConfig {
  items: BundleItem[];
  /** fixed: the set costs `value` paise; percent: `value`% off the set. */
  priceType: "fixed" | "percent";
  value: number;
}

export type OfferConfig = BxgyConfig | TieredConfig | FreeGiftConfig | BundleConfig;

export const offers = pgTable(
  "offers",
  {
    id: pk(),
    tenantId: tenantId(),
    kind: text("kind").$type<OfferKind>().notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Bundles: their storefront address (unique per tenant). */
    slug: text("slug"),
    imageUrl: text("image_url"),
    appliesTo: text("applies_to").$type<OfferAppliesTo>().notNull().default("all"),
    /** Category, collection or product ids, by `applies_to`. */
    targetIds: uuid("target_ids").array().notNull().default(sql`'{}'::uuid[]`),
    /** Kind-specific rules (BxgyConfig, TieredConfig, FreeGiftConfig or BundleConfig). */
    config: jsonb("config").$type<OfferConfig>().notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    /** Orders that may use it. Null = unlimited. */
    usageLimit: integer("usage_limit"),
    perCustomerLimit: integer("per_customer_limit"),
    channels: text("channels").array().$type<CouponChannel[]>().notNull().default(sql`'{store}'::text[]`),
    /** Adds to other stackable offers; otherwise the best single offer wins. */
    stackable: boolean("stackable").notNull().default(false),
    /** A coupon code may be used on top of it. */
    combinesWithCoupons: boolean("combines_with_coupons").notNull().default(false),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("offers_tenant_kind_idx").on(t.tenantId, t.kind),
    uniqueIndex("offers_tenant_slug_uq").on(t.tenantId, t.slug).where(sql`slug is not null`),
  ],
);

export const offerRedemptions = pgTable(
  "offer_redemptions",
  {
    id: pk(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    tenantId: tenantId(),
    refType: text("ref_type").$type<RedemptionRefType>().notNull(),
    refId: uuid("ref_id").notNull(),
    customerKey: text("customer_key"),
    /** Paise discounted by the offer on this order. */
    amount: integer("amount").notNull().default(0),
    status: text("status").$type<RedemptionStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("offer_redemptions_ref_uq").on(t.offerId, t.refType, t.refId),
    index("offer_redemptions_offer_status_idx").on(t.offerId, t.status),
    index("offer_redemptions_tenant_ref_idx").on(t.tenantId, t.refType, t.refId),
  ],
);

export type OfferRow = typeof offers.$inferSelect;
export type OfferRedemptionRow = typeof offerRedemptions.$inferSelect;
