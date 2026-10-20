/** Quantities are numeric(14,3): round to 3 decimals so float sums don't drift. */
export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

/** "2027-03" / "03/2027" / "2027-03-15" → the last day the batch may be sold, "YYYY-MM-DD" (month-end for month expiries). */
export function normalizeExpiry(value: string): string | null {
  const v = value.trim();
  let y: number;
  let m: number;
  let d: number | null = null;
  let match: RegExpMatchArray | null;
  if ((match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(\d{4})-(\d{1,2})$/))) [y, m] = [Number(match[1]), Number(match[2])];
  else if ((match = v.match(/^(\d{1,2})\/(\d{2}|\d{4})$/))) {
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
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export type ExpiryStatus = "expired" | "expiring" | "ok";

/** Expired after its expiry day; "expiring" within `withinDays` of today. */
export function expiryStatus(expiry: string, today: string, withinDays: number): ExpiryStatus {
  if (expiry < today) return "expired";
  if (expiry <= addDays(today, withinDays)) return "expiring";
  return "ok";
}

export interface BatchStock {
  id: string;
  expiry: string;
  qty: number;
}

export interface Allocation {
  batchId: string;
  qty: number;
}

/**
 * First-expiry-first-out: takes `qty` from the unexpired batches with stock, soonest expiry first. Expired batches are
 * never sold. `short` is what the batches couldn't cover (the sale still goes through; stock is fixed later).
 */
export function fefoAllocate(batches: BatchStock[], qty: number, today: string): { allocations: Allocation[]; short: number } {
  let left = roundQty(qty);
  const allocations: Allocation[] = [];
  const usable = batches.filter((b) => b.qty > 0 && b.expiry >= today).sort((a, b) => (a.expiry === b.expiry ? a.id.localeCompare(b.id) : a.expiry < b.expiry ? -1 : 1));
  for (const b of usable) {
    if (left <= 0) break;
    const take = roundQty(Math.min(b.qty, left));
    allocations.push({ batchId: b.id, qty: take });
    left = roundQty(left - take);
  }
  return { allocations, short: Math.max(0, left) };
}

/** Sums sale quantities per item (a bill can list the same item on several lines). */
export function qtyByItem(lines: { itemId?: string | null; qty: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines) {
    if (!l.itemId || !(l.qty > 0)) continue;
    out.set(l.itemId, roundQty((out.get(l.itemId) ?? 0) + l.qty));
  }
  return out;
}
