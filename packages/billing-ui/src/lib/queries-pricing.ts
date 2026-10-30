"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, useFeature } from "@rbms/web";
import type { CustomerGroup, CustomerPricing, ItemUnits, PriceListDetail, PriceListInput, PriceListSummary, ResolveResult } from "./types-pricing";

/** Price lists (docs/price-lists-units.md): feature `catalogue.price-lists`. */
export const PRICE_LISTS_FEATURE = "catalogue.price-lists";
const PL = "/pricelists";

export const pk = {
  lists: ["pricelists", "lists"] as const,
  list: (id: string) => ["pricelists", "list", id] as const,
  groups: ["pricelists", "groups"] as const,
  group: (id: string) => ["pricelists", "group", id] as const,
  customer: (id: string) => ["pricelists", "customer", id] as const,
  units: (variantId: string) => ["catalog", "units", variantId] as const,
};

export function usePriceListsOn(): boolean {
  return useFeature(PRICE_LISTS_FEATURE);
}

export function usePriceLists(enabled = true) {
  const on = usePriceListsOn();
  return useQuery({ queryKey: pk.lists, enabled: enabled && on, queryFn: () => api.get<{ items: PriceListSummary[] }>(`${PL}/lists`), staleTime: 60_000 });
}

export function usePriceList(id: string) {
  return useQuery({ queryKey: pk.list(id), enabled: !!id, queryFn: () => api.get<PriceListDetail>(`${PL}/lists/${id}`) });
}

export function useSavePriceList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: PriceListInput }) =>
      id ? api.patch<PriceListSummary>(`${PL}/lists/${id}`, body) : api.post<PriceListSummary>(`${PL}/lists`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pricelists"] }),
  });
}

export function useDeletePriceList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${PL}/lists/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pricelists"] }),
  });
}

export function useSavePriceEntries(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: { itemId: string; unit: string | null; minQty: number; price: number }[]) => api.put<PriceListDetail>(`${PL}/lists/${id}/items`, { items }),
    onSuccess: (d) => {
      qc.setQueryData(pk.list(id), d);
      void qc.invalidateQueries({ queryKey: pk.lists });
    },
  });
}

export function useCustomerGroups(enabled = true) {
  const on = usePriceListsOn();
  return useQuery({ queryKey: pk.groups, enabled: enabled && on, queryFn: () => api.get<{ items: CustomerGroup[] }>(`${PL}/groups`), staleTime: 60_000 });
}

export function useGroupCustomers(id: string) {
  return useQuery({
    queryKey: pk.group(id),
    enabled: !!id,
    queryFn: () => api.get<{ items: { id: string; name: string | null; phone: string | null }[] }>(`${PL}/groups/${id}/customers`),
  });
}

export function useSaveCustomerGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: { name: string; priceListId: string | null; note?: string | null } }) =>
      id ? api.patch<CustomerGroup>(`${PL}/groups/${id}`, body) : api.post<CustomerGroup>(`${PL}/groups`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pricelists"] }),
  });
}

export function useDeleteCustomerGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`${PL}/groups/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pricelists"] }),
  });
}

export function useCustomerPricing(customerId: string) {
  const on = usePriceListsOn();
  return useQuery({ queryKey: pk.customer(customerId), enabled: on && !!customerId, queryFn: () => api.get<CustomerPricing>(`${PL}/customers/${customerId}`) });
}

export function useSaveCustomerPricing(customerId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { groupId?: string | null; priceListId?: string | null }) => api.put<CustomerPricing>(`${PL}/customers/${customerId}`, body),
    onSuccess: (d) => {
      qc.setQueryData(pk.customer(customerId), d);
      void qc.invalidateQueries({ queryKey: pk.groups });
      void qc.invalidateQueries({ queryKey: pk.lists });
    },
  });
}

/** Prices for bill lines (customer list → slab → item price). */
export const resolvePrices = (body: { customerId?: string | null; priceListId?: string | null; date?: string; lines: { itemId: string; unit?: string | null; qty: number }[] }) =>
  api.post<ResolveResult>(`${PL}/resolve`, body);

// ---- alternate units of an item (catalogue variant)

export function useItemUnits(variantId: string | undefined) {
  return useQuery({
    queryKey: pk.units(variantId ?? ""),
    enabled: !!variantId,
    retry: (n, e) => !(e instanceof ApiError && (e.status === 404 || e.status === 403)) && n < 2,
    queryFn: () => api.get<ItemUnits>(`/catalog/variants/${variantId}/units`),
  });
}

export function useSaveItemUnits(variantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (units: { unit: string; factor: number; barcode: string | null; price: number | null; mrp?: number | null }[]) =>
      api.put<ItemUnits>(`/catalog/variants/${variantId}/units`, { units }),
    onSuccess: (d) => {
      qc.setQueryData(pk.units(variantId), d);
      void qc.invalidateQueries({ queryKey: ["items"] });
    },
  });
}
