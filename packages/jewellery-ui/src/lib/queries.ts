"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";
import { retry4xx } from "./http";
import type { MakingType, Metal, Purity } from "./pricing";
import type { BillSummary, Exchange, JewellerySettings, Piece, PiecePrice, RateEntry, RatesView, RepriceResult, ShopItem } from "./types";

const J = "/jewellery";

/** Query keys. Lists start with these prefixes so mutations can invalidate them. */
export const jk = {
  all: ["jewellery"] as const,
  rates: (days: number) => ["jewellery", "rates", days] as const,
  pieces: ["jewellery", "pieces"] as const,
  price: (id: string) => ["jewellery", "pieces", id, "price"] as const,
  exchanges: ["jewellery", "exchanges"] as const,
  exchange: (id: string) => ["jewellery", "exchange", id] as const,
  settings: ["jewellery", "settings"] as const,
  items: (q: string) => ["jewellery", "shop-items", q] as const,
  bills: (q: string) => ["jewellery", "bills", q] as const,
};

export function useRates(days = 30) {
  return useQuery({ queryKey: jk.rates(days), queryFn: () => api.get<RatesView>(`${J}/rates`, { days }), retry: retry4xx });
}

export function useJewellerySettings() {
  return useQuery({ queryKey: jk.settings, queryFn: () => api.get<JewellerySettings>(`${J}/settings`), retry: retry4xx });
}

export function usePiecePrice(id: string | null) {
  return useQuery({ queryKey: jk.price(id ?? ""), queryFn: () => api.get<PiecePrice>(`${J}/pieces/${id}/price`), enabled: !!id, retry: retry4xx });
}

export function useExchange(id: string) {
  return useQuery({ queryKey: jk.exchange(id), queryFn: () => api.get<Exchange>(`${J}/exchanges/${id}`), retry: retry4xx });
}

/** Billing items (catalogue variants) matching `q`, for the item picker. */
export function useShopItems(q: string, enabled = true) {
  return useQuery({
    queryKey: jk.items(q),
    queryFn: ({ signal }) => api.get<{ items: ShopItem[] }>("/invoices/items", { q: q || undefined, limit: 12 }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
    retry: retry4xx,
  });
}

/** Recent bills matching `q` (number or customer), for applying old gold to a bill. */
export function useBills(q: string, enabled = true) {
  return useQuery({
    queryKey: jk.bills(q),
    queryFn: ({ signal }) => api.get<{ items: BillSummary[] }>("/invoices", { q: q || undefined, limit: 8, sort: "-date" }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
    retry: retry4xx,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: jk.all });
}

export function useSaveRates() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (rates: RateEntry[]) => api.put<{ date: string; reprice: RepriceResult }>(`${J}/rates`, { rates }),
    onSuccess: invalidate,
  });
}

export interface PieceBody {
  itemId?: string;
  name?: string;
  metal: Metal;
  purity: Purity;
  grossWeight: number;
  stoneWeight: number;
  wastagePct: number;
  makingType: MakingType;
  makingValue: number;
  stoneCharges: number;
  huid: string | null;
  tagNo: string | null;
}

export function useSavePiece(id?: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: PieceBody) => (id ? api.patch<Piece>(`${J}/pieces/${id}`, body) : api.post<Piece>(`${J}/pieces`, body)),
    onSuccess: invalidate,
  });
}

export function usePieceActions() {
  const invalidate = useInvalidate();
  return {
    status: useMutation({ mutationFn: ({ id, status }: { id: string; status: Piece["status"] }) => api.patch<Piece>(`${J}/pieces/${id}`, { status }), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`${J}/pieces/${id}`), onSuccess: invalidate }),
    reprice: useMutation({ mutationFn: (body: { pieceId?: string; force?: boolean }) => api.post<RepriceResult>(`${J}/reprice`, body), onSuccess: invalidate }),
  };
}

export interface ExchangeBody {
  customer: { name: string; phone: string | null };
  lines: { description?: string; metal: Metal; purity: Purity; grossWeight: number; deductionPct: number }[];
  note: string | null;
}

export function useCreateExchange() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: ExchangeBody) => api.post<Exchange>(`${J}/exchanges`, body), onSuccess: invalidate });
}

export function useExchangeActions(id: string) {
  const invalidate = useInvalidate();
  return {
    apply: useMutation({ mutationFn: (invoiceId: string) => api.post<Exchange>(`${J}/exchanges/${id}/apply`, { invoiceId }), onSuccess: invalidate }),
    cancel: useMutation({ mutationFn: () => api.post<Exchange>(`${J}/exchanges/${id}/cancel`, {}), onSuccess: invalidate }),
  };
}

export function useSaveSettings() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: Partial<JewellerySettings>) => api.put<JewellerySettings>(`${J}/settings`, body), onSuccess: invalidate });
}
