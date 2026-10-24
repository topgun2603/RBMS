import { STORE_PATHS } from "@srirealtime/cms/seo";
import type { FinderOption } from "../types";

/*
 * The finder section's filters (pure): the answers a shopper picked → the public search query (`GET
 * /catalog/public/search`) and the matching listing link (`/search?cat=…&opt.Age=…`, the same parameters the filter
 * sidebar writes, so "See all" lands on the normal listing with the filters on).
 */

export interface FinderQuery {
  /** Query string for the search API (prices in paise; repeated `opt.<name>` for several values). */
  api: string;
  /** Listing link with the same filters (prices in rupees). */
  href: string;
  /** Number of filters in force (0 = nothing narrows the list yet). */
  filters: number;
}

/**
 * Combines answers: the last category wins, tags add up (a product needs all of them: board × class × medium),
 * option filters add up (`opt.<name>`), keywords join, price ranges narrow.
 */
export function finderQuery(picks: readonly (FinderOption | null | undefined)[]): FinderQuery {
  let categoryId: string | undefined;
  const tags: string[] = [];
  const opts = new Map<string, string[]>();
  const words: string[] = [];
  let min: number | undefined;
  let max: number | undefined;
  for (const o of picks) {
    if (!o) continue;
    if (o.categoryId) categoryId = o.categoryId;
    const tag = o.tag?.trim().toLowerCase();
    if (tag && !tags.includes(tag)) tags.push(tag);
    const name = o.filterName?.trim();
    const value = o.filterValue?.trim();
    if (name && value) opts.set(name, [...new Set([...(opts.get(name) ?? []), value])]);
    if (o.keywords?.trim()) words.push(o.keywords.trim());
    if (o.priceMin !== undefined) min = Math.max(min ?? 0, o.priceMin);
    if (o.priceMax !== undefined) max = max === undefined ? o.priceMax : Math.min(max, o.priceMax);
  }
  const api = new URLSearchParams();
  const url = new URLSearchParams();
  const q = words.join(" ").slice(0, 200);
  if (q) {
    api.set("q", q);
    url.set("q", q);
  }
  if (categoryId) {
    api.set("categoryId", categoryId);
    url.set("cat", categoryId);
  }
  for (const tag of tags.slice(0, 5)) {
    api.append("tag", tag);
    url.append("tag", tag);
  }
  if (min !== undefined) {
    api.set("priceMin", String(min));
    url.set("min", String(Math.floor(min / 100)));
  }
  if (max !== undefined) {
    api.set("priceMax", String(max));
    url.set("max", String(Math.ceil(max / 100)));
  }
  for (const [name, values] of opts) {
    for (const v of values) {
      api.append(`opt.${name}`, v);
      url.append(`opt.${name}`, v);
    }
  }
  const qs = url.toString();
  return { api: api.toString(), href: qs ? `${STORE_PATHS.search}?${qs}` : STORE_PATHS.search, filters: (q ? 1 : 0) + (categoryId ? 1 : 0) + Math.min(tags.length, 5) + (min !== undefined ? 1 : 0) + (max !== undefined ? 1 : 0) + opts.size };
}
