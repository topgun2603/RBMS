import { formatINR } from "@srirealtime/gst";
import type { StatusTone } from "@srirealtime/ui";

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
export const paiseToRupees = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

/** Plan length presets: months as the desk says them, days as the API stores them. */
export const DURATION_PRESETS = [
  { months: 1, days: 30 },
  { months: 3, days: 90 },
  { months: 6, days: 180 },
  { months: 12, days: 365 },
] as const;

/** The preset a stored duration matches, or null (custom days). */
export const presetFor = (days: number) => DURATION_PRESETS.find((p) => p.days === days) ?? null;

/** Colour of the "ends on" pill: red once ended, amber inside the expiring window, green otherwise. */
export function daysLeftTone(daysLeft: number, expiringDays = 7): StatusTone {
  if (daysLeft < 0) return "danger";
  if (daysLeft <= expiringDays) return "warning";
  return "success";
}

/** "+919876543210" → "98765 43210" (other formats unchanged). */
export function phoneLabel(phone: string | null | undefined): string {
  if (!phone) return "";
  const m = phone.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `${m[1]} ${m[2]}` : phone;
}

/** The day a renewal starts: the day after the current plan ends, or today once it has ended (as the API does). */
export function renewalStart(endDate: string, today: string): string {
  const next = new Date(Date.parse(`${endDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return next > today ? next : today;
}
