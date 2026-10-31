"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiDownload } from "@rbms/web";
import { retry4xx } from "./http";
import type { LabelPreview, ScaleItem, ScalesSettings, ShopItem, SoldBy } from "./types";

const S = "/scales";

/** Query keys. Lists start with these prefixes so mutations can invalidate them. */
export const sk = {
  all: ["scales"] as const,
  items: ["scales", "items"] as const,
  settings: ["scales", "settings"] as const,
  label: (itemId: string, weight: number) => ["scales", "label", itemId, weight] as const,
  latest: ["scales", "items", "latest"] as const,
  shopItems: (q: string) => ["scales", "shop-items", q] as const,
};

export function useScaleSettings() {
  return useQuery({ queryKey: sk.settings, queryFn: () => api.get<ScalesSettings>(`${S}/settings`), retry: retry4xx });
}

export function useSaveScaleSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ScalesSettings>) => api.put<ScalesSettings>(`${S}/settings`, body),
    onSuccess: (s) => {
      qc.setQueryData(sk.settings, s);
      return qc.invalidateQueries({ queryKey: sk.all });
    },
  });
}

/** The most recently priced item and the item count (dashboard card). */
export function useLatestPriced() {
  return useQuery({
    queryKey: sk.latest,
    queryFn: () => api.get<{ items: ScaleItem[]; total: number }>(`${S}/items`, { limit: 1, sort: "-priced", active: "true" }),
    retry: retry4xx,
  });
}

/** The barcode the scale would print for `weight` kg (null weight = off). */
export function useLabelPreview(itemId: string | null, weight: number | null) {
  return useQuery({
    queryKey: sk.label(itemId ?? "", weight ?? 0),
    queryFn: ({ signal }) => api.get<LabelPreview>(`${S}/items/${itemId}/label`, { weight: weight ?? 0 }, { signal }),
    enabled: !!itemId && weight !== null && weight > 0,
    placeholderData: keepPreviousData,
    retry: retry4xx,
  });
}

/** Billing items (catalogue variants) matching `q`, for the item picker. */
export function useShopItems(q: string, enabled = true) {
  return useQuery({
    queryKey: sk.shopItems(q),
    queryFn: ({ signal }) => api.get<{ items: ShopItem[] }>("/invoices/items", { q, limit: 12 }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
    retry: retry4xx,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: sk.all });
}

export interface ScaleItemBody {
  itemId: string;
  /** Omit for the next free PLU. */
  plu?: number | null;
  soldBy: SoldBy;
  tareGrams: number;
  unitLabel?: string;
  active?: boolean;
  /** Also set the catalogue price (paise per unit). */
  price?: number;
}

export function useSaveScaleItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ itemId, ...body }: ScaleItemBody) => api.put<ScaleItem>(`${S}/items/${itemId}`, body),
    onSuccess: invalidate,
  });
}

export function useRemoveScaleItem() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (itemId: string) => api.delete(`${S}/items/${itemId}`), onSuccess: invalidate });
}

/** Today's prices: `{ itemId, price }` in paise per unit. */
export function useSavePrices() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (items: { itemId: string; price: number }[]) => api.post<{ items: ScaleItem[] }>(`${S}/prices`, { items }),
    onSuccess: invalidate,
  });
}

/** Saves the PLU file (CSV for the scale software). */
export const downloadPluFile = () => apiDownload(`${S}/export.csv`, {}, "scale-plu.csv");
