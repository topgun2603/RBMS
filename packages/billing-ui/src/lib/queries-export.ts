"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import { qk } from "./queries";
import type { Invoice } from "./types";
import type { ForeignPaymentInput, GstinLookupResult, GstinStatus } from "./types-export";

/** A payment received in a bill's foreign currency at the bank's rate (POST /v1/export-billing/invoices/:id/payments). */
export function useForeignPayment(invoiceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ForeignPaymentInput) => api.post<Invoice>(`/export-billing/invoices/${invoiceId}/payments`, body),
    onSuccess: (inv) => {
      qc.setQueryData(qk.invoice(inv.id), inv);
      void qc.invalidateQueries({ queryKey: ["invoices", "list"] });
      void qc.invalidateQueries({ queryKey: qk.summary });
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

/** Is an online GSTIN provider configured (else the lookup is offline only). */
export function useGstinInfo() {
  return useQuery({ queryKey: ["gstin", "info"], queryFn: () => api.get<{ online: boolean; provider: string | null; cacheDays: number }>("/gstin/info"), staleTime: 10 * 60_000 });
}

/** GET /v1/gstin/:gstin — run on demand (`enabled`), `refresh` skips the 30-day cache. */
export function useGstinLookup() {
  return useMutation({
    mutationFn: ({ gstin, refresh }: { gstin: string; refresh?: boolean }) =>
      api.get<GstinLookupResult>(`/gstin/${encodeURIComponent(gstin.trim().toUpperCase())}`, refresh ? { refresh: "1" } : undefined),
  });
}

/** Cached registration status of GSTINs (never calls the provider): for the cancelled-GSTIN warning. */
export function useGstinStatuses(gstins: (string | null | undefined)[]) {
  const list = [...new Set(gstins.filter((g): g is string => !!g && g.trim().length === 15).map((g) => g.trim().toUpperCase()))].sort();
  return useQuery({
    queryKey: ["gstin", "status", list],
    queryFn: () => api.post<{ items: Record<string, { status: GstinStatus; fetchedAt: string; legalName: string | null }> }>("/gstin/status", { gstins: list }),
    enabled: list.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
