"use client";

/** React Query hooks for supplier payables, purchase orders / goods receipts and debit notes (/v1/inventory/...). */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import type { Paged, Purchase, PurchaseSummary } from "./types";
import type {
  ConvertInput,
  DebitNote,
  DebitNoteInput,
  PayablesAgeing,
  PayablesSummary,
  PaymentInput,
  PurchaseOrder,
  PurchaseOrderDetail,
  PurchasePayables,
  PurchasePayment,
  ReceiveInput,
  ReceiveResult,
  SupplierPaymentInput,
  SupplierPaymentResult,
  SupplierStatement,
  BillFields,
  GoodsReceipt,
} from "./types-payables";

const STOCK = "/inventory";

export const qkp = {
  summary: ["payables", "summary"] as const,
  ageing: (asOf: string) => ["payables", "ageing", asOf] as const,
  statement: (id: string, from: string, to: string) => ["suppliers", "statement", id, from, to] as const,
  payments: (key: string) => ["purchases", "payments", key] as const,
  po: (id: string) => ["purchase-orders", "one", id] as const,
  debitNotes: (purchaseId: string) => ["debit-notes", "of", purchaseId] as const,
};

/** Everything that depends on what we owe suppliers or on stock. */
function useRefreshAll() {
  const qc = useQueryClient();
  return () => {
    for (const key of [["payables"], ["suppliers"], ["purchases"], ["purchase-orders"], ["debit-notes"], ["stock"], ["reports"]]) {
      void qc.invalidateQueries({ queryKey: key });
    }
  };
}

// ---------------------------------------------------------------- payables, statement

export const usePayablesSummary = (enabled = true) =>
  useQuery({ queryKey: qkp.summary, queryFn: () => api.get<PayablesSummary>(`${STOCK}/payables/summary`), enabled, staleTime: 30_000 });

export const usePayablesAgeing = (asOf: string, enabled = true) =>
  useQuery({
    queryKey: qkp.ageing(asOf),
    queryFn: ({ signal }) => api.get<PayablesAgeing>(`${STOCK}/reports/payables-ageing`, { asOf }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useSupplierStatement = (id: string, from: string, to: string) =>
  useQuery({
    queryKey: qkp.statement(id, from, to),
    queryFn: ({ signal }) => api.get<SupplierStatement>(`${STOCK}/suppliers/${id}/statement`, { from: from || undefined, to: to || undefined }, { signal }),
    placeholderData: keepPreviousData,
    enabled: !!id,
  });

/** Unpaid recorded bills of a supplier, oldest first (for choosing what a payment settles). */
export const useSupplierDueBills = (supplierId: string, enabled: boolean) =>
  useQuery({
    queryKey: ["purchases", "due", supplierId],
    queryFn: () => api.get<Paged<PurchaseSummary & PurchasePayables>>(`${STOCK}/purchases`, { supplierId, status: "unpaid", sort: "date", limit: 200 }),
    enabled: enabled && !!supplierId,
  });

export const usePurchasePayments = (purchaseId: string) =>
  useQuery({
    queryKey: qkp.payments(purchaseId),
    queryFn: () => api.get<{ items: PurchasePayment[] }>(`${STOCK}/purchases/${purchaseId}/payments`),
    enabled: !!purchaseId,
  });

export function usePayPurchase() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PaymentInput }) => api.post<Purchase>(`${STOCK}/purchases/${id}/payments`, body),
    onSuccess: refresh,
  });
}

export function usePaySupplier() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SupplierPaymentInput }) => api.post<SupplierPaymentResult>(`${STOCK}/suppliers/${id}/payments`, body),
    onSuccess: refresh,
  });
}

export function useReversePayment() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ id, group, reason }: { id: string; group?: boolean; reason?: string }) =>
      api.post<{ reversed: number }>(`${STOCK}/payments/${group ? "group/" : ""}${id}/reverse`, reason ? { reason } : {}),
    onSuccess: refresh,
  });
}

export function useSetDueDate() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ id, dueDate }: { id: string; dueDate: string | null }) => api.patch<Purchase>(`${STOCK}/purchases/${id}`, { dueDate }),
    onSuccess: refresh,
  });
}

// ---------------------------------------------------------------- purchase orders

export const usePurchaseOrder = (id: string) =>
  useQuery({ queryKey: qkp.po(id), queryFn: () => api.get<PurchaseOrderDetail>(`${STOCK}/purchase-orders/${id}`), enabled: !!id });

export function useCreatePurchaseOrder() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<PurchaseOrder>(`${STOCK}/purchase-orders`, body),
    onSuccess: refresh,
  });
}

export function usePurchaseOrderAction() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (a: { id: string; kind: "send" | "cancel" | "close" }) => api.post<PurchaseOrder>(`${STOCK}/purchase-orders/${a.id}/${a.kind}`, {}),
    onSuccess: refresh,
  });
}

export function useReceiveGoods() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReceiveInput }) => api.post<ReceiveResult>(`${STOCK}/purchase-orders/${id}/receive`, body),
    onSuccess: refresh,
  });
}

export function useConvertOrder() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ConvertInput }) => api.post<ReceiveResult>(`${STOCK}/purchase-orders/${id}/convert`, body),
    onSuccess: refresh,
  });
}

export function useBillReceipt() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: BillFields }) => api.post<Purchase>(`${STOCK}/goods-receipts/${id}/bill`, body),
    onSuccess: refresh,
  });
}

export type { GoodsReceipt };

// ---------------------------------------------------------------- debit notes

export const useDebitNotesOf = (purchaseId: string) =>
  useQuery({
    queryKey: qkp.debitNotes(purchaseId),
    queryFn: () => api.get<Paged<DebitNote>>(`${STOCK}/debit-notes`, { purchaseId, limit: 100 }),
    enabled: !!purchaseId,
  });

export function useCreateDebitNote() {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: (body: DebitNoteInput) => api.post<DebitNote>(`${STOCK}/debit-notes`, body), onSuccess: refresh });
}

export function useCancelDebitNote() {
  const refresh = useRefreshAll();
  return useMutation({ mutationFn: (id: string) => api.post<DebitNote>(`${STOCK}/debit-notes/${id}/cancel`, {}), onSuccess: refresh });
}
