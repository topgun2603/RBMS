"use client";

import * as React from "react";
import { track } from "./analytics";

export function SearchTracker({ query }: { query: string }) {
  React.useEffect(() => track({ type: "search", query }), [query]);
  return null;
}

export function ProductViewTracker({ productId, value }: { productId: string; value: number }) {
  React.useEffect(() => track({ type: "product_view", productId, value }), [productId, value]);
  return null;
}

/** Fires `purchase` once per order (per browser). */
export function PurchaseTracker({ orderNumber, value }: { orderNumber: string; value: number }) {
  React.useEffect(() => {
    try {
      const key = `sr_purchase_${orderNumber}`;
      if (sessionStorage.getItem(key) || localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      /* ignore */
    }
    track({ type: "purchase", value });
  }, [orderNumber, value]);
  return null;
}
