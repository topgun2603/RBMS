/**
 * Price-dependent GST rates (pure, browser-safe).
 *
 * From 22 September 2025, Notification No. 9/2025-Central Tax (Rate) dated 17.09.2025 (G.S.R. 641(E); mirrored by
 * 9/2025-Integrated Tax (Rate) and the State notifications) taxes these goods by their sale value:
 *
 *   Schedule I (2.5% CGST + 2.5% SGST = 5%)
 *     S.No. 388  Ch. 61  "Articles of apparel and clothing accessories, knitted or crocheted, of sale value not
 *                        exceeding Rs 2500 per piece"
 *     S.No. 389  Ch. 62  "Articles of apparel and clothing accessories, not knitted or crocheted, of sale value not
 *                        exceeding Rs. 2500 per piece"
 *     S.No. 390  Ch. 63 (other than 6305 32 00, 6305 33 00, 6309) "Other made up textile articles, sets, of sale value
 *                        not exceeding Rs. 2500 per piece"
 *     S.No. 392  6401–6405 "Footwear of sale value not exceeding Rs.2500 per pair"
 *   Schedule II (9% CGST + 9% SGST = 18%)
 *     S.No. 197/198/199 the same Ch. 61 / 62 / 63 goods "of sale value exceeding Rs. 2500 per piece", and footwear of
 *     headings 6401–6405 other than the Schedule I entry (i.e. exceeding Rs. 2500 per pair).
 *
 * "Sale value" is the value of supply under Section 15 of the CGST Act: the transaction value, which excludes the GST
 * itself (s.15(2)(a) only adds other taxes), and from which a discount given before or at the time of supply and
 * recorded on the invoice is excluded (s.15(3)(a); CBIC GST flyer "Valuation", 2017). So the test is on the taxable
 * value per piece / pair AFTER the bill's discounts and BEFORE GST: ₹2,999 marked down to ₹2,399 is 5%; ₹2,500.00 is
 * still 5% ("not exceeding"); ₹2,500.01 is 18%. Each piece is tested on its own; a bill of several pieces is not
 * aggregated.
 *
 * Tax-inclusive (MRP) prices: the taxable value is what is left after taking the GST out, and which GST depends on the
 * taxable value. For an inclusive price P per piece:
 *   P ≤ ₹2,625.00 (= 2,500 × 1.05)  → 5%, taxable = P / 1.05 ≤ ₹2,500 — consistent.
 *   P > ₹2,950.00 (= 2,500 × 1.18)  → 18%, taxable = P / 1.18 > ₹2,500 — consistent.
 *   ₹2,625 < P ≤ ₹2,950 ("dead band") → NO rate is consistent: at 5% the taxable value is above ₹2,500 (so 18% is
 *     due), at 18% it is at or below ₹2,500 (so 5% is due). This module charges the higher rate there (`deadBand:
 *     true`): it never under-pays tax (an under-payment is a demand with interest and penalty; tax collected in excess
 *     must simply be paid over, s.76), and the admin editor warns so the shop can re-price to ≤ ₹2,625 or > ₹2,950.
 *     Brands publish the same two cut-offs (e.g. "MRP up to ₹2,625 attract 5% GST, while those above ₹2,950 are taxed
 *     at 18%").
 *
 * Sources: the schedule text of 9/2025-CT(R) (as reproduced at cmaknowledge.in, "GST Rate Changes Effective
 * 22.09.2025") and CBIC's copy of 9/2025-Integrated Tax (Rate); CGST Act s.15; jockey.in "GST Regulations" for the
 * published MRP cut-offs. The notification has been amended since (19/2025-CT(R); May 2026, Finance Act 2026
 * alignment): re-check the entries before changing the rule. docs/verticals.md "Price-band GST" has the summary.
 *
 * All amounts are integer paise. Quantities may have 3 decimals; comparisons are done in integers
 * (`taxable × 1000 ≤ threshold × qty-in-thousandths`), so a 3-piece line of ₹7,500.00 taxable is exactly at the
 * threshold.
 */
import type { GstRate } from "./gst";

/** A GST rate that depends on the taxable value per unit (piece / pair): `below` up to and including `threshold`, `above` beyond. */
export interface GstPriceBandRule {
  kind: "price-band";
  /** Paise of taxable value (after discount, before GST) per unit; "not exceeding" it → `below`. */
  threshold: number;
  below: GstRate;
  above: GstRate;
}

/** A rate rule a product can carry instead of (alongside) its single `gstRate`. Only price bands exist today. */
export type GstRateRule = GstPriceBandRule;

/**
 * Apparel and clothing accessories (Ch. 61, 62), other made-up textile articles and sets (Ch. 63, except 6305 32 00,
 * 6305 33 00 and 6309) and footwear (6401–6405): 5% up to ₹2,500 per piece / pair, 18% above (from 22.09.2025).
 */
export const APPAREL_FOOTWEAR_GST_RULE: GstPriceBandRule = Object.freeze({ kind: "price-band", threshold: 250_000, below: 5, above: 18 });

/** True for a well-formed rule (used by API validators; rates must be GST slabs, `below` < `above`). */
export function isGstRateRule(v: unknown, slabs: readonly number[] = [0, 0.25, 3, 5, 12, 18, 28]): v is GstRateRule {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    r.kind === "price-band" &&
    typeof r.threshold === "number" &&
    Number.isInteger(r.threshold) &&
    r.threshold > 0 &&
    slabs.includes(r.below as number) &&
    slabs.includes(r.above as number) &&
    (r.below as number) < (r.above as number)
  );
}

/** Half away from zero. */
const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));
const taxableIn = (total: number, gstRate: number) => {
  const bp = Math.round(gstRate * 100);
  return bp ? round((total * 10_000) / (10_000 + bp)) : total;
};
/** qty in thousandths (≥ 1). */
const milliOf = (qty: number) => Math.max(Math.round((qty || 1) * 1000), 1);
/** `taxable` (for `qty` units) is within the band: taxable / qty ≤ threshold, exactly. */
const within = (rule: GstPriceBandRule, taxable: number, qty: number) => taxable * 1000 <= rule.threshold * milliOf(qty);

const isRule = (r: unknown): r is GstRateRule => !!r && typeof r === "object" && (r as GstRateRule).kind === "price-band";

/**
 * The GST rate for a unit taxable value (paise, after discount, before GST). A plain rate is returned as is; a rule
 * picks its band. With `qty`, `unitTaxableValue` is the whole line's taxable value and the per-unit test is exact.
 */
export function effectiveGstRate(rateOrRule: number | GstRateRule | null | undefined, unitTaxableValue: number, qty = 1): number {
  if (!isRule(rateOrRule)) return typeof rateOrRule === "number" ? rateOrRule : 0;
  return within(rateOrRule, unitTaxableValue, qty) ? rateOrRule.below : rateOrRule.above;
}

export interface InclusiveRateResolution {
  rate: number;
  /** Taxable value inside the inclusive amount at `rate`. */
  taxable: number;
  /**
   * The inclusive amount is in the band where no rate is consistent (₹2,625 < P ≤ ₹2,950 per piece for the apparel
   * rule): the higher rate is charged. Re-price to fix.
   */
  deadBand: boolean;
}

/**
 * The GST rate for a GST-inclusive amount (paise; the whole line's charged amount after discount when `qty` is given):
 * the lower rate when the taxable value it leaves is within the threshold, else the higher one — see the module note
 * for the dead band between `threshold × (1 + below)` and `threshold × (1 + above)`.
 */
export function gstRateForInclusive(rateOrRule: number | GstRateRule | null | undefined, inclusive: number, qty = 1): InclusiveRateResolution {
  if (!isRule(rateOrRule)) {
    const rate = typeof rateOrRule === "number" ? rateOrRule : 0;
    return { rate, taxable: taxableIn(inclusive, rate), deadBand: false };
  }
  const low = taxableIn(inclusive, rateOrRule.below);
  if (within(rateOrRule, low, qty)) return { rate: rateOrRule.below, taxable: low, deadBand: false };
  const high = taxableIn(inclusive, rateOrRule.above);
  return { rate: rateOrRule.above, taxable: high, deadBand: within(rateOrRule, high, qty) };
}

/** The rate for one unit at a catalogue price (inclusive or exclusive of GST), before any discount: what a shelf / product page shows. */
export function gstRateAtPrice(rateOrRule: number | GstRateRule | null | undefined, price: number, taxInclusive: boolean): number {
  return taxInclusive ? gstRateForInclusive(rateOrRule, price).rate : effectiveGstRate(rateOrRule, price);
}

/** Inclusive prices per unit (paise) where a rule has no consistent rate: (threshold × (100 + below)%, threshold × (100 + above)%]. Null for none. */
export function deadBandOf(rule: GstRateRule | null | undefined): { from: number; to: number } | null {
  if (!isRule(rule)) return null;
  const from = round((rule.threshold * (10_000 + Math.round(rule.below * 100))) / 10_000);
  const to = round((rule.threshold * (10_000 + Math.round(rule.above * 100))) / 10_000);
  return to > from ? { from, to } : null;
}

/**
 * The rate a line is taxed at: its `gstRate`, or with a `gstRule` the band of its unit taxable value after the line
 * discount — from `inclusiveTotal` (tax-inclusive lines) or `qty × rate − discount`.
 */
export function lineGstRate(line: {
  qty: number;
  rate: number;
  discount?: number | null;
  gstRate: number;
  gstRule?: GstRateRule | null;
  inclusiveTotal?: number | null;
  unitFactor?: number | null;
}): number {
  if (!isRule(line.gstRule)) return line.gstRate;
  // The band is per piece: a box of 12 is tested on its value over 12 pieces (base units).
  const pieces = baseQtyOf(line);
  if (line.inclusiveTotal !== undefined && line.inclusiveTotal !== null) return gstRateForInclusive(line.gstRule, line.inclusiveTotal, pieces).rate;
  const milli = Math.round(line.qty * 1000);
  const amount = round((milli * line.rate) / 1000);
  return effectiveGstRate(line.gstRule, amount - (line.discount ?? 0), pieces);
}

/**
 * A line's quantity in the item's base (stock) unit: `qty × unitFactor` to 3 decimals (docs/price-lists-units.md).
 * Lines without an alternate unit return `qty` unchanged.
 */
export function baseQtyOf(line: { qty: number; unitFactor?: number | null }): number {
  const f = line.unitFactor;
  if (f === undefined || f === null || !(f > 0) || f === 1) return line.qty;
  return Math.round(line.qty * f * 1000) / 1000;
}

/** The unit GST reports (HSN summary UQC) count a line in: the base unit for alternate-unit lines. */
export function baseUnitOf(line: { unit?: string | null; unitFactor?: number | null; baseUnit?: string | null }): string | null {
  return line.unitFactor && line.unitFactor !== 1 && line.baseUnit ? line.baseUnit : (line.unit ?? null);
}

/**
 * The price-band rule an HSN code falls under, or null: chapters 61 and 62 (apparel and clothing accessories), chapter
 * 63 other than 6305 32 00, 6305 33 00 and 6309 (other made-up textile articles, sets) and headings 6401–6405
 * (footwear) — Notification 9/2025-CT(R) Sch. I S.No. 388/389/390/392, Sch. II S.No. 197/198/199 and footwear. 6406
 * (parts of footwear) is not covered. A 2-digit code ("61") matches its chapter; "64" alone is not enough (6406).
 */
export function priceBandRuleForHsn(hsn: string | null | undefined): GstPriceBandRule | null {
  const h = (hsn ?? "").replace(/\s+/g, "");
  if (!/^\d{2,8}$/.test(h)) return null;
  if (h.startsWith("61") || h.startsWith("62")) return APPAREL_FOOTWEAR_GST_RULE;
  if (h.startsWith("63")) return h.startsWith("6309") || h.startsWith("630532") || h.startsWith("630533") ? null : APPAREL_FOOTWEAR_GST_RULE;
  const heading = Number(h.slice(0, 4));
  if (h.length >= 4 && heading >= 6401 && heading <= 6405) return APPAREL_FOOTWEAR_GST_RULE;
  return null;
}
