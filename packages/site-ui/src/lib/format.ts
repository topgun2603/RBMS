import { formatINR } from "@rbms/gst";

/** ₹ with Indian grouping from integer paise. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

export function priceRange(min: number, max: number): string {
  return min === max ? money(min) : `${money(min)} – ${money(max)}`;
}

/** "12.5" / "12,500.50" → paise; empty or invalid → null. */
export function rupeesToPaise(input: string | null | undefined): number | null {
  const s = (input ?? "").replace(/[,\s₹]/g, "");
  if (!s) return null;
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** 123450 → "1234.5" (plain, for an input). 0 → "". */
export function paiseToInput(paise: number | null | undefined): string {
  if (!paise) return "";
  const r = Math.round(paise) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
}

/** ₹12.9K / ₹4.2L / ₹1.1Cr from paise. */
export function compactINR(paise: number | null | undefined, opts: { decimals?: number; symbol?: boolean } = {}): string {
  const rupees = Math.round(paise ?? 0) / 100;
  const sign = rupees < 0 ? "−" : "";
  const abs = Math.abs(rupees);
  const sym = opts.symbol === false ? "" : "₹";
  const d = opts.decimals ?? 1;
  const fmt = (n: number, unit: string) => `${sign}${sym}${n.toFixed(d).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")}${unit}`;
  if (abs >= 1e7) return fmt(abs / 1e7, "Cr");
  if (abs >= 1e5) return fmt(abs / 1e5, "L");
  if (abs >= 1e3) return fmt(abs / 1e3, "K");
  return `${sign}${sym}${Math.round(abs).toLocaleString("en-IN")}`;
}

const compactNum = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
export const compactCount = (n: number) => (Math.abs(n) < 1000 ? String(Math.round(n)) : compactNum.format(n));

/** "2.5 %" style percentage with up to 1 decimal. */
export const pct = (n: number, decimals = 1) => `${Number.isInteger(n) ? n : n.toFixed(decimals).replace(/\.0$/, "")}%`;

/** URL slug from a title (Latin letters and digits); empty when nothing usable is left. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/** Keeps a slug input tidy while typing (lowercase, hyphens for anything else, no doubled hyphens). */
export const cleanSlugInput = (v: string) => v.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-{2,}/g, "-").slice(0, 80);

/** Axis ticks for paise: "0", "1.2K", "4.5L" (no ₹ sign). */
export const tickINR = (paise: number) => (paise === 0 ? "0" : compactINR(paise, { decimals: 1, symbol: false }));

/** Percentage change from `prev` to `cur`; null when there is no base. */
export function pctChange(cur: number, prev: number | null | undefined): number | null {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
