"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import { qk } from "./queries";
import type {
  LinkedQuotation,
  PublicQuotationResponse,
  Quotation,
  QuotationChannel,
  QuotationConvertInput,
  QuotationConvertResult,
  QuotationInput,
  QuotationSettings,
  QuotationSummaryReport,
} from "./types-quotations";

const Q = "/quotations";

export const qkQ = {
  summary: ["quotations", "summary"] as const,
  list: ["quotations", "list"] as const,
  one: (id: string) => ["quotations", "one", id] as const,
  linked: (targetId: string) => ["quotations", "linked", targetId] as const,
  settings: ["quotations", "settings"] as const,
  public: (token: string) => ["public-quotation", token] as const,
};

export function useQuotation(id: string) {
  return useQuery({ queryKey: qkQ.one(id), queryFn: () => api.get<Quotation>(`${Q}/${id}`), enabled: !!id });
}

/** Open value, accepted this month and the conversion rate (dashboard tile). */
export function useQuotationSummary(enabled = true) {
  return useQuery({ queryKey: qkQ.summary, queryFn: () => api.get<QuotationSummaryReport>(`${Q}/summary`), enabled, staleTime: 30_000 });
}

/** The quotation a bill or order was made from, if any (bill page shows the link back). */
export function useLinkedQuotation(targetId: string, enabled = true) {
  return useQuery({
    queryKey: qkQ.linked(targetId),
    queryFn: () => api.get<{ quotation: LinkedQuotation | null }>(`${Q}/linked`, { targetId }).then((r) => r.quotation),
    enabled: enabled && !!targetId,
    staleTime: 60_000,
  });
}

export function useQuotationSettings() {
  return useQuery({ queryKey: qkQ.settings, queryFn: () => api.get<QuotationSettings>(`${Q}/settings`), staleTime: 5 * 60_000 });
}

/** The quotations shop settings namespace (prefix, validity days, default terms). */
export function useSaveQuotationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: QuotationSettings) =>
      api.put<{ values: QuotationSettings }>("/settings/quotations/tenant", { ...values, terms: values.terms ?? "" }).then((r) => r.values),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qkQ.settings }),
  });
}

/** Everything a quotation change can touch. */
function useChanged() {
  const qc = useQueryClient();
  return (q: Quotation) => {
    qc.setQueryData(qkQ.one(q.id), q);
    void qc.invalidateQueries({ queryKey: ["quotations"] });
  };
}

export function useReviseQuotation() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: QuotationInput }) => api.post<Quotation>(`${Q}/${id}/revise`, body),
    onSuccess: changed,
  });
}

export function useUpdateQuotation() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<QuotationInput> }) => api.patch<Quotation>(`${Q}/${id}`, body),
    onSuccess: changed,
  });
}

export function useCreateQuotation() {
  const changed = useChanged();
  return useMutation({ mutationFn: (body: QuotationInput) => api.post<Quotation>(Q, body), onSuccess: changed });
}

export function useDuplicateQuotation() {
  const changed = useChanged();
  return useMutation({ mutationFn: (id: string) => api.post<Quotation>(`${Q}/${id}/duplicate`, {}), onSuccess: changed });
}

export function useCancelQuotation() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => api.post<Quotation>(`${Q}/${id}/cancel`, reason ? { reason } : {}),
    onSuccess: changed,
  });
}

export function useShareQuotation() {
  const changed = useChanged();
  return useMutation({
    mutationFn: (id: string) => api.post<{ token: string; url: string; quotation: Quotation }>(`${Q}/${id}/share`, {}),
    onSuccess: (r) => changed(r.quotation),
  });
}

export function useSendQuotation() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, channel, to, locale }: { id: string; channel: QuotationChannel; to?: string; locale?: string }) =>
      api.post<{ logId: string; url: string; quotation: Quotation }>(`${Q}/${id}/send`, { channel, ...(to ? { to } : {}), ...(locale ? { locale } : {}) }),
    onSuccess: (r) => changed(r.quotation),
  });
}

export function useConvertQuotation() {
  const changed = useChanged();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: QuotationConvertInput }) => api.post<QuotationConvertResult>(`${Q}/${id}/convert`, body),
    onSuccess: (r) => {
      changed(r.quotation);
      if (r.invoice) qc.setQueryData(qk.invoice(r.invoice.id), r.invoice);
      // The new bill / order shows up in their lists; customers' balances change when a bill is issued.
      for (const key of [["invoices"], ["orders"], ["customers"], ["credit-book"], ["stock"]]) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

// ---- public page (no sign-in, no tenant header: the share token names the shop)

export function usePublicQuotation(token: string) {
  return useQuery({
    queryKey: qkQ.public(token),
    queryFn: () => api<PublicQuotationResponse>(`${Q}/public/${encodeURIComponent(token)}`, { tenant: null, anonymous: true }),
    enabled: !!token,
  });
}

export function useRespondQuotation(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { decision: "accept" | "decline"; name: string; note?: string }) =>
      api<PublicQuotationResponse>(`${Q}/public/${encodeURIComponent(token)}/respond`, { method: "POST", body, tenant: null, anonymous: true }),
    onSuccess: (r) => qc.setQueryData(qkQ.public(token), r),
  });
}
