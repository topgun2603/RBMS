import { z } from "zod";
import { DEFAULT_SCALE_FORMAT, scaleFormatProblem, type ParsedScaleBarcode, type ScaleBarcodeFormat } from "./barcode";
import type { ScaleSoldBy } from "./schema";

// ------------------------------------------------------------------ settings

/**
 * Settings namespace `scales` (apps/api: `settings.define("scales", SCALES_SETTINGS_SCHEMA, SCALES_SETTINGS_DEFAULTS)`):
 * the barcode format the shop's scales print. Prefix length + `pluDigits` + `valueDigits` must be 12 (checked on save
 * and when resolving; the schema itself stays a plain object for the settings host).
 */
export const SCALES_SETTINGS_SCHEMA = z.object({
  prefixes: z
    .array(z.string().trim().regex(/^\d{1,3}$/, "1 to 3 digits"))
    .min(1)
    .max(20),
  pluDigits: z.number().int().min(1).max(6),
  valueDigits: z.number().int().min(3).max(7),
  valueKind: z.enum(["weight", "price"]),
});
export type ScalesSettings = z.infer<typeof SCALES_SETTINGS_SCHEMA>;

export const SCALES_SETTINGS_DEFAULTS: ScalesSettings = {
  prefixes: [...DEFAULT_SCALE_FORMAT.prefixes],
  pluDigits: DEFAULT_SCALE_FORMAT.pluDigits,
  valueDigits: DEFAULT_SCALE_FORMAT.valueDigits,
  valueKind: DEFAULT_SCALE_FORMAT.valueKind,
};

/**
 * Stored values over the defaults, key by key; invalid stored values fall back to the default. If the result isn't a
 * usable format as a whole (digits don't add up to 12), the defaults apply.
 */
export function resolveScalesSettings(stored: Partial<Record<keyof ScalesSettings, unknown>> | null | undefined): ScalesSettings {
  const out: Record<string, unknown> = { ...SCALES_SETTINGS_DEFAULTS, prefixes: [...SCALES_SETTINGS_DEFAULTS.prefixes] };
  const shape = SCALES_SETTINGS_SCHEMA.shape;
  for (const key of Object.keys(shape) as (keyof ScalesSettings)[]) {
    const v = stored?.[key];
    if (v === undefined || v === null) continue;
    const parsed = shape[key].safeParse(v);
    if (parsed.success) out[key] = parsed.data;
  }
  const s = out as ScalesSettings;
  return scaleFormatProblem(s) === null ? s : { ...SCALES_SETTINGS_DEFAULTS, prefixes: [...SCALES_SETTINGS_DEFAULTS.prefixes] };
}

/** The barcode format of resolved settings (a fresh copy). */
export const formatOf = (s: ScalesSettings): ScaleBarcodeFormat => ({
  prefixes: [...s.prefixes],
  pluDigits: s.pluDigits,
  valueDigits: s.valueDigits,
  valueKind: s.valueKind,
});

// ------------------------------------------------------------------ PLU numbers

/** Next PLU to hand out: one past the highest in use, else the lowest gap; null when 1…max are all taken. */
export function nextFreePlu(used: readonly number[], max: number): number | null {
  const set = new Set(used.filter((n) => Number.isInteger(n) && n >= 1 && n <= max));
  let top = 0;
  for (const n of set) if (n > top) top = n;
  if (top < max) return top + 1;
  for (let n = 1; n <= max; n++) if (!set.has(n)) return n;
  return null;
}

// ------------------------------------------------------------------ quantities

export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

export interface ScaleLine {
  /** Sold quantity: kg for weighed items, pieces for counted ones. */
  qty: number;
  /** Line amount from the label (paise), for price labels: the bill should charge exactly this. */
  price?: number;
}

/**
 * Quantity of a scanned label for an item.
 * - weight label, weighed item: kg minus the item's tare (packaging the scale didn't take off)
 * - weight label, piece item: the value is a count (scales print counts for "by count" PLUs)
 * - price label: qty = amount / unit price (3 decimals; whole pieces for piece items) and the label amount is kept
 * Null when no positive quantity comes out (or a price label meets an item without a price).
 */
export function lineFromLabel(parsed: ParsedScaleBarcode, item: { soldBy: ScaleSoldBy; tareGrams: number }, unitPrice: number): ScaleLine | null {
  if (parsed.pricePaise !== undefined) {
    if (!(unitPrice > 0)) return null;
    const raw = parsed.pricePaise / unitPrice;
    const qty = item.soldBy === "piece" ? Math.max(1, Math.round(raw)) : roundQty(raw);
    return qty > 0 ? { qty, price: parsed.pricePaise } : null;
  }
  if (item.soldBy === "piece") return parsed.value > 0 ? { qty: parsed.value } : null;
  const grams = parsed.value - Math.max(0, item.tareGrams);
  const qty = roundQty(grams / 1000);
  return qty > 0 ? { qty } : null;
}

// ------------------------------------------------------------------ PLU file

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export interface PluFileRow {
  plu: number;
  name: string;
  /** Paise per unit (per kg for weighed items). */
  price: number;
  tareGrams: number;
  unitLabel: string;
}

/** CSV for loading into scale software: PLU, name, price per unit in rupees, tare in grams, unit. CRLF lines. */
export function pluCsv(rows: readonly PluFileRow[]): string {
  const lines = [["PLU", "Name", "Price per unit (Rs)", "Tare (g)", "Unit"].join(",")];
  for (const r of rows) lines.push([r.plu, csvCell(r.name), (r.price / 100).toFixed(2), r.tareGrams, csvCell(r.unitLabel)].join(","));
  return `${lines.join("\r\n")}\r\n`;
}
