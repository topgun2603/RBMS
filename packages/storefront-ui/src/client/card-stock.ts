"use client";

import { useQuery } from "@tanstack/react-query";
import type { Availability, List } from "../types";
import { stockOf, type CardStock } from "../lib/cards";
import { call } from "./api";

type Row = { inStock: boolean; lowStock: boolean };

/**
 * Card stock badges without a request per card: ids asked for within one tick are fetched together (the public
 * availability endpoint takes up to 200 ids a call); results are cached for the page's lifetime by react-query.
 */
let queue: { ids: string[]; resolve: (m: Map<string, Row>) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  const batch = queue;
  queue = [];
  timer = null;
  const ids = [...new Set(batch.flatMap((b) => b.ids))];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) chunks.push(ids.slice(i, i + 200));
  void Promise.all(
    chunks.map((c) => call<List<Availability>>("/inventory/public/availability", { query: { itemIds: c.join(",") }, auth: false }).catch(() => ({ items: [], total: 0 }))),
  ).then((lists) => {
    const all = new Map<string, Row>(lists.flatMap((l) => l.items.map((a) => [a.itemId, { inStock: a.inStock, lowStock: a.lowStock }] as const)));
    for (const b of batch) b.resolve(all);
  });
}

function availabilityOf(ids: string[]): Promise<Map<string, Row>> {
  return new Promise((resolve) => {
    queue.push({ ids, resolve });
    if (!timer) timer = setTimeout(flush, 30);
  });
}

/** The card's stock state (null until known, or when the API doesn't send variant ids). */
export function useCardStock(productId: string, variantIds: string[] | undefined): CardStock | null {
  const ids = variantIds ?? [];
  const q = useQuery({
    queryKey: ["card-stock", productId, ids.join(",")],
    queryFn: async () => stockOf(ids, await availabilityOf(ids)),
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
  return q.data ?? null;
}
