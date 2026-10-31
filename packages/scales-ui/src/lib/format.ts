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

/** Paise → what goes in a ₹ input: "40", "40.50". */
export function paiseToInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const r = paise / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/** "1.25" / "0,5" → kg (3 decimals); empty or invalid → null. */
export function parseKg(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!/^\d*\.?\d{0,3}$/.test(s) || s === "" || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Splits a scale barcode into its parts for display: prefix · PLU · value · check digit. */
export function barcodeParts(code: string, f: { prefixes: string[]; pluDigits: number; valueDigits: number }) {
  const p = f.prefixes.find((x) => code.startsWith(x))?.length ?? f.prefixes[0]?.length ?? 2;
  return {
    prefix: code.slice(0, p),
    plu: code.slice(p, p + f.pluDigits),
    value: code.slice(p + f.pluDigits, p + f.pluDigits + f.valueDigits),
    check: code.slice(p + f.pluDigits + f.valueDigits),
  };
}
