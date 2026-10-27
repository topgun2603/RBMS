"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import { qk } from "./queries";
import type { Invoice } from "./types";
import type {
  AdvanceInput,
  Challan,
  ChallanInput,
  ChallanSummary,
  ChallanPatch,
  LinkedSalesDocs,
  Proforma,
  ProformaInput,
  PublicSalesDocResponse,
  SaleOrder,
  SaleOrderInput,
  SalesDocChannel,
  SalesDocListResponse,
  SalesDocSettings,
  SalesDocsSummary,
} from "./types-sales-docs";

/** Routes of the sales documents module (packages/invoices/src/sales-docs-routes.ts). */
const SD = "/sales-docs";
const PI = `${SD}/proformas`;
const SO = `${SD}/sale-orders`;
const DC = `${SD}/challans`;

export const qkSD = {
  root: ["sales-docs"] as const,
  summary: ["sales-docs", "summary"] as const,
  settings: ["sales-docs", "settings"] as const,
  proforma: (id: string) => ["sales-docs", "proforma", id] as const,
  order: (id: string) => ["sales-docs", "sale-order", id] as const,
  challan: (id: string) => ["sales-docs", "challan", id] as const,
  linked: (invoiceId: string) => ["sales-docs", "linked", invoiceId] as const,
  challansOf: (customerKey: string) => ["sales-docs", "challans-to-bill", customerKey] as const,
  public: (token: string) => ["public-sales-doc", token] as const,
};

export function useSalesDocSettings() {
  return useQuery({ queryKey: qkSD.settings, queryFn: () => api.get<SalesDocSettings>(`${SD}/settings`), staleTime: 5 * 60_000 });
}

/** The "sales-docs" shop settings namespace (prefixes, proforma validity, default terms, advance %, hold stock). */
export function useSaveSalesDocSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: SalesDocSettings) =>
      api
        .put<{ values: SalesDocSettings }>("/settings/sales-docs/tenant", {
          ...v,
          proformaTerms: v.proformaTerms ?? "",
          saleOrderTerms: v.saleOrderTerms ?? "",
          challanTerms: v.challanTerms ?? "",
        })
        .then((r) => r.values),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qkSD.settings }),
  });
}

export function useSalesDocsSummary(enabled = true) {
  return useQuery({ queryKey: qkSD.summary, queryFn: () => api.get<SalesDocsSummary>(`${SD}/summary`), enabled, staleTime: 30_000 });
}

/** The proforma, sale orders and challans a bill was made from (bill page). */
export function useLinkedSalesDocs(invoiceId: string, enabled = true) {
  return useQuery({
    queryKey: qkSD.linked(invoiceId),
    queryFn: () => api.get<LinkedSalesDocs>(`${SD}/linked`, { targetId: invoiceId }),
    enabled: enabled && !!invoiceId,
    staleTime: 60_000,
  });
}

/** Everything a change can touch: the document, the lists, and (after billing) bills, customers, stock. */
function useChanged() {
  const qc = useQueryClient();
  return (opts: { invoice?: Invoice | null; billed?: boolean } = {}) => {
    void qc.invalidateQueries({ queryKey: qkSD.root });
    if (opts.invoice) qc.setQueryData(qk.invoice(opts.invoice.id), opts.invoice);
    if (opts.billed || opts.invoice) for (const key of [["invoices"], ["customers"], ["credit-book"]]) void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["stock"] });
  };
}

// ---------------------------------------------------------------- proforma invoices

export function useProforma(id: string) {
  return useQuery({ queryKey: qkSD.proforma(id), queryFn: () => api.get<Proforma>(`${PI}/${id}`), enabled: !!id });
}

export function useCreateProforma() {
  const changed = useChanged();
  return useMutation({ mutationFn: (body: ProformaInput) => api.post<Proforma>(PI, body), onSuccess: () => changed() });
}

export function useUpdateProforma() {
  const changed = useChanged();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<ProformaInput> }) => api.patch<Proforma>(`${PI}/${id}`, body), onSuccess: () => changed() });
}

export function useIssueProforma() {
  const changed = useChanged();
  return useMutation({ mutationFn: (id: string) => api.post<Proforma>(`${PI}/${id}/issue`, {}), onSuccess: () => changed() });
}

export function useProformaAdvance() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AdvanceInput }) => api.post<Proforma>(`${PI}/${id}/advance`, body),
    onSuccess: () => changed({ billed: true }),
  });
}

export function useConvertProforma() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, issue }: { id: string; issue: boolean }) => api.post<{ proforma: Proforma; invoice: Invoice; advanceApplied: number }>(`${PI}/${id}/convert`, { issue }),
    onSuccess: (r) => changed({ invoice: r.invoice }),
  });
}

// ---------------------------------------------------------------- sale orders

export function useSaleOrder(id: string) {
  return useQuery({ queryKey: qkSD.order(id), queryFn: () => api.get<SaleOrder>(`${SO}/${id}`), enabled: !!id });
}

export function useCreateSaleOrder() {
  const changed = useChanged();
  return useMutation({ mutationFn: (body: SaleOrderInput) => api.post<SaleOrder>(SO, body), onSuccess: () => changed() });
}

export function useUpdateSaleOrder() {
  const changed = useChanged();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<SaleOrderInput> }) => api.patch<SaleOrder>(`${SO}/${id}`, body), onSuccess: () => changed() });
}

export function useSaleOrderAdvance() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AdvanceInput }) => api.post<SaleOrder>(`${SO}/${id}/advance`, body),
    onSuccess: () => changed({ billed: true }),
  });
}

export interface DeliverBody {
  lines?: { key: string; qty: number }[];
  reason?: "before_invoice" | "approval";
  date?: string;
  returnBy?: string | null;
  shipTo?: string | null;
  transport?: ChallanInput["transport"];
  ewbNo?: string | null;
  ewbDate?: string | null;
  notes?: string | null;
}

export function useDeliverSaleOrder() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DeliverBody }) => api.post<{ order: SaleOrder; challan: Challan }>(`${SO}/${id}/deliver`, body),
    onSuccess: () => changed(),
  });
}

export function useInvoiceSaleOrder() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { lines?: { key: string; qty: number }[]; issue?: boolean } }) =>
      api.post<{ order: SaleOrder; invoice: Invoice; advanceApplied: number }>(`${SO}/${id}/invoice`, body),
    onSuccess: (r) => changed({ invoice: r.invoice }),
  });
}

export function useInvoiceOrderChallans() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { challanIds?: string[]; issue?: boolean } }) =>
      api.post<{ order: SaleOrder; invoice: Invoice; advanceApplied: number }>(`${SO}/${id}/invoice-challans`, body),
    onSuccess: (r) => changed({ invoice: r.invoice }),
  });
}

// ---------------------------------------------------------------- delivery challans

export function useChallan(id: string) {
  return useQuery({ queryKey: qkSD.challan(id), queryFn: () => api.get<Challan>(`${DC}/${id}`), enabled: !!id });
}

/** Open billable challans of a customer (to bill several in one bill). */
export function useChallansToBill(customerId: string | null, enabled = true) {
  return useQuery({
    queryKey: qkSD.challansOf(customerId ?? "-"),
    queryFn: () => api.get<SalesDocListResponse<ChallanSummary>>(DC, { toBill: "true", customerId: customerId ?? undefined, limit: 50, sort: "date" }),
    enabled: enabled && !!customerId,
  });
}

export function useCreateChallan() {
  const changed = useChanged();
  return useMutation({ mutationFn: (body: ChallanInput) => api.post<Challan>(DC, body), onSuccess: () => changed() });
}

export function useUpdateChallan() {
  const changed = useChanged();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: ChallanPatch }) => api.patch<Challan>(`${DC}/${id}`, body), onSuccess: () => changed() });
}

export function useReturnChallan() {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: { lines?: { key: string; qty: number }[]; date?: string; note?: string } }) => api.post<Challan>(`${DC}/${id}/return`, body),
    onSuccess: () => changed(),
  });
}

export function useInvoiceChallans() {
  const changed = useChanged();
  return useMutation({
    mutationFn: (body: { challanIds: string[]; issue?: boolean }) => api.post<{ invoice: Invoice; challans: ChallanSummary[] }>(`${DC}/invoice`, body),
    onSuccess: (r) => changed({ invoice: r.invoice }),
  });
}

// ---------------------------------------------------------------- shared actions

const PATHS = { proforma: PI, sale_order: SO, challan: DC } as const;
type Kind = keyof typeof PATHS;

export function useCancelSalesDoc(kind: Kind) {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => api.post<unknown>(`${PATHS[kind]}/${id}/cancel`, reason ? { reason } : {}),
    onSuccess: () => changed(),
  });
}

export function useShareSalesDoc(kind: Kind) {
  const changed = useChanged();
  return useMutation({ mutationFn: (id: string) => api.post<{ token: string; url: string }>(`${PATHS[kind]}/${id}/share`, {}), onSuccess: () => changed() });
}

export function useSendSalesDoc(kind: Kind) {
  const changed = useChanged();
  return useMutation({
    mutationFn: ({ id, channel, to, locale }: { id: string; channel: SalesDocChannel; to?: string; locale?: string }) =>
      api.post<{ logId: string; url: string }>(`${PATHS[kind]}/${id}/send`, { channel, ...(to ? { to } : {}), ...(locale ? { locale } : {}) }),
    onSuccess: () => changed(),
  });
}

// ---- public page (no sign-in, no tenant header: the share token names the shop)

export function usePublicSalesDoc(token: string) {
  return useQuery({
    queryKey: qkSD.public(token),
    queryFn: () => api<PublicSalesDocResponse>(`${SD}/public/${encodeURIComponent(token)}`, { tenant: null, anonymous: true }),
    enabled: !!token,
  });
}
