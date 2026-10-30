"use client";

import * as React from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, apiUrl, currentTenantSlug, getToken, readStored, useStored, writeStored, type ApiOptions, type QueryParams } from "@rbms/web";
import { MP } from "./queries";
import type {
  CatalogProduct,
  CatalogProductSummary,
  LedgerResponse,
  ListResult,
  Payout,
  PayoutAccountInput,
  ProductReviewList,
  ProductStatus,
  VendorMembership,
  VendorOrder,
  VendorSelf,
  VendorStockItem,
  VendorStockList,
} from "./types";

/** Header naming the seller when a user belongs to several (the API's VENDOR_HEADER). */
export const VENDOR_HEADER = "x-vendor";
/** localStorage: the seller the user last worked as (per shop origin). */
export const VENDOR_KEY = "sr_vendor";

export const getStoredVendor = () => readStored(VENDOR_KEY);
export const setStoredVendor = (id: string | null) => writeStored(VENDOR_KEY, id);
export const useStoredVendor = () => useStored(VENDOR_KEY);

/** The membership to act as: the stored one when still valid, the only one, or null (the user must choose). */
export function pickMembership(memberships: readonly VendorMembership[], stored: string | null): VendorMembership | null {
  if (stored) {
    const hit = memberships.find((m) => m.vendorId === stored || m.slug === stored);
    if (hit) return hit;
  }
  return memberships.length === 1 ? memberships[0]! : null;
}

/** API options carrying the `x-vendor` header. */
export function vendorOpts(vendorId: string, opts: ApiOptions = {}): ApiOptions {
  const headers = new Headers(opts.headers);
  headers.set(VENDOR_HEADER, vendorId);
  return { ...opts, headers };
}

export const vk = {
  mine: ["marketplace", "mine"] as const,
  self: (v: string) => ["marketplace", "self", v] as const,
  orders: (v: string, q: QueryParams) => ["marketplace", "self", v, "orders", q] as const,
  ledger: (v: string, q: QueryParams) => ["marketplace", "self", v, "ledger", q] as const,
  payouts: (v: string, q: QueryParams) => ["marketplace", "self", v, "payouts", q] as const,
  products: (v: string, q: QueryParams) => ["marketplace", "self", v, "products", q] as const,
  product: (v: string, id: string) => ["marketplace", "self", v, "product", id] as const,
  reviews: (v: string, ids: string) => ["marketplace", "self", v, "reviews", ids] as const,
  stock: (v: string, ids: string) => ["marketplace", "self", v, "stock", ids] as const,
};

// ---------------------------------------------------------------- context

export interface VendorContextValue {
  vendorId: string;
  membership: VendorMembership;
  memberships: VendorMembership[];
  /** GET /vendor/me (null while loading). */
  self: VendorSelf | null;
  switchTo: (vendorId: string | null) => void;
}

const VendorContext = React.createContext<VendorContextValue | null>(null);
export const VendorProvider = VendorContext.Provider;

export function useVendor(): VendorContextValue {
  const v = React.useContext(VendorContext);
  if (!v) throw new Error("useVendor must be used inside the seller portal");
  return v;
}
export const useOptionalVendor = () => React.useContext(VendorContext);

// ---------------------------------------------------------------- queries

export function useMemberships(enabled = true) {
  return useQuery({
    queryKey: vk.mine,
    enabled,
    queryFn: ({ signal }) => api.get<ListResult<VendorMembership>>(`${MP}/vendor/mine`, undefined, { signal }).then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useVendorSelf(vendorId: string | null) {
  return useQuery({
    queryKey: vk.self(vendorId ?? ""),
    enabled: !!vendorId,
    queryFn: ({ signal }) => api.get<VendorSelf>(`${MP}/vendor/me`, undefined, vendorOpts(vendorId!, { signal })),
    staleTime: 30_000,
  });
}

export function useApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: Record<string, unknown>) => api.post<VendorSelf>(`${MP}/public/vendors/apply`, b),
    onSuccess: (v) => {
      setStoredVendor(v.id);
      void qc.invalidateQueries({ queryKey: ["marketplace"] });
    },
  });
}

export function useMyOrders(q: QueryParams) {
  const { vendorId } = useVendor();
  return useQuery({
    queryKey: vk.orders(vendorId, q),
    queryFn: ({ signal }) => api.get<ListResult<VendorOrder>>(`${MP}/vendor/orders`, q, vendorOpts(vendorId, { signal })),
    placeholderData: keepPreviousData,
  });
}

export function useMyLedger(q: QueryParams) {
  const { vendorId } = useVendor();
  return useQuery({
    queryKey: vk.ledger(vendorId, q),
    queryFn: ({ signal }) => api.get<LedgerResponse>(`${MP}/vendor/ledger`, q, vendorOpts(vendorId, { signal })),
    placeholderData: keepPreviousData,
  });
}

export function useMyPayouts(q: QueryParams, enabled = true) {
  const { vendorId } = useVendor();
  return useQuery({
    queryKey: vk.payouts(vendorId, q),
    enabled,
    queryFn: ({ signal }) => api.get<ListResult<Payout>>(`${MP}/vendor/payouts`, q, vendorOpts(vendorId, { signal })),
    placeholderData: keepPreviousData,
  });
}

function useSelfMutation<TVars, TOut>(fn: (vendorId: string, vars: TVars) => Promise<TOut>) {
  const qc = useQueryClient();
  const { vendorId } = useVendor();
  return useMutation({
    mutationFn: (vars: TVars) => fn(vendorId, vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["marketplace", "self", vendorId] }),
  });
}

/** Review state of these products (the seller's own; others are left out by the API). */
export function useMyReviews(productIds: string[]) {
  const { vendorId } = useVendor();
  const ids = [...productIds].sort().join(",");
  return useQuery({
    queryKey: vk.reviews(vendorId, ids),
    enabled: ids.length > 0,
    queryFn: ({ signal }) => api.get<ProductReviewList>(`${MP}/vendor/product-reviews`, { productIds: ids, limit: 200 }, vendorOpts(vendorId, { signal })),
    staleTime: 15_000,
  });
}

/** Counts of the seller's reviews per status (dashboard to-dos). */
export function useMyReviewCounts() {
  const { vendorId } = useVendor();
  return useQuery({
    queryKey: vk.reviews(vendorId, "counts"),
    queryFn: ({ signal }) => api.get<ProductReviewList>(`${MP}/vendor/product-reviews`, { limit: 1 }, vendorOpts(vendorId, { signal })).then((r) => r.counts),
    staleTime: 30_000,
  });
}

/** Stock of the seller's variants of these products at their location (shop feature `inventory`). */
export function useMyStock(productIds: string[], enabled = true) {
  const { vendorId } = useVendor();
  const ids = [...productIds].sort().join(",");
  return useQuery({
    queryKey: vk.stock(vendorId, ids),
    enabled: enabled && ids.length > 0,
    queryFn: ({ signal }) => api.get<VendorStockList>(`${MP}/vendor/stock`, { productIds: ids }, vendorOpts(vendorId, { signal })),
    staleTime: 15_000,
  });
}

export const useAdjustStock = () =>
  useSelfMutation((v, { variantId, mode, qty, reason }: { variantId: string; mode: "set" | "add" | "remove"; qty: number; reason: string }) =>
    api.post<{ item: VendorStockItem; before: number; locationId: string }>(`${MP}/vendor/stock/${variantId}/adjust`, { mode, qty, reason }, vendorOpts(v)),
  );

export const useMarkPacked = () => useSelfMutation((v, id: string) => api.post<VendorOrder>(`${MP}/vendor/orders/${id}/packed`, undefined, vendorOpts(v)));
export const useMarkShipped = () =>
  useSelfMutation((v, { id, carrier, trackingNumber }: { id: string; carrier?: string | null; trackingNumber: string }) =>
    api.post<VendorOrder>(`${MP}/vendor/orders/${id}/shipped`, { carrier: carrier || null, trackingNumber }, vendorOpts(v)),
  );

export const useUpdateProfile = () =>
  useSelfMutation((v, patch: Record<string, unknown>) => api.patch<VendorSelf>(`${MP}/vendor/profile`, patch, vendorOpts(v)));

export const useSetMyPayoutAccount = () =>
  useSelfMutation((v, account: PayoutAccountInput) => api.put<unknown>(`${MP}/vendor/payout-account`, account, vendorOpts(v)));

// ---------------------------------------------------------------- products (catalogue routes, vendor scoped)

const CAT = "/catalog";

export function useMyProducts(q: { q?: string; status?: ProductStatus; offset: number; limit: number }) {
  const { vendorId } = useVendor();
  return useQuery({
    queryKey: vk.products(vendorId, q),
    queryFn: ({ signal }) => api.get<ListResult<CatalogProductSummary>>(`${CAT}/products`, q, vendorOpts(vendorId, { signal })),
    placeholderData: keepPreviousData,
  });
}

export function useMyProduct(id: string | null) {
  const { vendorId } = useVendor();
  return useQuery({
    queryKey: vk.product(vendorId, id ?? ""),
    enabled: !!id,
    queryFn: ({ signal }) => api.get<CatalogProduct>(`${CAT}/products/${id}`, undefined, vendorOpts(vendorId, { signal })),
  });
}

export const useCreateProduct = () =>
  useSelfMutation((v, body: Record<string, unknown>) => api.post<CatalogProduct>(`${CAT}/products`, body, vendorOpts(v)));
export const useUpdateProduct = () =>
  useSelfMutation((v, { id, patch }: { id: string; patch: Record<string, unknown> }) => api.patch<CatalogProduct>(`${CAT}/products/${id}`, patch, vendorOpts(v)));
export const useDeleteProduct = () => useSelfMutation((v, id: string) => api.delete(`${CAT}/products/${id}`, undefined, vendorOpts(v)));
export const useAddVariant = () =>
  useSelfMutation((v, { productId, variant }: { productId: string; variant: Record<string, unknown> }) =>
    api.post(`${CAT}/products/${productId}/variants`, variant, vendorOpts(v)),
  );
export const useUpdateVariant = () =>
  useSelfMutation((v, { id, patch }: { id: string; patch: Record<string, unknown> }) => api.patch(`${CAT}/variants/${id}`, patch, vendorOpts(v)));
export const useDeleteVariant = () => useSelfMutation((v, id: string) => api.delete(`${CAT}/variants/${id}`, undefined, vendorOpts(v)));

/** CSV download with the seller header (the kit's apiDownload can't send extra headers). */
export async function vendorDownload(vendorId: string, path: string, query: QueryParams, fallbackName: string): Promise<void> {
  const headers = new Headers({ accept: "text/csv, */*", [VENDOR_HEADER]: vendorId });
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const slug = currentTenantSlug();
  if (slug) headers.set("x-tenant", slug);
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
  const blob = await res.blob();
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = m?.[1] ? decodeURIComponent(m[1]) : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
