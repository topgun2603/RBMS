"use client";

import * as React from "react";
import type { CartLine, CartProduct } from "./cart";
import { countTotal, type DenominationCounts } from "./tender";
import type { PosCustomer } from "./types";

/**
 * Device-local counter state (localStorage), namespaced by shop and cashier: held bills, the day's till session
 * (opening cash, sales made on this counter, closing count), recent and favourite items, the chosen branch.
 * Nothing here is shared between devices. The API has no till/session endpoints yet; when it gets them
 * (e.g. `POST /v1/pos/days` open, `PATCH /v1/pos/days/:id` close with the count, `GET /v1/pos/days?date=`), the
 * `DayRecord` shape maps 1:1 and `openDay` / `closeDay` / cash moves become calls, with this store as the cache.
 * Held bills stay device-local by design (a parked cart at one till).
 */

const PREFIX = "sr_pos";

export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("sr-pos-storage", { detail: key }));
  } catch {
    // Quota or private mode: the counter keeps working in memory.
  }
}

export const storageKey = (kind: string, tenant: string | null | undefined, user?: string | null) =>
  [PREFIX, kind, tenant ?? "-", ...(user === undefined ? [] : [user ?? "-"])].join(":");

/** A localStorage-backed state that follows writes from other tabs and other hooks on the same key. */
export function useLocalState<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const fallbackRef = React.useRef(fallback);
  const [value, setValue] = React.useState<T>(fallback);
  React.useEffect(() => {
    setValue(readJson(key, fallbackRef.current));
    const onChange = (e: Event) => {
      const k = e instanceof StorageEvent ? e.key : (e as CustomEvent<string>).detail;
      if (k === key) setValue(readJson(key, fallbackRef.current));
    };
    window.addEventListener("storage", onChange);
    window.addEventListener("sr-pos-storage", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("sr-pos-storage", onChange);
    };
  }, [key]);
  const set = React.useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = readJson(key, fallbackRef.current);
      const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      writeJson(key, v);
      setValue(v);
    },
    [key],
  );
  return [value, set];
}

// ---------------------------------------------------------------- held bills

export interface HeldBill {
  id: string;
  name: string;
  note: string;
  lines: CartLine[];
  customer: PosCustomer;
  /** Total when held (display only; recalculated on recall). */
  total: number;
  createdAt: string;
}

export const MAX_HOLDS = 30;

export function holdBill(holds: readonly HeldBill[], bill: Omit<HeldBill, "id" | "createdAt">, now = new Date()): HeldBill[] {
  const id = `h${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return [{ ...bill, id, createdAt: now.toISOString() }, ...holds].slice(0, MAX_HOLDS);
}

export const dropHold = (holds: readonly HeldBill[], id: string) => holds.filter((h) => h.id !== id);

// ---------------------------------------------------------------- day (till session)

export interface LocalSale {
  id: string;
  number: string | null;
  total: number;
  at: string;
  /** Money recorded on the bill by method (cash = applied cash, after change). */
  payments: { method: string; amount: number }[];
  credit: number;
  customer: string;
}

export interface DayRecord {
  /** IST date "YYYY-MM-DD". */
  date: string;
  openedAt: string;
  openedBy: string;
  openingCash: number;
  sales: LocalSale[];
  /** Cash taken out / put in during the day (paise, + = in). */
  cashMoves: { at: string; amount: number; note: string }[];
  closedAt?: string;
  closingCount?: DenominationCounts;
  closingCash?: number;
  expectedCash?: number;
  note?: string;
}

export function openDay(date: string, openingCash: number, by: string, now = new Date()): DayRecord {
  return { date, openedAt: now.toISOString(), openedBy: by, openingCash: Math.max(Math.round(openingCash), 0), sales: [], cashMoves: [] };
}

/** Sums of this counter's sales by method. */
export function salesByMethod(day: Pick<DayRecord, "sales">): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of day.sales) {
    for (const p of s.payments) out[p.method] = (out[p.method] ?? 0) + p.amount;
    if (s.credit > 0) out.credit = (out.credit ?? 0) + s.credit;
  }
  return out;
}

/** Cash that should be in the drawer: opening + cash sales + cash moves. */
export function expectedCash(day: Pick<DayRecord, "openingCash" | "sales" | "cashMoves">): number {
  return day.openingCash + (salesByMethod(day).cash ?? 0) + day.cashMoves.reduce((s, m) => s + m.amount, 0);
}

export function closeDay(day: DayRecord, counts: DenominationCounts, note: string, now = new Date()): DayRecord {
  const closingCash = countTotal(counts);
  return { ...day, closedAt: now.toISOString(), closingCount: counts, closingCash, expectedCash: expectedCash(day), note };
}

export function recordSale(day: DayRecord | null, sale: LocalSale): DayRecord | null {
  if (!day || day.closedAt) return day;
  return { ...day, sales: [...day.sales, sale] };
}

// ---------------------------------------------------------------- recent & favourites

export const MAX_RECENT = 24;

export function pushRecent(list: readonly CartProduct[], p: CartProduct): CartProduct[] {
  const slim: CartProduct = { ...p };
  return [slim, ...list.filter((x) => x.itemId !== p.itemId)].slice(0, MAX_RECENT);
}

export function toggleFavourite(list: readonly CartProduct[], p: CartProduct): CartProduct[] {
  return list.some((x) => x.itemId === p.itemId) ? list.filter((x) => x.itemId !== p.itemId) : [...list, { ...p }].slice(0, 48);
}
