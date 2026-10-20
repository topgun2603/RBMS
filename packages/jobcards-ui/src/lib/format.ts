import { formatINR } from "@srirealtime/gst";

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

/** Paise → "120.50" for an input (empty for 0 when `blankZero`). */
export const paiseToInput = (paise: number, blankZero = false) => (blankZero && !paise ? "" : (paise / 100).toFixed(2).replace(/\.00$/, ""));

/** Prescription power as opticians write it: "+1.25", "-0.50", "0.00"; empty for none. */
export function power(v: unknown): string {
  if (typeof v !== "number") return "";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

/** "JC-0012" (the API sends `label`; this is for places that only have the number). */
export const jobLabel = (n: number) => `JC-${String(n).padStart(4, "0")}`;
