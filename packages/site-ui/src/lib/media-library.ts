"use client";

import { infiniteQueryOptions, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { STOCK_SIZES, STOCK_SLOTS, isStockTrade, stockArtDataUrl, stockArtPath, type StockColors, type StockSlot, type StockTrade } from "@rbms/branding/stock-art";
import { packOrDefault } from "@rbms/verticals";
import { absoluteUrl, api, useOptionalShop } from "@rbms/web";
import * as React from "react";
import { useBrand } from "./brand";
import { useStoreSettings } from "./queries";

/*
 * The site editor's media library: the shop's earlier uploads (`GET /v1/uploads`, staff only, newest first, keyset
 * paged) and stock artwork drawn in the shop's brand colours (@rbms/branding/stock-art, served by the API).
 */

export type MediaKind = "image" | "video";

/** Upload size caps the editor checks before signing (the API enforces the same). */
export const MEDIA_LIMITS: Record<MediaKind, number> = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024 };
export const VIDEO_TYPES = ["video/mp4", "video/webm"] as const;

export interface MediaFile {
  id: string;
  originalName: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  thumbUrl: string | null;
  createdAt: string;
}

export interface MediaPage {
  items: MediaFile[];
  nextCursor: string | null;
}

export const PAGE_SIZE = 24;

export const mediaKeys = {
  all: ["site", "media"] as const,
  list: (kind: MediaKind, q: string) => ["site", "media", kind, q] as const,
};

/** Query string of one library page: public files of a kind, matching `q`, after `cursor`. */
export function mediaListParams(kind: MediaKind, q: string, cursor?: string | null): Record<string, string | number> {
  const p: Record<string, string | number> = { kind, visibility: "public", limit: PAGE_SIZE };
  const term = q.trim();
  if (term) p.q = term.slice(0, 100);
  if (cursor) p.cursor = cursor;
  return p;
}

/** The shop's uploads of one kind, page by page (`fetchNextPage` for "Show more"). */
export function useMediaLibrary(kind: MediaKind, q: string, enabled = true) {
  return useInfiniteQuery({ ...mediaListOptions(kind, q), enabled });
}

/** The library list query (also usable with `queryClient.fetchInfiniteQuery`). */
export function mediaListOptions(kind: MediaKind, q: string) {
  return infiniteQueryOptions({
    queryKey: mediaKeys.list(kind, q.trim()),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<MediaPage>("/uploads", mediaListParams(kind, q, pageParam)),
    getNextPageParam: (last: MediaPage) => last.nextCursor,
    staleTime: 30_000,
  });
}

/** After an upload, the library should show the new file next time it opens. */
export function useRefreshMedia() {
  const qc = useQueryClient();
  return React.useCallback(() => void qc.invalidateQueries({ queryKey: mediaKeys.all }), [qc]);
}

/** Why a picked file can't be used, or null when it can. */
export function checkMediaFile(file: { type: string; size: number }, kind: MediaKind): "type" | "size" | null {
  const ok = kind === "image" ? file.type.startsWith("image/") : (VIDEO_TYPES as readonly string[]).includes(file.type);
  if (!ok) return "type";
  if (file.size > MEDIA_LIMITS[kind]) return "size";
  return null;
}

/** "Debounced" value: the search box waits for a pause in typing before querying. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** A thumbnail URL for a library file (the generated thumbnail when there is one). */
export const mediaThumb = (f: MediaFile) => absoluteUrl(f.thumbUrl || f.url);

// ---------------------------------------------------------------- stock artwork

export type StockGroup = "hero" | "split" | "tile" | "banner";

export interface StockItem {
  slot: StockSlot;
  group: StockGroup;
  /** What gets stored in the section (a site path the API serves). */
  path: string;
  /** Inline preview (no request per picture). */
  preview: string;
  width: number;
  height: number;
}

export const stockGroup = (slot: StockSlot): StockGroup => slot.split("-")[0] as StockGroup;

/** The stock pictures of a trade in the given colours. */
export function stockItems(trade: StockTrade, colors: StockColors): StockItem[] {
  return STOCK_SLOTS.map((slot) => ({
    slot,
    group: stockGroup(slot),
    path: stockArtPath(trade, slot, colors),
    preview: stockArtDataUrl(trade, slot, colors),
    width: STOCK_SIZES[slot].w,
    height: STOCK_SIZES[slot].h,
  }));
}

/** The shop's trade for stock artwork: its business type, else its app's default trade. */
export function shopTrade(businessType: string | null | undefined, appId: string | null | undefined): StockTrade {
  const id = packOrDefault(businessType, appId).id;
  return isStockTrade(id) ? id : "fashion";
}

/** The shop's brand colours as the stock artwork wants them (a neutral violet until branding loads). */
export function brandStockColors(b: { tokens: { colors: { primary: string; accent?: string; background?: string } } } | undefined): StockColors {
  const c = b?.tokens.colors;
  return { primary: c?.primary ?? "#7c3aed", accent: c?.accent ?? null, background: c?.background ?? null };
}

/** Trade + colours of the current shop, for the Stock tab. */
export function useShopStock() {
  const shop = useOptionalShop();
  const settings = useStoreSettings();
  const brand = useBrand();
  const trade = shopTrade(settings.data?.businessType, shop?.tenant.appId ?? null);
  const colors = brandStockColors(brand.data);
  return { trade, colors, loading: brand.isLoading };
}
