/** Mirrors of @srirealtime/scales responses (UI modules don't import server packages). */

export const SOLD_BY = ["weight", "piece"] as const;
export type SoldBy = (typeof SOLD_BY)[number];

export const VALUE_KINDS = ["weight", "price"] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];

/** A row of `GET /scales/items`: the scale item with the catalogue's current price. */
export interface ScaleItem {
  id: string;
  itemId: string;
  name: string;
  plu: number;
  soldBy: SoldBy;
  tareGrams: number;
  unitLabel: string;
  active: boolean;
  priceUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Paise per unit (per kg for weighed items); null when the catalogue item is gone. */
  price: number | null;
  taxInclusive: boolean | null;
  gstRate: number | null;
  unit: string | null;
  sku: string | null;
  missing: boolean;
}

/** `GET /scales/settings`: the barcode format the scales print. */
export interface ScalesSettings {
  prefixes: string[];
  pluDigits: number;
  valueDigits: number;
  valueKind: ValueKind;
}

/** `GET /scales/items/:itemId/label?weight=`. */
export interface LabelPreview {
  code: string;
  plu: number;
  weightKg: number;
  pricePaise: number | null;
  format: ScalesSettings;
}

/** A billing item from `GET /invoices/items` (the item picker). */
export interface ShopItem {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
}
