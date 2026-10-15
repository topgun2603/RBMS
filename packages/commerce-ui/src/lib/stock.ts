"use client";

import * as React from "react";
import { useFeature } from "@srirealtime/web";
import { useStockRows, useVariantProductMap } from "./queries";
import type { StockRow, StockStatus } from "./types";

export interface ProductStock {
  qty: number;
  status: StockStatus;
  /** Variants with tracked stock. */
  tracked: number;
  low: number;
  out: number;
}

const rank: Record<StockStatus, number> = { out: 0, low: 1, ok: 2 };

/** Stock rows by variant id, and per-product totals, when the inventory feature is on (null otherwise or on error). */
export function useCatalogStock() {
  const inventory = useFeature("inventory");
  const rows = useStockRows(inventory);
  const map = useVariantProductMap(inventory);
  return React.useMemo(() => {
    if (!inventory || rows.isError || !rows.data) return { enabled: inventory, loading: inventory && rows.isPending, byVariant: null, byProduct: null };
    const byVariant = new Map<string, StockRow>(rows.data.items.map((r) => [r.itemId, r]));
    const byProduct = new Map<string, ProductStock>();
    if (map.data) {
      for (const r of rows.data.items) {
        const pid = map.data.get(r.itemId);
        if (!pid || !r.track) continue;
        const cur = byProduct.get(pid) ?? { qty: 0, status: "ok" as StockStatus, tracked: 0, low: 0, out: 0 };
        cur.qty += r.qty;
        cur.tracked += 1;
        if (r.status === "low") cur.low += 1;
        if (r.status === "out") cur.out += 1;
        if (rank[r.status] < rank[cur.status]) cur.status = r.status;
        byProduct.set(pid, cur);
      }
    }
    return { enabled: true, loading: rows.isPending || map.isPending, byVariant, byProduct: map.data ? byProduct : null };
  }, [inventory, rows.data, rows.isError, rows.isPending, map.data, map.isPending]);
}
