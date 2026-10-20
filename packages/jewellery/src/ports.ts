import type { FeatureDef, PermissionDef } from "@srirealtime/core";
import type { JewellerySettings } from "./logic";

/**
 * Writes a piece's price to the catalogue so the counter, the bill editor and the store use it as a normal item price.
 * `price` is GST-exclusive paise; a host whose product stores tax-inclusive prices converts it.
 */
export interface CatalogPort {
  setPrice(tenantId: string, variantId: string, price: number): Promise<void>;
  /** Names of these variants (for a piece created without a name). */
  variants?(tenantId: string, ids: string[]): Promise<{ id: string; name: string }[]>;
}

/** Records the old-gold value as a payment on a bill. */
export interface PaymentPort {
  addPayment(tenantId: string, invoiceId: string, input: { amount: number; method: "other"; date: string; reference: string }): Promise<void>;
}

/**
 * Settings namespace `jewellery` (apps/api: `settings.define("jewellery", JEWELLERY_SETTINGS_SCHEMA,
 * JEWELLERY_SETTINGS_DEFAULTS)`). `get` may return a partial object; defaults fill the rest. `set` enables `PUT /settings`.
 */
export interface JewellerySettingsPort {
  get(tenantId: string): Promise<Partial<JewellerySettings>>;
  set?(tenantId: string, patch: Partial<JewellerySettings>): Promise<unknown>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export const JEWELLERY_FEATURE = "jewellery";
export const JEWELLERY_EXCHANGE_FEATURE = "jewellery.exchange";

export const JEWELLERY_RATES = "jewellery.rates";
export const JEWELLERY_MANAGE = "jewellery.manage";
export const JEWELLERY_EXCHANGE = "jewellery.exchange";

export const JEWELLERY_FEATURES: FeatureDef[] = [
  {
    key: JEWELLERY_FEATURE,
    module: "jewellery",
    label: "Jewellery pricing",
    description: "Today's gold, silver and platinum rates; pieces with weight, purity, making, wastage, stones and HUID, priced from the day's rate.",
  },
  {
    key: JEWELLERY_EXCHANGE_FEATURE,
    module: "jewellery",
    label: "Old gold exchange",
    description: "Buy old gold and silver from customers by weight and purity and set the value against their bill.",
    dependsOn: [JEWELLERY_FEATURE],
    shopToggle: true,
  },
];

export const JEWELLERY_PERMISSIONS: PermissionDef[] = [
  { key: JEWELLERY_RATES, module: "jewellery", label: "Set today's rates", description: "Enter the day's metal rates, which reprices every piece in stock." },
  { key: JEWELLERY_MANAGE, module: "jewellery", label: "Manage pieces", description: "Add and edit pieces (weights, making, wastage, stones, HUID), reprice them and change the settings." },
  { key: JEWELLERY_EXCHANGE, module: "jewellery", label: "Old gold exchange", description: "Buy old gold from customers and apply it to their bills." },
];
