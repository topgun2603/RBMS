"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { absoluteUrl, api, apiDownload, ApiError, type QueryParams } from "@srirealtime/web";
import { istEndOfDay, istDateOf, resolveSettings } from "./logic";
import type {
  KycCheckResponse,
  KycCheckType,
  KycSubject,
  LedgerEntry,
  LedgerResponse,
  ListResult,
  MarketplaceSettings,
  Payout,
  PayoutAccountInput,
  PayoutRunResult,
  PayoutStatus,
  PublicVendor,
  UploadedFile,
  UploadSignResponse,
  VendorDetail,
  VendorListResponse,
  VendorOrder,
  VendorStatus,
} from "./types";

export const MP = "/marketplace";

export const mk = {
  all: ["marketplace"] as const,
  vendors: (q: { status?: VendorStatus; q?: string; offset: number; limit: number }) => ["marketplace", "vendors", q] as const,
  vendor: (id: string) => ["marketplace", "vendor", id] as const,
  vendorOrders: (q: QueryParams) => ["marketplace", "vendor-orders", q] as const,
  ledger: (q: QueryParams) => ["marketplace", "ledger", q] as const,
  payouts: (q: QueryParams) => ["marketplace", "payouts", q] as const,
  preview: (until: string) => ["marketplace", "payout-preview", until] as const,
  settings: ["settings", "marketplace"] as const,
  kyc: (vendorId: string) => ["kyc", "vendor", vendorId] as const,
  publicVendor: (slug: string) => ["marketplace", "public-vendor", slug] as const,
};

// ---------------------------------------------------------------- settings (namespace `marketplace`)

export function useMarketplaceSettings(enabled = true) {
  return useQuery({
    queryKey: mk.settings,
    enabled,
    queryFn: () =>
      api.get<{ values: Partial<Record<keyof MarketplaceSettings, unknown>> | null }>("/settings/marketplace").then((r) => resolveSettings(r.values)),
    staleTime: 60_000,
  });
}

export function useSaveMarketplaceSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: MarketplaceSettings) =>
      api.put<{ values: Partial<MarketplaceSettings> }>("/settings/marketplace/tenant", values).then((r) => resolveSettings(r.values)),
    onSuccess: (v) => {
      qc.setQueryData(mk.settings, v);
      void qc.invalidateQueries({ queryKey: mk.all });
    },
  });
}

// ---------------------------------------------------------------- vendors (staff)

export const VENDOR_PAGE = 25;

export function useVendorList(q: { status?: VendorStatus; q?: string; offset: number; limit?: number }) {
  const key = { ...q, limit: q.limit ?? VENDOR_PAGE };
  return useQuery({
    queryKey: mk.vendors(key),
    queryFn: ({ signal }) => api.get<VendorListResponse>(`${MP}/vendors`, key, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useVendorDetail(id: string | null) {
  return useQuery({
    queryKey: mk.vendor(id ?? ""),
    enabled: !!id,
    queryFn: ({ signal }) => api.get<VendorDetail>(`${MP}/vendors/${id}`, undefined, { signal }),
    staleTime: 30_000,
  });
}

function useVendorMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: mk.all }),
  });
}

export interface VendorCreateInput {
  name: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  status?: "pending" | "active";
}

export const useCreateVendor = () => useVendorMutation((b: VendorCreateInput) => api.post<VendorDetail>(`${MP}/vendors`, b));
export const useUpdateVendor = () =>
  useVendorMutation(({ id, patch }: { id: string; patch: Record<string, unknown> }) => api.patch<VendorDetail>(`${MP}/vendors/${id}`, patch));
export const useSetVendorStatus = () =>
  useVendorMutation(({ id, to }: { id: string; to: "active" | "suspended" }) =>
    api.post<VendorDetail>(`${MP}/vendors/${id}/${to === "active" ? "approve" : "suspend"}`),
  );
export const useSetCommission = () =>
  useVendorMutation(({ id, commissionBps }: { id: string; commissionBps: number | null }) =>
    api.put<VendorDetail>(`${MP}/vendors/${id}/commission`, { commissionBps }),
  );
export const useStaffPayoutAccount = () =>
  useVendorMutation(({ id, account }: { id: string; account: PayoutAccountInput }) => api.put(`${MP}/vendors/${id}/payout-account`, account));
export const useAdjustLedger = () =>
  useVendorMutation(({ id, amount, note }: { id: string; amount: number; note: string }) =>
    api.post<LedgerEntry>(`${MP}/vendors/${id}/adjustments`, { amount, note }),
  );
export const useDeleteVendor = () => useVendorMutation((id: string) => api.delete(`${MP}/vendors/${id}`));

// ---------------------------------------------------------------- orders, ledger, payouts (staff)

export function useStaffVendorOrders(q: QueryParams, enabled = true) {
  return useQuery({
    queryKey: mk.vendorOrders(q),
    enabled,
    queryFn: ({ signal }) => api.get<ListResult<VendorOrder>>(`${MP}/vendor-orders`, q, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useStaffLedger(q: QueryParams, enabled = true) {
  return useQuery({
    queryKey: mk.ledger(q),
    enabled,
    queryFn: ({ signal }) => api.get<LedgerResponse>(`${MP}/ledger`, q, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useStaffPayouts(q: { vendorId?: string; status?: PayoutStatus; offset?: number; limit?: number }, enabled = true) {
  const key = { limit: 25, offset: 0, ...q } as QueryParams;
  return useQuery({
    queryKey: mk.payouts(key),
    enabled,
    queryFn: ({ signal }) => api.get<ListResult<Payout>>(`${MP}/payouts`, key, { signal }),
    placeholderData: keepPreviousData,
  });
}

export const exportCsv = (what: "vendor-orders" | "ledger" | "payouts", q: QueryParams) =>
  apiDownload(`${MP}/${what}`, { ...q, format: "csv" }, `seller-${what}.csv`);

export function usePayoutAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reference }: { id: string; action: "retry" | "mark-paid" | "cancel" | "refresh"; reference?: string }) =>
      api.post<unknown>(`${MP}/payouts/${id}/${action}`, action === "mark-paid" ? { reference } : undefined),
    onSuccess: () => void qc.invalidateQueries({ queryKey: mk.all }),
  });
}

export function useRunPayouts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { until?: string; vendorId?: string }) => api.post<PayoutRunResult>(`${MP}/payouts/run`, b),
    onSuccess: () => void qc.invalidateQueries({ queryKey: mk.all }),
  });
}

/** Most sellers the dry-run preview looks at (each needs its own balance call). */
export const PREVIEW_VENDOR_CAP = 100;

/**
 * Data for the payout dry run: every seller with their current balance (one detail call each, capped) and the
 * delivered sales still in the return window that a run up to `until` would release.
 */
export function usePayoutPreviewData(until: string, enabled = true) {
  return useQuery({
    queryKey: mk.preview(until),
    enabled,
    queryFn: async ({ signal }) => {
      const list = await api.get<VendorListResponse>(`${MP}/vendors`, { limit: PREVIEW_VENDOR_CAP, offset: 0 }, { signal });
      const [details, orders] = await Promise.all([
        Promise.all(list.items.map((v) => api.get<VendorDetail>(`${MP}/vendors/${v.id}`, undefined, { signal }))),
        api.get<ListResult<VendorOrder>>(`${MP}/vendor-orders`, { status: "delivered", settlementStatus: "pending", limit: 500 }, { signal }),
      ]);
      return { vendors: details, orders: orders.items, capped: list.total > list.items.length, until: istEndOfDay(until) };
    },
    staleTime: 15_000,
  });
}

export const todayIST = () => istDateOf(new Date());

// ---------------------------------------------------------------- public seller page (products of active sellers)

export function usePublicVendor(slug: string | null, enabled = true) {
  return useQuery({
    queryKey: mk.publicVendor(slug ?? ""),
    enabled: enabled && !!slug,
    retry: false,
    queryFn: ({ signal }) => api.get<PublicVendor>(`${MP}/public/vendors/${slug}`, { limit: 24 }, { signal }),
  });
}

// ---------------------------------------------------------------- kyc (feature `kyc`)

export function useKycSubject(vendorId: string | null, enabled = true, headers?: Record<string, string>) {
  return useQuery({
    queryKey: mk.kyc(vendorId ?? ""),
    enabled: enabled && !!vendorId,
    queryFn: ({ signal }) => api.get<KycSubject>(`/kyc/subjects/vendor/${vendorId}`, undefined, { signal, headers }),
    staleTime: 15_000,
  });
}

export function useSubmitKycCheck(vendorId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, input }: { type: KycCheckType; input: Record<string, string> }) =>
      api.post<KycCheckResponse>("/kyc/checks", { subjectType: "vendor", subjectId: vendorId, type, input }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: mk.kyc(vendorId) });
      void qc.invalidateQueries({ queryKey: ["marketplace", "self"] });
    },
  });
}

// ---------------------------------------------------------------- uploads

/** POST /uploads/sign → PUT the bytes (XHR for progress) → POST /uploads/:id/complete. Returns absolute URLs. */
export async function uploadImage(file: File, opts: { purpose?: string; onProgress?: (pct: number) => void } = {}): Promise<UploadedFile> {
  const sign = await api.post<UploadSignResponse>("/uploads/sign", {
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    visibility: "public",
    purpose: opts.purpose ?? "product",
  });
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(sign.upload.method || "PUT", absoluteUrl(sign.upload.url));
    for (const [k, v] of Object.entries(sign.upload.headers ?? {})) {
      if (k.toLowerCase() === "content-length" || k.toLowerCase() === "host") continue;
      xhr.setRequestHeader(k, v);
    }
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, "upload_failed", xhr.statusText || "Upload failed")));
    xhr.onerror = () => reject(new ApiError(0, "network_error", "Upload failed"));
    xhr.send(file);
  });
  opts.onProgress?.(100);
  const done = await api.post<UploadedFile>(`/uploads/${sign.fileId}/complete`);
  return { ...done, url: absoluteUrl(done.url), thumbUrl: absoluteUrl(done.thumbUrl) };
}
