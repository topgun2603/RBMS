import { formatINR } from "@rbms/gst";

/** ₹ with Indian grouping from integer paise. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** Grams with 3 decimals: "10.500 g". */
export const grams = (g: number | null | undefined) => `${(g ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} g`;

/** "12.5" / "12,500.50" → paise; empty or invalid → null. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[,\s₹]/g, "");
  if (!s) return null;
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Paise → an input value in rupees ("7250.5"). */
export const paiseToInput = (paise: number | null | undefined) => (paise == null ? "" : String(paise / 100));

/** A decimal typed in an input ("10.25"), up to `decimals` places; empty or invalid → null. */
export function parseDecimal(input: string, decimals: number): number | null {
  const s = input.replace(/[,\s]/g, "");
  if (!s || s === ".") return null;
  if (!new RegExp(`^\d*\.?\d{0,${decimals}}$`).test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Keeps digits and one dot while typing. */
export const decimalInput = (v: string) => v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
