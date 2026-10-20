import type { KotStatus } from "./schema";

export const roundQty = (n: number) => Math.round(n * 1000) / 1000;

export interface PricedLine {
  qty: number;
  rate: number;
}

/** Paise: Σ qty × rate (line rates as billed, so GST-inclusive items stay inclusive). */
export function orderAmount(lines: PricedLine[]): number {
  return lines.reduce((sum, l) => sum + Math.round(l.qty * l.rate), 0);
}

/** Groups pending lines by station, keeping their order. Each group becomes one KOT. */
export function groupByStation<T extends { station: string }>(lines: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const l of lines) {
    const key = l.station.trim() || "kitchen";
    out.set(key, [...(out.get(key) ?? []), l]);
  }
  return out;
}

const NEXT: Record<KotStatus, readonly KotStatus[]> = {
  new: ["preparing", "ready", "served", "cancelled"],
  preparing: ["ready", "served", "new"],
  ready: ["served", "preparing"],
  served: ["ready"],
  cancelled: [],
};

/** Moves the kitchen allows: forward through the line, one step back to undo a mis-tap. */
export function canMoveKot(from: KotStatus, to: KotStatus): boolean {
  return from === to || NEXT[from].includes(to);
}

/**
 * Splits the lines for separate bills. `groups` lists line ids per bill; lines not mentioned stay together in a last
 * bill. Empty groups are dropped; an id in two groups or not on the order is an error.
 */
export function splitLines<T extends { id: string }>(lines: T[], groups: string[][]): { bills: T[][]; error?: string } {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const bills: T[][] = [];
  for (const g of groups) {
    const bill: T[] = [];
    for (const id of g) {
      if (!byId.has(id)) return { bills: [], error: "unknown_line" };
      if (seen.has(id)) return { bills: [], error: "line_in_two_bills" };
      seen.add(id);
      bill.push(byId.get(id)!);
    }
    if (bill.length) bills.push(bill);
  }
  const rest = lines.filter((l) => !seen.has(l.id));
  if (rest.length) bills.push(rest);
  return { bills };
}

/** Same item + rate + note on separate lines → one line with the summed quantity (for the bill). */
export function mergeLines<T extends { itemId: string | null; name: string; rate: number; note: string | null; qty: number }>(lines: T[]): T[] {
  const out: T[] = [];
  for (const l of lines) {
    const same = out.find((o) => o.itemId === l.itemId && o.name === l.name && o.rate === l.rate && (o.note ?? "") === (l.note ?? ""));
    if (same) same.qty = roundQty(same.qty + l.qty);
    else out.push({ ...l });
  }
  return out;
}

/** Minutes between two instants, floored (kitchen timers). */
export const minutesSince = (from: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
