"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { posApi } from "./api";
import type { CartLine } from "./cart";

/** One batch of an item at this branch (GET /v1/inventory/batches/pick). */
export interface BatchOption {
  batchId: string;
  batchNo: string;
  expiry: string | null;
  mrp: number | null;
  qty: number;
  status: "expired" | "expiring" | "ok" | "none";
  daysLeft: number | null;
  /** Near-expiry discount hint, percent. */
  suggestedDiscount: number | null;
}

export interface BatchPick {
  itemId: string;
  tracked: boolean;
  rule: "fefo" | "manual";
  expiredPolicy: "block" | "warn" | "allow";
  batches: BatchOption[];
  suggestion: { batchId: string; qty: number }[];
  short: number;
}

/** How much of a line is more than the chosen batch has left (the server takes that part from the next batch); 0 when it fits or the stock is unknown. */
export function batchSpill(line: Pick<CartLine, "qty" | "batch">): number {
  const left = line.batch?.qty;
  if (left === undefined || line.qty <= left) return 0;
  return Math.round((line.qty - Math.max(0, left)) * 1000) / 1000;
}

type Tracking = { items: { itemId: string; tracked: boolean }[] };

/**
 * Which of these items use batches: the shop switched batch tracking on for them, or (pharmacy shops, `medicines` on)
 * they have medicine batches. The two never overlap: Pharmacy-managed items stay out of the generic batches.
 */
export function useBatchTracking(itemIds: string[], enabled: boolean, medicines = false) {
  const ids = [...new Set(itemIds)].sort().join(",");
  return useQuery({
    queryKey: ["pos", "batch-tracking", ids, medicines],
    queryFn: async () => {
      const [generic, pharmacy] = await Promise.all([
        posApi.get<Tracking>("/inventory/batches/tracking", { ids }),
        medicines ? posApi.get<Tracking>("/medicines/batches/tracking", { ids }).catch(() => ({ items: [] }) as Tracking) : Promise.resolve({ items: [] } as Tracking),
      ]);
      return new Set([...generic.items, ...pharmacy.items].filter((i) => i.tracked).map((i) => i.itemId));
    },
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    retry: 0,
  });
}

/** The item's batches for the counter: from inventory, or (an item Pharmacy manages, `medicines` on) from the medicine batches. */
export async function fetchBatchPick(itemId: string, qty: number, medicines = false): Promise<BatchPick> {
  const generic = await posApi.get<BatchPick>("/inventory/batches/pick", { itemId, qty });
  if (!medicines || generic.tracked) return generic;
  return posApi.get<BatchPick>("/medicines/batches/pick", { itemId, qty }).catch(() => generic);
}

export function useBatchPick(itemId: string | null, qty: number, medicines = false) {
  return useQuery({
    queryKey: ["pos", "batch-pick", itemId, qty, medicines],
    queryFn: () => fetchBatchPick(itemId!, qty, medicines),
    enabled: !!itemId,
    staleTime: 10_000,
    retry: 0,
  });
}

/**
 * Items with batches get the oldest-expiry batch on their line as soon as they are added (when the shop's rule is "oldest
 * first"); the cashier can change it. Returns the set of tracked item ids. Offline or on any error nothing happens: the
 * server then takes the stock oldest-expiry first when the bill is sent.
 */
export function useAutoBatches(lines: readonly CartLine[], setLines: (fn: (l: CartLine[]) => CartLine[]) => void, enabled: boolean, medicines = false) {
  const ids = lines.filter((l) => !l.itemId.startsWith("open:")).map((l) => l.itemId);
  const tracking = useBatchTracking(ids, enabled, medicines);
  const tried = React.useRef(new Set<string>());
  const tracked = tracking.data ?? EMPTY;

  React.useEffect(() => {
    if (!enabled || tracked.size === 0) return;
    for (const l of lines) {
      if (l.batch || !tracked.has(l.itemId) || tried.current.has(l.key)) continue;
      tried.current.add(l.key);
      void fetchBatchPick(l.itemId, l.qty, medicines)
        .then((pick) => {
          if (pick.rule !== "fefo") return;
          const first = pick.suggestion[0] && pick.batches.find((b) => b.batchId === pick.suggestion[0]!.batchId);
          if (!first) return;
          setLines((ls) => ls.map((x) => (x.key === l.key && !x.batch ? { ...x, batch: { id: first.batchId, no: first.batchNo, expiry: first.expiry, qty: first.qty } } : x)));
        })
        .catch(() => undefined);
    }
  }, [lines, tracked, enabled, medicines, setLines]);

  return tracked;
}

const EMPTY: ReadonlySet<string> = new Set();
