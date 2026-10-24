"use client";

/** React Query hooks for batches and expiry, stock audits and stock transfers (/v1/inventory/...). */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import type {
  AuditCountEntry,
  AuditCountResult,
  AuditLine,
  Batch,
  BatchAdjustInput,
  BatchMovement,
  BatchReceiveInput,
  BatchSettings,
  ExpirySummary,
  InTransitReport,
  PickAnswer,
  StockAudit,
  Transfer,
  TransferInput,
  TransferReceiveInput,
} from "./types-stock";
import type { Paged } from "./types";

const STOCK = "/inventory";

/** Everything that depends on stock, batches, audits or transfers. */
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const key of [["stock"], ["batches"], ["audits"], ["transfers"], ["purchases"], ["reports"]]) void qc.invalidateQueries({ queryKey: key });
  };
}

// ---------------------------------------------------------------- batches

export const useBatchSettings = (enabled = true) =>
  useQuery({ queryKey: ["batches", "settings"], queryFn: () => api.get<BatchSettings>(`${STOCK}/batches/settings`), enabled, staleTime: 60_000 });

export function useSaveBatchSettings() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: Partial<BatchSettings>) => api.put<BatchSettings>(`${STOCK}/batches/settings`, body), onSuccess: refresh });
}

export const useExpirySummary = (locationId?: string, enabled = true) =>
  useQuery({
    queryKey: ["batches", "summary", locationId ?? "all"],
    queryFn: () => api.get<ExpirySummary>(`${STOCK}/batches/expiry-summary`, { locationId }),
    enabled,
    staleTime: 60_000,
  });

export const useBatch = (id: string | null) =>
  useQuery({ queryKey: ["batches", "one", id], queryFn: () => api.get<Batch>(`${STOCK}/batches/${id}`), enabled: !!id });

export const useBatchMovements = (id: string | null) =>
  useQuery({ queryKey: ["batches", "movements", id], queryFn: () => api.get<{ items: BatchMovement[] }>(`${STOCK}/batches/${id}/movements`), enabled: !!id });

export const useItemTracking = (itemId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ["batches", "tracking", itemId],
    queryFn: () => api.get<{ items: { itemId: string; tracked: boolean }[] }>(`${STOCK}/batches/tracking`, { ids: itemId }).then((r) => r.items[0]?.tracked ?? false),
    enabled: enabled && !!itemId,
    staleTime: 30_000,
  });

export function useSetItemTracking() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (a: { itemId: string; enabled: boolean }) => api.put<{ itemId: string; tracked: boolean }>(`${STOCK}/stock/${a.itemId}/batches/tracking`, { enabled: a.enabled }),
    onSuccess: refresh,
  });
}

/** The batches of an item at the current branch, soonest expiry first, with the first-expiry-first-out choice for `qty`. */
export const usePickBatches = (itemId: string | undefined, qty: number, enabled = true) =>
  useQuery({
    queryKey: ["batches", "pick", itemId, qty],
    queryFn: () => api.get<PickAnswer>(`${STOCK}/batches/pick`, { itemId, qty: qty > 0 ? qty : undefined }),
    enabled: enabled && !!itemId,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

export function useReceiveBatch() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: BatchReceiveInput) => api.post<Batch>(`${STOCK}/batches`, body), onSuccess: refresh });
}

export function useAdjustBatch() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (a: { id: string; body: BatchAdjustInput }) => api.post<Batch>(`${STOCK}/batches/${a.id}/adjust`, a.body), onSuccess: refresh });
}

export function useUpdateBatch() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (a: { id: string; body: Partial<Pick<Batch, "mfgDate" | "expiry" | "mrp" | "cost" | "supplierName" | "note">> }) => api.patch<Batch>(`${STOCK}/batches/${a.id}`, a.body),
    onSuccess: refresh,
  });
}

// ---------------------------------------------------------------- audits

export const useAudit = (id: string) =>
  useQuery({ queryKey: ["audits", "one", id], queryFn: () => api.get<StockAudit>(`${STOCK}/audits/${id}`), enabled: !!id });

export const useAuditLines = (id: string, p: { filter: string; q: string; offset: number; limit: number }, enabled = true) =>
  useQuery({
    queryKey: ["audits", "lines", id, p.filter, p.q, p.offset, p.limit],
    queryFn: () => api.get<Paged<AuditLine>>(`${STOCK}/audits/${id}/lines`, { filter: p.filter, q: p.q || undefined, offset: p.offset, limit: p.limit }),
    enabled: enabled && !!id,
    placeholderData: keepPreviousData,
  });

export function useCreateAudit() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: { locationId?: string; categoryIds?: string[]; title?: string; note?: string; includeZero?: boolean }) => api.post<StockAudit>(`${STOCK}/audits`, body),
    onSuccess: refresh,
  });
}

/** start / submit / reopen / cancel / approve (with a body) on one audit. */
export function useAuditAction(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (a: { action: "start" | "submit" | "reopen" | "cancel" | "approve" | "reasons"; body?: Record<string, unknown> }) =>
      api.post<StockAudit>(`${STOCK}/audits/${id}/${a.action}`, a.body ?? {}),
    onSuccess: refresh,
  });
}

export function useCountAudit(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { entries: AuditCountEntry[]; counter?: string }) => api.post<AuditCountResult>(`${STOCK}/audits/${id}/count`, a),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["audits", "lines", id] });
      void qc.invalidateQueries({ queryKey: ["audits", "one", id] });
    },
  });
}

export function usePatchAuditLine(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { lineId: string; body: { countedQty?: number | null; reason?: string | null; note?: string | null } }) =>
      api.patch<AuditLine>(`${STOCK}/audits/${id}/lines/${a.lineId}`, a.body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["audits", "lines", id] });
      void qc.invalidateQueries({ queryKey: ["audits", "one", id] });
    },
  });
}

// ---------------------------------------------------------------- transfers

export const useTransfer = (id: string) =>
  useQuery({ queryKey: ["transfers", "one", id], queryFn: () => api.get<Transfer>(`${STOCK}/transfer-notes/${id}`), enabled: !!id });

export const useInTransit = (enabled = true, toLocationId?: string) =>
  useQuery({
    queryKey: ["transfers", "in-transit", toLocationId ?? "all"],
    queryFn: () => api.get<InTransitReport>(`${STOCK}/transfer-notes/in-transit`, { toLocationId }),
    enabled,
    staleTime: 20_000,
  });

export function useCreateTransfer() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (body: TransferInput) => api.post<Transfer>(`${STOCK}/transfer-notes`, body), onSuccess: refresh });
}

export function useTransferAction(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (a: { action: "send" | "receive" | "cancel"; body?: TransferReceiveInput | { reason?: string } }) => api.post<Transfer>(`${STOCK}/transfer-notes/${id}/${a.action}`, a.body ?? {}),
    onSuccess: refresh,
  });
}

export function useDeleteTransfer() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: (id: string) => api.delete<{ ok: true }>(`${STOCK}/transfer-notes/${id}`), onSuccess: refresh });
}
