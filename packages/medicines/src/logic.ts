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
export function fefoAllocate(
  batches: BatchStock[],
  qty: number,
  today: string,
  /** Batches the pharmacist chose at the counter, taken first (up to the qty named for each), then the rest FEFO. */
  preferred: readonly Allocation[] = [],
): { allocations: Allocation[]; short: number } {
  let left = roundQty(qty);
  const taken = new Map<string, number>();
  const usable = batches.filter((b) => b.qty > 0 && b.expiry >= today).sort((a, b) => (a.expiry === b.expiry ? a.id.localeCompare(b.id) : a.expiry < b.expiry ? -1 : 1));
  const room = new Map(usable.map((b) => [b.id, b.qty]));
  const take = (id: string, want: number) => {
    const n = roundQty(Math.min(room.get(id) ?? 0, want, left));
    if (n <= 0) return;
    taken.set(id, roundQty((taken.get(id) ?? 0) + n));
    room.set(id, roundQty((room.get(id) ?? 0) - n));
    left = roundQty(left - n);
  };
  for (const p of preferred) take(p.batchId, p.qty);
  for (const b of usable) {
    if (left <= 0) break;
    take(b.id, left);
  }
  return { allocations: [...taken].map(([batchId, q]) => ({ batchId, qty: q })), short: Math.max(0, left) };
}

/** Quantity per (item, chosen batch) from the bill's lines; lines without a batch choice are left out. */
export function chosenBatches(lines: { itemId?: string | null; qty: number; batchId?: string | null }[]): Map<string, Allocation[]> {
  const out = new Map<string, Allocation[]>();
  for (const l of lines) {
    if (!l.itemId || !l.batchId || !(l.qty > 0)) continue;
    const list = out.get(l.itemId) ?? [];
    const same = list.find((a) => a.batchId === l.batchId);
    if (same) same.qty = roundQty(same.qty + l.qty);
    else list.push({ batchId: l.batchId, qty: roundQty(l.qty) });
    out.set(l.itemId, list);
  }
  return out;
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
