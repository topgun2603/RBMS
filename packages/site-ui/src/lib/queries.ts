"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { absoluteUrl, api, ApiError } from "@rbms/web";
import { patchReviewList } from "./review-cache";
import type { HomeDocInput, MenuItemInput, MenuKey, PageInput, PagePatch, PostInput, PostPatch } from "./content";
import type {
  CatalogCategory,
  CatalogCollection,
  CmsPage,
  CmsPageSummary,
  CmsPost,
  CmsPostSummary,
  ContentStatus,
  DomainInstructions,
  Overview,
  Paged,
  ProductSummary,
  PublicCollectionPage,
  ResolvedHomeSection,
  Review,
  ReviewImportResult,
  ReviewSettings,
  StaffReviewInput,
  SettingsValues,
  StaffHome,
  StaffMenu,
  StoreSettings,
  TenantDomain,
  UploadedFile,
  UploadSignResponse,
} from "./types";

export const sk = {
  all: ["site"] as const,
  home: ["site", "home"] as const,
  preview: ["site", "home", "preview"] as const,
  pages: (f: object) => ["site", "pages", f] as const,
  /** The Pages table (useServerTable appends its params); under ["site", "pages"], which the page mutations invalidate. */
  pageList: ["site", "pages", "list"] as const,
  page: (id: string) => ["site", "page", id] as const,
  posts: (f: object) => ["site", "posts", f] as const,
  /** The Blog table; under ["site", "posts"]. */
  postList: ["site", "posts", "list"] as const,
  post: (id: string) => ["site", "post", id] as const,
  menu: (key: MenuKey) => ["site", "menu", key] as const,
  reviews: ["site", "reviews"] as const,
  /** The moderation table; under ["site", "reviews"], which the review actions invalidate. */
  reviewList: ["site", "reviews", "list"] as const,
  reviewSettings: ["site", "settings", "reviews"] as const,
  overview: (from: string, to: string) => ["site", "analytics", from, to] as const,
  store: ["site", "settings", "store"] as const,
  domains: ["site", "domains"] as const,
  instructions: (id: string) => ["site", "domains", id, "instructions"] as const,
  categories: ["site", "catalog", "categories"] as const,
  collections: ["site", "catalog", "collections"] as const,
  productSearch: (q: string) => ["site", "catalog", "pick", q] as const,
  productsByIds: (ids: string[]) => ["site", "catalog", "by-ids", ids] as const,
  publicCollection: (slug: string, limit: number) => ["site", "catalog", "public-collection", slug, limit] as const,
};

/** Retry transient failures only: 4xx (403 no access, 404) won't get better. */
const retry = (count: number, err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;

// ---------------------------------------------------------------- home

export function useHome(enabled = true) {
  return useQuery({ queryKey: sk.home, enabled, retry, queryFn: () => api.get<StaffHome>("/cms/home") });
}

export function useHomePreview(enabled: boolean) {
  return useQuery({
    queryKey: sk.preview,
    enabled,
    retry,
    queryFn: () => api.get<{ sections: ResolvedHomeSection[] }>("/cms/home/preview"),
  });
}

export function useSaveHome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (doc: HomeDocInput) => api.put<StaffHome>("/cms/home", doc),
    onSuccess: (h) => {
      qc.setQueryData(sk.home, h);
      void qc.invalidateQueries({ queryKey: sk.preview });
    },
  });
}

export function usePublishHome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<StaffHome>("/cms/home/publish"),
    onSuccess: (h) => {
      qc.setQueryData(sk.home, h);
      void qc.invalidateQueries({ queryKey: ["onboarding"] });
    },
  });
}

// ---------------------------------------------------------------- pages & posts

export interface ContentFilters {
  q?: string;
  status?: ContentStatus;
  tag?: string;
}

export function usePages(f: ContentFilters, enabled = true) {
  return useQuery({
    queryKey: sk.pages(f),
    enabled,
    retry,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<Paged<CmsPageSummary>>("/cms/pages", { q: f.q || undefined, status: f.status, limit: 100 }, { signal }),
  });
}

export function usePage(id: string | null) {
  return useQuery({ queryKey: sk.page(id ?? ""), enabled: !!id, retry, queryFn: () => api.get<CmsPage>(`/cms/pages/${id}`) });
}

export function useSavePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: PageInput | PagePatch }) =>
      id ? api.patch<CmsPage>(`/cms/pages/${id}`, body) : api.post<CmsPage>("/cms/pages", body),
    onSuccess: (p) => {
      qc.setQueryData(sk.page(p.id), p);
      void qc.invalidateQueries({ queryKey: ["site", "pages"] });
    },
  });
}

export function usePagePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) => api.post<CmsPage>(`/cms/pages/${id}/${publish ? "publish" : "unpublish"}`),
    onSuccess: (p) => {
      qc.setQueryData(sk.page(p.id), p);
      void qc.invalidateQueries({ queryKey: ["site", "pages"] });
    },
  });
}

export function useDeletePage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/cms/pages/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: sk.page(id) });
      void qc.invalidateQueries({ queryKey: ["site", "pages"] });
    },
  });
}

export function usePosts(f: ContentFilters, enabled = true) {
  return useQuery({
    queryKey: sk.posts(f),
    enabled,
    retry,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api.get<Paged<CmsPostSummary>>("/cms/posts", { q: f.q || undefined, status: f.status, tag: f.tag || undefined, limit: 100 }, { signal }),
  });
}

export function usePost(id: string | null) {
  return useQuery({ queryKey: sk.post(id ?? ""), enabled: !!id, retry, queryFn: () => api.get<CmsPost>(`/cms/posts/${id}`) });
}

export function useSavePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: PostInput | PostPatch }) =>
      id ? api.patch<CmsPost>(`/cms/posts/${id}`, body) : api.post<CmsPost>("/cms/posts", body),
    onSuccess: (p) => {
      qc.setQueryData(sk.post(p.id), p);
      void qc.invalidateQueries({ queryKey: ["site", "posts"] });
    },
  });
}

export function usePostPublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) => api.post<CmsPost>(`/cms/posts/${id}/${publish ? "publish" : "unpublish"}`),
    onSuccess: (p) => {
      qc.setQueryData(sk.post(p.id), p);
      void qc.invalidateQueries({ queryKey: ["site", "posts"] });
    },
  });
}

export function useDeletePost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/cms/posts/${id}`),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: sk.post(id) });
      void qc.invalidateQueries({ queryKey: ["site", "posts"] });
    },
  });
}

// ---------------------------------------------------------------- menus

export function useMenu(key: MenuKey) {
  return useQuery({ queryKey: sk.menu(key), retry, queryFn: () => api.get<StaffMenu>(`/cms/menus/${key}`) });
}

export function useSaveMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, items }: { key: MenuKey; items: MenuItemInput[] }) => api.put<StaffMenu>(`/cms/menus/${key}`, { items }),
    onSuccess: (m) => qc.setQueryData(sk.menu(m.key), m),
  });
}

// ---------------------------------------------------------------- catalogue (pickers + preview)

export function useCategories(enabled = true) {
  return useQuery({
    queryKey: sk.categories,
    enabled,
    retry,
    staleTime: 60_000,
    queryFn: () => api.get<Paged<CatalogCategory>>("/catalog/categories").then((r) => r.items),
  });
}

export function useCollections(enabled = true) {
  return useQuery({
    queryKey: sk.collections,
    enabled,
    retry,
    staleTime: 60_000,
    queryFn: () => api.get<Paged<CatalogCollection>>("/catalog/collections", { limit: 200 }).then((r) => r.items),
  });
}

export function useProductSearch(q: string, enabled = true) {
  return useQuery({
    queryKey: sk.productSearch(q),
    enabled,
    retry,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<Paged<ProductSummary>>("/catalog/products", { q: q || undefined, limit: 20 }, { signal }),
  });
}

/** Summaries for product ids (the staff list has no ids filter: page through once). */
export function useProductsByIds(ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  return useQuery({
    queryKey: sk.productsByIds(sorted),
    enabled: sorted.length > 0,
    retry,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const want = new Set(sorted);
      const found = new Map<string, ProductSummary>();
      for (let offset = 0; offset < 2000 && found.size < want.size; offset += 200) {
        const page = await api.get<Paged<ProductSummary>>("/catalog/products", { limit: 200, offset });
        for (const p of page.items) if (want.has(p.id)) found.set(p.id, p);
        if (page.items.length < 200) break;
      }
      return found;
    },
  });
}

/** What the store shows for a collection (exact rule evaluation by the server); 404 → null. */
export function usePublicCollection(slug: string, limit: number) {
  return useQuery({
    queryKey: sk.publicCollection(slug, limit),
    enabled: !!slug,
    retry: 0,
    staleTime: 60_000,
    queryFn: () =>
      api
        .get<PublicCollectionPage>(`/catalog/public/collections/${encodeURIComponent(slug)}`, { limit }, { anonymous: true })
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.status === 404) return null;
          throw err;
        }),
  });
}

// ---------------------------------------------------------------- reviews

/** A few pending reviews for the dashboard. */
export function usePendingReviews(limit: number, enabled = true) {
  return useQuery({
    queryKey: ["site", "reviews", "pending-widget", limit],
    enabled,
    retry,
    queryFn: () => api.get<Paged<Review>>("/reviews", { status: "pending", limit }),
  });
}

export type ReviewAction = { kind: "approve" | "reject" | "delete"; id: string } | { kind: "reply"; id: string; reply: string };

export function useReviewAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: ReviewAction): Promise<unknown> => {
      if (a.kind === "delete") return api.delete<{ ok: true }>(`/reviews/${a.id}`);
      if (a.kind === "reply") return api.post<Review>(`/reviews/${a.id}/reply`, { reply: a.reply.trim() || null });
      return api.post<Review>(`/reviews/${a.id}/${a.kind}`);
    },
    // Approve / reject / delete show at once in every cached reviews list (table pages, the dashboard widget, older
    // infinite caches); a failure puts the lists back. The refetch afterwards moves rows out of filtered views.
    onMutate: async (a) => {
      if (a.kind === "reply") return undefined;
      await qc.cancelQueries({ queryKey: sk.reviews });
      const before = qc.getQueriesData({ queryKey: sk.reviews });
      const patch = a.kind === "delete" ? null : { status: a.kind === "approve" ? ("approved" as const) : ("rejected" as const) };
      qc.setQueriesData({ queryKey: sk.reviews }, (data: unknown) => patchReviewList(data, a.id, patch));
      return { before };
    },
    onError: (_err, _a, ctx) => {
      for (const [key, data] of ctx?.before ?? []) qc.setQueryData(key, data);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: sk.reviews }),
  });
}

export function useReviewSettings(enabled = true) {
  return useQuery({
    queryKey: sk.reviewSettings,
    enabled,
    retry,
    queryFn: () => api.get<SettingsValues<Partial<ReviewSettings>>>("/settings/reviews").then((r) => r.values ?? {}),
  });
}

export function useSaveReviewSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ReviewSettings) => api.put<SettingsValues<ReviewSettings>>("/settings/reviews/tenant", v).then((r) => r.values),
    onSuccess: (v) => qc.setQueryData(sk.reviewSettings, v),
  });
}

/** Staff adds a review a customer gave elsewhere (at the counter, on Google, in reply to a request). */
export function useCreateReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: StaffReviewInput) => api.post<Review>("/reviews", v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sk.reviews }),
  });
}

/** CSV import: `check` is a dry run (nothing saved); `import` saves the valid rows. */
export function useImportReviews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { mode: "check" | "import"; csv: string; status: "approved" | "pending" }) =>
      api.post<ReviewImportResult>(v.mode === "check" ? "/reviews/import/check" : "/reviews/import", { csv: v.csv, status: v.status }),
    onSuccess: (r) => {
      if (!r.dryRun && r.imported > 0) void qc.invalidateQueries({ queryKey: sk.reviews });
    },
  });
}

// ---------------------------------------------------------------- analytics

export function useOverview(range: { from: string; to: string }, enabled = true) {
  return useQuery({
    queryKey: sk.overview(range.from, range.to),
    enabled,
    retry,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => api.get<Overview>("/analytics/overview", range, { signal }),
  });
}

// ---------------------------------------------------------------- store settings

export function useStoreSettings() {
  return useQuery({
    queryKey: sk.store,
    retry,
    queryFn: () => api.get<SettingsValues<Partial<StoreSettings>>>("/settings/store").then((r) => r.values ?? {}),
  });
}

export function useSaveStoreSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: StoreSettings) => api.put<SettingsValues<StoreSettings>>("/settings/store/tenant", v).then((r) => r.values),
    onSuccess: (v) => qc.setQueryData(sk.store, v),
  });
}

// ---------------------------------------------------------------- domains

export function useDomains() {
  return useQuery({ queryKey: sk.domains, retry, queryFn: () => api.get<Paged<TenantDomain>>("/tenancy/domains").then((r) => r.items) });
}

export function useDomainInstructions(id: string | null) {
  return useQuery({
    queryKey: sk.instructions(id ?? ""),
    enabled: !!id,
    retry,
    queryFn: () => api.get<DomainInstructions>(`/tenancy/domains/${id}/instructions`),
  });
}

export function useAddDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (domain: string) => api.post<TenantDomain>("/tenancy/domains", { domain }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sk.domains }),
  });
}

export function useVerifyDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<TenantDomain>(`/tenancy/domains/${id}/verify`, {}),
    onSettled: () => void qc.invalidateQueries({ queryKey: sk.domains }),
  });
}

export function useDeleteDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/tenancy/domains/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sk.domains }),
  });
}

// ---------------------------------------------------------------- uploads

/**
 * POST /uploads/sign → PUT the bytes (XHR, for progress) → POST /uploads/:id/complete. Public files; the URL is made
 * absolute (cms image URLs must be http(s) URLs).
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
    purpose: opts.purpose ?? "site",
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
