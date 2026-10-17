"use client";

import * as React from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { api, apiDownload } from "@srirealtime/web";
import { moveCount } from "./status";
import type {
  CarrierAccount,
  CarrierAccountInput,
  CategoryLite,
  Coupon,
  CouponEvaluation,
  CouponInput,
  ManualOrderInput,
  Order,
  OrderListFilters,
  OrderListResult,
  OrderSettings,
  OrdersSummary,
  OrderStatus,
  Paged,
  PincodeInfo,
  ProductLite,
  Quote,
  Rate,
  RateInput,
  Redemption,
  Shipment,
  ShipmentInput,
  StatusInput,
  VariantLookup,
  Zone,
  ZoneInput,
  ZoneList,
} from "./types";

export const PAGE_SIZE = 50;

export const ok = {
  orders: ["orders"] as const,
  lists: ["orders", "list"] as const,
  list: (f: OrderListFilters) => ["orders", "list", f] as const,
  board: (f: OrderListFilters) => ["orders", "board", f] as const,
  order: (id: string) => ["orders", "detail", id] as const,
  summary: ["orders", "summary"] as const,
  settings: ["settings", "orders"] as const,
  /** Every coupon list cache (the table's key starts with it). */
  couponLists: ["coupons", "list"] as const,
  couponTable: ["coupons", "list", "table"] as const,
  coupon: (id: string) => ["coupons", "detail", id] as const,
  redemptions: (id: string) => ["coupons", "redemptions", id] as const,
  zones: ["delivery", "zones"] as const,
  account: ["delivery", "account"] as const,
  shipments: (orderId: string) => ["delivery", "shipments", orderId] as const,
  pincode: (pin: string) => ["delivery", "pincode", pin] as const,
  variants: (q: string) => ["catalog", "variants-search", q] as const,
  categories: ["catalog", "categories"] as const,
  products: (q: string) => ["catalog", "products-pick", q] as const,
};

const clean = (f: OrderListFilters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== "")) as OrderListFilters;

// ---------------------------------------------------------------- orders

export function useOrderList(filters: OrderListFilters) {
  return useInfiniteQuery({
    queryKey: ok.list(clean(filters)),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => api.get<OrderListResult>("/orders", { ...clean(filters), limit: PAGE_SIZE, offset: pageParam }, { signal }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length === PAGE_SIZE && loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
}

/** Kanban: the latest 200 orders of the filters (any status), grouped on the client. */
export function useOrderBoard(filters: OrderListFilters, enabled: boolean) {
  const f = clean({ ...filters, status: undefined });
  return useQuery({
    queryKey: ok.board(f),
    enabled,
    queryFn: ({ signal }) => api.get<OrderListResult>("/orders", { ...f, limit: 200, offset: 0 }, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useOrder(id: string | null) {
  return useQuery({
    queryKey: ok.order(id ?? ""),
    queryFn: () => api.get<Order>(`/orders/${id}`),
    enabled: !!id,
  });
}

export function useOrdersSummary(enabled = true) {
  return useQuery({ queryKey: ok.summary, enabled, queryFn: () => api.get<OrdersSummary>("/orders/summary"), staleTime: 30_000 });
}

/** The latest few orders (any status) for the dashboard. */
export function useRecentOrders(limit = 5) {
  return useQuery({
    queryKey: [...ok.lists, "recent", limit] as const,
    queryFn: ({ signal }) => api.get<OrderListResult>("/orders", { limit, offset: 0 }, { signal }),
    staleTime: 30_000,
  });
}

export const exportOrdersCsv = (filters: OrderListFilters) => apiDownload("/orders", { ...clean(filters), format: "csv" }, "orders.csv");

/** After any order write: refresh lists, the board, the summary; put the fresh order in the detail cache. */
function useOrdersChanged() {
  const qc = useQueryClient();
  return React.useCallback(
    (order?: Order) => {
      if (order) qc.setQueryData(ok.order(order.id), order);
      void qc.invalidateQueries({ queryKey: ok.lists });
      void qc.invalidateQueries({ queryKey: ["orders", "board"] });
      void qc.invalidateQueries({ queryKey: ok.summary });
    },
    [qc],
  );
}

/** Order list caches: infinite pages (older lists) or one table page (useServerTable). */
type ListCache = InfiniteData<OrderListResult, number> | OrderListResult;

function moveInPage(p: OrderListResult, id: string, from: OrderStatus, to: OrderStatus, withCounts: boolean): OrderListResult {
  if (!Array.isArray(p.items)) return p;
  const counts = withCounts && p.counts ? moveCount(p.counts, from, to) : p.counts;
  return {
    ...p,
    items: p.items.map((o) => (o.id === id ? { ...o, status: to } : o)),
    counts,
    facets: p.facets && withCounts && counts ? { ...p.facets, status: { ...counts } } : p.facets,
  };
}

/**
 * Status change with an optimistic update: the order's pill (in every cached list, the board and the detail) moves at
 * once and rolls back if the API refuses.
 */
export function useUpdateStatus() {
  const qc = useQueryClient();
  const changed = useOrdersChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; from: OrderStatus; body: StatusInput }) => api.post<Order>(`/orders/${id}/status`, body),
    onMutate: async ({ id, from, body }) => {
      await qc.cancelQueries({ queryKey: ok.orders });
      const lists = qc.getQueriesData<ListCache>({ queryKey: ok.lists });
      const boards = qc.getQueriesData<OrderListResult>({ queryKey: ["orders", "board"] });
      const detail = qc.getQueryData<Order>(ok.order(id));
      const to = body.status;
      for (const [key, data] of lists) {
        if (!data) continue;
        qc.setQueryData<ListCache>(
          key,
          ("pages" in data ? { ...data, pages: data.pages.map((p, i) => moveInPage(p, id, from, to, i === 0)) } : moveInPage(data, id, from, to, true)) as ListCache,
        );
      }
      for (const [key, data] of boards) {
        if (!data) continue;
        qc.setQueryData<OrderListResult>(key, { ...data, items: data.items.map((o) => (o.id === id ? { ...o, status: to } : o)) });
      }
      if (detail) qc.setQueryData<Order>(ok.order(id), { ...detail, status: to, nextStatuses: [] });
      return { lists, boards, detail };
    },
    onError: (_e, { id }, ctx) => {
      for (const [key, data] of ctx?.lists ?? []) qc.setQueryData(key, data);
      for (const [key, data] of ctx?.boards ?? []) qc.setQueryData(key, data);
      if (ctx?.detail) qc.setQueryData(ok.order(id), ctx.detail);
    },
    onSuccess: (o) => changed(o),
  });
}

export function useCreateOrder() {
  const changed = useOrdersChanged();
  return useMutation({
    mutationFn: (body: ManualOrderInput) => api.post<Order>("/orders", body),
    onSuccess: (o) => changed(o),
  });
}

/** Notes, payments, refunds, shipping details, invoice retry: each returns the updated order. */
export function useOrderAction() {
  const changed = useOrdersChanged();
  return useMutation({
    mutationFn: ({ id, action, body }: { id: string; action: "notes" | "payments" | "refunds" | "fulfillment" | "invoice"; body?: unknown }) =>
      api.post<Order>(`/orders/${id}/${action}`, body ?? {}),
    onSuccess: (o) => changed(o),
  });
}

// ---------------------------------------------------------------- order settings (settings namespace "orders")

export function useOrderSettings() {
  return useQuery({
    queryKey: ok.settings,
    queryFn: () => api.get<{ namespace: string; values: Partial<OrderSettings> }>("/settings/orders").then((r) => r.values),
  });
}

export function useSaveOrderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: OrderSettings) => api.put<{ values: OrderSettings }>("/settings/orders/tenant", values).then((r) => r.values),
    onSuccess: (v) => qc.setQueryData(ok.settings, v),
  });
}

// ---------------------------------------------------------------- coupons

export function useCoupon(id: string | null) {
  return useQuery({ queryKey: ok.coupon(id ?? ""), enabled: !!id, queryFn: () => api.get<Coupon>(`/coupons/${id}`) });
}

export function useRedemptions(id: string | null) {
  return useQuery({
    queryKey: ok.redemptions(id ?? ""),
    enabled: !!id,
    queryFn: () => api.get<Paged<Redemption>>(`/coupons/${id}/redemptions`, { limit: 100 }),
  });
}

export function useSaveCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<CouponInput> }) => (id ? api.patch<Coupon>(`/coupons/${id}`, body) : api.post<Coupon>("/coupons", body)),
    onSuccess: (c) => {
      qc.setQueryData(ok.coupon(c.id), c);
      void qc.invalidateQueries({ queryKey: ok.couponLists });
    },
  });
}

/** Active switch with an optimistic update in every cached coupon list. */
export function useToggleCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch<Coupon>(`/coupons/${id}`, { active }),
    onMutate: async ({ id, active }) => {
      await qc.cancelQueries({ queryKey: ok.couponLists });
      // The table's cache is one `{ items, total, … }` page; leave any other shape alone.
      const prev = qc.getQueriesData<Paged<Coupon>>({ queryKey: ok.couponLists });
      for (const [key, data] of prev) {
        if (data && Array.isArray(data.items)) qc.setQueryData<Paged<Coupon>>(key, { ...data, items: data.items.map((c) => (c.id === id ? { ...c, active } : c)) });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.prev ?? []) qc.setQueryData(key, data);
    },
    onSuccess: (c) => qc.setQueryData(ok.coupon(c.id), c),
    onSettled: () => void qc.invalidateQueries({ queryKey: ok.couponLists }),
  });
}

export function useDeleteCoupon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/coupons/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: ok.coupon(id) });
      void qc.invalidateQueries({ queryKey: ok.couponLists });
    },
  });
}

/** Checkout preview of a code (POST /coupons/public/validate; channel "store"). */
export const validateCoupon = (body: { code: string; subtotal: number; shipping?: number; lines?: { productId?: string; amount: number }[] }) =>
  api.post<CouponEvaluation>("/coupons/public/validate", body);

// ---------------------------------------------------------------- delivery

export function useZones(enabled = true) {
  return useQuery({ queryKey: ok.zones, enabled, queryFn: () => api.get<ZoneList>("/delivery/zones") });
}

function useZonesChanged() {
  const qc = useQueryClient();
  return React.useCallback(() => void qc.invalidateQueries({ queryKey: ok.zones }), [qc]);
}

export function useSaveZone() {
  const changed = useZonesChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<ZoneInput> }) =>
      id ? api.patch<Zone>(`/delivery/zones/${id}`, body) : api.post<Zone>("/delivery/zones", body),
    onSuccess: changed,
  });
}

export function useDeleteZone() {
  const changed = useZonesChanged();
  return useMutation({ mutationFn: (id: string) => api.delete(`/delivery/zones/${id}`), onSuccess: changed });
}

export function useSaveRate() {
  const changed = useZonesChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<RateInput> }) =>
      id ? api.patch<Rate>(`/delivery/rates/${id}`, body) : api.post<Rate>("/delivery/rates", body),
    onSuccess: changed,
  });
}

export function useDeleteRate() {
  const changed = useZonesChanged();
  return useMutation({ mutationFn: (id: string) => api.delete(`/delivery/rates/${id}`), onSuccess: changed });
}

export const quoteDelivery = (body: { pincode: string; weightGrams: number; subtotal: number; cod: boolean; stateCode?: string | null }) =>
  api.post<Quote>("/delivery/quote", body);

export function usePincode(pin: string) {
  return useQuery({
    queryKey: ok.pincode(pin),
    enabled: /^[1-9]\d{5}$/.test(pin),
    queryFn: () => api.get<PincodeInfo>(`/delivery/public/pincode/${pin}`),
    staleTime: Infinity,
    retry: 0,
  });
}

export function useCarrierAccount(enabled: boolean) {
  return useQuery({ queryKey: ok.account, enabled, queryFn: () => api.get<CarrierAccount>("/delivery/account"), retry: 0 });
}

export function useSaveCarrierAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CarrierAccountInput) => api.put<CarrierAccount>("/delivery/account", body),
    onSuccess: (a) => {
      // Keep the one-time token out of the cache; the page shows it from the mutation result.
      const { newWebhookToken: _t, ...rest } = a;
      qc.setQueryData(ok.account, rest);
    },
  });
}

export function useDeleteCarrierAccount() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.delete("/delivery/account"), onSuccess: () => void qc.invalidateQueries({ queryKey: ok.account }) });
}

export function useShipments(orderId: string, enabled: boolean) {
  return useQuery({
    queryKey: ok.shipments(orderId),
    enabled,
    queryFn: () => api.get<Paged<Shipment>>("/delivery/shipments", { orderId }).then((r) => r.items),
  });
}

/** Create / cancel / refresh / mock-advance a shipment, then refresh it and the order (fulfillment + status follow). */
export function useShipmentAction(orderId: string) {
  const qc = useQueryClient();
  const changed = useOrdersChanged();
  return useMutation({
    mutationFn: (a: { kind: "create"; body: ShipmentInput } | { kind: "cancel" | "refresh" | "mock-advance"; id: string }) =>
      a.kind === "create" ? api.post<Shipment>(`/delivery/orders/${orderId}/shipments`, a.body) : api.post<Shipment>(`/delivery/shipments/${a.id}/${a.kind}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ok.shipments(orderId) });
      void qc.invalidateQueries({ queryKey: ok.order(orderId) });
      changed();
    },
  });
}

// ---------------------------------------------------------------- catalogue pickers

export function useVariantSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: ok.variants(q),
    enabled,
    queryFn: ({ signal }) => api.get<Paged<VariantLookup>>("/catalog/variants/search", { q: q || undefined, limit: 20 }, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useCategories(enabled = true) {
  return useQuery({
    queryKey: ok.categories,
    enabled,
    queryFn: () => api.get<Paged<CategoryLite>>("/catalog/categories").then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useProductPick(q: string, enabled = true) {
  return useQuery({
    queryKey: ok.products(q),
    enabled,
    queryFn: ({ signal }) => api.get<Paged<ProductLite>>("/catalog/products", { q: q || undefined, limit: 20 }, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/** Product names for ids already on a coupon (pages through the staff list once; small catalogues). */
export function useProductsByIds(ids: string[]) {
  const key = [...ids].sort();
  return useQuery({
    queryKey: ["catalog", "products-by-ids", key],
    enabled: ids.length > 0,
    queryFn: async () => {
      const want = new Set(ids);
      const found = new Map<string, ProductLite>();
      for (let offset = 0; offset < 2000 && found.size < want.size; offset += 200) {
        const page = await api.get<Paged<ProductLite>>("/catalog/products", { limit: 200, offset });
        for (const p of page.items) if (want.has(p.id)) found.set(p.id, p);
        if (page.items.length < 200) break;
      }
      return found;
    },
    staleTime: 60_000,
  });
}
