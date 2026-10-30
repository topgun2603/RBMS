"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, APPROVAL_PIN_HEADER } from "@rbms/web";
import type {
  Customer,
  CustomerInput,
  Invoice,
  InvoiceInput,
  InvoiceStatus,
  InvoiceSummary,
  InvoiceSummaryResponse,
  Item,
  ItemInput,
  Paged,
  PaymentMethod,
  SellerProfile,
  SettingsValues,
} from "./types";

const INV = "/invoices";
export const PAGE_SIZE = 20;

export const qk = {
  summary: ["invoices", "summary"] as const,
  invoices: (f: object) => ["invoices", "list", f] as const,
  invoice: (id: string) => ["invoices", "one", id] as const,
  customers: (q: string, limit?: number) => ["customers", q, limit ?? null] as const,
  customer: (id: string) => ["customers", "one", id] as const,
  items: (q: string, limit?: number) => ["items", q, limit ?? null] as const,
  seller: ["settings", "billing"] as const,
};

// ---- seller profile

export function useSellerProfile() {
  return useQuery({
    queryKey: qk.seller,
    queryFn: () => api.get<SettingsValues<Partial<SellerProfile>>>("/settings/billing").then((r) => r.values ?? {}),
    staleTime: 5 * 60_000,
  });
}

export function useSaveSellerProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: SellerProfile) =>
      api.put<SettingsValues<SellerProfile>>("/settings/billing/tenant", values).then((r) => r.values),
    onSuccess: (values) => qc.setQueryData(qk.seller, values),
  });
}

/** Missing seller fields that make an invoice incomplete (legal name and state are required for GST). */
export function sellerProfileGaps(p?: Partial<SellerProfile>): string[] {
  if (!p) return [];
  const gaps: string[] = [];
  if (!p.legalName?.trim()) gaps.push("legalName");
  if (!p.stateCode?.trim()) gaps.push("stateCode");
  return gaps;
}

// ---- invoices

export function useInvoiceSummary() {
  return useQuery({ queryKey: qk.summary, queryFn: () => api.get<InvoiceSummaryResponse>(`${INV}/summary`) });
}

export interface InvoiceFilters {
  status?: InvoiceStatus | "overdue" | "";
  q?: string;
  customerId?: string;
}

export function useInvoiceList(filters: InvoiceFilters) {
  return useInfiniteQuery({
    queryKey: qk.invoices(filters),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api.get<Paged<InvoiceSummary>>(
        INV,
        { status: filters.status, q: filters.q, customerId: filters.customerId, limit: PAGE_SIZE, offset: pageParam },
        { signal },
      ),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length === PAGE_SIZE && loaded < (last.total ?? Infinity) ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: string) {
  return useQuery({ queryKey: qk.invoice(id), queryFn: () => api.get<Invoice>(`${INV}/${id}`), enabled: !!id });
}

/** After any invoice change: store the fresh copy and refresh lists, summary and customer balances. */
function useInvoiceUpdated() {
  const qc = useQueryClient();
  return (inv?: Invoice) => {
    if (inv?.id) qc.setQueryData(qk.invoice(inv.id), inv);
    void qc.invalidateQueries({ queryKey: ["invoices", "list"] });
    void qc.invalidateQueries({ queryKey: qk.summary });
    void qc.invalidateQueries({ queryKey: ["customers"] });
  };
}

export function useSaveInvoice() {
  const updated = useInvoiceUpdated();
  return useMutation({
    // PATCH accepts `issue: true` too (saves, then issues).
    // `approvalPin`: a manager's POS PIN approving a discount above the user's limit (see useDiscountApproval).
    mutationFn: ({ id, body, approvalPin }: { id?: string; body: InvoiceInput; approvalPin?: string }) => {
      const opts = approvalPin ? { headers: { [APPROVAL_PIN_HEADER]: approvalPin } } : undefined;
      return id ? api.patch<Invoice>(`${INV}/${id}`, body, opts) : api.post<Invoice>(INV, body, opts);
    },
    onSuccess: (inv) => updated(inv),
    onError: () => updated(),
  });
}

export function useInvoiceAction() {
  const updated = useInvoiceUpdated();
  return useMutation({
    mutationFn: (
      a:
        | { kind: "issue"; id: string }
        | { kind: "cancel"; id: string; reason?: string }
        | { kind: "pay"; id: string; amount: number; method: PaymentMethod; date: string; reference?: string }
        | { kind: "unpay"; id: string; paymentId: string },
    ) => {
      switch (a.kind) {
        case "issue":
          return api.post<Invoice>(`${INV}/${a.id}/issue`);
        case "cancel":
          return api.post<Invoice>(`${INV}/${a.id}/cancel`, a.reason ? { reason: a.reason } : {});
        case "pay":
          return api.post<Invoice>(`${INV}/${a.id}/payments`, {
            amount: a.amount,
            method: a.method,
            date: a.date,
            ...(a.reference ? { reference: a.reference } : {}),
          });
        case "unpay":
          return api.delete<Invoice>(`${INV}/${a.id}/payments/${a.paymentId}`);
      }
    },
    onSuccess: (inv) => updated(inv),
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  const updated = useInvoiceUpdated();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`${INV}/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: qk.invoice(id) });
      updated();
    },
  });
}

export function useShareInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ token: string; url: string }>(`${INV}/${id}/share`),
    onSuccess: (r, id) => {
      qc.setQueryData<Invoice>(qk.invoice(id), (inv) => (inv ? { ...inv, shareToken: r.token } : inv));
    },
  });
}

// ---- customers

export function useCustomers(q: string, limit = 50) {
  return useQuery({
    queryKey: qk.customers(q, limit),
    queryFn: ({ signal }) => api.get<Paged<Customer>>(`${INV}/customers`, { q, limit }, { signal }),
    placeholderData: keepPreviousData,
  });
}

/** One customer (GET /customers/:id — implemented by the API, not listed in the contract). */
export function useCustomer(id: string) {
  return useQuery({
    queryKey: qk.customer(id),
    enabled: !!id,
    queryFn: () => api.get<Customer>(`${INV}/customers/${id}`),
  });
}

export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: CustomerInput }) =>
      id ? api.patch<Customer>(`${INV}/customers/${id}`, body) : api.post<Customer>(`${INV}/customers`, body),
    onSuccess: (c) => {
      qc.setQueryData(qk.customer(c.id), c);
      void qc.invalidateQueries({ queryKey: ["customers"] });
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`${INV}/customers/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["customers"] }),
  });
}

// ---- items

export function useItems(q: string, limit = 50, enabled = true) {
  return useQuery({
    queryKey: qk.items(q, limit),
    queryFn: ({ signal }) => api.get<Paged<Item>>(`${INV}/items`, { q, limit }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useSaveItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: ItemInput }) =>
      id ? api.patch<Item>(`${INV}/items/${id}`, body) : api.post<Item>(`${INV}/items`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["items"] }),
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`${INV}/items/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["items"] }),
  });
}
