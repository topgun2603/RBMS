import { apiGetSafe } from "./api";
import type { Rating } from "../types";

/** Ratings for product ids (≤ 200), as a Map; empty on any failure (reviews off, API down). */
export async function getRatings(ids: string[]): Promise<Map<string, Rating>> {
  const unique = [...new Set(ids)].slice(0, 200);
  if (!unique.length) return new Map();
  const rows = await apiGetSafe<Rating[] | { items: Rating[] }>("/reviews/public/ratings", [], { revalidate: 120, query: { productIds: unique.join(",") } });
  const list = Array.isArray(rows) ? rows : (rows.items ?? []);
  return new Map(list.filter((r) => r.count > 0).map((r) => [r.productId, r]));
}

export type SearchParams = Record<string, string | string[] | undefined>;

export const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
