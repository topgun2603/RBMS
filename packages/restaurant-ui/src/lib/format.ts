import { formatINR } from "@srirealtime/gst";

/** ₹ with Indian grouping from integer paise. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** Quantities: up to 3 decimals, no trailing zeros. */
export const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

/** Whole minutes since an ISO time (never negative). */
export const minutesSince = (iso: string, now: number = Date.now()) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));

/** "12 min" / "1 h 05 m" */
export function elapsed(min: number): string {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} m`;
}
