"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type QueryParams } from "@srirealtime/web";
import { readJson, storageKey, writeJson } from "./storage";
import type {
  CatalogPage,
  DeviceInfo,
  Pairing,
  PairResponse,
  PinRow,
  PinSession,
  PosCategory,
  StaffEntry,
  Terminal,
  TerminalList,
  TerminalRole,
  TerminalSettings,
  WeighTicket,
} from "./terminal-types";

/**
 * `/v1/pos` calls (docs/pos-terminals.md). Device calls rely on the kit's api() carrying `x-device-token` (set by
 * terminal mode through setDeviceToken) and, once unlocked, the PIN session as the bearer (setSessionOverride).
 */

const POS = "/pos";

const idem = (key?: string): HeadersInit | undefined => (key ? { "idempotency-key": key } : undefined);
export const newIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

// ---------------------------------------------------------------- device-local state

/** The device token of this browser for a shop (localStorage). */
export const deviceTokenKey = (tenant: string | null | undefined) => storageKey("device", tenant ?? null);
export const readDeviceToken = (tenant: string | null | undefined) => readJson<string | null>(deviceTokenKey(tenant), null);
export const writeDeviceToken = (tenant: string | null | undefined, token: string | null) => writeJson(deviceTokenKey(tenant), token);

/** Last GET /device answer (shown while offline). */
const deviceInfoKey = (tenant: string | null | undefined) => storageKey("device-info", tenant ?? null);
export const readCachedDevice = (tenant: string | null | undefined) => readJson<DeviceInfo | null>(deviceInfoKey(tenant), null);
export const writeCachedDevice = (tenant: string | null | undefined, d: DeviceInfo | null) => writeJson(deviceInfoKey(tenant), d);

/** The PIN session survives a reload of this tab only (sessionStorage), never a closed browser. */
const pinKey = (tenant: string | null | undefined) => storageKey("pin-session", tenant ?? null);
export function readPinSession(tenant: string | null | undefined): PinSession | null {
  try {
    const raw = window.sessionStorage.getItem(pinKey(tenant));
    return raw ? (JSON.parse(raw) as PinSession) : null;
  } catch {
    return null;
  }
}
export function writePinSession(tenant: string | null | undefined, s: PinSession | null) {
  try {
    if (s) window.sessionStorage.setItem(pinKey(tenant), JSON.stringify(s));
    else window.sessionStorage.removeItem(pinKey(tenant));
  } catch {
    // blocked storage: the session lives in memory
  }
}

/** A short device description for POST /pair. */
export function describeDevice(appVersion?: string): { platform: "web"; model?: string; appVersion?: string; name?: string } {
  if (typeof navigator === "undefined") return { platform: "web" };
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : /iPhone|iPad/.test(ua) ? "iOS" : "";
  return { platform: "web", model: [browser, os].filter(Boolean).join(" on "), ...(appVersion ? { appVersion } : {}) };
}

// ---------------------------------------------------------------- pairing & device

export const pairDevice = (code: string, device = describeDevice()) => api.post<PairResponse>(`${POS}/pair`, { code, device }, { anonymous: true });
export const getDevice = () => api.get<DeviceInfo>(`${POS}/device`);
export const unpairDevice = () => api.post<{ ok: true }>(`${POS}/device/unpair`);
export const getStaff = () => api.get<{ items: StaffEntry[] }>(`${POS}/staff`);
export const openPinSession = (pin: string) => api.post<PinSession>(`${POS}/session`, { pin });
export const lockPinSession = () => api.post<{ ok: true }>(`${POS}/session/lock`);

// ---------------------------------------------------------------- catalogue

export const fetchCatalogPage = (q: { since?: string; after?: string; limit: number }, signal?: AbortSignal) =>
  api<CatalogPage>(`${POS}/catalog`, { query: q as QueryParams, signal });
export const fetchPosCategories = () => api.get<{ items: PosCategory[] }>(`${POS}/catalog/categories`).then((r) => r.items);
/** Price lists, customer groups and links for offline pricing (docs/price-lists-units.md). */
export const fetchPricingCache = () => api.get<import("./units").PricingCache>("/pricelists/cache");
/** The same for counters without the POS catalogue cache (null when the shop has no price lists). */
export function usePricingCache(enabled: boolean) {
  return useQuery({
    queryKey: ["pos", "pricing"],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => fetchPricingCache().catch(() => null),
  }).data;
}

// ---------------------------------------------------------------- weigh tickets

export interface TicketLineInput {
  itemId: string;
  weightKg?: number;
  qty?: number;
  tareKg?: number;
}
export const createWeighTicket = (body: { lines: TicketLineInput[]; note?: string }, key = newIdempotencyKey()) =>
  api.post<WeighTicket>(`${POS}/weigh-tickets`, body, { headers: idem(key) });
export const listWeighTickets = (q: { status?: string; limit?: number } = {}) => api.get<{ items: WeighTicket[]; total: number }>(`${POS}/weigh-tickets`, q);
export const getTicketByCode = (code: string) => api.get<WeighTicket>(`${POS}/weigh-tickets/by-code/${encodeURIComponent(code)}`);
export const markTicketUsed = (id: string, body: { invoiceId: string }, key: string) =>
  api.post<WeighTicket>(`${POS}/weigh-tickets/${id}/use`, body, { headers: idem(key) });
export const cancelWeighTicket = (id: string) => api.post<WeighTicket>(`${POS}/weigh-tickets/${id}/cancel`, undefined, { headers: idem(newIdempotencyKey()) });

// ---------------------------------------------------------------- terminals (admin)

export const terminalKeys = {
  all: ["pos", "terminals"] as const,
  list: ["pos", "terminals", "list"] as const,
};

export interface TerminalInput {
  name: string;
  role: TerminalRole;
  branchId?: string | null;
  settings?: Partial<TerminalSettings>;
}

export function useTerminals() {
  return useQuery({ queryKey: terminalKeys.list, queryFn: () => api.get<TerminalList>(`${POS}/terminals`), staleTime: 10_000, refetchInterval: 30_000 });
}

export function useTerminalActions() {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: terminalKeys.all });
  return {
    create: useMutation({
      mutationFn: (b: TerminalInput) => api.post<{ terminal: Terminal; pairing: Pairing }>(`${POS}/terminals`, b, { headers: idem(newIdempotencyKey()) }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, ...b }: Partial<TerminalInput> & { id: string }) => api.patch<Terminal>(`${POS}/terminals/${id}`, b),
      onSuccess: refresh,
    }),
    reissue: useMutation({ mutationFn: (id: string) => api.post<Pairing>(`${POS}/terminals/${id}/pairing-code`), onSuccess: refresh }),
    unpair: useMutation({ mutationFn: (id: string) => api.delete<Terminal>(`${POS}/terminals/${id}/device`), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api.delete<{ ok: true }>(`${POS}/terminals/${id}`), onSuccess: refresh }),
  };
}

// ---------------------------------------------------------------- PINs

export const pinKeys = { all: ["pos", "pins"] as const };

export function usePins(enabled: boolean) {
  return useQuery({ queryKey: pinKeys.all, queryFn: () => api.get<{ items: PinRow[] }>(`${POS}/pins`).then((r) => r.items), enabled, staleTime: 30_000 });
}

export function useSetMyPin() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (pin: string) => api.put<{ ok: true }>(`${POS}/pins/me`, { pin }), onSuccess: () => void qc.invalidateQueries({ queryKey: pinKeys.all }) });
}
