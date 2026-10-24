import {
  computeInvoice,
  effectiveGstRate,
  exclusiveOf,
  gstRateForInclusive,
  isGstRate,
  lineAmount,
  type GstRate,
  type GstRateRule,
  type InvoiceTotals,
  type LineInput,
} from "@srirealtime/gst";

/**
 * Cart math for the counter. Prices are what the shop sells at: GST-inclusive for tax-inclusive (MRP) products,
 * exclusive otherwise, exactly as the catalogue stores them. Line discounts are on the same basis (money off the
 * line as charged). `toLineInput` turns a line into the invoice API's line, the same way the orders module does, so
 * `cartTotals` (computeInvoice over those lines) is exactly what the server will compute for the bill.
 */

/** Something that can go on the bill: a catalogue variant (or a billing item when the catalogue is off). */
export interface CartProduct {
  /** Catalogue variant id (or billing item id): the invoice line's `itemId`, which drives stock. */
  itemId: string;
  productId?: string | null;
  /** "Product" or "Product – M / Red". */
  name: string;
  sku?: string | null;
  barcode?: string | null;
  hsn?: string | null;
  unit: string;
  /** Paise per unit as sold (incl. GST when `taxInclusive`). */
  price: number;
  taxInclusive: boolean;
  /** The rate at `price`; a price-band product's line is re-banded on its value after the discount (`cartLineGstRate`). */
  gstRate: number;
  /** Price-band GST (apparel / footwear: 5% up to ₹2,500 taxable per piece, 18% above). */
  gstRule?: GstRateRule | null;
  image?: string | null;
  /** From the POS catalogue: by-weight items ask for the weight when tapped. */
  soldBy?: "unit" | "weight";
}

export interface CartLine extends CartProduct {
  /** Stable key for React and edits. */
  key: string;
  qty: number;
  /** Paise off the whole line, on the price basis (what the customer saves). */
  discount: number;
  /** The catalogue price before a manual price change. */
  listPrice: number;
  /** Serial numbers / IMEIs scanned onto this line (one per unit); printed on the bill and marked sold. */
  serials?: string[];
  /** The stock batch the line is sold from (items with batches): printed on the bill, stock is taken from it first. */
  batch?: { id: string; no: string; expiry: string | null };
  /** A weigh-ticket line (fixed qty and price; removed with its whole ticket). */
  ticket?: { id: string; code: string };
}

export interface TaxOptions {
  sellerState: string;
  placeOfSupply: string;
  /** Composition taxpayer: a bill of supply, no tax added to the prices (the server does the same). */
  taxFree?: boolean;
}

let seq = 0;
const newKey = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

const gstOf = (rate: number): GstRate => (isGstRate(rate) ? rate : 0);

/** qty × price (paise), before any discount. */
export const lineGross = (l: Pick<CartLine, "qty" | "price">) => lineAmount(l.qty, l.price);

/** Clamp a discount to 0…gross, whole paise. */
export const clampDiscount = (discount: number, gross: number) => Math.min(Math.max(Math.round(discount), 0), Math.max(gross, 0));

/**
 * Adds a product. The same item at the same price without a discount merges into the existing line (qty + `qty`);
 * returns the new lines and the key of the line that changed (for the scan flash).
 */
export function addProduct(lines: readonly CartLine[], p: CartProduct, qty = 1, serial?: string | null): { lines: CartLine[]; key: string } {
  const same = lines.find((l) => !l.ticket && l.itemId === p.itemId && l.price === p.price && l.discount === 0);
  if (serial) {
    // A unit with a serial / IMEI: one unit per scan; the same unit scanned twice is not added again.
    const holder = lines.find((l) => l.serials?.includes(serial));
    if (holder) return { lines: [...lines], key: holder.key };
    if (same) {
      return {
        lines: lines.map((l) => (l.key === same.key ? { ...l, qty: roundQty(l.qty + 1), serials: [...(l.serials ?? []), serial] } : l)),
        key: same.key,
      };
    }
    const line: CartLine = { ...p, key: newKey(), qty: 1, discount: 0, listPrice: p.price, serials: [serial] };
    return { lines: [...lines, line], key: line.key };
  }
  if (same) {
    return { lines: lines.map((l) => (l.key === same.key ? { ...l, qty: roundQty(l.qty + qty) } : l)), key: same.key };
  }
  const line: CartLine = { ...p, key: newKey(), qty, discount: 0, listPrice: p.price };
  return { lines: [...lines, line], key: line.key };
}

/** Serials beyond the line's units are dropped (the last scanned first). */
const fitSerials = (serials: string[] | undefined, qty: number) => (serials && serials.length > Math.ceil(qty) ? serials.slice(0, Math.ceil(qty)) : serials);

const roundQty = (q: number) => Math.round(q * 1000) / 1000;

/** Sets the quantity (≥ 0.001, 3 decimals). Discount is clamped to the new gross. */
export function setQty(lines: readonly CartLine[], key: string, qty: number): CartLine[] {
  const q = roundQty(qty);
  if (!(q > 0)) return [...lines];
  return lines.map((l) => (l.key === key && !l.ticket ? { ...l, qty: q, discount: clampDiscount(l.discount, lineAmount(q, l.price)), serials: fitSerials(l.serials, q) } : l));
}

/** +1 / −1. Never goes to zero (removing is its own action). */
export function stepQty(lines: readonly CartLine[], key: string, delta: 1 | -1): CartLine[] {
  const line = lines.find((l) => l.key === key);
  if (!line) return [...lines];
  const next = roundQty(line.qty + delta);
  if (next <= 0) return [...lines];
  return setQty(lines, key, next);
}

export function setPrice(lines: readonly CartLine[], key: string, price: number): CartLine[] {
  const p = Math.max(Math.round(price), 0);
  return lines.map((l) => (l.key === key && !l.ticket ? { ...l, price: p, discount: clampDiscount(l.discount, lineAmount(l.qty, p)) } : l));
}

export function setDiscount(lines: readonly CartLine[], key: string, discount: number): CartLine[] {
  return lines.map((l) => (l.key === key && !l.ticket ? { ...l, discount: clampDiscount(discount, lineGross(l)) } : l));
}

/** Discount from a percentage of the line gross (rounded to the paisa). */
export const percentDiscount = (l: Pick<CartLine, "qty" | "price">, pct: number) =>
  clampDiscount((lineGross(l) * Math.min(Math.max(pct, 0), 100)) / 100, lineGross(l));

export const removeLine = (lines: readonly CartLine[], key: string) => lines.filter((l) => l.key !== key);

/**
 * The invoice API line for a cart line. Exclusive prices: rate = price, discount as is. Tax-inclusive prices:
 * rate = the exclusive rate, the discount converted to the exclusive basis, and `inclusiveTotal` = what is charged
 * (gross − discount), so GST is taken out of the charged amount and ₹999 stays ₹999.00.
 */
/**
 * The rate a cart line is billed at: its `gstRate`, or for a price-band product (apparel / footwear) the band of the
 * piece's value after the line discount — the charged amount for tax-inclusive prices, the exclusive amount otherwise.
 * The server re-bands the same way (the line carries `gstRule`).
 */
export function cartLineGstRate(l: Pick<CartLine, "qty" | "price" | "discount" | "taxInclusive" | "gstRate" | "gstRule">): GstRate {
  if (!l.gstRule) return gstOf(l.gstRate);
  const gross = lineGross(l);
  const charged = gross - clampDiscount(l.discount, gross);
  return gstOf(l.taxInclusive ? gstRateForInclusive(l.gstRule, charged, l.qty).rate : effectiveGstRate(l.gstRule, charged, l.qty));
}

export function toLineInput(l: CartLine): LineInput {
  const gstRate = cartLineGstRate(l);
  const rate = exclusiveOf(l.price, gstRate, l.taxInclusive);
  const amount = lineAmount(l.qty, rate);
  const gross = lineGross(l);
  const d = clampDiscount(l.discount, gross);
  const input: LineInput = { description: l.name, qty: l.qty, rate, gstRate };
  // Open items (billed once, not in the catalogue) have no item id.
  if (!l.itemId.startsWith("open:")) input.itemId = l.itemId;
  if (l.gstRule) input.gstRule = l.gstRule;
  if (l.taxInclusive && gstRate) {
    const discount = Math.min(exclusiveOf(d, gstRate, true), amount);
    if (discount > 0) input.discount = discount;
    input.inclusiveTotal = gross - d;
  } else if (d > 0) {
    input.discount = Math.min(d, amount);
  }
  if (l.hsn) input.hsn = l.hsn;
  if (l.unit) input.unit = l.unit;
  if (l.serials?.length) input.serials = [...l.serials];
  if (l.batch) {
    input.batchId = l.batch.id;
    input.batchNo = l.batch.no;
    if (l.batch.expiry) input.expiry = l.batch.expiry;
  }
  return input;
}

export interface CartTotals extends InvoiceTotals {
  /** Number of lines. */
  count: number;
  /** Sum of quantities. */
  units: number;
  /** Line discounts on the charged basis (what the customer saves). */
  savings: number;
}

/** Live totals: exactly computeInvoice over `toLineInput` lines. */
export function cartTotals(lines: readonly CartLine[], opts: TaxOptions): CartTotals {
  const inputs = lines.map(toLineInput);
  const totals = computeInvoice(opts.taxFree ? inputs.map((l) => ({ ...l, gstRate: 0 as const, gstRule: null })) : inputs, opts);
  return {
    ...totals,
    count: lines.length,
    units: roundQty(lines.reduce((s, l) => s + l.qty, 0)),
    savings: lines.reduce((s, l) => s + clampDiscount(l.discount, lineGross(l)), 0),
  };
}

/** Half away from zero to the rupee (same rule as computeInvoice). */
const toRupee = (p: number) => Math.sign(p) * Math.round(Math.abs(p) / 100) * 100;

/**
 * What the customer pays after a loyalty-points discount (`discount` paise). The server spreads the discount over
 * the lines (charged amounts drop by exactly the discount) and rounds the bill to the rupee again, so the payable is
 * the unrounded total minus the discount, rounded. The issued bill's total is the final word.
 */
export function payableAfterLoyalty(t: Pick<InvoiceTotals, "total" | "roundOff">, discount: number): number {
  const d = Math.max(Math.round(discount), 0);
  if (d === 0) return t.total;
  const exact = t.total - t.roundOff;
  return Math.max(toRupee(exact - Math.min(d, exact)), 0);
}

/** A cart line from an API product, for tests and the product grid. */
export const productToLine = (p: CartProduct, qty = 1): CartLine => ({ ...p, key: newKey(), qty, discount: 0, listPrice: p.price });
