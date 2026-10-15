import type { GstRate, LineTotals, TaxBreakupRow } from "@srirealtime/gst";

/** Buyer snapshot frozen on the order. */
export interface OrderCustomer {
  name: string;
  /** E.164 when it is a valid Indian mobile, else as entered. */
  phone: string | null;
  email: string | null;
  /** billing_customers id, when the shop links one (manual orders). */
  customerId?: string | null;
  /** Storefront customer account id. */
  accountId?: string | null;
  /** Message language ("en", "ta"). */
  locale?: string | null;
}

export interface Address {
  name?: string | null;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  district?: string | null;
  /** 2-digit GST state code; the shipping address's code is the place of supply. */
  stateCode: string;
  pincode: string;
  country: string;
}

export interface Fulfillment {
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shipmentId?: string | null;
}

export interface OrderLine {
  /** Catalogue variant id (= invoice `itemId`, inventory `itemId`). */
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  image: string | null;
  qty: number;
  unit: string;
  /** Paise per unit as charged (includes GST when the product is tax-inclusive). */
  price: number;
  /** Paise per unit before GST (`exclusiveOf(price)`). */
  rate: number;
  gstRate: GstRate;
  hsn: string | null;
  taxInclusive: boolean;
  /** Paise, before GST (the coupon share of this line, converted to the exclusive basis). */
  discount: number;
  /** qty × rate. */
  amount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface OrderTotals {
  /** Σ qty × price as charged (what the customer sees in the cart). */
  subtotal: number;
  /** Coupon discount on the goods, as charged. */
  discount: number;
  /** Shipping charged (GST-inclusive), after any free-shipping coupon. */
  shipping: number;
  /** Shipping waived by a free-shipping coupon. */
  shippingWaived: number;
  /** Shipping as a taxed line (composite supply at the principal item's GST rate), null when no shipping is charged. */
  shippingLine: LineTotals | null;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  taxBreakup: TaxBreakupRow[];
  sellerState: string;
  placeOfSupply: string;
  interState: boolean;
}
