import { formatINR } from "@rbms/gst";

/** ₹ with Indian grouping from integer paise. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** Quantities: up to 3 decimals, Indian grouping, no trailing zeros. */
export const qty = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

/** "12.5" / "12,500.50" → paise; empty or invalid → null. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[,\s₹]/g, "");
  if (!s) return null;
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** "2027-03-31" → "03/2027" (how strips print expiry). */
export const expiryLabel = (date: string) => `${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** This month plus `months` as "YYYY-MM" (default for the expiry month input). */
export function monthFromNow(months: number, now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
  return d.toISOString().slice(0, 7);
}
