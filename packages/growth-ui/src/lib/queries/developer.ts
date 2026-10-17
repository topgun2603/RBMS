"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import { retry4xx } from "../http";
import type { ApiKey, ISODate, Paged, ScopeDef, WebhookDelivery, WebhookEndpoint, WebhookEventDef } from "../types";

/** /v1/developer: API keys, webhook endpoints, delivery log (packages/developer/src/routes.ts). */
const BASE = "/developer";

export const developerKeys = {
  all: ["developer"] as const,
  scopes: () => ["developer", "scopes"] as const,
  events: () => ["developer", "events"] as const,
  keys: () => ["developer", "keys"] as const,
  endpoints: () => ["developer", "endpoints"] as const,
  /** Prefix of every delivery-log query (the table appends its params); redeliver / test / delete invalidate it. */
  deliveries: () => ["developer", "deliveries"] as const,
  delivery: (id: string) => ["developer", "delivery", id] as const,
};

/** Server rows carry a few more fields than lib/types has. */
export type DeliveryDetail = WebhookDelivery & { deliveredAt?: ISODate | null; tenantId?: string };

export interface CreateKeyInput {
  name: string;
  scopes: string[];
  expiresAt: string | null;
}

export interface EndpointInput {
  url: string;
  events: string[];
  description?: string | null;
  active?: boolean;
}

// ------------------------------------------------------------------ catalogues

export const useScopes = () =>
  useQuery({
    queryKey: developerKeys.scopes(),
    queryFn: () => api<Paged<ScopeDef>>(`${BASE}/scopes`),
    staleTime: 10 * 60_000,
    retry: retry4xx,
  });

export const useEvents = () =>
  useQuery({
    queryKey: developerKeys.events(),
    queryFn: () => api<Paged<WebhookEventDef>>(`${BASE}/events`),
    staleTime: 10 * 60_000,
    retry: retry4xx,
  });

// ------------------------------------------------------------------ API keys

export const useApiKeys = () =>
  useQuery({ queryKey: developerKeys.keys(), queryFn: () => api<Paged<ApiKey>>(`${BASE}/keys`), retry: retry4xx });

export function useCreateKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateKeyInput) => api<{ key: ApiKey; token: string }>(`${BASE}/keys`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: developerKeys.keys() }),
  });
}

export function useRenameKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api<ApiKey>(`${BASE}/keys/${id}`, { method: "PATCH", body: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: developerKeys.keys() }),
  });
}

export function useRevokeKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<ApiKey>(`${BASE}/keys/${id}/revoke`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: developerKeys.keys() }),
  });
}

// ------------------------------------------------------------------ endpoints

export const useEndpoints = () =>
  useQuery({ queryKey: developerKeys.endpoints(), queryFn: () => api<Paged<WebhookEndpoint>>(`${BASE}/endpoints`), retry: retry4xx });

export function useCreateEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EndpointInput) => api<{ endpoint: WebhookEndpoint; secret: string }>(`${BASE}/endpoints`, { method: "POST", body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: developerKeys.endpoints() }),
  });
}

export function useUpdateEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<EndpointInput> & { id: string }) =>
      api<WebhookEndpoint>(`${BASE}/endpoints/${id}`, { method: "PATCH", body }),
    onMutate: async ({ id, active }) => {
      // Optimistic switch flip.
      if (active === undefined) return undefined;
      await qc.cancelQueries({ queryKey: developerKeys.endpoints() });
      const prev = qc.getQueryData<Paged<WebhookEndpoint>>(developerKeys.endpoints());
      if (prev) qc.setQueryData(developerKeys.endpoints(), { ...prev, items: prev.items.map((e) => (e.id === id ? { ...e, active } : e)) });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(developerKeys.endpoints(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: developerKeys.endpoints() }),
  });
}

export function useDeleteEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`${BASE}/endpoints/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: developerKeys.endpoints() });
      void qc.invalidateQueries({ queryKey: developerKeys.deliveries() });
    },
  });
}

export function useRotateSecret() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ endpoint: WebhookEndpoint; secret: string }>(`${BASE}/endpoints/${id}/rotate-secret`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: developerKeys.endpoints() }),
  });
}

/** Sends a `ping` now; returns the logged delivery (null if it couldn't be claimed). */
export function useTestEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<DeliveryDetail | null>(`${BASE}/endpoints/${id}/test`, { method: "POST" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: developerKeys.deliveries() });
      void qc.invalidateQueries({ queryKey: developerKeys.endpoints() });
    },
  });
}

// ------------------------------------------------------------------ deliveries

/** The delivery log's server default sort (packages/developer `DELIVERY_SORT`). */
export const DELIVERIES_DEFAULT_SORT = "-time";

export const useDelivery = (id: string | null) =>
  useQuery({
    queryKey: developerKeys.delivery(id ?? ""),
    queryFn: () => api<DeliveryDetail>(`${BASE}/deliveries/${id}`),
    enabled: !!id,
    retry: retry4xx,
  });

export function useRedeliver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<DeliveryDetail | null>(`${BASE}/deliveries/${id}/redeliver`, { method: "POST" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: developerKeys.deliveries() });
      void qc.invalidateQueries({ queryKey: developerKeys.endpoints() });
    },
  });
}
