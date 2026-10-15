import type { FeatureGatePort, TenantRef } from "@srirealtime/core";

export type { FeatureGatePort };

// ------------------------------------------------------------------ catalogue

/** A catalogue variant as the store needs it. Products that are draft/archived or not on the store channel are still returned (flagged unavailable). */
export interface StoreVariant {
  /** Variant id. */
  id: string;
  productId: string;
  productSlug: string;
  productName: string;
  /** "M / Red"; "" for the default variant. */
  title: string;
  categoryId: string | null;
  /** Paise as listed (incl. GST when `taxInclusive`). */
  price: number;
  mrp: number | null;
  /** Variant image, else the product's first image. */
  image: string | null;
  weightGrams: number | null;
  taxInclusive: boolean;
  gstRate: number;
  /** Product status. */
  status: "active" | "draft" | "archived";
  /** Product channels, e.g. ["store", "billing"]. */
  channels: string[];
}

export interface StoreProductSummary {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  priceMin: number;
  priceMax: number;
  mrp: number | null;
  status: "active" | "draft" | "archived";
  channels: string[];
}

/** Implemented by the catalogue (kit). Unknown or deleted ids are simply missing from the result. */
export interface CatalogPort {
  getVariants(tenantId: string, variantIds: string[]): Promise<StoreVariant[]>;
  getProducts(tenantId: string, productIds: string[]): Promise<StoreProductSummary[]>;
}

// ------------------------------------------------------------------ inventory

export interface VariantAvailability {
  itemId: string;
  /** qty − reserved, summed over locations. */
  available: number;
  /** false = stock isn't tracked (unlimited). Return false too when the shop allows backorders. */
  tracked: boolean;
}

/** Implemented with inventory `availability` (kit). Items missing from the result count as untracked. */
export interface AvailabilityPort {
  availability(tenantId: string, variantIds: string[]): Promise<VariantAvailability[]>;
}

// ------------------------------------------------------------------ coupons

export interface CouponContextLine {
  productId?: string | null;
  categoryId?: string | null;
  amount: number;
}

export type CouponEvaluationResult =
  | { valid: true; couponId: string; discount: number; freeShipping: boolean; lineDiscounts?: number[] }
  | { valid: false; reason: string; message?: string };

/** Implemented by the coupons service (`evaluate`, same shape). */
export interface CouponPort {
  evaluate(
    tenantId: string,
    code: string,
    ctx: {
      channel: string;
      subtotal: number;
      shipping?: number;
      lines?: CouponContextLine[];
      customerKey?: string | null;
      isFirstOrder?: boolean;
    },
  ): Promise<CouponEvaluationResult>;
}

// ------------------------------------------------------------------ delivery

export interface DeliveryOption {
  id: string;
  name: string;
  /** Paise, GST-inclusive. */
  amount: number;
  etaDays: [number, number];
  codAllowed: boolean;
  codFee: number;
}

export interface DeliveryQuote {
  serviceable: boolean;
  options: DeliveryOption[];
}

/** Implemented by the delivery module (docs/commerce-batch2.md §2). */
export interface DeliveryPort {
  quote(
    tenantId: string,
    input: { pincode: string; stateCode?: string; weightGrams: number; subtotal: number; cod: boolean },
  ): Promise<DeliveryQuote>;
}

// ------------------------------------------------------------------ orders

export interface CheckoutOrderAddress {
  name: string;
  phone: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  district?: string | null;
  stateCode: string;
  pincode: string;
  country: string;
}

/** Same shape as orders' `CheckoutInput`. */
export interface CheckoutOrderInput {
  customer: { name: string; phone: string; email?: string | null; accountId: string; locale?: string | null };
  shippingAddress: CheckoutOrderAddress;
  billingAddress?: CheckoutOrderAddress | null;
  lines: { variantId: string; qty: number }[];
  couponCode?: string | null;
  paymentMethod: "online" | "cod";
  /** Paise, GST-inclusive: the delivery option's amount (a free-shipping coupon waives it). */
  shipping: number;
  /** Paise, GST-inclusive: the COD fee (cash on delivery only). Charged separately; a free-shipping coupon doesn't waive it. */
  codFee?: number;
  customerNote?: string | null;
}

/** The parts of orders' `CustomerOrder` the store reads (structurally compatible). */
export interface StoreOrder {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  total: number;
  accessToken: string;
  couponCode: string | null;
  cancelReason: string | null;
  customerNote: string | null;
  shippingAddress: { city: string; pincode: string; stateCode: string } | null;
  lines: { variantId: string; productId: string; name: string; image: string | null; qty: number; unit: string; price: number; total: number }[];
  totals: { subtotal: number; discount: number; shipping: number; shippingWaived?: number; codFee?: number; roundOff?: number; total: number };
  fulfillment: { carrier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null };
  events: { type: string; fromStatus: string | null; toStatus: string | null; message: string | null; createdAt: Date }[];
  placedAt: Date;
  confirmedAt?: Date | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  cancelledAt?: Date | null;
}

export interface StoreOrderSummary {
  id: string;
  number: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  itemCount: number;
  total: number;
  placedAt: Date;
}

/**
 * Implemented by the orders service (kit). `accountId` = store_customers.id. `cancelForCustomer` does not exist in
 * orders yet: the kit can implement it as `getForCustomer` (ownership) + `updateStatus(…, { status: "cancelled", note: reason })`.
 */
export interface OrdersPort {
  createFromCheckout(tenant: TenantRef, input: CheckoutOrderInput): Promise<StoreOrder>;
  listForCustomer(tenantId: string, accountId: string, query: { limit?: number; offset?: number }): Promise<{ items: StoreOrderSummary[]; total: number }>;
  getForCustomer(tenantId: string, accountId: string, orderId: string): Promise<StoreOrder>;
  getByToken(token: string, tenantId: string): Promise<StoreOrder>;
  cancelForCustomer(tenantId: string, accountId: string, orderId: string, reason: string): Promise<StoreOrder>;
}

// ------------------------------------------------------------------ settings, branding

export interface StoreSettings {
  open: boolean;
  closedMessage: string;
  codEnabled: boolean;
  /** Paise; 0 = no limit. */
  codMaxAmount: number;
  /** Paise, on goods after discount. */
  minOrderValue: number;
  contactPhone: string;
  contactEmail: string;
  social: { instagram?: string; facebook?: string; youtube?: string; whatsapp?: string };
  policies: { shipping?: string; returns?: string; privacy?: string; terms?: string };
}

/** Settings namespace `store` (apps/api). May return a partial object; defaults fill the rest. */
export interface StoreSettingsPort {
  get(tenantId: string): Promise<Partial<StoreSettings>>;
}

/** The shop's branding (kit: branding service + business name). */
export interface BrandingPort {
  get(tenantId: string): Promise<{ name: string | null; logoUrl: string | null; css: string }>;
}

/** Optional: the signed-in user's profile, used to prefill a new store customer. */
export interface ShopperProfilePort {
  get(userId: string): Promise<{ name?: string | null; phone?: string | null; email?: string | null } | null>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
