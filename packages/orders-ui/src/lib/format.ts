import { formatINR, GST_STATES } from "@srirealtime/gst";

/** ₹ with Indian grouping from integer paise. Always en-IN digits, also in Tamil. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** "₹1.2L" style compact rupees for tight tiles (en-IN grouping). */
export function moneyCompact(paise: number | null | undefined): string {
  const r = Math.round(paise ?? 0) / 100;
  if (Math.abs(r) >= 1_00_00_000) return `₹${trim(r / 1_00_00_000)}Cr`;
  if (Math.abs(r) >= 1_00_000) return `₹${trim(r / 1_00_000)}L`;
  if (Math.abs(r) >= 1_000) return `₹${trim(r / 1_000)}K`;
  return money(paise);
}
const trim = (n: number) => (Math.round(n * 10) / 10).toString();

/** "12.5" / "12,500.50" / "₹ 99" → paise; empty or invalid → null. */
export function rupeesToPaise(input: string | null | undefined): number | null {
  const s = (input ?? "").replace(/[,\s₹]/g, "");
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

const qtyFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
export const formatQty = (n: number | null | undefined) => qtyFormatter.format(n ?? 0);

/** Decimal quantity input: up to 3 places. Invalid → null. */
export function parseQty(input: string): number | null {
  const s = input.replace(/[,\s]/g, "");
  if (!s || !/^\d*\.?\d{0,3}$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Keeps digits and one dot, max 3 decimals (quantity inputs). */
export function cleanQty(v: string): string {
  const s = v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
  const m = /^(\d*)(\.?\d{0,3})/.exec(s);
  return m ? m[1]! + m[2]! : "";
}

/** Keeps digits only, up to `max` characters (pincodes, whole numbers). */
export const digitsOnly = (v: string, max = 12) => v.replace(/\D/g, "").slice(0, max);

/** Trims strings; empty → null (optional API fields). */
export const orNull = (s: string | null | undefined) => {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
};

// ------------------------------------------------------------------ IST dates

const IST = "Asia/Kolkata";

/** A Date (or ISO string) as its IST calendar day, YYYY-MM-DD. */
export function istDate(value: Date | string | number = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Today's date in IST as YYYY-MM-DD. */
export const todayIST = (now: Date = new Date()) => istDate(now);

/** "2026-10-14" + 15 → "2026-10-29" (calendar arithmetic, no timezone drift). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

export const DATE_PRESETS = ["all", "today", "yesterday", "7d", "30d", "month", "custom"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

/** IST date range for a preset (inclusive YYYY-MM-DD bounds); "all" → no bounds. */
export function presetRange(preset: DatePreset, today = todayIST()): { from?: string; to?: string } {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    default:
      return {};
  }
}

/** Whole days between two YYYY-MM-DD dates. */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// ------------------------------------------------------------------ places and people

export function stateName(code: string | null | undefined): string {
  if (!code) return "";
  return GST_STATES.find((s) => s.code === code)?.name ?? code;
}

/** Address as display lines (name first, then street, landmark, city/district, state + PIN). */
export function addressLines(a: {
  name?: string | null;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  district?: string | null;
  stateCode: string;
  pincode: string;
}): string[] {
  const cityLine = [a.city, a.district && a.district !== a.city ? a.district : null].filter(Boolean).join(", ");
  return [a.line1, a.line2, a.landmark, cityLine, `${stateName(a.stateCode)} – ${a.pincode}`].filter((s): s is string => !!s && s.trim() !== "");
}

/** Digits for wa.me / tel: an Indian 10-digit mobile gets the 91 prefix. Null when it isn't a phone number. */
export function phoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;
  if (d.length >= 8 && d.length <= 15) return d;
  return null;
}

export const telHref = (phone: string | null | undefined) => {
  const d = phoneDigits(phone);
  return d ? `tel:+${d}` : null;
};

export const whatsappHref = (phone: string | null | undefined, text?: string) => {
  const d = phoneDigits(phone);
  if (!d) return null;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
};

/** "+91 98765 43210" for display. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 5)} ${d.slice(5)}`;
  return phone;
}

/** Initials for an avatar ("Anbu Selvan" → "AS"). */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : "")).toUpperCase();
}

/** Grams for display: 1500 → "1.5 kg", 250 → "250 g". */
export function formatGrams(g: number): string {
  if (g >= 1000) return `${qtyFormatter.format(g / 1000)} kg`;
  return `${qtyFormatter.format(g)} g`;
}

/** Normalised coupon code: uppercase, no spaces. */
export const normalizeCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");
export const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
