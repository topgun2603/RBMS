import { PUBLIC_API_ORIGIN } from "./tenant";

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Paise → "₹1,299" (or "₹1,299.50" when there are paise). Digits stay Latin in Tamil too (as on price tags). */
export function money(paise: number | null | undefined): string {
  const p = Math.round(paise ?? 0);
  return p % 100 === 0 ? inr0.format(p / 100) : inr2.format(p / 100);
}

/** Percent off MRP, rounded down; 0 when there's no real discount. */
export function percentOff(price: number, mrp: number | null | undefined): number {
  if (!mrp || mrp <= price || price <= 0) return 0;
  return Math.floor(((mrp - price) / mrp) * 100);
}

/** Upload paths the API returns relative to its origin become absolute; http(s) URLs pass through. */
export function imageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  return `${PUBLIC_API_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function formatDate(value: string | Date, locale: string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  try {
    return new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { timeZone: "Asia/Kolkata", ...opts }).format(new Date(value));
  } catch {
    return String(value);
  }
}

/** Delivery ETA as a date range from today ("18 – 20 Oct"). */
export function etaRange(days: [number, number], locale: string): string {
  const now = Date.now();
  const d = (n: number) => new Date(now + n * 86_400_000);
  const fmt = (x: Date) => formatDate(x, locale, { day: "numeric", month: "short" });
  return days[0] === days[1] ? fmt(d(days[0])) : `${fmt(d(days[0]))} – ${fmt(d(days[1]))}`;
}

/** Initial letters for an image placeholder ("Anarkali Kurti" → "AK"). */
export function initialsOf(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

/** Stable 0–359 hue offset from a string (placeholder tints vary per product, around the brand colour). */
export function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** "+919876543210" → "98765 43210". */
export function prettyPhone(p: string | null | undefined): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : p;
}

/** Indian mobile → "+91XXXXXXXXXX", or null. */
export function normalizeMobile(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}
