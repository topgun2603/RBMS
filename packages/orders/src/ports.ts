import type { GstRateRule } from "@srirealtime/gst";
import type { OrderPaymentStatus, OrderStatus } from "./schema";
import type { Order } from "./service";

/** A sellable catalogue variant (docs/commerce-batch1.md §1, `CatalogItem`). */
export interface CatalogItem {
  /** Variant id. */
  id: string;
  productId: string;
  /** "Product" or "Product – M / Red". */
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  unit: string;
  /** Exclusive paise. */
  rate: number;
  /** Paise as listed (incl. GST when `taxInclusive`). */
  price: number;
  taxInclusive: boolean;
  /** The rate at `price` (a price-band product's band at its list price). */
  gstRate: number;
  /** Price-band GST (apparel / footwear): the order re-bands each line on its value after coupon / loyalty discounts. */
  gstRule?: GstRateRule | null;
  image: string | null;
  /** Needed for category coupons; optional until the catalogue adds it to CatalogItem. */
  categoryId?: string | null;
}

/** Implemented by the catalogue. Unknown/deleted ids are simply missing from the result. */
export interface CatalogPort {
  getVariants(tenantId: string, ids: string[], opts?: { channel?: string }): Promise<CatalogItem[]>;
}

export interface StockReservation {
  refType: "order";
  refId: string;
  locationId?: string | null;
  lines: { itemId: string; qty: number }[];
  allowBackorder?: boolean;
}

/**
 * Implemented by inventory (reservations, docs/commerce-batch1.md §2). `reserve` is idempotent per ref and throws
 * 409 insufficient_stock `{ itemId, available }[]`, which orders passes through.
 */
export interface StockPort {
  reserve(tenantId: string, reservation: StockReservation): Promise<unknown>;
  release(tenantId: string, refType: "order", refId: string): Promise<unknown>;
  commit(tenantId: string, refType: "order", refId: string): Promise<unknown>;
  /** Puts committed (sold) stock back, reason `return`. Optional: without it returns are noted for a manual adjustment. */
  restock?(tenantId: string, refType: "order", refId: string): Promise<unknown>;
}

/** Implemented with the invoices service (kit). */
export interface InvoicingPort {
  /** Issues a GST invoice for the order (customer snapshot, lines with itemId = variantId, place of supply). */
  createFromOrder(tenantId: string, order: Order): Promise<{ invoiceId: string; number: string }>;
  cancelInvoice(tenantId: string, invoiceId: string, reason: string): Promise<void>;
}

export interface CouponEvaluationLine {
  productId?: string | null;
  categoryId?: string | null;
  amount: number;
}

export type CouponEvaluationResult =
  | {
      valid: true;
      couponId: string;
      discount: number;
      freeShipping: boolean;
      shippingDiscount?: number;
      /** `discount` split over the context lines (same order). */
      lineDiscounts?: number[];
    }
  | { valid: false; reason: string; message?: string };

/** One applied automatic offer (buy X get Y, tier, free gift, bundle), as `priceCart` reports it. */
export interface AppliedOfferResult {
  offerId: string;
  kind: string;
  name: string;
  label: string;
  discount: number;
  /** Same order as the lines. */
  lineDiscounts: number[];
}

/** `priceCart` result: offers and the coupon combined (best for the customer). */
export interface CartPricingResult {
  /** Offers + coupon per line, as charged (same order as the lines). */
  lineDiscounts: number[];
  lines: { offerDiscount: number; couponDiscount: number }[];
  offers: AppliedOfferResult[];
  offerDiscount: number;
  coupon: CouponEvaluationResult | null;
  couponDiscount: number;
  freeShipping: boolean;
}

/** Implemented by the coupons service (same shape). */
export interface CouponPort {
  /**
   * Automatic offers + the coupon in one go (the coupons module's `priceCart`). Optional: without it only the coupon
   * is evaluated (`evaluate`).
   */
  priceCart?(
    tenantId: string,
    input: {
      channel: string;
      lines: { variantId: string; productId: string; categoryId?: string | null; unitPrice: number; qty: number; amount?: number }[];
      shipping?: number;
      couponCode?: string | null;
      customerKey?: string | null;
      isFirstOrder?: boolean;
    },
  ): Promise<CartPricingResult>;
  /** Records the offers an order used; throws 409 offer_invalid when one ran out. `release` frees them too. */
  redeemOffers?(tenantId: string, ref: { refType: "order"; refId: string }, customerKey: string | null | undefined, used: { offerId: string; amount: number }[]): Promise<unknown>;
  evaluate(
    tenantId: string,
    code: string,
    ctx: {
      channel: string;
      subtotal: number;
      shipping?: number;
      lines?: CouponEvaluationLine[];
      customerKey?: string | null;
      isFirstOrder?: boolean;
    },
  ): Promise<CouponEvaluationResult>;
  redeem(
    tenantId: string,
    code: string,
    ref: { refType: "order"; refId: string },
    customerKey: string | null | undefined,
    amount: number,
  ): Promise<unknown>;
  release(tenantId: string, refType: "order", refId: string): Promise<unknown>;
}

export interface NotifierSendInput {
  tenantId: string;
  channel: "whatsapp" | "sms" | "email";
  /** E.164 phone or email address. */
  to: string;
  /** Notify template key, e.g. "order.placed". */
  template: string;
  vars: Record<string, string>;
  locale?: string;
}

/** Implemented by the notify module (same shape as invoices' NotifierPort, plus email). */
export interface NotifierPort {
  send(input: NotifierSendInput): Promise<{ logId: string }>;
}

/** The shop owners/admins to tell about new orders. */
export interface ShopContactPort {
  ownerContacts(tenantId: string): Promise<{ phone?: string | null; email?: string | null }[]>;
}

/** The shop's GST details (billing settings). */
export interface SellerPort {
  get(tenantId: string): Promise<{ stateCode: string | null; legalName?: string | null }>;
}

export interface OrderSettings {
  /** Order number prefix, default "ORD". */
  prefix: string;
  /** When the GST invoice is issued. */
  invoiceOn: "confirmed" | "delivered";
  /** Place orders even when tracked stock is short. */
  allowBackorder: boolean;
  /** Confirm new orders automatically (online orders once paid). */
  autoConfirm: boolean;
  /** Tell the shop owner about new orders (default true). */
  notifyOwner?: boolean;
}

/** Settings namespace `orders` (apps/api). May return a partial object; defaults fill the rest. */
export interface OrderSettingsPort {
  get(tenantId: string): Promise<Partial<OrderSettings> | OrderSettings>;
}

/** Money recorded on an order (online payment, COD collected on delivery, manual payment). */
export interface OrderPaymentEvent {
  tenantId: string;
  orderId: string;
  channel: string;
  /** Storefront customer account (store_customers.id), when the order came from the store. */
  accountId: string | null;
  /** Paise. */
  amount: number;
  source: "online" | "cod" | "manual";
  /** The order's payment status after this payment. */
  paymentStatus: OrderPaymentStatus;
}

export interface OrderStatusChangedEvent {
  tenantId: string;
  order: Order;
  from: OrderStatus;
  to: OrderStatus;
}

/**
 * Optional listeners (kit: storefront customer stats, developer webhooks `order.created` / `order.status_changed`,
 * loyalty earn/reverse). Called after the change is stored; failures are logged and never fail the request.
 */
export interface OrderEventsPort {
  paymentRecorded?(e: OrderPaymentEvent): Promise<void> | void;
  /** A new order was stored (after the placement commit and its messages, before any auto-confirm). */
  created?(tenantId: string, order: Order): Promise<void> | void;
  /** After every successful status change (staff, customer cancel, auto-confirm, courier updates). */
  statusChanged?(e: OrderStatusChangedEvent): Promise<void> | void;
}

/**
 * Loyalty points redeemed at placement (kit: the loyalty service with memberKey = phone, refType "order",
 * refId = orderId). `redeem` returns the discount in paise (it may lower `points` to what it allowed) and throws an
 * AppError when the points can't be used; `reverse` gives the points back (idempotent).
 */
export interface OrderLoyaltyPort {
  redeem(
    tenantId: string,
    input: { phone: string; name?: string | null; points: number; orderId: string; orderAmount: number },
  ): Promise<{ points: number; discount: number }>;
  reverse(tenantId: string, orderId: string): Promise<unknown>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
