// Pure helpers for the Order settings page (settings namespace "orders"). Unit-tested.
import { todayIST } from "./format";
import type { OrderSettings } from "./types";

export const DEFAULT_ORDER_SETTINGS: OrderSettings = { prefix: "ORD", invoiceOn: "delivered", allowBackorder: false, autoConfirm: false, notifyOwner: true };

/** Server values over the defaults (the namespace may be partly set). */
export const withDefaults = (v: Partial<OrderSettings> | undefined): OrderSettings => ({ ...DEFAULT_ORDER_SETTINGS, ...(v ?? {}) });

export const PREFIX_RE = /^[A-Z0-9-]{1,6}$/;

/** "ORD" → "ORD/26-27/0001" (the financial year starts in April, IST). */
export function sampleNumber(prefix: string, today = todayIST()): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${prefix || "ORD"}/${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}/0001`;
}
