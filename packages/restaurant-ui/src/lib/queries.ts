"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@srirealtime/web";
import type { Area, BillResult, DiningTable, Floor, KitchenTicket, Kot, KotStatus, MenuSetting, Order, OrderType, ShopItem } from "./types";

const D = "/dining";

/** Never retry 4xx (no access, feature off, not found). */
export const retry4xx = (count: number, err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;
export const isStatus = (err: unknown, ...statuses: number[]) => err instanceof ApiError && statuses.includes(err.status);

export const rk = {
  all: ["restaurant"] as const,
  floor: ["restaurant", "floor"] as const,
  order: (id: string) => ["restaurant", "order", id] as const,
  kitchen: (stations: string[]) => ["restaurant", "kitchen", stations.join(",")] as const,
  areas: ["restaurant", "areas"] as const,
  tables: ["restaurant", "tables"] as const,
  menu: ["restaurant", "menu"] as const,
  stations: ["restaurant", "stations"] as const,
  items: (q: string) => ["restaurant", "items", q] as const,
};

/** Polling stands in for a live channel: the floor every 10 s, the kitchen every 5 s (paused in background tabs). */
export const FLOOR_POLL_MS = 10_000;
export const KITCHEN_POLL_MS = 5_000;

export function useFloor() {
  return useQuery({ queryKey: rk.floor, queryFn: () => api.get<Floor>(`${D}/floor`), refetchInterval: FLOOR_POLL_MS, retry: retry4xx });
}

export function useOrder(id: string) {
  return useQuery({ queryKey: rk.order(id), queryFn: () => api.get<Order>(`${D}/orders/${id}`), refetchInterval: FLOOR_POLL_MS, retry: retry4xx });
}

export function useKitchen(stations: string[]) {
  return useQuery({
    queryKey: rk.kitchen(stations),
    queryFn: () => api.get<{ tickets: KitchenTicket[]; stations: string[]; now: string }>(`${D}/kitchen`, { station: stations.join(",") || undefined, recent: 15 }),
    refetchInterval: KITCHEN_POLL_MS,
    retry: retry4xx,
  });
}

export function useAreas() {
  return useQuery({ queryKey: rk.areas, queryFn: () => api.get<{ items: Area[] }>(`${D}/areas`), retry: retry4xx });
}

export function useTables() {
  return useQuery({ queryKey: rk.tables, queryFn: () => api.get<{ items: DiningTable[] }>(`${D}/tables`), retry: retry4xx });
}

export function useMenuSettings() {
  return useQuery({ queryKey: rk.menu, queryFn: () => api.get<{ items: MenuSetting[] }>(`${D}/menu`), retry: retry4xx });
}

export function useStations() {
  return useQuery({ queryKey: rk.stations, queryFn: () => api.get<{ items: string[] }>(`${D}/stations`), retry: retry4xx });
}

/** Billing items (catalogue variants) matching `q`; an empty `q` lists the first ones (the quick menu). */
export function useShopItems(q: string, limit = 60) {
  return useQuery({
    queryKey: [...rk.items(q), limit],
    queryFn: ({ signal }) => api.get<{ items: ShopItem[] }>("/invoices/items", { q: q || undefined, limit }, { signal }),
    placeholderData: keepPreviousData,
    retry: retry4xx,
  });
}

function useRefresh() {
  const qc = useQueryClient();
  return (order?: Order) => {
    if (order) qc.setQueryData(rk.order(order.id), order);
    return qc.invalidateQueries({ queryKey: rk.all });
  };
}

export interface LineBody {
  itemId?: string | null;
  name?: string;
  rate?: number;
  qty: number;
  note?: string | null;
}

export interface OpenBody {
  type: OrderType;
  tableId?: string | null;
  guests?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  note?: string | null;
  items?: LineBody[];
}

export function useOpenOrder() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: OpenBody) => api.post<Order>(`${D}/orders`, body), onSuccess: (o) => refresh(o) });
}

export function useOrderActions(id: string) {
  const refresh = useRefresh();
  const done = (o: Order) => refresh(o);
  return {
    addItems: useMutation({ mutationFn: ({ lines, send }: { lines: LineBody[]; send?: boolean }) => api.post<Order>(`${D}/orders/${id}/items${send ? "?send=1" : ""}`, lines), onSuccess: done }),
    updateLine: useMutation({ mutationFn: ({ lineId, ...b }: { lineId: string; qty?: number; note?: string | null }) => api.patch<Order>(`${D}/orders/${id}/items/${lineId}`, b), onSuccess: done }),
    deleteLine: useMutation({ mutationFn: (lineId: string) => api.delete<Order>(`${D}/orders/${id}/items/${lineId}`), onSuccess: done }),
    cancelLine: useMutation({ mutationFn: ({ lineId, reason }: { lineId: string; reason: string }) => api.post<Order>(`${D}/orders/${id}/items/${lineId}/cancel`, { reason }), onSuccess: done }),
    sendKot: useMutation({ mutationFn: () => api.post<{ kots: Kot[]; order: Order }>(`${D}/orders/${id}/kot`), onSuccess: (r) => done(r.order) }),
    update: useMutation({
      mutationFn: (b: { tableId?: string | null; guests?: number | null; customerName?: string | null; customerPhone?: string | null; note?: string | null }) => api.patch<Order>(`${D}/orders/${id}`, b),
      onSuccess: done,
    }),
    merge: useMutation({ mutationFn: (orderId: string) => api.post<Order>(`${D}/orders/${id}/merge`, { orderId }), onSuccess: done }),
    bill: useMutation({
      mutationFn: (b: { splits?: string[][]; customer?: { name: string; phone?: string | null } | null }) => api.post<{ order: Order; bills: BillResult[] }>(`${D}/orders/${id}/bill`, b),
      onSuccess: (r) => done(r.order),
    }),
    cancel: useMutation({ mutationFn: (reason: string) => api.post<Order>(`${D}/orders/${id}/cancel`, { reason }), onSuccess: done }),
  };
}

export function useMoveKot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: KotStatus }) => api.patch<Kot>(`${D}/kots/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: rk.all }),
  });
}

export function useSetupActions() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: rk.all });
  return {
    createArea: useMutation({ mutationFn: (b: { name: string }) => api.post<Area>(`${D}/areas`, b), onSuccess }),
    updateArea: useMutation({ mutationFn: ({ id, ...b }: { id: string; name?: string; sort?: number }) => api.patch<Area>(`${D}/areas/${id}`, b), onSuccess }),
    deleteArea: useMutation({ mutationFn: (id: string) => api.delete(`${D}/areas/${id}`), onSuccess }),
    createTable: useMutation({ mutationFn: (b: { name: string; areaId: string | null; seats: number }) => api.post<DiningTable>(`${D}/tables`, b), onSuccess }),
    updateTable: useMutation({
      mutationFn: ({ id, ...b }: { id: string; name?: string; areaId?: string | null; seats?: number; active?: boolean }) => api.patch<DiningTable>(`${D}/tables/${id}`, b),
      onSuccess,
    }),
    deleteTable: useMutation({ mutationFn: (id: string) => api.delete(`${D}/tables/${id}`), onSuccess }),
    rotateQr: useMutation({ mutationFn: (id: string) => api.post<DiningTable>(`${D}/tables/${id}/qr`), onSuccess }),
    saveMenu: useMutation({
      mutationFn: ({ itemId, ...b }: { itemId: string; station?: string; veg?: boolean | null; available?: boolean }) => api.put<MenuSetting>(`${D}/menu/${itemId}`, b),
      onSuccess,
    }),
  };
}
