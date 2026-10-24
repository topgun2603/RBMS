/**
 * Pure rules for batches and expiry (no database). Quantities are integer thousandths ("milli"), as in ./logic.
 * The design follows the pharmacy module's batches (packages/medicines/src/logic.ts): expiry printed as MM/YYYY means
 * the last day of that month, and selling is first-expiry-first-out (FEFO).
 */
import type { DiscountStep, ExpiredPolicy } from "./schema";

/** "2027-03" / "03/2027" / "03-2027" / "2027-03-15" / "15/03/2027" → "YYYY-MM-DD" (month-end for month-only expiries). */
export function normalizeExpiry(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  let y: number;
  let m: number;
  let d: number | null = null;
  let match: RegExpMatchArray | null;
  if ((match = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else if ((match = v.match(/^(\d{4})[-/.](\d{1,2})$/))) [y, m] = [Number(match[1]), Number(match[2])];
  else if ((match = v.match(/^(\d{1,2})[-/.](\d{2}|\d{4})$/))) {
    m = Number(match[1]);
    y = Number(match[2]);
    if (y < 100) y += 2000;
  } else return null;
  if (m < 1 || m > 12 || y < 2000 || y > 2100) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d !== null && (d < 1 || d > last)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d ?? last).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" plus `days` (UTC calendar maths; dates are IST calendar days). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function dateDiffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export type ExpiryStatus = "expired" | "expiring" | "ok" | "none";

/** Expired after its expiry day; "expiring" within `withinDays` of today; "none" when the batch does not expire. */
export function expiryStatus(expiry: string | null | undefined, today: string, withinDays: number): ExpiryStatus {
  if (!expiry) return "none";
  if (expiry < today) return "expired";
  if (expiry <= addDays(today, withinDays)) return "expiring";
  return "ok";
}

/** Days left (negative = days since expiry); null when it does not expire. */
export function daysLeft(expiry: string | null | undefined, today: string): number | null {
  return expiry ? dateDiffDays(today, expiry) : null;
}

export interface BatchStockInput {
  id: string;
  /** Null = does not expire (sold after every dated batch). */
  expiry: string | null;
  /** Milli available at the location. */
  milli: number;
}

export interface BatchAllocation {
  batchId: string;
  milli: number;
}

const byExpiry = (a: BatchStockInput, b: BatchStockInput) => {
  if (a.expiry === b.expiry) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (a.expiry === null) return 1;
  if (b.expiry === null) return -1;
  return a.expiry < b.expiry ? -1 : 1;
};

/**
 * First-expiry-first-out: takes `milli` from the batches with stock, soonest expiry first; batches that do not expire
 * go last. Expired batches are skipped unless `allowExpired`. `preferred` batches are taken first (the one the
 * cashier chose), then the rest FEFO. `short` is what the batches could not cover (it stays "unbatched").
 */
export function fefoAllocate(
  batches: readonly BatchStockInput[],
  milli: number,
  today: string,
  opts: { allowExpired?: boolean; preferred?: readonly { batchId: string; milli: number }[] } = {},
): { allocations: BatchAllocation[]; short: number } {
  let left = Math.max(0, Math.round(milli));
  const usable = batches.filter((b) => b.milli > 0 && (opts.allowExpired || b.expiry === null || b.expiry >= today)).sort(byExpiry);
  const take = new Map<string, number>();
  const room = new Map(usable.map((b) => [b.id, b.milli]));
  for (const p of opts.preferred ?? []) {
    const have = room.get(p.batchId) ?? 0;
    const n = Math.min(have, p.milli, left);
    if (n > 0) {
      take.set(p.batchId, (take.get(p.batchId) ?? 0) + n);
      room.set(p.batchId, have - n);
      left -= n;
    }
  }
  for (const b of usable) {
    if (left <= 0) break;
    const have = room.get(b.id) ?? 0;
    const n = Math.min(have, left);
    if (n > 0) {
      take.set(b.id, (take.get(b.id) ?? 0) + n);
      room.set(b.id, have - n);
      left -= n;
    }
  }
  const allocations = [...take.entries()].map(([batchId, m]) => ({ batchId, milli: m }));
  return { allocations, short: left };
}

/** True when a sale from this batch should be refused / warned about under the shop's policy. */
export function isSaleBlocked(expiry: string | null | undefined, today: string, policy: ExpiredPolicy): boolean {
  return policy === "block" && expiryStatus(expiry, today, 0) === "expired";
}

export const DEFAULT_LADDER: DiscountStep[] = [
  { days: 30, pct: 20 },
  { days: 60, pct: 10 },
  { days: 90, pct: 5 },
];

/**
 * Suggested discount for a batch with `left` days to go: the row with the smallest `days` that still covers `left`.
 * Expired batches get no suggestion (they should not be sold); null when nothing applies.
 */
export function suggestDiscount(left: number | null, ladder: readonly DiscountStep[] = DEFAULT_LADDER): number | null {
  if (left === null || left < 0) return null;
  const rows = [...ladder].sort((a, b) => a.days - b.days);
  const hit = rows.find((r) => left <= r.days);
  return hit ? hit.pct : null;
}

/** Splits a total across `parts` by weight, largest-remainder, so the pieces add up exactly. */
export function splitMilli(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const floor = raw.map(Math.floor);
  let rest = total - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (const o of order) {
    if (rest <= 0) break;
    floor[o.i]! += 1;
    rest -= 1;
  }
  return floor;
}

export interface CountEntry {
  counter: string;
  mode: "add" | "set";
  milli: number;
}

/**
 * Merges the entries of several counters into one count: each counter's total is its latest "set" plus the "add"s after
 * it (entries are in time order); the line's count is the sum over counters. Null when nobody has counted.
 */
export function mergeCounts(entries: readonly CountEntry[]): number | null {
  if (entries.length === 0) return null;
  const per = new Map<string, number>();
  for (const e of entries) per.set(e.counter, e.mode === "set" ? e.milli : (per.get(e.counter) ?? 0) + e.milli);
  let total = 0;
  for (const v of per.values()) total += v;
  return total;
}

export interface VarianceInput {
  systemMilli: number;
  countedMilli: number | null;
  unitCost: number | null;
}

/** Variance of one line: counted − system (null count = not counted → no variance) and its value at cost (paise). */
export function lineVariance(l: VarianceInput): { varianceMilli: number; value: number } {
  if (l.countedMilli === null) return { varianceMilli: 0, value: 0 };
  const varianceMilli = l.countedMilli - l.systemMilli;
  return { varianceMilli, value: Math.round((varianceMilli * (l.unitCost ?? 0)) / 1000) };
}

/** Transfer status after a receive: closed when everything is settled, else partially received. */
export function transferStatusAfter(lines: readonly { qty: number; received?: number; damaged?: number; short?: number }[]): "closed" | "partially_received" {
  const open = lines.some((l) => Math.round((l.qty - (l.received ?? 0) - (l.damaged ?? 0) - (l.short ?? 0)) * 1000) > 0);
  return open ? "partially_received" : "closed";
}

/** What is still on the road for one transfer line (qty never negative). */
export function lineInTransit(l: { qty: number; received?: number; damaged?: number; short?: number }): number {
  return Math.max(0, Math.round((l.qty - (l.received ?? 0) - (l.damaged ?? 0) - (l.short ?? 0)) * 1000) / 1000);
}
