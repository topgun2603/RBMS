import type { Product, ProductSummary } from "../types";

/**
 * Compare list (pure): up to `COMPARE_MAX` products kept in the shopper's browser (localStorage `sr_compare`). Each
 * entry carries what the tray shows (name, picture, link); the compare page loads the rest by id.
 */
export const COMPARE_KEY = "sr_compare";
export const COMPARE_EVENT = "sr:compare";
export const COMPARE_MAX = 4;

export type CompareItem = Pick<ProductSummary, "id" | "slug" | "name" | "image">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stored JSON → a clean list (bad entries and duplicates dropped, capped). */
export function parseCompare(raw: string | null | undefined): CompareItem[] {
  let v: unknown;
  try {
    v = JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: CompareItem[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object") continue;
    const { id, slug, name, image } = x as Record<string, unknown>;
    if (typeof id !== "string" || !UUID.test(id) || typeof slug !== "string" || out.some((o) => o.id === id)) continue;
    out.push({ id, slug, name: typeof name === "string" ? name : slug, image: typeof image === "string" ? image : null });
    if (out.length === COMPARE_MAX) break;
  }
  return out;
}

export type CompareResult = { list: CompareItem[]; status: "added" | "removed" | "full" };

/** Adds (at the end) or removes the product; a full list stays as it is (`full`). */
export function toggleCompare(list: readonly CompareItem[], item: CompareItem, max = COMPARE_MAX): CompareResult {
  if (list.some((x) => x.id === item.id)) return { list: list.filter((x) => x.id !== item.id), status: "removed" };
  if (list.length >= max) return { list: [...list], status: "full" };
  return { list: [...list, { id: item.id, slug: item.slug, name: item.name, image: item.image ?? null }], status: "added" };
}

export const removeCompare = (list: readonly CompareItem[], id: string) => list.filter((x) => x.id !== id);

// ------------------------------------------------------------------ the compare table

export interface CompareRow {
  key: string;
  label: string;
  /** One cell per product ("" = not given). */
  values: string[];
  /** The products don't all have the same value. */
  differs: boolean;
}

const norm = (v: string) => v.trim().toLowerCase();

/** True when at least two products have different (non-empty or empty) values. */
export const valuesDiffer = (values: readonly string[]) => values.length > 1 && new Set(values.map(norm)).size > 1;

/**
 * The spec rows of the compare table, from what the catalogue holds: brand, category, each option (its values) and
 * every attribute any of the products has (in first-seen order). Price, rating and stock are rendered separately.
 */
export function compareRows(products: readonly Pick<Product, "brand" | "categoryName" | "options" | "attributes" | "unit">[], labels: { brand: string; category: string }): CompareRow[] {
  const rows: CompareRow[] = [];
  const add = (key: string, label: string, values: string[]) => {
    if (values.every((v) => !v.trim())) return;
    rows.push({ key, label, values, differs: valuesDiffer(values) });
  };
  add("brand", labels.brand, products.map((p) => p.brand ?? ""));
  add("category", labels.category, products.map((p) => p.categoryName ?? ""));
  const optionNames: string[] = [];
  for (const p of products) for (const o of p.options ?? []) if (!optionNames.some((n) => norm(n) === norm(o.name))) optionNames.push(o.name);
  for (const name of optionNames) {
    add(`opt.${name}`, name, products.map((p) => (p.options ?? []).find((o) => norm(o.name) === norm(name))?.values.join(", ") ?? ""));
  }
  const attrNames: string[] = [];
  for (const p of products) for (const k of Object.keys(p.attributes ?? {})) if (!attrNames.includes(k)) attrNames.push(k);
  for (const k of attrNames) add(`attr.${k}`, k, products.map((p) => String(p.attributes?.[k] ?? "")));
  return rows;
}
