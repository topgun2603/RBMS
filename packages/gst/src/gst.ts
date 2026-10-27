import { normalizeStateCode } from "./states";
import { lineGstRate, type GstRateRule } from "./rate-rule";

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_RATES)[number];

export const isGstRate = (v: unknown): v is GstRate => GST_RATES.includes(v as GstRate);

export interface LineInput {
  description: string;
  hsn?: string;
  /** Up to 3 decimal places, e.g. 2.5 metres. */
  qty: number;
  unit?: string;
  /** Paise per unit. */
  rate: number;
  /** Paise, for the whole line. */
  discount?: number;
  gstRate: GstRate;
  /** The saved item this line came from (inventory keys stock by it). Carried into LineTotals. */
  itemId?: string;
  /**
   * Paise: the GST-inclusive amount actually charged for the whole line (after any discount), for tax-inclusive
   * (MRP-style) prices. When set, the GST is taken out of it instead of added on top of the rounded exclusive rate,
   * so the line total equals it to the paisa: `taxable = round(total × 100 / (100 + gstRate))`, GST = the rest, and
   * `amount = taxable + discount` (which can differ from `qty × rate` by a paisa). Without it, `round(price / 1.05)`
   * followed by `+ 5%` drifts (₹999 → ₹999.01).
   */
  inclusiveTotal?: number;
  /** Serial numbers / IMEIs of the units sold on this line (electronics); printed on the bill, at most one per unit. */
  serials?: string[];
  /** The stock batch the goods come from (items with batch tracking); batch number and expiry are printed on the bill. */
  batchId?: string;
  batchNo?: string;
  /** YYYY-MM-DD. */
  mfgDate?: string;
  expiry?: string;
  /**
   * A price-dependent rate (apparel / footwear: 5% up to ₹2,500 taxable per piece, 18% above; see rate-rule.ts). When
   * set, `computeLine` taxes the line at the band of its unit taxable value after the line discount (from
   * `inclusiveTotal` for tax-inclusive lines) and returns that as `gstRate`; `gstRate` on input is only a hint.
   */
  gstRule?: GstRateRule | null;
  /**
   * Alternate unit (docs/price-lists-units.md): how many base units one `unit` holds (1 box = 12 pcs → 12; 1 g of a
   * kg item → 0.001). Stock always moves `qty × unitFactor` of the item's `baseUnit`, and GST reports count the base
   * unit. Absent (or 1) = the line is in the item's base unit. The server sets it from the catalogue.
   */
  unitFactor?: number;
  /** The item's base (stock) unit when `unitFactor` is set, e.g. "pcs". */
  baseUnit?: string;
}

export interface LineTotals extends LineInput {
  /** round(qty * rate) */
  amount: number;
  /** amount - discount */
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface TaxBreakupRow {
  gstRate: GstRate;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface InvoiceTotals {
  lines: LineTotals[];
  subtotal: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  taxBreakup: TaxBreakupRow[];
}

export interface ComputeOptions {
  sellerState: string;
  placeOfSupply: string;
  /** Round the grand total to the nearest rupee. Default true. */
  roundToRupee?: boolean;
}

/** Different 2-digit GST state codes → inter-state supply (IGST). */
export function isInterState(sellerState: string, placeOfSupply: string): boolean {
  const a = normalizeStateCode(sellerState) ?? sellerState.trim();
  const b = normalizeStateCode(placeOfSupply) ?? placeOfSupply.trim();
  return a !== b;
}

/** Half away from zero (Math.round rounds -0.5 towards +inf). */
const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

/** qty × rate in paise, using integer thousandths of qty to avoid float drift (1.005 × 100 = 100.5 → 101). */
export function lineAmount(qty: number, rate: number): number {
  const milli = Math.round(qty * 1000);
  return round((milli * rate) / 1000);
}

/**
 * The GST-exclusive rate (paise) of a catalogue price. A tax-inclusive price (typical MRP retail) has its GST taken
 * out: `round(price × 100 / (100 + gstRate))`; an exclusive price is returned unchanged. Use it wherever a catalogue
 * price becomes an invoice/order line `rate`.
 */
export function exclusiveOf(price: number, gstRate: number, taxInclusive: boolean): number {
  if (!taxInclusive || !gstRate) return price;
  // Basis points keep 0.25% exact.
  const bp = Math.round(gstRate * 100);
  return round((price * 10_000) / (10_000 + bp));
}

/**
 * The GST-inclusive price (paise) that `exclusiveOf(price, gstRate, true)` turned into `rate`, for when only the rounded
 * exclusive rate was kept. Adding the GST back on top (`round(rate × 1.18)`) drifts by a paisa (₹6,500 → 5,508.47 →
 * ₹6,499.99); this instead returns a price that maps back to `rate` exactly, preferring the roundest one (whole rupees,
 * then 10 paise) when two prices share the rate. Use the stored inclusive price itself whenever it is still known.
 */
export function inclusiveOfRate(rate: number, gstRate: number): number {
  const bp = Math.round(gstRate * 100);
  if (!bp || rate <= 0) return rate;
  const d = 10_000 + bp;
  // price × 10000 / d rounds to `rate` ⇔ (2·rate − 1)·d / 20000 ≤ price < (2·rate + 1)·d / 20000.
  const lo = Math.ceil(((2 * rate - 1) * d) / 20_000);
  const hi = Math.ceil(((2 * rate + 1) * d) / 20_000) - 1;
  const fits = (p: number) => round((p * 10_000) / d) === rate;
  const candidates: number[] = [];
  for (let p = lo; p <= hi; p++) if (fits(p)) candidates.push(p);
  if (candidates.length === 0) return round((rate * d) / 10_000);
  const score = (p: number) => (p % 100 === 0 ? 2 : p % 10 === 0 ? 1 : 0);
  return candidates.reduce((best, p) => (score(p) > score(best) ? p : best), candidates[0]!);
}

/** Taxable value inside a GST-inclusive amount: `round(total × 100 / (100 + gstRate))`. */
export function taxableOfInclusive(total: number, gstRate: number): number {
  const bp = Math.round(gstRate * 100);
  return bp ? round((total * 10_000) / (10_000 + bp)) : total;
}

export function computeLine(input: LineInput, interState: boolean): LineTotals {
  // A rule-priced line is taxed at the band of its own taxable value; everything below then uses that rate, so the
  // line's stored `gstRate` (and the rate-wise / HSN-wise summaries built from it) is the effective one.
  const line: LineInput = input.gstRule ? { ...input, gstRate: lineGstRate(input) as GstRate } : input;
  const discount = line.discount ?? 0;
  // Basis points avoid float error for 0.25%.
  const bp = Math.round(line.gstRate * 100);
  if (line.inclusiveTotal !== undefined && line.inclusiveTotal !== null) {
    // Backward: the charged amount is fixed; GST is what is inside it. CGST gets the odd paisa.
    const total = line.inclusiveTotal;
    const taxable = taxableOfInclusive(total, line.gstRate);
    const tax = total - taxable;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (interState) igst = tax;
    else {
      cgst = round(tax / 2);
      sgst = tax - cgst;
    }
    return { ...line, discount, amount: taxable + discount, taxable, cgst, sgst, igst, total };
  }
  const amount = lineAmount(line.qty, line.rate);
  const taxable = amount - discount;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (interState) igst = round((taxable * bp) / 10_000);
  else cgst = sgst = round((taxable * bp) / 20_000);
  return { ...line, discount, amount, taxable, cgst, sgst, igst, total: taxable + cgst + sgst + igst };
}

export function computeInvoice(lines: LineInput[], opts: ComputeOptions): InvoiceTotals {
  const inter = isInterState(opts.sellerState, opts.placeOfSupply);
  const computed = lines.map((l) => computeLine(l, inter));
  const sum = (k: "amount" | "discount" | "taxable" | "cgst" | "sgst" | "igst") =>
    computed.reduce((s, l) => s + (l[k] ?? 0), 0);

  const subtotal = sum("amount");
  const discount = sum("discount");
  const taxable = sum("taxable");
  const cgst = sum("cgst");
  const sgst = sum("sgst");
  const igst = sum("igst");
  const exact = taxable + cgst + sgst + igst;
  const roundOff = opts.roundToRupee === false ? 0 : round(exact / 100) * 100 - exact;

  const byRate = new Map<GstRate, TaxBreakupRow>();
  for (const l of computed) {
    const row = byRate.get(l.gstRate) ?? { gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += l.taxable;
    row.cgst += l.cgst;
    row.sgst += l.sgst;
    row.igst += l.igst;
    byRate.set(l.gstRate, row);
  }
  const taxBreakup = [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate);

  return { lines: computed, subtotal, discount, taxable, cgst, sgst, igst, roundOff, total: exact + roundOff, taxBreakup };
}
