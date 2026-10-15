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

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
