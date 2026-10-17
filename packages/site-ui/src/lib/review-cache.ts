import type { Review } from "./types";

type Page = { items: Review[]; total?: number };
type Infinite = { pages: Page[]; pageParams?: unknown[] };

/**
 * Optimistic edit of one review in a cached reviews list under ["site", "reviews"]: the table's plain
 * `{ items, total, … }` page (and the dashboard widget's) as well as an older infinite `{ pages: [{ items }] }` cache.
 * `null` removes the review (delete) and lowers `total`. Anything else (counts, settings) is returned unchanged.
 */
export function patchReviewList<T>(data: T, id: string, patch: Partial<Review> | null): T {
  if (!data || typeof data !== "object") return data;
  const one = (p: Page): Page => {
    if (!Array.isArray(p.items) || !p.items.some((r) => r.id === id)) return p;
    if (patch === null) {
      return { ...p, items: p.items.filter((r) => r.id !== id), ...(typeof p.total === "number" ? { total: Math.max(0, p.total - 1) } : {}) };
    }
    return { ...p, items: p.items.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
  };
  if (Array.isArray((data as unknown as Infinite).pages)) {
    const inf = data as unknown as Infinite;
    const pages = inf.pages.map(one);
    return (pages.every((p, i) => p === inf.pages[i]) ? data : { ...inf, pages }) as T;
  }
  if (Array.isArray((data as unknown as Page).items)) return one(data as unknown as Page) as T;
  return data;
}
