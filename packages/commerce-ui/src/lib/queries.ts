"use client";

import * as React from "react";
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { absoluteUrl, api, apiDownload, ApiError } from "@srirealtime/web";
import type {
  Category,
  CategoryInput,
  Collection,
  CollectionInput,
  Paged,
  Product,
  ProductCreateInput,
  ProductFields,
  ProductListFilters,
  ProductStatus,
  ProductSummary,
  PublicCollectionPage,
  StockAdjustInput,
  StockListResponse,
  StockRow,
  StockSummary,
  UploadedFile,
  UploadSignResponse,
  Variant,
  VariantInput,
  VariantLookup,
} from "./types";

const CAT = "/catalog";
const INV = "/inventory";
export const PAGE_SIZE = 50;

export const ck = {
  all: ["catalog"] as const,
  products: (f: ProductListFilters) => ["catalog", "products", f] as const,
  product: (id: string) => ["catalog", "product", id] as const,
  counts: ["catalog", "counts"] as const,
  categories: ["catalog", "categories"] as const,
  collections: (q: string) => ["catalog", "collections", q] as const,
  collection: (id: string) => ["catalog", "collection", id] as const,
  variantMap: ["catalog", "variant-map"] as const,
  pick: (q: string) => ["catalog", "pick", q] as const,
  byIds: (ids: string[]) => ["catalog", "by-ids", ids] as const,
  stock: ["stock", "list", "", "all"] as const,
  stockSummary: ["stock", "summary"] as const,
};

// ---------------------------------------------------------------- products

export function useProductList(filters: ProductListFilters) {
  return useInfiniteQuery({
    queryKey: ck.products(filters),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      api.get<Paged<ProductSummary>>(`${CAT}/products`, { ...filters, limit: PAGE_SIZE, offset: pageParam }, { signal }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return last.items.length === PAGE_SIZE && loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
  });
}

/** Totals for the list's status chips and the dashboard widget (three cheap `limit=1` calls). */
export function useProductCounts(enabled = true) {
  return useQuery({
    queryKey: ck.counts,
    enabled,
    queryFn: async () => {
      const count = (status?: ProductStatus) =>
        api.get<Paged<ProductSummary>>(`${CAT}/products`, { status, limit: 1 }).then((r) => r.total);
      const [all, active, draft, archived] = await Promise.all([count(), count("active"), count("draft"), count("archived")]);
      return { all, active, draft, archived };
    },
    staleTime: 30_000,
  });
}

export function useProduct(id: string | null) {
  return useQuery({
    queryKey: ck.product(id ?? ""),
    queryFn: () => api.get<Product>(`${CAT}/products/${id}`),
    enabled: !!id,
  });
}

function useCatalogChanged() {
  const qc = useQueryClient();
  return React.useCallback(
    (product?: Product) => {
      if (product) qc.setQueryData(ck.product(product.id), product);
      void qc.invalidateQueries({ queryKey: ["catalog", "products"] });
      void qc.invalidateQueries({ queryKey: ck.counts });
      void qc.invalidateQueries({ queryKey: ck.categories });
      void qc.invalidateQueries({ queryKey: ck.variantMap });
      void qc.invalidateQueries({ queryKey: ["items"] });
    },
    [qc],
  );
}

export function useCreateProduct() {
  const changed = useCatalogChanged();
  return useMutation({
    mutationFn: (body: ProductCreateInput) => api.post<Product>(`${CAT}/products`, body),
    onSuccess: (p) => changed(p),
  });
}

export function useUpdateProduct() {
  const changed = useCatalogChanged();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ProductFields> }) => api.patch<Product>(`${CAT}/products/${id}`, body),
    onSuccess: (p) => changed(p),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  const changed = useCatalogChanged();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`${CAT}/products/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: ck.product(id) });
      changed();
    },
  });
}

/**
 * Bulk status change with an optimistic list update: the rows flip at once and roll back if any request fails.
 * Resolves with the number of products that failed.
 */
export function useBulkStatus() {
  const qc = useQueryClient();
  const changed = useCatalogChanged();
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: ProductStatus }) => {
      const results = await Promise.allSettled(ids.map((id) => api.patch<Product>(`${CAT}/products/${id}`, { status })));
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length === ids.length) throw (failed[0] as PromiseRejectedResult).reason;
      return { failed: failed.length };
    },
    onMutate: async ({ ids, status }) => {
      await qc.cancelQueries({ queryKey: ["catalog", "products"] });
      const snapshot = qc.getQueriesData({ queryKey: ["catalog", "products"] });
      const set = new Set(ids);
      qc.setQueriesData<{ pages: Paged<ProductSummary>[]; pageParams: unknown[] }>({ queryKey: ["catalog", "products"] }, (old) =>
        old
          ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((it) => (set.has(it.id) ? { ...it, status } : it)) })) }
          : old,
      );
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => changed(),
  });
}

/** Downloads `GET /products?format=csv` (one row per variant) for the current filters. */
export const exportProductsCsv = (filters: ProductListFilters) =>
  apiDownload(`${CAT}/products`, { ...filters, format: "csv" }, "products.csv");

// ---------------------------------------------------------------- variants

export function useGenerateVariants() {
  const changed = useCatalogChanged();
  return useMutation({
    mutationFn: ({ id, options, price }: { id: string; options: { name: string; values: string[] }[]; price?: number }) =>
      api.post<Product>(`${CAT}/products/${id}/variants/generate`, { options, ...(price !== undefined ? { price } : {}) }),
    onSuccess: (p) => changed(p),
  });
}

export function useAddVariant() {
  const changed = useCatalogChanged();
  return useMutation({
    mutationFn: ({ productId, body }: { productId: string; body: VariantInput }) => api.post<Variant>(`${CAT}/products/${productId}/variants`, body),
    onSuccess: () => changed(),
  });
}

export function useUpdateVariant() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<VariantInput> }) => api.patch<Variant>(`${CAT}/variants/${id}`, body),
  });
}

export function useDeleteVariant() {
  const changed = useCatalogChanged();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`${CAT}/variants/${id}`),
    onSuccess: () => changed(),
  });
}

/** variant id → product id for every live variant (stock summaries in the list). Up to 500 variants. */
export function useVariantProductMap(enabled: boolean) {
  return useQuery({
    queryKey: ck.variantMap,
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const map = new Map<string, string>();
      for (let offset = 0; offset < 500; offset += 100) {
        const page = await api.get<Paged<VariantLookup>>(`${CAT}/variants/search`, { limit: 100, offset });
        for (const v of page.items) map.set(v.id, v.productId);
        if (page.items.length < 100 || offset + 100 >= page.total) break;
      }
      return map;
    },
  });
}

/** Product picker search (collections): staff product list. */
export function useProductSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: ck.pick(q),
    enabled,
    queryFn: ({ signal }) => api.get<Paged<ProductSummary>>(`${CAT}/products`, { q: q || undefined, limit: 20 }, { signal }),
    placeholderData: keepPreviousData,
  });
}

// ---------------------------------------------------------------- categories

export function useCategories(enabled = true) {
  return useQuery({
    queryKey: ck.categories,
    enabled,
    queryFn: () => api.get<Paged<Category>>(`${CAT}/categories`).then((r) => r.items),
    staleTime: 30_000,
  });
}

export function useSaveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<CategoryInput> }) =>
      id ? api.patch<Category>(`${CAT}/categories/${id}`, body) : api.post<Category>(`${CAT}/categories`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ck.categories });
      void qc.invalidateQueries({ queryKey: ["catalog", "products"] });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`${CAT}/categories/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ck.categories }),
  });
}

/** PUT /categories/order with the full order; the list updates optimistically. */
export function useReorderCategories() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ordered: Category[]) => api.put<Paged<Category>>(`${CAT}/categories/order`, { ids: ordered.map((c) => c.id) }),
    onMutate: async (ordered) => {
      await qc.cancelQueries({ queryKey: ck.categories });
      const prev = qc.getQueryData<Category[]>(ck.categories);
      qc.setQueryData(ck.categories, ordered.map((c, i) => ({ ...c, sort: i })));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ck.categories, ctx.prev);
    },
    onSuccess: (r) => qc.setQueryData(ck.categories, r.items),
  });
}

// ---------------------------------------------------------------- collections

export function useCollections(q: string) {
  return useQuery({
    queryKey: ck.collections(q),
    queryFn: ({ signal }) => api.get<Paged<Collection>>(`${CAT}/collections`, { q: q || undefined, limit: 200 }, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useCollection(id: string | null) {
  return useQuery({ queryKey: ck.collection(id ?? ""), enabled: !!id, queryFn: () => api.get<Collection>(`${CAT}/collections/${id}`) });
}

export function useSaveCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<CollectionInput> }) =>
      id ? api.patch<Collection>(`${CAT}/collections/${id}`, body) : api.post<Collection>(`${CAT}/collections`, body),
    onSuccess: (c) => {
      qc.setQueryData(ck.collection(c.id), c);
      void qc.invalidateQueries({ queryKey: ["catalog", "collections"] });
      void qc.invalidateQueries({ queryKey: ["catalog", "public-collection"] });
    },
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`${CAT}/collections/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["catalog", "collections"] }),
  });
}

/** What the store shows for a saved, active collection (exact rule evaluation by the server). */
export function usePublicCollection(slug: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["catalog", "public-collection", slug],
    enabled: enabled && !!slug,
    retry: 0,
    queryFn: () => api.get<PublicCollectionPage>(`${CAT}/public/collections/${slug}`, { limit: 24 }, { anonymous: true }),
  });
}

/** Summaries for a list of product ids (manual collections), in that order. Up to 200 per call via the list API. */
export function useProductsByIds(ids: string[]) {
  return useQuery({
    queryKey: ck.byIds(ids),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      // The staff list has no `ids` filter: page through the catalogue once and pick the ones we need.
      const want = new Set(ids);
      const found = new Map<string, ProductSummary>();
      for (let offset = 0; offset < 2000 && found.size < want.size; offset += 200) {
        const page = await api.get<Paged<ProductSummary>>(`${CAT}/products`, { limit: 200, offset });
        for (const p of page.items) if (want.has(p.id)) found.set(p.id, p);
        if (page.items.length < 200) break;
      }
      return found;
    },
  });
}

// ---------------------------------------------------------------- inventory

export function useStockRows(enabled: boolean) {
  return useQuery({
    queryKey: ck.stock,
    enabled,
    retry: 0,
    queryFn: ({ signal }) => api.get<StockListResponse>(`${INV}/stock`, { filter: "all" }, { signal }),
  });
}

export function useStockSummary(enabled: boolean) {
  return useQuery({ queryKey: ck.stockSummary, enabled, retry: 0, queryFn: () => api.get<StockSummary>(`${INV}/summary`) });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: StockAdjustInput }) => api.post<StockRow>(`${INV}/stock/${itemId}/adjust`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stock"] });
      void qc.invalidateQueries({ queryKey: ["items"] });
    },
  });
}

// ---------------------------------------------------------------- uploads

/**
 * Uploads flow: POST /uploads/sign → PUT the bytes to the signed URL (XHR, for progress) → POST /uploads/:id/complete.
 * Resolves with the stored file; `url` is made absolute (catalogue image URLs must be full URLs).
 */
export async function uploadImage(
  file: File,
  opts: { purpose?: string; onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
): Promise<UploadedFile> {
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
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    opts.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
  opts.onProgress?.(100);
  const done = await api.post<UploadedFile>(`/uploads/${sign.fileId}/complete`);
  return { ...done, url: absoluteUrl(done.url), thumbUrl: absoluteUrl(done.thumbUrl) };
}
