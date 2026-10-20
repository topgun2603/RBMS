import type { FeatureDef, PermissionDef } from "@srirealtime/core";
import type { ScalesSettings } from "./logic";

/** A catalogue variant as the scales module needs it (catalogue's `VariantLookup` is assignable to it). */
export interface ScaleCatalogVariant {
  id: string;
  /** "Product" or "Product – Variant". */
  name: string;
  productName: string;
  title: string;
  /** Paise per unit (per kg for weighed items), incl. GST when `taxInclusive`. */
  price: number;
  taxInclusive: boolean;
  gstRate: number;
  unit: string;
  sku: string | null;
  barcode: string | null;
}

/**
 * The catalogue (apps/api: `variants` → `catalogue.service.getVariants(tenantId, ids)`, `setPrice` →
 * `catalogue.service.updateVariant(tenantId, variantId, { price })`). Unknown ids are left out of `variants`.
 */
export interface CatalogPort {
  variants(tenantId: string, ids: string[]): Promise<ScaleCatalogVariant[]>;
  setPrice(tenantId: string, variantId: string, price: number): Promise<void>;
}

/**
 * Settings namespace `scales` (apps/api: `settings.define("scales", SCALES_SETTINGS_SCHEMA, SCALES_SETTINGS_DEFAULTS)`).
 * `get` may return a partial object; defaults fill the rest. `set` (tenant layer) enables `PUT /settings`.
 */
export interface ScalesSettingsPort {
  get(tenantId: string): Promise<Partial<ScalesSettings>>;
  set?(tenantId: string, patch: Partial<ScalesSettings>): Promise<unknown>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export const SCALES_FEATURE = "scales";
export const SCALES_MANAGE = "scales.manage";
/** Billing staff may resolve scale labels at the counter. */
export const INVOICES_CREATE = "invoices.create";

export const SCALES_FEATURES: FeatureDef[] = [
  {
    key: SCALES_FEATURE,
    module: "scales",
    label: "Weighing scales",
    description: "Sell by weight: item codes (PLU) for the scale, the daily price list and scanning the scale's barcode labels at the counter.",
    shopToggle: true,
  },
];

export const SCALES_PERMISSIONS: PermissionDef[] = [
  {
    key: SCALES_MANAGE,
    module: "scales",
    label: "Manage weighed items",
    description: "Item codes (PLU) for the scale, today's prices, the PLU file and the barcode format.",
  },
];
