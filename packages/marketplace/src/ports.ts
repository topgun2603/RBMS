import type { MarketplaceSettings } from "./settings";

export type { FeatureGatePort } from "@srirealtime/core";

/** Order statuses as the orders module defines them. */
export const ORDER_STATUSES = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled", "returned"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** One order line as marketplace needs it: orders' `OrderLine` plus the product's seller (null = the shop's own product). */
export interface SourceOrderLine {
  variantId: string;
  productId: string;
  /** Seller of the product when the order was placed; null for the shop's own products. */
  vendorId: string | null;
  name: string;
  sku: string | null;
  image: string | null;
  qty: number;
  unit: string;
  /** Paise per unit as charged (incl. GST when the product is tax-inclusive). */
  price: number;
  gstRate: number;
  /** Coupon share of this line (orders stores it on the exclusive basis); used only as a weight. */
  discount: number;
  /** Line total incl. GST, after discount (informational). */
  total: number;
}

/** The parts of orders' `OrderTotals` that marketplace splits. Money in paise. */
export interface SourceOrderTotals {
  /** Σ qty × price as charged. */
  subtotal: number;
  /** Coupon discount on the goods, as charged. */
  discount: number;
  /** Shipping charged (GST-inclusive), after any free-shipping coupon. */
  shipping: number;
  /** Grand total the customer pays. */
  total: number;
}

export interface SourceOrder {
  id: string;
  /** "ORD/26-27/0001". */
  number: string;
  status: OrderStatus;
  placedAt: Date;
  deliveredAt: Date | null;
  customerName: string;
  lines: SourceOrderLine[];
  totals: SourceOrderTotals;
}

/**
 * Implemented with the orders service + catalogue in kit (lines get `vendorId` from the product). Unknown ids → null.
 */
export interface OrderSourcePort {
  getOrder(tenantId: string, orderId: string): Promise<SourceOrder | null>;
}

export interface VendorProduct {
  id: string;
  name: string;
  slug: string;
  status: string;
  image: string | null;
  priceMin: number;
  priceMax: number;
}

/** Implemented by the catalogue once products carry `vendorId` (integration). */
export interface VendorProductsPort {
  count(tenantId: string, vendorId: string, opts?: { publicOnly?: boolean }): Promise<number>;
  list(
    tenantId: string,
    vendorId: string,
    opts: { limit: number; offset: number; publicOnly?: boolean; q?: string },
  ): Promise<{ items: VendorProduct[]; total: number }>;
  /**
   * The seller of each product id (null = the shop's own; unknown ids left out). Optional: without it the storefront's
   * "Sold by" lookup by product answers only for seller ids.
   */
  productVendors?(tenantId: string, productIds: string[]): Promise<Record<string, string | null>>;
}

/** Razorpay Route transfer statuses (`created` is treated like `pending`). */
export type TransferStatus = "created" | "pending" | "processed" | "failed" | "reversed" | "partially_reversed";

export interface TransferRequest {
  /** Route linked account id, `acc_XXXXXXXXXXXXXX`. */
  accountId: string;
  /** Paise. */
  amount: number;
  currency: "INR";
  /** Stable per payout attempt (`<payoutId>:<attempt>`); providers that support idempotency keys use it. */
  idempotencyKey: string;
  notes: Record<string, string>;
}

export interface TransferResult {
  id: string;
  status: TransferStatus;
  error?: string | null;
}

/**
 * Money transfer to a seller's linked account, implemented in kit with the shop's own payments credentials
 * (`razorpayRouteTransferPort` in this package does the HTTP part). Throws on network/API errors.
 */
export interface TransferPort {
  transfer(tenantId: string, req: TransferRequest): Promise<TransferResult>;
  /** Current state of an earlier transfer (to settle `processing` payouts). */
  fetch?(tenantId: string, transferId: string): Promise<TransferResult>;
}

export type KycStatus = "none" | "pending" | "verified" | "failed" | "manual_review";

/** Implemented with the kyc module (`status("vendor", vendorId)`). Without it the vendor row's `kycStatus` is used. */
export interface KycStatusPort {
  status(tenantId: string, subjectType: "vendor", subjectId: string): Promise<KycStatus | string | null>;
}

export interface NotifierSendInput {
  tenantId: string;
  channel: "whatsapp" | "sms" | "email";
  /** E.164 phone or email address. */
  to: string;
  /** Notify template key, e.g. "marketplace.vendor_approved". */
  template: string;
  vars: Record<string, string>;
  locale?: string;
}

/** Implemented by the notify module (same shape as orders' NotifierPort). Best effort: failures are logged. */
export interface NotifierPort {
  send(input: NotifierSendInput): Promise<{ logId: string }>;
}

/** Settings namespace `marketplace`. May return a partial object; defaults fill the rest. */
export interface MarketplaceSettingsPort {
  get(tenantId: string): Promise<Partial<MarketplaceSettings> | null | undefined>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
