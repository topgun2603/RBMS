import { browserStore, type KeyValueStore } from "./config";

/**
 * Device-local log of drawer openings that weren't sales ("No sale"), newest last, capped. This is the minimum
 * audit trail until the server records them; it lives on the counter PC only.
 */
export interface DrawerLogEntry {
  at: string;
  kind: "no_sale" | "cash_sale" | "test";
  user?: string | null;
  ok: boolean;
  note?: string;
}

const KEY = "sr_print:drawer-log";
const MAX = 200;

export function readDrawerLog(store: KeyValueStore | null = browserStore()): DrawerLogEntry[] {
  try {
    const raw = store?.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as DrawerLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function logDrawer(entry: Omit<DrawerLogEntry, "at"> & { at?: string }, store: KeyValueStore | null = browserStore()): void {
  const full: DrawerLogEntry = { ...entry, at: entry.at ?? new Date().toISOString() };
  try {
    store?.setItem(KEY, JSON.stringify([...readDrawerLog(store), full].slice(-MAX)));
  } catch {
    // storage unavailable: the console line below is all there is
  }
  // eslint-disable-next-line no-console
  console.info("[drawer]", full.kind, full.ok ? "opened" : "failed", full.user ?? "", full.note ?? "");
}
