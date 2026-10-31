import { pk, tenantId, timestamps } from "@rbms/db";
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type {
  LedgerType,
  MaskedPayoutAccount,
  PayoutAccountStatus,
  PayoutStatus,
  ProductReviewStatus,
  SettlementStatus,
  VendorKycStatus,
  VendorOrderLine,
  VendorStatus,
  VendorUserRole,
} from "./logic";
import type { OrderStatus } from "./ports";
import type { PayoutProvider } from "./settings";

export interface VendorAddress {
  line1: string;
  line2?: string | null;
  city: string;
  district?: string | null;
  /** 2-digit GST state code. */
  stateCode: string;
  pincode: string;
}

export const vendors = pgTable(
  "vendors",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** Unique per tenant; the storefront seller page is /sellers/<slug>. */
    slug: text("slug").notNull(),
    status: text("status").$type<VendorStatus>().notNull().default("pending"),
    kycStatus: text("kyc_status").$type<VendorKycStatus>().notNull().default("none"),
    /** Null = the shop's default commission (settings `marketplace.defaultCommissionBps`). */
    commissionBps: integer("commission_bps"),
    description: text("description"),
    logoUrl: text("logo_url"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    gstin: text("gstin"),
    address: jsonb("address").$type<VendorAddress | null>(),
    /** AES-256-GCM JSON of the PayoutAccount (bank / UPI / Route linked account). */
    payoutAccountEnc: text("payout_account_enc"),
    /** Display-safe copy (last 4 digits only). */
    payoutAccountMasked: jsonb("payout_account_masked").$type<MaskedPayoutAccount | null>(),
    payoutAccountStatus: text("payout_account_status").$type<PayoutAccountStatus>().notNull().default("none"),
    /** Staff-only note. */
    notes: text("notes"),
    /** The seller's own stock location (inventory `stock_locations.id`); null = the shop's default location. */
    stockLocationId: uuid("stock_location_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [unique("vendors_tenant_slug_uq").on(t.tenantId, t.slug), index("vendors_tenant_status_idx").on(t.tenantId, t.status)],
);

export const vendorUsers = pgTable(
  "vendor_users",
  {
    id: pk(),
    tenantId: tenantId(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: text("role").$type<VendorUserRole>().notNull().default("staff"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("vendor_users_vendor_user_uq").on(t.vendorId, t.userId), index("vendor_users_tenant_user_idx").on(t.tenantId, t.userId)],
);

export const vendorOrders = pgTable(
  "vendor_orders",
  {
    id: pk(),
    tenantId: tenantId(),
    orderId: uuid("order_id").notNull(),
    orderNumber: text("order_number").notNull(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    lines: jsonb("lines").$type<VendorOrderLine[]>().notNull(),
    /** Paise, as charged, before the coupon. */
    subtotal: integer("subtotal").notNull(),
    discount: integer("discount").notNull().default(0),
    shippingShare: integer("shipping_share").notNull().default(0),
    commissionBps: integer("commission_bps").notNull(),
    commission: integer("commission").notNull(),
    /** subtotal − discount + shipping_share − commission. */
    net: integer("net").notNull(),
    /** Mirrors the order. */
    status: text("status").$type<OrderStatus>().notNull(),
    settlementStatus: text("settlement_status").$type<SettlementStatus>().notNull().default("pending"),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    /** Delivered + return window (IST); payable from then. */
    eligibleAt: timestamp("eligible_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    payoutId: uuid("payout_id"),
    /** The seller packed / shipped their lines (split orders: the order itself may still wait for other sellers). */
    packedAt: timestamp("packed_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    ...timestamps(),
  },
  (t) => [
    unique("vendor_orders_order_vendor_uq").on(t.tenantId, t.orderId, t.vendorId),
    index("vendor_orders_tenant_vendor_idx").on(t.tenantId, t.vendorId, t.placedAt),
    index("vendor_orders_settlement_idx").on(t.tenantId, t.settlementStatus, t.eligibleAt),
  ],
);

export const vendorLedger = pgTable(
  "vendor_ledger",
  {
    id: pk(),
    tenantId: tenantId(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    type: text("type").$type<LedgerType>().notNull(),
    /** Signed paise: + owed to the seller, − commission/refunds/payouts. */
    amount: integer("amount").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vendor_ledger_tenant_vendor_idx").on(t.tenantId, t.vendorId, t.createdAt),
    // A vendor order's sale/commission (and their reversal) are posted once, whatever retries happen.
    uniqueIndex("vendor_ledger_vendor_order_uq")
      .on(t.tenantId, t.type, t.refType, t.refId)
      .where(sql`${t.refType} in ('vendor_order', 'vendor_order_reversal')`),
  ],
);

export const vendorPayouts = pgTable(
  "vendor_payouts",
  {
    id: pk(),
    tenantId: tenantId(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id),
    /** Paise. */
    amount: integer("amount").notNull(),
    status: text("status").$type<PayoutStatus>().notNull().default("pending"),
    provider: text("provider").$type<PayoutProvider>().notNull(),
    /** Transfer id / bank reference. */
    providerRef: text("provider_ref"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    periodFrom: timestamp("period_from", { withTimezone: true }),
    periodTo: timestamp("period_to", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("vendor_payouts_tenant_vendor_idx").on(t.tenantId, t.vendorId, t.createdAt), index("vendor_payouts_tenant_status_idx").on(t.tenantId, t.status)],
);

/**
 * Review of a seller's product before it goes live (one row per product; the latest submission). The catalogue keeps
 * the product a draft while this is `pending`; approving makes it active.
 */
export const vendorProductReviews = pgTable(
  "vendor_product_reviews",
  {
    id: pk(),
    tenantId: tenantId(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    /** catalogue `catalog_products.id`. */
    productId: uuid("product_id").notNull(),
    status: text("status").$type<ProductReviewStatus>().notNull().default("pending"),
    /** Snapshot at submission, for the review queue. */
    productName: text("product_name").notNull(),
    productImage: text("product_image"),
    /** Why the shop rejected it (shown to the seller). */
    reason: text("reason"),
    /** A re-review: the product was live and approved, then the seller changed what customers see (it stays live). */
    changedAfterApproval: boolean("changed_after_approval").notNull().default(false),
    /** What changed since approval: name, description, images, price, variants, gst. */
    changedFields: text("changed_fields").array().$type<string[]>().notNull().default(sql`'{}'::text[]`),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by"),
    ...timestamps(),
  },
  (t) => [
    unique("vendor_product_reviews_product_uq").on(t.tenantId, t.productId),
    index("vendor_product_reviews_status_idx").on(t.tenantId, t.status, t.submittedAt),
    index("vendor_product_reviews_vendor_idx").on(t.tenantId, t.vendorId),
  ],
);

export type VendorRow = typeof vendors.$inferSelect;
export type VendorProductReviewRow = typeof vendorProductReviews.$inferSelect;
export type VendorUserRow = typeof vendorUsers.$inferSelect;
export type VendorOrderRow = typeof vendorOrders.$inferSelect;
export type VendorLedgerRow = typeof vendorLedger.$inferSelect;
export type VendorPayoutRow = typeof vendorPayouts.$inferSelect;
