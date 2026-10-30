import type { FeatureGatePort } from "@rbms/core";
import type { AutoApprove } from "./logic";
import type { LinkedOrder } from "./staff";

export type { FeatureGatePort };

/** Implemented with the orders service: a delivered order of this shopper that contains the product. */
export interface OrdersPort {
  hasDelivered(tenantId: string, userId: string, productId: string): Promise<{ orderId: string } | null>;
  /**
   * Staff linking an order to a review: the order with this number (any status), whether it is delivered and whether
   * it contains the product. Null when there is no such order. Without it staff can't link orders (never verified).
   */
  findForReview?(tenantId: string, orderNumber: string, productId: string): Promise<LinkedOrder | null>;
}

/** Implemented with the catalogue: the product exists and is sold in the store. */
export interface ProductsPort {
  exists(tenantId: string, productId: string): Promise<boolean>;
  /** CSV import: lowercased SKU or slug → product id, for the keys that match a (non-deleted) product. */
  resolve?(tenantId: string, keys: string[]): Promise<Map<string, string>>;
}

/** Outcome of asking a customer for a review. */
export interface ReviewRequestResult {
  /** "sent": at least one message queued or sent; "skipped": nothing went out (see `reason`). */
  status: "sent" | "skipped";
  /** "duplicate" (already asked for this order), "no_contact", "off", "opted_out", "not_delivered", "error". */
  reason?: string;
  channels: string[];
}

/** Sends the customer of an order a "please review" message with a link (apps/api: customer messages `review.request`). */
export interface ReviewRequestsPort {
  send(tenantId: string, orderId: string): Promise<ReviewRequestResult>;
}

/** Implemented with the shopper's store-customer record (or the auth user): their full name, null when unknown. */
export interface ShopperPort {
  displayName(tenantId: string, userId: string): Promise<string | null>;
}

export interface ReviewSettings {
  /** Which new or edited reviews are published without moderation. Default "verified". */
  autoApprove: AutoApprove;
}

/** Settings namespace `reviews` (apps/api). May return a partial object; defaults fill the rest. */
export interface ReviewSettingsPort {
  get(tenantId: string): Promise<Partial<ReviewSettings>>;
}

/**
 * Outgoing domain events (the developer module's webhooks, wired in kit). Best effort: errors are logged and never
 * fail the review write. Emits `review.created` `{ id, productId, rating, title, status, createdAt }` on every submit.
 */
export interface EventsPort {
  emit(tenantId: string, type: string, data: unknown): Promise<void>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
