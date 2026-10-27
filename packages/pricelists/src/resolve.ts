import { exclusiveOf, gstRateAtPrice, type GstRateRule } from "@srirealtime/gst";

/**
 * Price resolution (docs/price-lists-units.md). Pure and browser-safe: the API resolves bill lines with it and the POS
 * resolves offline with the same code over its cached lists (`@srirealtime/pricelists/resolve`).
 *
 * For one item, unit and quantity on a date, the lists are tried in order (the bill's / customer's list first, then the
 * shop's default list) and the first that prices the line wins:
 *   1. an entry for the item in the chosen unit: the highest quantity slab at or under the quantity;
 *   2. an entry for the item in its base unit (slab on the base quantity), scaled to the chosen unit;
 *   3. the list's percentage rule (−10 = 10% off, +5 = 5% markup) on the item's own price for that unit.
 * Nothing matched: the item's own price for the unit (the unit's price, else factor × the item price). A shop
 * without price lists therefore bills exactly as before.
 *
 * Prices are paise on the item's basis (GST-inclusive for tax-inclusive items, like the catalogue); `rate` is the
 * GST-exclusive paise a bill line takes.
 */

export interface PricingUnit {
  unit: string;
  /** Base units in one of this unit. */
  factor: number;
  /** Price for one of this unit (null / absent = factor × the item price). */
  ownPrice?: number | null;
}

export interface PricingItem {
  id: string;
  /** The item's base (stock) unit. */
  unit: string;
  /** Paise per base unit, as sold (incl. GST when `taxInclusive`). */
  price: number;
  taxInclusive: boolean;
  gstRate: number;
  gstRule?: GstRateRule | null;
  units?: readonly PricingUnit[] | null;
}

export interface PricingEntry {
  itemId: string;
  /** Null = the item's base unit. */
  unit: string | null;
  /** Slab: applies from this quantity (in `unit`) up. 0 = any quantity. */
  minQty: number;
  /** Paise for one `unit`, on the item's basis. */
  price: number;
}

export interface PricingList {
  id: string;
  name: string;
  /** % change on the item's own price when the list has no entry: −10 = 10% off, 5 = 5% markup; null = none. */
  adjustPct: number | null;
  /** Round rule prices to the whole rupee. */
  roundRupee?: boolean;
  /** YYYY-MM-DD, inclusive; null = open. */
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  entries: readonly PricingEntry[];
}

export type PriceSource = "list" | "slab" | "rule" | "unit" | "item";

export interface ResolvedPrice {
  itemId: string;
  /** The unit the price is for (the base unit when none or an unknown unit was asked). */
  unit: string;
  /** Base units in `unit` (1 for the base unit). */
  unitFactor: number;
  /** Paise for one `unit`, on the item's basis. */
  price: number;
  /** GST-exclusive paise for one `unit` (what a bill line's `rate` takes). */
  rate: number;
  /** The rate the price was converted with (price-band items: the band of one piece). */
  gstRate: number;
  /** The item's own price for the unit, without any list (for "you save" and discount checks). */
  basePrice: number;
  source: PriceSource;
  /** The list that priced the line; null = the item's own price. */
  listId: string | null;
  listName: string | null;
  /** The slab that applied (entries with a quantity from 2 up). */
  minQty: number | null;
}

const key = (u: string | null | undefined) => (u ?? "").trim().toLowerCase();
const EPS = 1e-9;

/** The list is on for `date` (YYYY-MM-DD): active and inside its validity. */
export function listApplies(list: Pick<PricingList, "active" | "validFrom" | "validTo">, date: string): boolean {
  if (!list.active) return false;
  if (list.validFrom && date < list.validFrom) return false;
  if (list.validTo && date > list.validTo) return false;
  return true;
}

/** The item's unit for a name (any case); null = the base unit (or a unit the item doesn't have). */
export function unitOf(item: Pick<PricingItem, "unit" | "units">, unit: string | null | undefined): PricingUnit | null {
  const k = key(unit);
  if (!k || k === key(item.unit)) return null;
  return item.units?.find((u) => key(u.unit) === k) ?? null;
}

/** The item's own price for one of `unit`: the unit's price, else round(factor × item price). */
export function ownPrice(item: PricingItem, unit: PricingUnit | null): number {
  if (!unit) return item.price;
  return unit.ownPrice ?? Math.round(item.price * unit.factor);
}

/** The best slab among `entries` for `qty`: the highest `minQty` at or under it. */
function bestSlab(entries: readonly PricingEntry[], qty: number): PricingEntry | null {
  let best: PricingEntry | null = null;
  for (const e of entries) if (e.minQty <= qty + EPS && (!best || e.minQty > best.minQty)) best = e;
  return best;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** GST-exclusive paise of `price` for one `unit` (a price-band item is banded on the value of one piece). */
export function rateOf(item: Pick<PricingItem, "taxInclusive" | "gstRate" | "gstRule">, price: number, factor = 1): { rate: number; gstRate: number } {
  const gstRate = item.gstRule ? gstRateAtPrice(item.gstRule, Math.round(price / (factor || 1)), item.taxInclusive) : item.gstRate;
  return { rate: exclusiveOf(price, gstRate, item.taxInclusive), gstRate };
}

/** The price of `qty` of `unit` of `item` on `date` under `lists` (in priority order). */
export function resolvePrice(input: { item: PricingItem; unit?: string | null; qty?: number | null; date: string; lists: readonly (PricingList | null | undefined)[] }): ResolvedPrice {
  const { item, date } = input;
  const qty = input.qty && input.qty > 0 ? input.qty : 1;
  const u = unitOf(item, input.unit);
  const factor = u?.factor ?? 1;
  const base = ownPrice(item, u);
  const done = (price: number, source: PriceSource, list: PricingList | null, minQty: number | null = null): ResolvedPrice => {
    const p = Math.max(Math.round(price), 0);
    return {
      itemId: item.id,
      unit: u?.unit ?? item.unit,
      unitFactor: factor,
      price: p,
      ...rateOf(item, p, factor),
      basePrice: base,
      source,
      listId: list?.id ?? null,
      listName: list?.name ?? null,
      minQty,
    };
  };
  const seen = new Set<string>();
  for (const list of input.lists) {
    if (!list || seen.has(list.id) || !listApplies(list, date)) continue;
    seen.add(list.id);
    const mine = list.entries.filter((e) => e.itemId === item.id);
    // 1. entries in the chosen unit (an entry naming the base unit counts as base)
    const inUnit = mine.filter((e) => (u ? key(e.unit) === key(u.unit) : !e.unit || key(e.unit) === key(item.unit)));
    const hit = bestSlab(inUnit, qty);
    if (hit) return done(hit.price, hit.minQty > 1 ? "slab" : "list", list, hit.minQty > 1 ? hit.minQty : null);
    // 2. base-unit entries scaled to the chosen unit (slab on the base quantity)
    if (u) {
      const baseEntries = mine.filter((e) => !e.unit || key(e.unit) === key(item.unit));
      const b = bestSlab(baseEntries, round3(qty * factor));
      if (b) return done(b.price * factor, b.minQty > 1 ? "slab" : "list", list, b.minQty > 1 ? b.minQty : null);
    }
    // 3. the list's percentage rule
    if (list.adjustPct !== null && list.adjustPct !== undefined) {
      const raw = (base * (100 + list.adjustPct)) / 100;
      return done(list.roundRupee ? Math.round(raw / 100) * 100 : raw, "rule", list);
    }
  }
  return done(base, u?.ownPrice !== null && u?.ownPrice !== undefined ? "unit" : "item", null);
}

/** Which list a bill uses: an explicit pick ("none" = the item price), else the customer's own list, else its group's. */
export function pickList(opts: {
  /** The list picked on the bill; "none" = item prices only (no default list either). */
  chosen?: string | null;
  customerListId?: string | null;
  groupListId?: string | null;
  defaultListId?: string | null;
}): { listId: string | null; defaultListId: string | null } {
  if (opts.chosen === "none") return { listId: null, defaultListId: null };
  const listId = opts.chosen || opts.customerListId || opts.groupListId || null;
  return { listId, defaultListId: opts.defaultListId && opts.defaultListId !== listId ? opts.defaultListId : null };
}
