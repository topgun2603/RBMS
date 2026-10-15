/** URL-driven listing state: everything a product listing shows lives in its query string (SSR + shareable). */

export type Params = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 24;
export const SORTS = ["relevance", "new", "price-asc", "price-desc", "rating"] as const;
export type Sort = (typeof SORTS)[number];

/** Store URL keys: q, cat (category id), min/max (rupees), stock=1, sort, page, attr.<Name>, opt.<Name> (repeatable). */
export const LISTING_KEYS = ["q", "cat", "min", "max", "stock", "sort", "page"] as const;

export function toSearchParams(p: Params): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) if (x !== "") out.append(k, x);
  }
  return out;
}

/** `path?…` with some keys changed (undefined/[] removes them). Changing a filter resets the page. */
export function hrefWith(path: string, current: Params, changes: Params, opts: { keepPage?: boolean } = {}): string {
  const next: Params = { ...current };
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined || (Array.isArray(v) && v.length === 0)) delete next[k];
    else next[k] = v;
  }
  if (!opts.keepPage && !("page" in changes)) delete next.page;
  const qs = toSearchParams(next).toString();
  return qs ? `${path}?${qs}` : path;
}

export const valuesOf = (p: Params, key: string): string[] => {
  const v = p[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};

/** Toggles one value of a repeatable key. */
export function toggleHref(path: string, current: Params, key: string, value: string): string {
  const vals = valuesOf(current, key);
  const next = vals.includes(value) ? vals.filter((v) => v !== value) : [...vals, value];
  return hrefWith(path, current, { [key]: next });
}

const rupeesToPaise = (v: string | undefined) => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

/** Store query → API `/catalog/public/search` query. */
export function apiSearchQuery(p: Params, fixed: { categoryId?: string; q?: string } = {}): Record<string, string | string[] | number | undefined> {
  const page = Math.max(1, Math.min(400, Number(valuesOf(p, "page")[0]) || 1));
  const sort = valuesOf(p, "sort")[0];
  const q: Record<string, string | string[] | number | undefined> = {
    q: fixed.q ?? valuesOf(p, "q")[0],
    categoryId: fixed.categoryId ?? valuesOf(p, "cat")[0],
    priceMin: rupeesToPaise(valuesOf(p, "min")[0]),
    priceMax: rupeesToPaise(valuesOf(p, "max")[0]),
    inStock: valuesOf(p, "stock")[0] === "1" ? "1" : undefined,
    sort: SORTS.includes(sort as Sort) ? sort : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };
  for (const [k, v] of Object.entries(p)) if ((k.startsWith("attr.") || k.startsWith("opt.")) && v !== undefined) q[k] = Array.isArray(v) ? v : [v];
  return q;
}

export function currentPage(p: Params): number {
  return Math.max(1, Number(valuesOf(p, "page")[0]) || 1);
}
