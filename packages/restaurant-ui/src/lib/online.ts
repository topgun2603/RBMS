"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";
import { retry4xx } from "./queries";
import type { Platform } from "./types";

/** Client side of @rbms/aggregators (`/v1/aggregators`). Money in paise. */

const A = "/aggregators";

export const PROVIDERS = ["urbanpiper", "manual"] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export const ONLINE_STATUSES = ["placed", "accepted", "ready", "dispatched", "completed", "rejected", "cancelled"] as const;
export type OnlineStatus = (typeof ONLINE_STATUSES)[number];
export type TaxMode = "eco_9_5" | "restaurant";

export interface PlatformSetting {
  enabled: boolean;
  taxMode: TaxMode;
  gstin: string | null;
}

export interface Connection {
  provider: ProviderId;
  label: string;
  configured: boolean;
  enabled: boolean;
  webhookUrl: string | null;
  signatureHeaders: string[];
  username: string | null;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  storeRef: string | null;
  baseUrl: string | null;
  platforms: Record<Platform, PlatformSetting>;
  autoAccept: boolean;
  prepMinutes: number;
  lastWebhookAt: string | null;
  lastError: string | null;
  menuPushedAt: string | null;
  /** Shown once, right after it was generated. */
  newWebhookSecret?: string;
}

export interface OnlineLine {
  externalId: string;
  title: string;
  qty: number;
  unitPrice: number;
  total: number;
  itemId: string | null;
  via: "mapping" | "ref" | null;
  note: string | null;
}

export interface CallbackEntry {
  status: string;
  at: string;
  ok: boolean;
  skipped?: boolean;
  httpStatus?: number;
  error?: string;
}

export interface OnlineOrder {
  id: string;
  provider: ProviderId;
  platform: Platform;
  externalId: string;
  platformOrderId: string | null;
  type: "delivery" | "pickup";
  status: OnlineStatus;
  diningOrderId: string | null;
  kitchenNumber: number | null;
  order: {
    customer: { name: string | null; phone: string | null };
    charges: { title: string; amount: number }[];
    discounts: { title: string; amount: number; fundedBy: string }[];
    totals: { items: number; charges: number; discount: number; tax: number; total: number };
    instructions: string | null;
  };
  lines: OnlineLine[];
  unmapped: number;
  total: number;
  payment: "prepaid" | "cod";
  taxMode: TaxMode;
  valueOfSupply: number;
  gst: number;
  placedAt: string;
  expectedPickupAt: string | null;
  prepMinutes: number | null;
  acceptedAt: string | null;
  readyAt: string | null;
  dispatchedAt: string | null;
  reason: string | null;
  rider: { name: string | null; phone: string | null; status: string | null } | null;
  lastCallback: CallbackEntry | null;
  kitchenError: string | null;
  test: boolean;
  taxNote: string;
}

export interface Mapping {
  id: string;
  externalId: string;
  itemId: string;
  title: string | null;
}

export interface Unmapped {
  externalId: string;
  title: string;
  count: number;
  lastSeen: string;
}

export interface PushResult {
  sent: boolean;
  ok: boolean;
  reason?: string;
  requests: number;
  failed: number;
  error?: string;
  items?: number;
}

export interface EcoReport {
  from: string;
  to: string;
  summary: { platform: Platform; operator: string; operatorGstin: string | null; orders: number; valueOfSupply: number; gst: number }[];
  restaurantTaxed: { orders: number; valueOfSupply: number };
}

export const ok = {
  all: ["restaurant", "online"] as const,
  orders: (status: string) => ["restaurant", "online", "orders", status] as const,
  connections: ["restaurant", "online", "connections"] as const,
  mappings: (p: ProviderId) => ["restaurant", "online", "mappings", p] as const,
  unmapped: (p: ProviderId) => ["restaurant", "online", "unmapped", p] as const,
  report: (from: string, to: string) => ["restaurant", "online", "report", from, to] as const,
};

/** New platform orders must be seen fast: the queue polls every 5 s. */
export const ONLINE_POLL_MS = 5_000;

export function useOnlineOrders(status: "active" | "done") {
  return useQuery({
    queryKey: ok.orders(status),
    queryFn: () => api.get<{ items: OnlineOrder[] }>(`${A}/orders`, { status, limit: status === "done" ? 50 : 100 }),
    refetchInterval: status === "active" ? ONLINE_POLL_MS : false,
    retry: retry4xx,
  });
}

export function useOnlineActions() {
  const qc = useQueryClient();
  // Kitchen tickets and the floor change too.
  const onSuccess = () => qc.invalidateQueries({ queryKey: ["restaurant"] });
  const post = (path: string, body?: unknown) => api.post<OnlineOrder>(`${A}/orders/${path}`, body ?? {});
  return {
    accept: useMutation({ mutationFn: ({ id, prepMinutes }: { id: string; prepMinutes: number }) => post(`${id}/accept`, { prepMinutes }), onSuccess }),
    reject: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => post(`${id}/reject`, { reason }), onSuccess }),
    ready: useMutation({ mutationFn: (id: string) => post(`${id}/ready`), onSuccess }),
    dispatched: useMutation({ mutationFn: (id: string) => post(`${id}/dispatched`), onSuccess }),
    retryKitchen: useMutation({ mutationFn: (id: string) => post(`${id}/retry-kitchen`), onSuccess }),
    resync: useMutation({ mutationFn: (id: string) => post(`${id}/resync`), onSuccess }),
  };
}

export function useConnections() {
  return useQuery({ queryKey: ok.connections, queryFn: () => api.get<{ items: Connection[] }>(`${A}/connections`), retry: retry4xx });
}

export interface ConnectionBody {
  enabled?: boolean;
  username?: string | null;
  apiKey?: string | null;
  webhookSecret?: string | null;
  storeRef?: string | null;
  baseUrl?: string | null;
  platforms?: Partial<Record<Platform, Partial<PlatformSetting>>>;
  autoAccept?: boolean;
  prepMinutes?: number;
}

export function useConnectionActions(provider: ProviderId) {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries({ queryKey: ok.all });
  const P = `${A}/connections/${provider}`;
  return {
    save: useMutation({ mutationFn: (b: ConnectionBody) => api.put<Connection>(P, b), onSuccess }),
    rotate: useMutation({ mutationFn: (b: { secret?: boolean }) => api.post<Connection>(`${P}/rotate`, b), onSuccess }),
    testOrder: useMutation({ mutationFn: (platform: Platform) => api.post<OnlineOrder>(`${P}/test-order`, { platform }), onSuccess: () => qc.invalidateQueries({ queryKey: ["restaurant"] }) }),
    pushMenu: useMutation({ mutationFn: () => api.post<PushResult>(`${P}/menu/push`, {}), onSuccess }),
    pushStock: useMutation({ mutationFn: () => api.post<PushResult>(`${P}/stock/push`, {}), onSuccess }),
    map: useMutation({ mutationFn: (b: { externalId: string; itemId: string; title?: string | null }) => api.put<Mapping>(`${P}/mappings`, b), onSuccess }),
    unmap: useMutation({ mutationFn: (id: string) => api.delete(`${A}/mappings/${id}`), onSuccess }),
  };
}

export function useMappings(provider: ProviderId, enabled = true) {
  return useQuery({ queryKey: ok.mappings(provider), queryFn: () => api.get<{ items: Mapping[] }>(`${A}/connections/${provider}/mappings`), enabled, retry: retry4xx });
}

export function useUnmapped(provider: ProviderId, enabled = true) {
  return useQuery({ queryKey: ok.unmapped(provider), queryFn: () => api.get<{ items: Unmapped[] }>(`${A}/connections/${provider}/unmapped`), enabled, retry: retry4xx });
}

export function useEcoReport(from: string, to: string) {
  return useQuery({ queryKey: ok.report(from, to), queryFn: () => api.get<EcoReport>(`${A}/reports/eco`, { from, to }), retry: retry4xx });
}

/** Whole minutes until an ISO time (negative = late). */
export const minutesUntil = (iso: string, now: number = Date.now()) => Math.ceil((Date.parse(iso) - now) / 60_000);
