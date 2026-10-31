import { resolvePrice, pickList, type PricingItem, type PricingList } from "@rbms/pricelists/resolve";
import { clampDiscount, type CartLine, type CartProduct } from "./cart";
import { boxesForArea, lineAmount, normaliseAreaUnit, type AreaUnit } from "@rbms/gst";

/**
 * Alternate units and price lists at the counter (docs/price-lists-units.md). Pure: unit tested, and the same price
 * resolution as the API (`@rbms/pricelists/resolve`) over the cached lists, so it works offline.
 */

/** An alternate unit of an item as the POS catalogue sends it: `price` for one of the unit. */
export interface PosUnit {
  unit: string;
  factor: number;
  barcode: string | null;
  price: number;
  ownPrice?: number | null;
  mrp?: number | null;
}

/** What `GET /v1/pricelists/cache` returns (cached on the device). */
export interface PricingCache {
  lists: PricingList[];
  defaultListId: string | null;
  groups: { id: string; name: string; priceListId: string | null }[];
  customers: { customerId: string; groupId: string | null; priceListId: string | null }[];
  at: number;
}

const key = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();

/** The product's base unit (stock unit). */
export const baseUnitOf = (p: Pick<CartProduct, "unit" | "baseUnit">) => p.baseUnit ?? p.unit;
/** The unit's row, or null for the base unit / an unknown unit. */
export function unitRow(p: Pick<CartProduct, "unit" | "baseUnit" | "units">, unit: string | null | undefined): PosUnit | null {
  const k = key(unit);
  if (!k || k === key(baseUnitOf(p))) return null;
  return p.units?.find((u) => key(u.unit) === k) ?? null;
}

/** Base units in the line's unit (1 = the base unit). */
export function unitFactorOf(p: Pick<CartProduct, "unit" | "baseUnit" | "units">): number {
  return unitRow(p, p.unit)?.factor ?? 1;
}

/** The product sold in `unit` (its price for that unit); the base unit / an unknown unit gives the base product. */
export function inUnit<T extends CartProduct>(p: T, unit: string | null | undefined): T {
  const base = baseUnitOf(p);
  const basePrice = p.basePrice ?? (unitRow(p, p.unit) ? Math.round(p.price / unitFactorOf(p)) : p.price);
  const u = unitRow({ ...p, baseUnit: base }, unit);
  return { ...p, baseUnit: base, basePrice, unit: u ? u.unit : base, price: u ? u.price : basePrice };
}

/**
 * Changes a line's unit: the quantity stays, the price becomes the unit's price unless it was changed by hand (then
 * it is scaled by the units' ratio). The discount is clamped to the new amount.
 */
export function setLineUnit(lines: readonly CartLine[], lineKey: string, unit: string): CartLine[] {
  return lines.map((l) => {
    if (l.key !== lineKey || l.ticket) return l;
    const next = inUnit(l, unit);
    if (next.unit === l.unit) return l;
    const manual = l.price !== l.listPrice;
    const ratio = unitFactorOf(next) / unitFactorOf(l);
    const price = manual ? Math.round(l.price * ratio) : next.price;
    return { ...next, price, listPrice: next.price, discount: clampDiscount(l.discount, lineAmount(l.qty, price)), batch: l.batch };
  });
}

/** The item as the price resolver sees it (base unit and price, units with their own prices). */
export function pricingItemOf(p: CartProduct): PricingItem {
  const b = inUnit(p, null);
  return {
    id: p.itemId,
    unit: b.unit,
    price: b.price,
    taxInclusive: p.taxInclusive,
    gstRate: p.gstRate,
    gstRule: p.gstRule ?? null,
    units: (p.units ?? []).map((u) => ({ unit: u.unit, factor: u.factor, ownPrice: u.ownPrice ?? u.price })),
  };
}

/** The lists a bill uses: the picked one ("none" = item prices) or the customer's / group's, then the default list. */
export function listsFor(cache: PricingCache | null, opts: { customerId?: string | null; chosen?: string | null }): PricingList[] {
  if (!cache) return [];
  const link = opts.customerId ? cache.customers.find((c) => c.customerId === opts.customerId) : undefined;
  const group = link?.groupId ? cache.groups.find((g) => g.id === link.groupId) : undefined;
  const { listId, defaultListId } = pickList({ chosen: opts.chosen ?? null, customerListId: link?.priceListId ?? null, groupListId: group?.priceListId ?? null, defaultListId: cache.defaultListId });
  return [listId, defaultListId].map((id) => (id ? cache.lists.find((l) => l.id === id) : undefined)).filter((l): l is PricingList => !!l);
}

/** The price of a line (product in its unit, at `qty`) under the lists; null when the lists don't change it. */
export function listPriceOf(p: CartProduct, qty: number, lists: readonly PricingList[], date: string): { price: number; listName: string | null } {
  const r = resolvePrice({ item: pricingItemOf(p), unit: p.unit, qty, date, lists });
  return { price: r.price, listName: r.listName };
}

/**
 * Re-prices the lines whose price wasn't changed by hand (price = list price), e.g. after the customer, the list, a
 * unit or a quantity (slabs) changed. Weigh-ticket and open lines keep their price. Returns the same array when
 * nothing changed.
 */
export function repriceLines(lines: readonly CartLine[], lists: readonly PricingList[], date: string): CartLine[] {
  let changed = false;
  const out = lines.map((l) => {
    if (l.ticket || l.itemId.startsWith("open:") || l.price !== l.listPrice) return l;
    const { price } = listPriceOf(l, l.qty, lists, date);
    if (price === l.price) return l;
    changed = true;
    return { ...l, price, listPrice: price, discount: clampDiscount(l.discount, lineAmount(l.qty, price)) };
  });
  return changed ? out : (lines as CartLine[]);
}


/**
 * Selling by area at the counter (tiles, flooring): for an item whose base unit is sq ft / sq m and that has a box
 * unit, the whole boxes that cover `area` (plus wastage). Null when the item isn't sold that way or the input is not
 * a positive number. The line then goes in as `qty` of the box unit and stock moves by `qty × coverage`.
 */
export function boxesToCover(
  p: Pick<CartProduct, "unit" | "baseUnit" | "units">,
  area: number,
  areaUnit: AreaUnit = "sqft",
  wastagePct = 0,
): { unit: string; qty: number; covered: number; coverage: number } | null {
  const base = normaliseAreaUnit(baseUnitOf(p));
  const box = p.units?.find((u) => !normaliseAreaUnit(u.unit));
  if (!base || !box || !(area > 0) || !(wastagePct >= 0 && wastagePct <= 100)) return null;
  const r = boxesForArea({ area, areaUnit, coverage: box.factor, coverageUnit: base, wastagePct });
  return { unit: box.unit, qty: r.boxes, covered: r.covered, coverage: box.factor };
}
