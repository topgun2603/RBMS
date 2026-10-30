"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";
import type { CancelReasonCode, EInvoicePreview, EInvoiceRecord, GenerateIrnResult, Gstr1Summary, InvoiceEInvoiceStatus, ewbRequestBody } from "./einvoice";
import type { LoyaltyQuote } from "./loyalty";

const EI = "/einvoice";

export const growthKeys = {
  einvoice: (invoiceId: string) => ["einvoice", "invoice", invoiceId] as const,
  gstr1: (period: string) => ["einvoice", "gstr1", period] as const,
  quote: (phone: string, amount: number) => ["loyalty", "quote", phone, amount] as const,
};

// ---- e-invoice (per bill)

export function useEInvoiceStatus(invoiceId: string, enabled = true) {
  return useQuery({
    queryKey: growthKeys.einvoice(invoiceId),
    queryFn: ({ signal }) => api.get<InvoiceEInvoiceStatus>(`${EI}/invoices/${invoiceId}`, undefined, { signal }),
    enabled: enabled && !!invoiceId,
    retry: (count, err) => count < 2 && (err as { status?: number }).status !== 403,
  });
}

/** Fetches the NIC payload preview + issues on demand (before generating). */
export function useEInvoicePreview() {
  return useMutation({
    mutationFn: (invoiceId: string) => api.get<EInvoicePreview>(`${EI}/invoices/${invoiceId}/preview`),
  });
}

type EwbBody = ReturnType<typeof ewbRequestBody>;

export function useEInvoiceAction(invoiceId: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: growthKeys.einvoice(invoiceId) });
  return useMutation({
    mutationFn: (
      a:
        | { kind: "irn" }
        | { kind: "cancelIrn"; reason: CancelReasonCode; remark?: string }
        | { kind: "ewb"; body: EwbBody }
        | { kind: "cancelEwb"; reason: CancelReasonCode; remark?: string },
    ): Promise<GenerateIrnResult | EInvoiceRecord | { record: EInvoiceRecord }> => {
      const base = `${EI}/invoices/${invoiceId}`;
      switch (a.kind) {
        case "irn":
          return api.post<GenerateIrnResult>(`${base}/irn`, {});
        case "cancelIrn":
          return api.post<EInvoiceRecord>(`${base}/irn/cancel`, { reason: a.reason, ...(a.remark ? { remark: a.remark } : {}) });
        case "ewb":
          return api.post<{ record: EInvoiceRecord }>(`${base}/ewb`, a.body);
        case "cancelEwb":
          return api.post<EInvoiceRecord>(`${base}/ewb/cancel`, { reason: a.reason, ...(a.remark ? { remark: a.remark } : {}) });
      }
    },
    // Failed attempts are recorded too (history), so refresh either way.
    onSettled: () => void refresh(),
  });
}

// ---- GSTR-1

export function useGstr1Summary(period: string, enabled = true) {
  return useQuery({
    queryKey: growthKeys.gstr1(period),
    queryFn: ({ signal }) => api.get<Gstr1Summary>(`${EI}/gstr1`, { period }, { signal }),
    enabled: enabled && /^\d{6}$/.test(period),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: (count, err) => count < 1 && (err as { status?: number }).status !== 403,
  });
}

// ---- loyalty

/** Quote for a customer's phone and the bill amount (paise). Disabled until both are set. */
export function useLoyaltyQuote(phone: string | null, amount: number, enabled = true) {
  return useQuery({
    queryKey: growthKeys.quote(phone ?? "", amount),
    queryFn: ({ signal }) => api.post<LoyaltyQuote>("/loyalty/quote", { phone, amount }, { signal }),
    enabled: enabled && !!phone && amount > 0,
    // Keep the last answer while re-quoting a new total, but never show another customer's points.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === (phone ?? "") ? prev : undefined),
    staleTime: 30_000,
    retry: (count, err) => count < 1 && ![400, 403, 404].includes((err as { status?: number }).status ?? 0),
  });
}
