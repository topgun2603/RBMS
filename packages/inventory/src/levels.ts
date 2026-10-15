/**
 * Pure rules for stock locations, availability and reservations (no database).
 * Quantities are integer thousandths ("milli"), as in ./logic.
 */
import { fromMilli, toMilli } from "./logic";

/** One stock row (one location) as read from the database; numeric columns arrive as strings. */
export interface StockLevelInput {
  qty: number | string;
  reserved?: number | string | null;
  reorderLevel: number | string;
  track: boolean;
  avgCost: number | null;
  updatedAt: Date | null;
  /** True for the row of the tenant's default location (preferred for the fallback cost). */
  isDefault?: boolean;
}

export interface AggregatedStock {
  qtyMilli: number;
  reservedMilli: number;
  /** qty − reserved (negative when stock is negative or backordered). */
  availableMilli: number;
  reorderMilli: number;
  /** False when the item is untracked at any location (tracking is an item-level switch). */
  track: boolean;
  avgCost: number | null;
  updatedAt: Date | null;
}

/** An item is tracked unless any of its rows says otherwise (no rows = tracked). */
export const isItemTracked = (rows: readonly Pick<StockLevelInput, "track">[]): boolean => rows.every((r) => r.track);

/**
 * Sums an item's rows across locations: qty, reserved, available and reorder level are sums; the average
 * cost is the qty-weighted average of rows with positive stock and a known cost (exact for a single row),
 * falling back to the default location's (or any) known cost. Returns null when there are no rows.
 */
export function aggregateStock(rows: readonly StockLevelInput[]): AggregatedStock | null {
  if (rows.length === 0) return null;
  let qtyMilli = 0;
  let reservedMilli = 0;
  let reorderMilli = 0;
  let num = 0n;
  let den = 0n;
  let updatedAt: Date | null = null;
  for (const r of rows) {
    const q = toMilli(r.qty);
    qtyMilli += q;
    reservedMilli += toMilli(r.reserved ?? 0);
    reorderMilli += toMilli(r.reorderLevel);
    if (q > 0 && r.avgCost !== null) {
      num += BigInt(q) * BigInt(Math.round(r.avgCost));
      den += BigInt(q);
    }
    if (r.updatedAt && (!updatedAt || r.updatedAt > updatedAt)) updatedAt = r.updatedAt;
  }
  let avgCost: number | null;
  if (den > 0n) avgCost = Number((num * 2n + den) / (2n * den));
  else avgCost = (rows.find((r) => r.isDefault && r.avgCost !== null) ?? rows.find((r) => r.avgCost !== null))?.avgCost ?? null;
  return {
    qtyMilli,
    reservedMilli,
    availableMilli: qtyMilli - reservedMilli,
    reorderMilli,
    track: isItemTracked(rows),
    avgCost,
    updatedAt,
  };
}

export interface ShortItem {
  itemId: string;
  /** Units available at the location (qty − reserved). */
  available: number;
  /** Units asked for. */
  requested: number;
}

export type AvailabilityCheck =
  | {
      ok: true;
      /** Tracked lines to hold or move. */
      lines: { itemId: string; milli: number }[];
      /** Untracked item ids (not checked, not held). */
      skipped: string[];
    }
  | { ok: false; items: ShortItem[] };

/**
 * Decides whether `lines` (merged, milli) can be taken from one location. Untracked items are skipped;
 * tracked items need `qty − reserved >= requested` unless `allowBackorder`. All-or-nothing: any short item
 * fails the whole set, and every short item is reported.
 */
export function checkAvailability(
  lines: readonly { itemId: string; milli: number }[],
  stock: ReadonlyMap<string, { qtyMilli: number; reservedMilli: number }>,
  untracked: ReadonlySet<string>,
  opts: { allowBackorder?: boolean } = {},
): AvailabilityCheck {
  const take: { itemId: string; milli: number }[] = [];
  const skipped: string[] = [];
  const short: ShortItem[] = [];
  for (const l of lines) {
    if (untracked.has(l.itemId)) {
      skipped.push(l.itemId);
      continue;
    }
    const s = stock.get(l.itemId);
    const available = (s?.qtyMilli ?? 0) - (s?.reservedMilli ?? 0);
    if (!opts.allowBackorder && available < l.milli) {
      short.push({ itemId: l.itemId, available: fromMilli(available), requested: fromMilli(l.milli) });
    }
    take.push(l);
  }
  if (short.length > 0) return { ok: false, items: short };
  return { ok: true, lines: take, skipped };
}

/** Storefront view of availability, booleans only. low = tracked, in stock and available ≤ reorder level. */
export function publicStockFlags(a: { availableMilli: number; reorderMilli: number; track: boolean }): {
  inStock: boolean;
  lowStock: boolean;
} {
  if (!a.track) return { inStock: true, lowStock: false };
  const inStock = a.availableMilli > 0;
  return { inStock, lowStock: inStock && a.availableMilli <= a.reorderMilli };
}

/** Why a transfer between these locations is not allowed (null = fine). */
export function transferProblem(
  fromLocationId: string,
  toLocationId: string,
  from: { active: boolean } | null,
  to: { active: boolean } | null,
): { status: 400 | 404; message: string } | null {
  if (fromLocationId === toLocationId) return { status: 400, message: "Choose two different locations" };
  if (!from) return { status: 404, message: "Source location not found" };
  if (!to) return { status: 404, message: "Destination location not found" };
  if (!to.active) return { status: 400, message: "The destination location is inactive" };
  return null;
}

/**
 * Reserve is idempotent per ref: a ref that still holds stock (active) or already sold it (committed) is not
 * reserved again. A ref with no rows, or only released rows, is (re)reserved.
 */
export function reserveDecision(existing: readonly { status: string }[]): "create" | "noop" {
  return existing.some((r) => r.status === "active" || r.status === "committed") ? "noop" : "create";
}

/** Rows that release and commit act on: only active ones, which makes both idempotent. */
export function activeReservations<T extends { status: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.status === "active");
}

/** Why a location patch is refused (null = fine). */
export function locationPatchProblem(
  current: { isDefault: boolean; active: boolean },
  patch: { isDefault?: boolean; active?: boolean },
): string | null {
  if (current.isDefault && patch.active === false) {
    return "The default location can't be deactivated; make another location the default first";
  }
  if (current.isDefault && patch.isDefault === false) return "Make another location the default instead";
  const activeAfter = patch.active ?? current.active;
  if (patch.isDefault === true && !activeAfter) return "An inactive location can't be the default";
  return null;
}

/** Why a location can't be deleted (null = fine). */
export function locationDeleteProblem(l: {
  isDefault: boolean;
  /** Rows at the location with qty or reserved ≠ 0. */
  stockRows: number;
  activeReservations: number;
  movements: number;
}): { status: 400 | 409; message: string } | null {
  if (l.isDefault) return { status: 400, message: "The default location can't be deleted" };
  if (l.stockRows > 0) return { status: 409, message: "This location still has stock; transfer or adjust it to zero first" };
  if (l.activeReservations > 0) return { status: 409, message: "This location has stock reserved for orders" };
  if (l.movements > 0) return { status: 409, message: "This location has stock history; deactivate it instead" };
  return null;
}

/** "Back room #2" → "BACKROOM2" (fallback "LOC"), at most 12 characters. */
export function locationCodeFrom(name: string): string {
  const c = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return c || "LOC";
}

/** Signed deltas summed per (location, item), sorted by item then location; null locations count as the default. */
export function netByLocationItem(
  movements: readonly { locationId: string | null; itemId: string; delta: number | string }[],
  defaultLocationId: string,
): { locationId: string; itemId: string; milli: number }[] {
  const by = new Map<string, { locationId: string; itemId: string; milli: number }>();
  for (const m of movements) {
    const locationId = m.locationId ?? defaultLocationId;
    const key = `${m.itemId}|${locationId}`;
    const cur = by.get(key) ?? { locationId, itemId: m.itemId, milli: 0 };
    cur.milli += toMilli(m.delta);
    by.set(key, cur);
  }
  return [...by.entries()]
    .filter(([, v]) => v.milli !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => v);
}
