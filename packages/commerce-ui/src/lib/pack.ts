"use client";

import { useQuery } from "@tanstack/react-query";
import { packOrDefault, type BusinessPack } from "@rbms/verticals";
import { api, useOptionalShop } from "@rbms/web";

/**
 * The shop's business pack (its trade, from Settings → Appearance), for trade-specific hints in the product editor:
 * name placeholder, attribute and option suggestions, category examples. Falls back to the app's default trade.
 */
export function usePack(): BusinessPack {
  const shop = useOptionalShop();
  const q = useQuery({
    queryKey: ["site", "settings", "store"],
    queryFn: () => api.get<{ values?: { businessType?: string } }>("/settings/store").then((r) => r.values ?? {}),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return packOrDefault(q.data?.businessType, shop?.tenant.appId ?? null);
}
