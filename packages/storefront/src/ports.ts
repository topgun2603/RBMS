import type { FeatureGatePort, TenantRef } from "@rbms/core";
import type { GstRateRule } from "@rbms/gst";

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
  /** The rate at `price` (a price-band product's band at its list price). */
  gstRate: number;
  /** Price-band GST (apparel / footwear); the estimate re-bands the line after its discount. */
  gstRule?: GstRateRule | null;
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
  /** For offer badges on the product page (category-scoped offers). Optional for older ports. */
  categoryId?: string | null;
  /** Live variant ids (bundle items that take any variant list their choices). Optional for older ports. */
  variantIds?: string[];
  /** The product's option names in order ("Size", "Length"): labels the variant pick of a bundle item. Optional for older ports. */
  optionNames?: string[];
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

/** A cart line as automatic offers see it. */
export interface OfferPricingLine {
  variantId: string;
  productId: string;
  categoryId?: string | null;
  unitPrice: number;
  qty: number;
  amount?: number;
}

export type OfferRewardView =
  | { type: "units"; qty: number; percent: number }
  | { type: "percent"; value: number }
  | { type: "flat"; value: number }
  | { type: "gift"; productId: string; variantId: string; qty: number }
  | { type: "bundle" };

/** "Add 1 more to get 1 free" (coupons' OfferNudge). */
export interface OfferNudge {
  offerId: string;
  kind: string;
  name: string;
  label: string;
  addQty?: number;
  addAmount?: number;
  reward: OfferRewardView;
  /** "all" = anything in the shop counts towards it. */
  scope?: string;
  productIds?: string[];
}

export interface OfferGift {
  offerId: string;
  name: string;
  productId: string;
  variantId: string;
  qty: number;
  unlocked: boolean;
  inCart: boolean;
  remaining: number;
}

/** coupons' `priceCart` result (the parts the store reads). */
export interface CartPricingResult {
  /** Same order as the lines sent. */
  lines: { offerDiscount: number; couponDiscount: number; discount: number; offerIds: string[] }[];
  offers: { offerId: string; kind: string; name: string; label: string; discount: number; applications: number }[];
  offerDiscount: number;
  coupon: CouponEvaluationResult | null;
  couponDiscount: number;
  freeShipping: boolean;
  nudges: OfferNudge[];
  gifts: OfferGift[];
}

/** A live offer as the store shows it (coupons' PublicOffer). `config` depends on `kind`. */
export interface PublicOfferView {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  slug: string | null;
  imageUrl: string | null;
  label: string;
  config: unknown;
  appliesTo: string;
  endsAt: Date | null;
}

/** Implemented by the coupons service (`offers`). */
export interface OffersViewPort {
  forProduct(tenantId: string, p: { productId: string; categoryId?: string | null }): Promise<PublicOfferView[]>;
  bundles(tenantId: string, opts?: { productId?: string; limit?: number }): Promise<PublicOfferView[]>;
  bundle(tenantId: string, idOrSlug: string): Promise<PublicOfferView>;
}

/** Implemented by the coupons service (`evaluate`, same shape). */
export interface CouponPort {
  /** Automatic offers + the coupon (coupons' `priceCart`). Without it only the coupon is evaluated. */
  priceCart?(
    tenantId: string,
    input: { channel: string; lines: OfferPricingLine[]; couponCode?: string | null; customerKey?: string | null; isFirstOrder?: boolean },
  ): Promise<CartPricingResult>;
  /** Offer badges and bundles for the store pages. */
  offers?: OffersViewPort;
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
  /** Free-delivery threshold (paise of goods after discounts) for the cart bar: this pincode's zone, or everywhere. */
  freeShipping?(tenantId: string, input: { pincode?: string | null }): Promise<{ threshold: number | null; scope: "zone" | "shop" }>;
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
  /** Null for a pickup order. */
  shippingAddress: CheckoutOrderAddress | null;
  fulfilment?: "delivery" | "pickup";
  billingAddress?: CheckoutOrderAddress | null;
  lines: { variantId: string; qty: number }[];
  couponCode?: string | null;
  paymentMethod: "online" | "cod";
  /** Paise, GST-inclusive: the delivery option's amount (a free-shipping coupon waives it). */
  shipping: number;
  /** Paise, GST-inclusive: the COD fee (cash on delivery only). Charged separately; a free-shipping coupon doesn't waive it. */
  codFee?: number;
  customerNote?: string | null;
  /** Loyalty points to redeem; orders prices the discount (a discount on the goods' taxable value). */
  loyaltyPoints?: number;
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
  totals: {
    subtotal: number;
    discount: number;
    shipping: number;
    shippingWaived?: number;
    codFee?: number;
    roundOff?: number;
    total: number;
    /** Loyalty points redeemed and their discount (paise); absent when none were used. */
    loyalty?: { points: number; discount: number };
  };
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
  /** Home delivery (default on). Off: pickup only. */
  deliveryEnabled?: boolean;
  /** Pickup / takeaway: the shopper collects at the shop (default off). */
  pickupEnabled?: boolean;
  /** Where and when to collect ("Counter 1, ready in 20 minutes"). */
  pickupNote?: string;
  contactPhone: string;
  contactEmail: string;
  social: { instagram?: string; facebook?: string; youtube?: string; whatsapp?: string };
  policies: { shipping?: string; returns?: string; privacy?: string; terms?: string };
  /** @rbms/verticals pack id; "" = the app's default. */
  businessType?: string;
  /** Show the storefront's "Install <shop> app" banner (default on). */
  installBanner?: boolean;
  /** Trust badges / announcement fallback overrides (storefront-ui lib/trust.ts); missing = derived. */
  trust?: StoreTrustSettings;
}

/** The owner's trust settings: "auto" = derived from the returns policy and the trade; own badges replace the derived ones. */
export interface StoreTrustSettings {
  returns: "auto" | "easy" | "replace" | "exchange" | "none";
  payment: "auto" | "online" | "confirm" | "visit";
  badges: { title: string; text: string; titleTa: string; textTa: string }[];
}

/** Settings namespace `store` (apps/api). May return a partial object; defaults fill the rest. */
export interface StoreSettingsPort {
  get(tenantId: string): Promise<Partial<StoreSettings>>;
}

/** The shop's branding (kit: branding service + business name). */
export interface BrandingPort {
  get(tenantId: string): Promise<{
    name: string | null;
    logoUrl: string | null;
    css: string;
    /** Theme variants (header, hero, card, imageRatio…) from the brand tokens. */
    theme?: Record<string, string>;
    /** Font families the CSS uses (the store loads them). */
    fonts?: string[];
  }>;
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
