import { z } from "zod";

// ------------------------------------------------------------------ metals and purities

export const METALS = ["gold", "silver", "platinum"] as const;
export type Metal = (typeof METALS)[number];

/** Purity codes per metal, finest first. The first one is the metal's base (the rate the market quotes). */
export const PURITIES = {
  gold: ["24K", "22K", "18K", "14K"],
  silver: ["999", "925"],
  platinum: ["950"],
} as const satisfies Record<Metal, readonly string[]>;
export type Purity = (typeof PURITIES)[Metal][number];
export const ALL_PURITIES = [...new Set(Object.values(PURITIES).flat())] as unknown as readonly [Purity, ...Purity[]];

/** Fine-metal fraction of each purity (BIS hallmark grades: 22K = 916, 18K = 750, 14K = 585). */
export const PURITY_FACTORS: Record<Metal, Record<string, number>> = {
  gold: { "24K": 0.999, "22K": 0.916, "18K": 0.75, "14K": 0.585 },
  silver: { "999": 0.999, "925": 0.925 },
  platinum: { "950": 0.95 },
};

/** The purity whose rate the others are derived from: gold 24K, silver 999, platinum 950. */
export const basePurity = (metal: Metal): Purity => PURITIES[metal][0];

export const isPurityOf = (metal: Metal, purity: string): purity is Purity => (PURITIES[metal] as readonly string[]).includes(purity);

/** Fine fraction of a purity; throws for a purity the metal doesn't have. */
export function purityFactor(metal: Metal, purity: string): number {
  const f = PURITY_FACTORS[metal]?.[purity];
  if (f === undefined) throw new RangeError(`Unknown purity ${purity} for ${metal}`);
  return f;
}

/** Every (metal, purity) pair in display order. */
export const METAL_PURITIES: { metal: Metal; purity: Purity }[] = METALS.flatMap((metal) => PURITIES[metal].map((purity) => ({ metal, purity: purity as Purity })));

/** A purity's rate from the base purity's rate (paise per gram, rounded): 22K = 24K rate × 0.916 / 0.999. */
export function derivedRate(baseRate: number, metal: Metal, purity: string): number {
  const base = basePurity(metal);
  if (purity === base) return Math.round(baseRate);
  return Math.round((baseRate * purityFactor(metal, purity)) / purityFactor(metal, base));
}

export interface RateEntry {
  metal: Metal;
  purity: Purity;
  /** Paise per gram. */
  ratePerGram: number;
}

export interface ResolvedRate {
  metal: Metal;
  purity: Purity;
  /** Paise per gram; null when neither this purity nor the base purity was entered. */
  ratePerGram: number | null;
  /** "entered" = typed in (or an override), "derived" = worked out from the base purity, null = no rate. */
  source: "entered" | "derived" | null;
}

/**
 * The full rate card from what was entered for a day: an entered purity wins (an override), otherwise it is derived
 * from the metal's base purity when that was entered.
 */
export function resolveRates(entered: readonly RateEntry[]): ResolvedRate[] {
  const byKey = new Map(entered.map((e) => [`${e.metal}:${e.purity}`, e.ratePerGram]));
  return METAL_PURITIES.map(({ metal, purity }) => {
    const own = byKey.get(`${metal}:${purity}`);
    if (own !== undefined) return { metal, purity, ratePerGram: own, source: "entered" as const };
    const base = byKey.get(`${metal}:${basePurity(metal)}`);
    if (base !== undefined) return { metal, purity, ratePerGram: derivedRate(base, metal, purity), source: "derived" as const };
    return { metal, purity, ratePerGram: null, source: null };
  });
}

/** Rate of one purity in a resolved card (null when missing). */
export const rateOf = (card: readonly ResolvedRate[], metal: Metal, purity: string): number | null =>
  card.find((r) => r.metal === metal && r.purity === purity)?.ratePerGram ?? null;

// ------------------------------------------------------------------ weights (grams, 3 decimals = milligrams)

/** Grams (number or numeric string) → whole milligrams. */
export const toMg = (grams: number | string | null | undefined) => Math.round(Number(grams ?? 0) * 1000);
/** Milligrams → grams (3 decimals). */
export const mgToGrams = (mg: number) => Math.round(mg) / 1000;
/** Grams rounded to 3 decimals. */
export const roundGrams = (g: number) => mgToGrams(toMg(g));

/** Net (metal) weight = gross − stones, never below 0. */
export const netWeight = (grossWeight: number | string, stoneWeight: number | string = 0) => mgToGrams(Math.max(0, toMg(grossWeight) - toMg(stoneWeight)));

/** Percent (2 decimals) → basis points. */
const bp = (pct: number) => Math.round(pct * 100);

/** Paise × percent, rounded to whole paise. */
export const pctOf = (amount: number, pct: number) => Math.round((amount * bp(pct)) / 10_000);

// ------------------------------------------------------------------ price

export const MAKING_TYPES = ["per_gram", "percent", "flat"] as const;
export type MakingType = (typeof MAKING_TYPES)[number];

export interface PieceSpec {
  /** Grams. */
  grossWeight: number | string;
  /** Grams of stones (not charged at the metal rate). */
  stoneWeight?: number | string;
  /** Percent of the metal value, e.g. 8 or 8.5. */
  wastagePct?: number | string;
  makingType: MakingType;
  /** per_gram: paise per gram of net weight; percent: basis points of the metal value (12% = 1200); flat: paise. */
  makingValue: number;
  /** Paise. */
  stoneCharges?: number;
}

export interface PriceBreakdown {
  /** Grams. */
  netWeight: number;
  /** Paise per gram used. */
  ratePerGram: number;
  metalValue: number;
  wastage: number;
  making: number;
  stones: number;
  /** metalValue + wastage + making + stones (paise, before rounding). */
  subtotal: number;
  /** total − subtotal (the shop's rounding). */
  rounding: number;
  /** GST-exclusive price (rounded) = the catalogue price. */
  total: number;
  gstRate: number;
  gst: number;
  /** total + gst: what the customer pays. */
  totalWithGst: number;
}

/** Rounds paise to the nearest `step` paise (100 = nearest rupee); a step of 1 or less leaves it alone. */
export const roundToStep = (paise: number, step: number) => (step > 1 ? Math.round(paise / step) * step : Math.round(paise));

/** GST on a GST-exclusive amount (whole paise). */
export const gstOn = (amount: number, gstRate: number) => pctOf(amount, gstRate);

/**
 * The price of a piece at a metal rate, each step rounded to whole paise:
 * - metal value = net weight × rate
 * - wastage = metal value × wastage %
 * - making: per gram × net weight, percent (basis points) of the metal value, or flat
 * - stones as entered
 * The GST-exclusive total is rounded to `roundTo` paise; GST (default 3%) is on that total.
 */
export function priceBreakdown(spec: PieceSpec, ratePerGram: number, opts: { gstRate?: number; roundTo?: number } = {}): PriceBreakdown {
  const netMg = Math.max(0, toMg(spec.grossWeight) - toMg(spec.stoneWeight ?? 0));
  const rate = Math.round(ratePerGram);
  const metalValue = Math.round((netMg * rate) / 1000);
  const wastage = pctOf(metalValue, Number(spec.wastagePct ?? 0));
  const v = Math.round(spec.makingValue);
  const making =
    spec.makingType === "per_gram" ? Math.round((netMg * v) / 1000) : spec.makingType === "percent" ? Math.round((metalValue * v) / 10_000) : v;
  const stones = Math.round(spec.stoneCharges ?? 0);
  const subtotal = metalValue + wastage + making + stones;
  const total = roundToStep(subtotal, opts.roundTo ?? 1);
  const gstRate = opts.gstRate ?? DEFAULT_GST_RATE;
  const gst = gstOn(total, gstRate);
  return { netWeight: mgToGrams(netMg), ratePerGram: rate, metalValue, wastage, making, stones, subtotal, rounding: total - subtotal, total, gstRate, gst, totalWithGst: total + gst };
}

// ------------------------------------------------------------------ old gold (exchange)

/** The shop's buying rate: the sale rate less `buybackPct` percent. */
export const buybackRate = (saleRate: number, buybackPct: number) => Math.max(0, Math.round(saleRate) - pctOf(Math.round(saleRate), buybackPct));

export interface OldGoldLine {
  grossWeight: number | string;
  /** Percent taken off the gross weight for stones, dirt, solder. */
  deductionPct?: number | string;
}

/** Old gold: net = gross × (1 − deduction %) (milligram precision); value = net × buying rate. */
export function oldGoldValue(line: OldGoldLine, ratePerGram: number): { netWeight: number; value: number } {
  const grossMg = toMg(line.grossWeight);
  const ded = Math.min(10_000, Math.max(0, bp(Number(line.deductionPct ?? 0))));
  const netMg = Math.round((grossMg * (10_000 - ded)) / 10_000);
  return { netWeight: mgToGrams(netMg), value: Math.round((netMg * Math.round(ratePerGram)) / 1000) };
}

/** "OG-0003". */
export const formatExchangeNumber = (n: number) => `OG-${String(n).padStart(4, "0")}`;

// ------------------------------------------------------------------ HUID

/** BIS Hallmark Unique ID: 6 characters, A–Z and 0–9. */
export const HUID_RE = /^[A-Z0-9]{6}$/;
export const normalizeHuid = (v: string) => v.replace(/\s+/g, "").toUpperCase();
export const isValidHuid = (v: string | null | undefined) => typeof v === "string" && HUID_RE.test(v);

// ------------------------------------------------------------------ settings

export const DEFAULT_GST_RATE = 3;

/**
 * Settings namespace `jewellery` (apps/api: `settings.define("jewellery", JEWELLERY_SETTINGS_SCHEMA,
 * JEWELLERY_SETTINGS_DEFAULTS)`). `gstRate` (%) is shown on breakdowns (bills charge the catalogue product's rate);
 * `buybackPct` is how far below the sale rate old gold is bought; `roundTo` (paise) rounds the GST-exclusive price
 * (100 = nearest rupee, 1 = no rounding).
 */
export const JEWELLERY_SETTINGS_SCHEMA = z.object({
  gstRate: z.number().min(0).max(28),
  buybackPct: z.number().min(0).max(50),
  roundTo: z.number().int().min(1).max(100_000),
});
export type JewellerySettings = z.infer<typeof JEWELLERY_SETTINGS_SCHEMA>;

export const JEWELLERY_SETTINGS_DEFAULTS: JewellerySettings = { gstRate: DEFAULT_GST_RATE, buybackPct: 0, roundTo: 100 };

/** Stored values over the defaults, key by key; invalid stored values fall back to the default. */
export function resolveJewellerySettings(stored: Partial<Record<keyof JewellerySettings, unknown>> | null | undefined): JewellerySettings {
  const out: Record<string, unknown> = { ...JEWELLERY_SETTINGS_DEFAULTS };
  const shape = JEWELLERY_SETTINGS_SCHEMA.shape;
  for (const key of Object.keys(shape) as (keyof JewellerySettings)[]) {
    const v = stored?.[key];
    if (v === undefined || v === null) continue;
    const parsed = shape[key].safeParse(v);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as JewellerySettings;
}

// ------------------------------------------------------------------ dates

/** "YYYY-MM-DD" plus `days`. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
