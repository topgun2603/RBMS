/**
 * Pure stock rules (no database). Quantities are handled as integer thousandths ("milli") so that
 * 0.1 + 0.2 metres is exactly 0.3; columns are numeric(14,3).
 */

export const QTY_SCALE = 1000;

/** Half away from zero. */
const roundHalfAway = (n: number) => Math.sign(n) * Math.round(Math.abs(n)) + 0;

/** 2.5 → 2500, "1.005" → 1005, null → 0. Throws on non-numbers. */
export function toMilli(q: number | string | null | undefined): number {
  if (q === null || q === undefined || q === "") return 0;
  const n = typeof q === "number" ? q : Number(q);
  if (!Number.isFinite(n)) throw new RangeError(`Invalid quantity: ${String(q)}`);
  return roundHalfAway(n * QTY_SCALE);
}

/** 2500 → 2.5 (for JSON responses). */
export const fromMilli = (milli: number): number => milli / QTY_SCALE + 0;

/** 2500 → "2.500", -1 → "-0.001" (exact decimal text for numeric columns). */
export function milliToDecimal(milli: number): string {
  if (!Number.isSafeInteger(milli)) throw new RangeError(`Invalid milli quantity: ${milli}`);
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  return `${sign}${Math.floor(abs / QTY_SCALE)}.${String(abs % QTY_SCALE).padStart(3, "0")}`;
}

/** True when `q` has at most 3 decimal places. */
export const hasAtMost3Decimals = (q: number) => Math.abs(Math.round(q * QTY_SCALE) - q * QTY_SCALE) < 1e-6;

export type StockStatus = "ok" | "low" | "out";

/** out if qty <= 0; low if a reorder level is set and qty <= it; else ok. */
export function stockStatus(qtyMilli: number, reorderMilli: number): StockStatus {
  if (qtyMilli <= 0) return "out";
  if (reorderMilli > 0 && qtyMilli <= reorderMilli) return "low";
  return "ok";
}

/** Stock value in paise = qty × avgCost; negative stock and unknown cost are valued at 0. */
export function stockValue(qtyMilli: number, avgCost: number | null): number {
  if (avgCost === null || qtyMilli <= 0) return 0;
  return Math.round((qtyMilli * avgCost) / QTY_SCALE);
}

/**
 * Cost per unit (paise) of a purchase line: its taxable value (excluding GST, which is claimed as
 * input tax credit) divided by the quantity.
 */
export function unitCostOf(taxable: number, qtyMilli: number): number {
  if (qtyMilli <= 0) return 0;
  return Math.round((taxable * QTY_SCALE) / qtyMilli);
}

/**
 * Moving-average cost after receiving `inMilli` at `unitCost`:
 * round((oldQty × oldAvg + inQty × unitCost) / (oldQty + inQty)) when oldQty > 0 and oldAvg is known,
 * else unitCost. BigInt keeps large quantities × costs exact.
 */
export function movingAverageCost(oldMilli: number, oldAvg: number | null, inMilli: number, unitCost: number): number | null {
  if (inMilli <= 0) return oldAvg;
  if (oldMilli <= 0 || oldAvg === null) return unitCost;
  const num = BigInt(oldMilli) * BigInt(Math.round(oldAvg)) + BigInt(inMilli) * BigInt(Math.round(unitCost));
  const den = BigInt(oldMilli + inMilli);
  // Round half up (all terms are non-negative).
  return Number((num * 2n + den) / (2n * den));
}

export type AdjustMode = "add" | "remove" | "set";

/** Signed change for a manual adjustment. */
export function adjustmentDelta(mode: AdjustMode, qtyMilli: number, currentMilli: number): number {
  if (mode === "add") return qtyMilli;
  if (mode === "remove") return -qtyMilli;
  return qtyMilli - currentMilli;
}

/**
 * Merges sale lines by itemId (the same item may appear on several invoice lines), drops lines without
 * a positive total, and sorts by itemId so concurrent transactions lock rows in the same order.
 */
export function mergeQtyLines(lines: readonly { itemId: string; qty: number | string }[]): { itemId: string; milli: number }[] {
  const byItem = new Map<string, number>();
  for (const l of lines) {
    if (!l.itemId) continue;
    byItem.set(l.itemId, (byItem.get(l.itemId) ?? 0) + toMilli(l.qty));
  }
  return [...byItem.entries()]
    .filter(([, milli]) => milli > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([itemId, milli]) => ({ itemId, milli }));
}

/** Sums signed movement deltas per item, e.g. to reverse what a sale or purchase applied. */
export function netByItem(movements: readonly { itemId: string; delta: number | string }[]): { itemId: string; milli: number }[] {
  const byItem = new Map<string, number>();
  for (const m of movements) byItem.set(m.itemId, (byItem.get(m.itemId) ?? 0) + toMilli(m.delta));
  return [...byItem.entries()]
    .filter(([, milli]) => milli !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([itemId, milli]) => ({ itemId, milli }));
}

/**
 * Purchase lines with an itemId merged per item: total quantity and total taxable value, so the unit
 * cost of an item bought on two lines is the weighted average of both.
 */
export function mergePurchaseLines(
  lines: readonly { itemId?: string | null; qty: number; taxable: number; unitFactor?: number | null }[],
): { itemId: string; milli: number; taxable: number }[] {
  const byItem = new Map<string, { milli: number; taxable: number }>();
  for (const l of lines) {
    if (!l.itemId) continue;
    const cur = byItem.get(l.itemId) ?? { milli: 0, taxable: 0 };
    // Stock is kept in the base unit: 2 boxes of 12 are 24 pieces (docs/price-lists-units.md).
    cur.milli += baseMilliOf(l);
    cur.taxable += l.taxable;
    byItem.set(l.itemId, cur);
  }
  return [...byItem.entries()]
    .filter(([, v]) => v.milli > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([itemId, v]) => ({ itemId, ...v }));
}

/** A line's quantity in thousandths of the item's base unit: `qty × unitFactor` (alternate units, e.g. 1 box = 12 pcs). */
export const baseMilliOf = (l: { qty: number; unitFactor?: number | null }): number =>
  toMilli(l.unitFactor && l.unitFactor > 0 && l.unitFactor !== 1 ? Math.round(l.qty * l.unitFactor * 1000) / 1000 : l.qty);

/** Paise → "1234.56" for CSV exports. */
export function paiseToRupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
