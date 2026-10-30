import { formatINR } from "@rbms/gst";

/** ₹ with Indian grouping from integer paise. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** "1500" / "1,500.50" / "₹ 1500" → paise; empty or invalid → null. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[,\s₹]/g, "");
  if (!s) return null;
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Paise → "1500" / "1500.50" for an amount input. */
export const paiseToRupees = (paise: number | null | undefined) => (paise === null || paise === undefined ? "" : paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

/** Basis points → "12" / "0.75" (percent, for an input). */
export const bpToPercent = (bp: number) => String(Math.round(bp) / 100);

/** "12" / "0.75" → basis points; invalid → null. */
export function percentToBp(input: string): number | null {
  const s = input.trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  return n <= 10_000 ? n : null;
}

/** Whole or half days ("1", "0.5", "-2") → number; invalid → null. */
export function parseHalfDays(input: string, allowNegative = false): number | null {
  const s = input.trim();
  if (!(allowNegative ? /^-?\d{1,3}(\.5|\.0)?$/ : /^\d{1,3}(\.5|\.0)?$/).test(s)) return null;
  return Number(s);
}

/** Minutes → "1h 05m" / "45m". */
export function minutesLabel(min: number): string {
  if (!min) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** An ISO instant → "09:42" IST. */
export function istTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

/** Today in IST, "YYYY-MM-DD". */
export const todayIst = (now: Date = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** "2026-10" → "2026-11" (n months later; negative goes back). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "2026-10" → "October 2026" in the UI language. */
export function monthName(month: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T00:00:00Z`));
}

/** 0 = Sunday → short weekday name. */
export function weekdayName(d: number, locale: string, style: "short" | "long" = "short"): string {
  // 2026-10-04 is a Sunday.
  return new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2026, 9, 4 + d)));
}

/** 1–12 → month name. */
export function monthOfYear(m: number, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, m - 1, 15)));
}

/** "HH:MM". */
export const isHm = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** Hours with one decimal from minutes. */
export const hours = (min: number) => Math.round((min / 60) * 10) / 10;
