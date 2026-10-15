import type { FeatureGatePort } from "@srirealtime/core";
import type { AutoApprove } from "./logic";

export type { FeatureGatePort };

/** Implemented with the orders service: a delivered order of this shopper that contains the product. */
export interface OrdersPort {
  hasDelivered(tenantId: string, userId: string, productId: string): Promise<{ orderId: string } | null>;
}

/** Implemented with the catalogue: the product exists and is sold in the store. */
export interface ProductsPort {
  exists(tenantId: string, productId: string): Promise<boolean>;
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
