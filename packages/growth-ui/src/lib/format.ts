import { formatINR } from "@srirealtime/gst";

/** ₹ with Indian grouping from integer paise. Always en-IN digits, also in Tamil. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** Compact ₹ for chart ticks: ₹1.2L, ₹3.4Cr, ₹950. */
export function compactINR(paise: number): string {
  const r = paise / 100;
  const abs = Math.abs(r);
  if (abs >= 1e7) return `₹${trim(r / 1e7)}Cr`;
  if (abs >= 1e5) return `₹${trim(r / 1e5)}L`;
  if (abs >= 1e3) return `₹${trim(r / 1e3)}K`;
  return `₹${Math.round(r)}`;
}
const trim = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, ""));

/** "12.5" / "12,500.50" → paise; empty or invalid → null. */
export function rupeesToPaise(input: string): number | null {
  const s = input.replace(/[,\s₹]/g, "");
  if (!s) return null;
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === ".") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** 123450 → "1234.5" (plain, for an input). */
export function paiseToInput(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const r = Math.round(paise) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2).replace(/0$/, "");
}

/** Points / counts with Indian grouping. */
export const num = (n: number | null | undefined) => new Intl.NumberFormat("en-IN").format(n ?? 0);

/** Today in IST as YYYY-MM-DD. */
export function todayIST(offsetDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
}

/** First day of the IST month, YYYY-MM-DD. */
export const monthStartIST = () => `${todayIST().slice(0, 7)}-01`;

/** "+919876543210" → "98765 43210"; anything else unchanged. */
export function displayPhone(key: string | null | undefined): string {
  if (!key) return "";
  const m = /^\+91([6-9]\d{4})(\d{5})$/.exec(key);
  return m ? `${m[1]} ${m[2]}` : key;
}

/** Digits a phone search should send ("98765 43210" → "9876543210"); text searches pass through. */
export const searchTerm = (q: string) => (/^[\d\s+()-]+$/.test(q.trim()) ? q.replace(/\D/g, "") : q.trim());
