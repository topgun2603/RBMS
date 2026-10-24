import type { PosItem } from "./ports";
import type { OfflineFlag, VoidedSeq } from "./schema";

/** Pure rules of offline billing (docs/offline-billing.md). */

/** Indian financial year of a bill date, "26-27" for 2026-10-14 (the same text `financialYear` in @srirealtime/gst gives). */
export function financialYearOf(date: string): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  const yy = (n: number) => String(n % 100).padStart(2, "0");
  return `${yy(start)}-${yy(start + 1)}`;
}

export interface BlockRange {
  fromSeq: number;
  toSeq: number;
  voided: readonly Pick<VoidedSeq, "seq">[];
}

export const inRange = (b: Pick<BlockRange, "fromSeq" | "toSeq">, seq: number) => Number.isInteger(seq) && seq >= b.fromSeq && seq <= b.toSeq;

/** Numbers of the block that no bill holds and nobody has voided yet. */
export function unusedSeqs(b: BlockRange, held: Iterable<number>): number[] {
  const taken = new Set<number>(held);
  for (const v of b.voided) taken.add(v.seq);
  const out: number[] = [];
  for (let s = b.fromSeq; s <= b.toSeq; s++) if (!taken.has(s)) out.push(s);
  return out;
}

/** "OFF-A1B2-0007": a slip number that can't be mistaken for an invoice number. */
export function provisionalNumber(deviceId: string, n: number): string {
  const tag = deviceId
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(-4)
    .toUpperCase()
    .padStart(4, "0");
  return `OFF-${tag}-${String(n).padStart(4, "0")}`;
}

/** The payments still to record when `alreadyPaid` paise are on the bill (a retry after a crash half-way). */
export function remainingPayments<P extends { amount: number }>(planned: readonly P[], alreadyPaid: number): P[] {
  let skip = Math.max(Math.round(alreadyPaid), 0);
  const out: P[] = [];
  for (const p of planned) {
    if (skip >= p.amount) {
      skip -= p.amount;
      continue;
    }
    out.push(skip > 0 ? { ...p, amount: p.amount - skip } : p);
    skip = 0;
  }
  return out;
}

export interface LineLike {
  itemId?: string;
  [k: string]: unknown;
}

/**
 * Compares the offline lines with the catalogue as it is now. An item that is gone (deleted, archived, store-only) loses
 * its `itemId` so the bill still posts as a free-text line (`item_missing`). A catalogue price or GST rate that differs
 * from what the cashier saw offline (`snapshots`) is flagged, never applied: the offline price stays as sold.
 */
export function reconcileLines<L extends LineLike>(
  lines: readonly L[],
  snapshots: readonly { itemId: string; price: number; gstRate: number }[],
  current: ReadonlyMap<string, Pick<PosItem, "price" | "gstRate">>,
): { lines: L[]; flags: OfflineFlag[] } {
  const flags: OfflineFlag[] = [];
  const seen = new Map(snapshots.map((s) => [s.itemId, s]));
  const out = lines.map((line, i) => {
    const id = line.itemId;
    if (!id) return line;
    const now = current.get(id);
    if (!now) {
      flags.push({ code: "item_missing", line: i, detail: { itemId: id } });
      const { itemId: _gone, ...rest } = line;
      return rest as L;
    }
    const was = seen.get(id);
    if (was && was.price !== now.price) flags.push({ code: "price_changed", line: i, detail: { itemId: id, offlinePrice: was.price, currentPrice: now.price } });
    if (was && was.gstRate !== now.gstRate) flags.push({ code: "tax_changed", line: i, detail: { itemId: id, offlineGst: was.gstRate, currentGst: now.gstRate } });
    return line;
  });
  return { lines: out, flags };
}

/** `stock_negative` for every kept line whose item is now below zero after the sale. */
export function negativeStockFlags(lines: readonly LineLike[], stock: ReadonlyMap<string, number>): OfflineFlag[] {
  const flags: OfflineFlag[] = [];
  lines.forEach((l, i) => {
    const q = l.itemId ? stock.get(l.itemId) : undefined;
    if (q !== undefined && q < 0) flags.push({ code: "stock_negative", line: i, detail: { itemId: l.itemId, stock: q } });
  });
  return flags;
}

/** A bill synced more than a day after it was made. */
export const LATE_SYNC_MS = 24 * 60 * 60_000;
export const isLate = (billedAt: Date, now: Date) => now.getTime() - billedAt.getTime() > LATE_SYNC_MS;

/** Whether a failure is worth retrying by itself (service trouble, quota) or needs the shop to change something first. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 402 || status === 408 || status === 409 || status === 423 || status === 429;
}
