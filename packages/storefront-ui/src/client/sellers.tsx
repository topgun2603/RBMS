"use client";

import * as React from "react";
import Link from "next/link";
import { StoreIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@srirealtime/ui/lib/utils";
import { featureOn, STORE_FEATURES } from "../lib/features";
import type { SellerCard, SellerLookup } from "../types";
import { call } from "./api";
import { useStore } from "./store-context";

/**
 * productId → seller card for the products in the cart (marketplace shops only). One shared query for every cart
 * line (same key), refreshed when the set of products changes. Shop-owned products map to nothing.
 */
export function useCartSellers(): Map<string, SellerCard> {
  const { shell, cart } = useStore();
  const on = featureOn(shell.features, STORE_FEATURES.marketplace);
  const ids = React.useMemo(() => [...new Set((cart.cart?.lines ?? []).map((l) => l.productId))].sort(), [cart.cart?.lines]);
  const q = useQuery({
    queryKey: ["sellers", ids.join(",")],
    queryFn: () => call<SellerLookup>("/marketplace/public/sellers", { query: { productIds: ids.join(",") }, auth: false }),
    enabled: on && ids.length > 0,
    staleTime: 5 * 60_000,
  });
  return React.useMemo(() => {
    const out = new Map<string, SellerCard>();
    const byId = new Map((q.data?.items ?? []).map((s) => [s.id, s]));
    for (const [p, v] of Object.entries(q.data?.products ?? {})) {
      const s = byId.get(v);
      if (s) out.set(p, s);
    }
    return out;
  }, [q.data]);
}

/** "Sold by <seller>" with a link to the seller page. */
export function SoldBy({ seller, className, onNavigate }: { seller: SellerCard; className?: string; onNavigate?: () => void }) {
  const { t } = useStore();
  return (
    <p className={cn("flex items-center gap-1 text-xs text-muted-foreground", className)} data-testid="sold-by">
      <StoreIcon className="size-3.5 shrink-0" />
      <span>{t("seller.soldBy")}</span>
      <Link href={`/sellers/${encodeURIComponent(seller.slug)}`} onClick={onNavigate} className="truncate font-semibold text-foreground/80 underline-offset-2 hover:text-primary hover:underline">
        {seller.name}
      </Link>
    </p>
  );
}
