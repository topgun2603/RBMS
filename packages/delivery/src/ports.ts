export type { FeatureGatePort } from "@srirealtime/core";

/** Shipping address as stored on the order (orders' `Address`). */
export interface FulfillmentAddress {
  name?: string | null;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  district?: string | null;
  /** 2-digit GST state code. */
  stateCode: string;
  pincode: string;
  country?: string | null;
}

/** What delivery needs to know about an order. Money in paise. */
export interface FulfillmentOrder {
  id: string;
  /** e.g. "ORD/26-27/0001". */
  number: string;
  /** Order status (`placed|confirmed|packed|shipped|delivered|cancelled|returned`). */
  status: string;
  customer: { name: string; phone: string | null; email: string | null };
  shippingAddress: FulfillmentAddress | null;
  /** `price` = paise per unit as charged. */
  lines: { name: string; sku: string | null; qty: number; price: number }[];
  total: number;
  /** `online|cod|cash|upi|card|other`. */
  paymentMethod: string;
  /** Paise still to collect (the COD amount for cash-on-delivery orders). */
  balance: number;
}

export interface FulfillmentInfo {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  /** Our shipment id. */
  shipmentId: string | null;
}

/**
 * Implemented with the orders service (kit). Every write must be idempotent: delivery may call `markShipped` /
 * `markDelivered` more than once (webhook retries, the tracking job), and calls `markShipped` before `markDelivered`
 * so orders can walk packed → shipped → delivered. Failures are logged by delivery and never undo the shipment update.
 * `setFulfillment` with all-null fields (after a staff cancel) means "clear the tracking details".
 */
export interface OrderFulfillmentPort {
  getOrder(tenantId: string, orderId: string): Promise<FulfillmentOrder | null>;
  setFulfillment(tenantId: string, orderId: string, fulfillment: FulfillmentInfo): Promise<void>;
  markShipped(tenantId: string, orderId: string): Promise<void>;
  markDelivered(tenantId: string, orderId: string): Promise<void>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
