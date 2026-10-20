import { formatINR } from "@srirealtime/gst";

/** ₹ with Indian grouping from integer paise. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** "12.5" / "12,500.50" → paise; empty or invalid → null. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[,\s₹]/g, "");
  if (!s) return null;
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
