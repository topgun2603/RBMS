import { formatINR } from "@srirealtime/gst";

export { todayIST } from "@srirealtime/gst";

/** ₹ with Indian grouping from integer paise. Always en-IN digits, also in Tamil. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** Whole rupees without decimals when they are zero: 50000 → "₹500", 50050 → "₹500.50". */
export function moneyShort(paise: number): string {
  const p = Math.round(paise);
  if (p % 100 === 0) return `₹${(p / 100).toLocaleString("en-IN")}`;
  return money(p);
}

/** "12.5" / "12,500.50" / "₹ 99" → paise; empty or invalid → null. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[,\s₹]/g, "");
  if (!s) return null;
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** 123450 → "1234.5" (plain, for editing in an input). */
export function paiseToInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const r = Math.round(paise) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
}

/** Decimal quantity input: up to 3 places. Invalid or ≤ 0 → null. */
export function parseQty(input: string): number | null {
  const s = input.replace(/[,\s]/g, "");
  if (!s || !/^\d*\.?\d{0,3}$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const qtyFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
export const formatQty = (n: number) => qtyFormatter.format(n);

/** Digits of an Indian mobile: "+91 98765 43210" → "9876543210"; null when it isn't one. */
export function mobileDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(d)) return d;
  if (/^0[6-9]\d{9}$/.test(d)) return d.slice(1);
  if (/^91[6-9]\d{9}$/.test(d)) return d.slice(2);
  return null;
}

/** "+919876543210" for an Indian mobile, else null. */
export const e164 = (raw: string | null | undefined) => {
  const d = mobileDigits(raw);
  return d ? `+91${d}` : null;
};

/** Short local time "14:05". */
export const timeShort = (d: Date | string | number) =>
  new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date(d));
