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

/** Which of these items use batches (the shop switched batch tracking on for them). */
export function useBatchTracking(itemIds: string[], enabled: boolean) {
  const ids = [...new Set(itemIds)].sort().join(",");
  return useQuery({
    queryKey: ["pos", "batch-tracking", ids],
    queryFn: () => posApi.get<{ items: { itemId: string; tracked: boolean }[] }>("/inventory/batches/tracking", { ids }).then((r) => new Set(r.items.filter((i) => i.tracked).map((i) => i.itemId))),
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    retry: 0,
  });
}

export const fetchBatchPick = (itemId: string, qty: number) => posApi.get<BatchPick>("/inventory/batches/pick", { itemId, qty });

export function useBatchPick(itemId: string | null, qty: number) {
  return useQuery({
    queryKey: ["pos", "batch-pick", itemId, qty],
    queryFn: () => fetchBatchPick(itemId!, qty),
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
export function useAutoBatches(lines: readonly CartLine[], setLines: (fn: (l: CartLine[]) => CartLine[]) => void, enabled: boolean) {
  const ids = lines.filter((l) => !l.itemId.startsWith("open:")).map((l) => l.itemId);
  const tracking = useBatchTracking(ids, enabled);
  const tried = React.useRef(new Set<string>());
  const tracked = tracking.data ?? EMPTY;

  React.useEffect(() => {
    if (!enabled || tracked.size === 0) return;
    for (const l of lines) {
      if (l.batch || !tracked.has(l.itemId) || tried.current.has(l.key)) continue;
      tried.current.add(l.key);
      void fetchBatchPick(l.itemId, l.qty)
        .then((pick) => {
          if (pick.rule !== "fefo") return;
          const first = pick.suggestion[0] && pick.batches.find((b) => b.batchId === pick.suggestion[0]!.batchId);
          if (!first) return;
          setLines((ls) => ls.map((x) => (x.key === l.key && !x.batch ? { ...x, batch: { id: first.batchId, no: first.batchNo, expiry: first.expiry } } : x)));
        })
        .catch(() => undefined);
    }
  }, [lines, tracked, enabled, setLines]);

  return tracked;
}

const EMPTY: ReadonlySet<string> = new Set();
