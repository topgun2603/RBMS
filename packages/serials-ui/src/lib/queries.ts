"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import { retry4xx } from "./http";
import type { ManualStatus, SerialEvent, SerialItem, SerialsSummary, SerialUnit, ShopItem, WarrantyLookup } from "./types";

const S = "/serials";

/** Query keys. Lists start with these prefixes so mutations can invalidate them. */
export const sk = {
  all: ["serials"] as const,
  units: ["serials", "units"] as const,
  unit: (id: string) => ["serials", "unit", id] as const,
  items: ["serials", "items"] as const,
  itemsFor: (ids: string) => ["serials", "items", "for", ids] as const,
  warranty: (code: string) => ["serials", "warranty", code] as const,
  summary: ["serials", "summary"] as const,
  shopItems: (q: string) => ["serials", "shop-items", q] as const,
};

export function useUnit(id: string | null) {
  return useQuery({
    queryKey: sk.unit(id ?? ""),
    queryFn: () => api.get<SerialUnit & { events: SerialEvent[] }>(`${S}/units/${id}`),
    enabled: !!id,
    retry: retry4xx,
  });
}

/** Serial settings for one item (null when it was never set up). */
export function useItemSettings(itemId: string | null) {
  return useQuery({
    queryKey: sk.itemsFor(itemId ?? ""),
    queryFn: async () => (await api.get<{ items: SerialItem[] }>(`${S}/items`, { ids: itemId ?? "" })).items[0] ?? null,
    enabled: !!itemId,
    retry: retry4xx,
  });
}

export function useWarranty(code: string) {
  return useQuery({
    queryKey: sk.warranty(code),
    queryFn: () => api.get<WarrantyLookup>(`${S}/warranty`, { code }),
    enabled: code.length > 0,
    retry: retry4xx,
  });
}

export function useSummary() {
  return useQuery({ queryKey: sk.summary, queryFn: () => api.get<SerialsSummary>(`${S}/summary`), retry: retry4xx });
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

export interface ReceiveBody {
  itemId: string;
  itemName: string;
  units: { serial: string; serial2?: string | null }[];
  purchaseRef?: string | null;
  supplier?: string | null;
  costPaise?: number | null;
}

export function useReceiveUnits() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: ReceiveBody) => api.post<{ received: number }>(`${S}/units/receive`, body), onSuccess: invalidate });
}

export function useSetStatus(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { status: ManualStatus; note?: string | null }) => api.post<SerialUnit>(`${S}/units/${id}/status`, body),
    onSuccess: invalidate,
  });
}

export function useClaim(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: { note: string }) => api.post<SerialEvent>(`${S}/units/${id}/claim`, body), onSuccess: invalidate });
}

export interface ItemSettingsBody {
  itemId: string;
  name: string;
  tracked: boolean;
  warrantyMonths: number;
  dualImei: boolean;
}

export function useSaveItem() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ itemId, ...body }: ItemSettingsBody) => api.put<SerialItem>(`${S}/items/${itemId}`, body),
    onSuccess: invalidate,
  });
}
