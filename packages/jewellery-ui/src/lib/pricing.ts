/**
 * Client copy of @srirealtime/jewellery's pure pricing (UI modules don't import back-end packages). Used for the live
 * previews only; the server's numbers are the ones written to the catalogue. Keep in step with
 * packages/jewellery/src/logic.ts (module.test.ts checks the same worked examples).
 */

export const METALS = ["gold", "silver", "platinum"] as const;
export type Metal = (typeof METALS)[number];

export const PURITIES = {
  gold: ["24K", "22K", "18K", "14K"],
  silver: ["999", "925"],
  platinum: ["950"],
} as const satisfies Record<Metal, readonly string[]>;
export type Purity = (typeof PURITIES)[Metal][number];

export const PURITY_FACTORS: Record<Metal, Record<string, number>> = {
  gold: { "24K": 0.999, "22K": 0.916, "18K": 0.75, "14K": 0.585 },
  silver: { "999": 0.999, "925": 0.925 },
  platinum: { "950": 0.95 },
};

export const MAKING_TYPES = ["per_gram", "percent", "flat"] as const;
export type MakingType = (typeof MAKING_TYPES)[number];

export const basePurity = (metal: Metal): Purity => PURITIES[metal][0];
export const isPurityOf = (metal: Metal, purity: string): purity is Purity => (PURITIES[metal] as readonly string[]).includes(purity);
export const METAL_PURITIES: { metal: Metal; purity: Purity }[] = METALS.flatMap((metal) => PURITIES[metal].map((purity) => ({ metal, purity: purity as Purity })));

export function derivedRate(baseRate: number, metal: Metal, purity: string): number {
  const base = basePurity(metal);
  if (purity === base) return Math.round(baseRate);
  return Math.round((baseRate * (PURITY_FACTORS[metal][purity] ?? 0)) / PURITY_FACTORS[metal][base]!);
}

export interface ResolvedRate {
  metal: Metal;
  purity: Purity;
  ratePerGram: number | null;
  source: "entered" | "derived" | null;
}

export function resolveRates(entered: readonly { metal: Metal; purity: Purity; ratePerGram: number }[]): ResolvedRate[] {
  const byKey = new Map(entered.map((e) => [`${e.metal}:${e.purity}`, e.ratePerGram]));
  return METAL_PURITIES.map(({ metal, purity }) => {
    const own = byKey.get(`${metal}:${purity}`);
    if (own !== undefined) return { metal, purity, ratePerGram: own, source: "entered" as const };
    const base = byKey.get(`${metal}:${basePurity(metal)}`);
    if (base !== undefined) return { metal, purity, ratePerGram: derivedRate(base, metal, purity), source: "derived" as const };
    return { metal, purity, ratePerGram: null, source: null };
  });
}

export const rateOf = (card: readonly ResolvedRate[], metal: Metal, purity: string): number | null =>
  card.find((r) => r.metal === metal && r.purity === purity)?.ratePerGram ?? null;

export const toMg = (grams: number | string | null | undefined) => Math.round(Number(grams ?? 0) * 1000);
export const mgToGrams = (mg: number) => Math.round(mg) / 1000;
export const netWeight = (gross: number, stone = 0) => mgToGrams(Math.max(0, toMg(gross) - toMg(stone)));
export const pctOf = (amount: number, pct: number) => Math.round((amount * Math.round(pct * 100)) / 10_000);
export const roundToStep = (paise: number, step: number) => (step > 1 ? Math.round(paise / step) * step : Math.round(paise));

export interface PieceSpec {
  grossWeight: number;
  stoneWeight?: number;
  wastagePct?: number;
  makingType: MakingType;
  /** per_gram: paise per gram; percent: basis points; flat: paise. */
  makingValue: number;
  stoneCharges?: number;
}

export function priceBreakdown(spec: PieceSpec, ratePerGram: number, opts: { gstRate?: number; roundTo?: number } = {}) {
  const netMg = Math.max(0, toMg(spec.grossWeight) - toMg(spec.stoneWeight ?? 0));
  const rate = Math.round(ratePerGram);
  const metalValue = Math.round((netMg * rate) / 1000);
  const wastage = pctOf(metalValue, spec.wastagePct ?? 0);
  const v = Math.round(spec.makingValue);
  const making = spec.makingType === "per_gram" ? Math.round((netMg * v) / 1000) : spec.makingType === "percent" ? Math.round((metalValue * v) / 10_000) : v;
  const stones = Math.round(spec.stoneCharges ?? 0);
  const subtotal = metalValue + wastage + making + stones;
  const total = roundToStep(subtotal, opts.roundTo ?? 1);
  const gstRate = opts.gstRate ?? 3;
  const gst = pctOf(total, gstRate);
  return { netWeight: mgToGrams(netMg), ratePerGram: rate, metalValue, wastage, making, stones, subtotal, rounding: total - subtotal, total, gstRate, gst, totalWithGst: total + gst };
}

export const buybackRate = (saleRate: number, buybackPct: number) => Math.max(0, Math.round(saleRate) - pctOf(Math.round(saleRate), buybackPct));

export function oldGoldValue(line: { grossWeight: number; deductionPct?: number }, ratePerGram: number) {
  const grossMg = toMg(line.grossWeight);
  const ded = Math.min(10_000, Math.max(0, Math.round((line.deductionPct ?? 0) * 100)));
  const netMg = Math.round((grossMg * (10_000 - ded)) / 10_000);
  return { netWeight: mgToGrams(netMg), value: Math.round((netMg * Math.round(ratePerGram)) / 1000) };
}

export const HUID_RE = /^[A-Z0-9]{6}$/;
export const normalizeHuid = (v: string) => v.replace(/\s+/g, "").toUpperCase();
export const isValidHuid = (v: string) => HUID_RE.test(v);
