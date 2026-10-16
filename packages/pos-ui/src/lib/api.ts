"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, ApiError, apiUrl, currentTenantSlug, getToken, type ApiOptions, type QueryParams } from "@srirealtime/web";
import type {
  BillingItem,
  CatalogCategory,
  Customer,
  Invoice,
  InvoiceSummary,
  LoyaltyQuote,
  MyBranches,
  Paged,
  PaymentMethod,
  PaymentsReport,
  Product,
  ProductSummary,
  SellerProfile,
  VariantLookup,
} from "./types";
import type { LineInput } from "@srirealtime/gst";

/**
 * The counter's API calls. Every call carries `x-branch` (the branch picked in the top bar, when the shop has
 * branches), so bills, stock and reports land in the right branch. Paths are under /v1.
 */

let branchCode: string | null = null;

/** Set by the POS screen when the branch changes. */
export function setPosBranch(code: string | null) {
  branchCode = code;
}
export const posBranch = () => branchCode;

function withBranch(opts: ApiOptions = {}): ApiOptions {
  if (!branchCode) return opts;
  const headers = new Headers(opts.headers);
  headers.set("x-branch", branchCode);
  return { ...opts, headers };
}

export const posApi = {
  get: <T>(path: string, query?: QueryParams) => api<T>(path, withBranch({ query })),
  post: <T>(path: string, body?: unknown) => api<T>(path, withBranch({ method: "POST", body })),
};

/** True for "the network is down / API restarting", as opposed to a real refusal. */
export const isNetworkError = (err: unknown) => err instanceof ApiError && (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504);

// ---------------------------------------------------------------- query keys

export const pk = {
  seller: ["pos", "seller"] as const,
  branches: ["pos", "branches"] as const,
  categories: ["pos", "categories"] as const,
  search: (q: string) => ["pos", "search", q] as const,
  items: (q: string) => ["pos", "items", q] as const,
  category: (id: string) => ["pos", "category", id] as const,
  customers: (q: string) => ["pos", "customers", q] as const,
  quote: (phone: string, amount: number) => ["pos", "quote", phone, amount] as const,
  stock: (ids: string) => ["pos", "stock", ids] as const,
  payments: (date: string, branch: string | null) => ["pos", "payments", date, branch] as const,
  bills: (q: string) => ["pos", "bills", q] as const,
};

// ---------------------------------------------------------------- shop

export function useSellerProfile() {
  return useQuery({
    queryKey: pk.seller,
    queryFn: () => posApi.get<{ values?: Partial<SellerProfile> }>("/settings/billing").then((r) => r.values ?? {}),
    staleTime: 10 * 60_000,
    retry: 2,
  });
}

export function useMyBranches(enabled: boolean) {
  return useQuery({
    queryKey: pk.branches,
    // Without x-branch: a stale stored code must not make the list itself fail.
    queryFn: () => api.get<MyBranches>("/branches/mine"),
    enabled,
    staleTime: 10 * 60_000,
    retry: 2,
  });
}

// ---------------------------------------------------------------- products

export function useCategories(enabled: boolean) {
  return useQuery({
    queryKey: pk.categories,
    queryFn: () => posApi.get<Paged<CatalogCategory>>("/catalog/categories").then((r) => r.items.filter((c) => c.active && c.productCount > 0)),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useVariantSearch(q: string, enabled: boolean) {
  return useQuery({
    queryKey: pk.search(q),
    queryFn: ({ signal }) => api<Paged<VariantLookup>>("/catalog/variants/search", withBranch({ query: { q, limit: 24 }, signal })),
    enabled: enabled && q.trim().length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useBillingItems(q: string, enabled: boolean) {
  return useQuery({
    queryKey: pk.items(q),
    queryFn: ({ signal }) => api<Paged<BillingItem>>("/invoices/items", withBranch({ query: { q, limit: 24 }, signal })),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useCategoryProducts(categoryId: string | null) {
  return useQuery({
    queryKey: pk.category(categoryId ?? ""),
    queryFn: () => posApi.get<Paged<ProductSummary>>("/catalog/products", { categoryId, status: "active", limit: 60 }),
    enabled: !!categoryId,
    staleTime: 60_000,
  });
}

export const fetchProduct = (id: string) => posApi.get<Product>(`/catalog/products/${id}`);

/** Barcode or SKU → variant. 404 when nothing matches. */
export const lookupCode = (code: string) => posApi.get<VariantLookup>("/catalog/variants/lookup", { code });

export function useStock(itemIds: string[], enabled: boolean) {
  const ids = [...new Set(itemIds)].sort().join(",");
  return useQuery({
    queryKey: pk.stock(ids),
    queryFn: () =>
      posApi
        .get<Paged<{ itemId: string; available: number; tracked: boolean }>>("/inventory/availability", { itemIds: ids })
        .then((r) => new Map(r.items.map((i) => [i.itemId, i]))),
    enabled: enabled && ids.length > 0,
    staleTime: 20_000,
    retry: 0,
  });
}

// ---------------------------------------------------------------- customers & loyalty

export function useCustomerSearch(q: string) {
  return useQuery({
    queryKey: pk.customers(q),
    queryFn: ({ signal }) => api<Paged<Customer>>("/invoices/customers", withBranch({ query: { q, limit: 6 }, signal })),
    enabled: q.trim().length >= 3,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

export const createCustomer = (input: { name: string; phone?: string | null }) => posApi.post<Customer>("/invoices/customers", input);

export function useLoyaltyQuote(phone: string | null, amount: number, enabled: boolean) {
  return useQuery({
    queryKey: pk.quote(phone ?? "", amount),
    queryFn: () => posApi.post<LoyaltyQuote>("/loyalty/quote", { phone, amount }),
    enabled: enabled && !!phone,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: 0,
  });
}

// ---------------------------------------------------------------- bills

export interface CreateBillInput {
  customerId?: string;
  customer?: { name: string; phone?: string };
  date: string;
  placeOfSupply?: string;
  lines: LineInput[];
  notes?: string;
  issue: true;
  loyaltyPoints?: number;
  /** The till session the bill is made at. */
  tillSessionId?: string;
}

export const createBill = (input: CreateBillInput) => posApi.post<Invoice>("/invoices", input);

export const addPayment = (id: string, p: { amount: number; method: PaymentMethod; date: string; reference?: string; tillSessionId?: string }) =>
  posApi.post<Invoice>(`/invoices/${id}/payments`, p);

export const sendBill = (id: string, to?: string) => posApi.post<{ logId: string; url: string }>(`/invoices/${id}/send`, { channel: "whatsapp", ...(to ? { to } : {}) });

export const getBill = (id: string) => posApi.get<Invoice>(`/invoices/${id}`);

export const findBills = (q: string) => posApi.get<Paged<InvoiceSummary>>("/invoices", { q, limit: 8 });

export const cancelBill = (id: string, reason: string) => posApi.post<Invoice>(`/invoices/${id}/cancel`, { reason });

export function usePaymentsReport(date: string, branchId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: pk.payments(date, branchId),
    queryFn: () => posApi.get<PaymentsReport>("/invoices/reports/payments", { from: date, to: date, branchId }),
    enabled,
    staleTime: 0,
  });
}

// ---------------------------------------------------------------- PDFs

/** Documents thermal receipt (80 mm) of a bill. */
export const thermalPath = (id: string) => `/documents/invoice-thermal/${id}.pdf`;

/** Fetches a PDF with the session's token, shop and branch headers. */
export async function fetchPdf(path: string, query: QueryParams = {}): Promise<Blob> {
  const headers = new Headers({ accept: "application/pdf" });
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const slug = currentTenantSlug();
  if (slug) headers.set("x-tenant", slug);
  if (branchCode) headers.set("x-branch", branchCode);
  let res: Response;
  try {
    res = await fetch(apiUrl(path, query), { headers, credentials: "include" });
  } catch (err) {
    throw new ApiError(0, "network_error", err instanceof Error ? err.message : "Network error");
  }
  if (!res.ok) {
    const e = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(res.status, e?.error?.code ?? `http_${res.status}`, e?.error?.message ?? "Download failed");
  }
  return new Blob([await res.blob()], { type: "application/pdf" });
}
