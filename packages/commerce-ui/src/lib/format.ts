import { formatINR } from "@srirealtime/gst";

/** ₹ with Indian grouping from integer paise. Always en-IN digits, also in Tamil. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** "₹499" or "₹499 – ₹899" for a product's variants. */
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

/** Percentage off MRP (whole number), null when there is no discount. */
export function discountPct(price: number, mrp: number | null | undefined): number | null {
  if (!mrp || mrp <= price) return null;
  return Math.round(((mrp - price) / mrp) * 100);
}

/** URL slug from a name (Latin letters and digits; other scripts drop out). Empty when nothing usable is left. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Every combination of option values, in option order: [{Size: "S", Colour: "Red"}, …]. */
export function cartesian(options: { name: string; values: string[] }[]): Record<string, string>[] {
  const used = options.filter((o) => o.name.trim() && o.values.length > 0);
  if (used.length === 0) return [];
  let out: Record<string, string>[] = [{}];
  for (const o of used) {
    const next: Record<string, string>[] = [];
    for (const combo of out) for (const v of o.values) next.push({ ...combo, [o.name.trim()]: v });
    out = next;
  }
  return out;
}

/** "M / Red" from option values in option order. */
export function variantTitle(values: Record<string, string>, options: { name: string }[]): string {
  const ordered = options.map((o) => values[o.name.trim()]).filter((v): v is string => !!v);
  const rest = Object.entries(values)
    .filter(([k]) => !options.some((o) => o.name.trim() === k))
    .map(([, v]) => v);
  return [...ordered, ...rest].join(" / ");
}

/** Stable key for a set of option values (order-insensitive). */
export const comboKey = (values: Record<string, string>) =>
  JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));

/** Trims strings; empty → null (optional API fields). */
export const orNull = (s: string | null | undefined) => {
  const v = (s ?? "").trim();
  return v === "" ? null : v;
};
