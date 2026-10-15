import type { FeatureGatePort } from "@srirealtime/core";
import type { LoyaltySettings } from "./logic";

export type { FeatureGatePort };

/**
 * Settings namespace `loyalty` (apps/api: `settings.define("loyalty", LOYALTY_SETTINGS_SCHEMA, LOYALTY_SETTINGS_DEFAULTS)`).
 * `get` may return a partial object; defaults fill the rest. `set` (tenant layer) enables `PUT /settings`.
 */
export interface LoyaltySettingsPort {
  get(tenantId: string): Promise<Partial<LoyaltySettings>>;
  set?(tenantId: string, patch: Partial<LoyaltySettings>): Promise<unknown>;
}

/** The signed-in shopper's mobile number (store customer record or auth user), any format; null when unknown. */
export interface ShopperPhonePort {
  phone(tenantId: string, userId: string): Promise<string | null>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
