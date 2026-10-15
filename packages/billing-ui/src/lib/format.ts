import { formatINR, GST_STATES } from "@srirealtime/gst";

/** ₹ with Indian grouping from integer paise. Always en-IN digits, also in Tamil. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** "12.5" / "12,500.50" → paise; empty or invalid → null. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[,\s₹]/g, "");
  if (!s) return null;
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** 123450 → "1234.5" (plain, for editing in an input). */
export function paiseToInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const r = Math.round(paise) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
}

/** Decimal quantity input: up to 3 places. Invalid → null. */
export function parseQty(input: string): number | null {
  const s = input.replace(/[,\s]/g, "");
  if (!s || !/^\d*\.?\d{0,3}$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Today's date in IST as YYYY-MM-DD. */
export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

/** "2026-10-14" + 15 → "2026-10-29" (calendar arithmetic, no timezone drift). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function stateName(code: string | null | undefined): string {
  if (!code) return "";
  return GST_STATES.find((s) => s.code === code)?.name ?? code;
}

/** "Tamil Nadu (33)" */
export function stateLabel(code: string | null | undefined): string {
  if (!code) return "—";
  const name = stateName(code);
  return name && name !== code ? `${name} (${code})` : code;
}

/** "98765 43210" → "+919876543210"; emails are lowercased; anything else is invalid. */
export function normalizeTarget(raw: string): { target: string; kind: "phone" | "email" | "invalid" } {
  const v = raw.trim();
  if (v.includes("@")) {
    const email = v.toLowerCase();
    return { target: email, kind: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "email" : "invalid" };
  }
  const digits = v.replace(/[^\d+]/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return { target: `+91${digits}`, kind: "phone" };
  if (/^0[6-9]\d{9}$/.test(digits)) return { target: `+91${digits.slice(1)}`, kind: "phone" };
  if (/^91[6-9]\d{9}$/.test(digits)) return { target: `+${digits}`, kind: "phone" };
  if (/^\+\d{8,15}$/.test(digits)) return { target: digits, kind: "phone" };
  return { target: v, kind: "invalid" };
}

/** Digits for a wa.me link: Indian 10-digit numbers get the 91 country code. Null if unusable. */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;
  if (d.length >= 8 && d.length <= 15) return d;
  return null;
}

/** Trims every string field and drops empty ones (for optional API fields). */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    const val = typeof v === "string" ? v.trim() : v;
    if (val === "" || val === undefined || val === null) continue;
    (out as Record<string, unknown>)[k] = val;
  }
  return out;
}

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;
export const UNITS = ["pcs", "nos", "kg", "g", "m", "cm", "l", "ml", "box", "set", "pair", "dozen", "pack", "hr", "day"] as const;

// ---------------------------------------------------------------- v2 helpers

/**
 * Compact Indian money from paise: ₹950, ₹12.9K, ₹4.2L, ₹1.2Cr (K = thousand, L = lakh, Cr = crore).
 * `decimals: 0` gives axis-tick style labels (₹10K, ₹2L).
 */
export function compactINR(paise: number | null | undefined, opts: { decimals?: number; symbol?: boolean } = {}): string {
  const rupees = Math.round(paise ?? 0) / 100;
  const sign = rupees < 0 ? "−" : "";
  const abs = Math.abs(rupees);
  const sym = opts.symbol === false ? "" : "₹";
  const d = opts.decimals ?? 1;
  const fmt = (n: number, unit: string) => {
    const s = n.toFixed(d).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    return `${sign}${sym}${s}${unit}`;
  };
  if (abs >= 1e7) return fmt(abs / 1e7, "Cr");
  if (abs >= 1e5) return fmt(abs / 1e5, "L");
  if (abs >= 1e3) return fmt(abs / 1e3, "K");
  return `${sign}${sym}${new Intl.NumberFormat("en-IN", { maximumFractionDigits: abs < 100 && abs % 1 ? 2 : 0 }).format(abs)}`;
}

/** Axis tick: 0, 10K, 2L, 1Cr (rupees, no symbol, no decimals unless needed). */
export const tickINR = (paise: number) => (paise === 0 ? "0" : compactINR(paise, { decimals: 1, symbol: false }));

const qtyFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
export const formatQty = (n: number | null | undefined) => qtyFormatter.format(n ?? 0);

/** Percentage change from `prev` to `cur`; null when there is no base. */
export function pctChange(cur: number, prev: number | null | undefined): number | null {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

export type RangePreset = "thisMonth" | "lastMonth" | "thisQuarter" | "thisFY" | "lastFY" | "custom";
export const RANGE_PRESETS: RangePreset[] = ["thisMonth", "lastMonth", "thisQuarter", "thisFY", "lastFY", "custom"];

export interface DateRange {
  from: string;
  to: string;
}

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Date range for a preset, in IST calendar terms. The Indian financial year runs April–March. */
export function rangeFor(preset: Exclude<RangePreset, "custom">, today: string = todayIST()): DateRange {
  const [y = 1970, m = 1] = today.split("-").map(Number);
  switch (preset) {
    case "thisMonth":
      return { from: ymd(y, m, 1), to: today };
    case "lastMonth": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return { from: ymd(py, pm, 1), to: ymd(py, pm, lastDay(py, pm)) };
    }
    case "thisQuarter": {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: ymd(y, qm, 1), to: today };
    }
    case "thisFY": {
      const fy = m >= 4 ? y : y - 1;
      return { from: ymd(fy, 4, 1), to: today };
    }
    case "lastFY": {
      const fy = (m >= 4 ? y : y - 1) - 1;
      return { from: ymd(fy, 4, 1), to: ymd(fy + 1, 3, 31) };
    }
  }
}

/** Every date from `from` to `to` inclusive (YYYY-MM-DD), capped at 400 days. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) out.push(d);
  return out;
}
