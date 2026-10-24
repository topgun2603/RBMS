"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@srirealtime/web";

/** Reorder suggestions and the daily summary card (docs/ai.md Phase 2 part B). The API computes every number. */

export interface ReorderItem {
  itemId: string;
  name: string;
  unit: string;
  qty: number;
  group: string;
  reasons: string[];
  stock: number;
  onOrder: number;
  avgDaily: number;
  daysCover: number | null;
  trendPct: number | null;
  festival?: { id: string; name: string; nameTa: string; daysAway: number; ratio: number; extraQty: number };
  supplierId: string | null;
  supplierName: string | null;
  lastRate: number | null;
  gstRate: number | null;
  hsn: string | null;
}

export interface ReorderGroupView {
  group: string;
  count: number;
  reason: string | null;
  reasonSource: "ai" | "template" | null;
  items: ReorderItem[];
}

export interface ReorderResponse {
  today: string;
  historyDays: number;
  festivals: { id: string; name: string; nameTa: string; date: string; daysAway: number; hasLastYearData: boolean }[];
  groups: ReorderGroupView[];
  total: number;
  aiNote: string | null;
  credits: number;
}

export function useReorderSuggestions(lang: "en" | "ta", enabled: boolean) {
  return useQuery({
    queryKey: ["ai", "reorder", lang],
    queryFn: () => api.post<ReorderResponse>("/ai/insights/reorder", { lang, explain: true }),
    enabled,
    staleTime: 5 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
}

export interface PoLineBody {
  itemId: string;
  description: string;
  qty: number;
  unit?: string;
  hsn?: string;
  rate: number;
  gstRate: number;
}

/** Creates a DRAFT purchase order through the normal route; the owner reviews and sends it from the order page. */
export function useCreateDraftPo() {
  return useMutation({
    mutationFn: (body: { supplierId: string; lines: PoLineBody[]; notes: string }) => api.post<{ id: string; number: string }>("/inventory/purchase-orders", body),
  });
}

export interface LatestSummary {
  date: string;
  source: string | null;
  language: string;
  narrative: string | null;
  actions: string[];
}

export function useLatestSummaryCard(enabled: boolean) {
  return useQuery({
    queryKey: ["ai", "daily", "latest"],
    queryFn: () => api.get<{ summary: LatestSummary | null }>("/ai/insights/daily/latest").then((r) => r.summary),
    enabled,
    staleTime: 5 * 60_000,
    retry: 0,
  });
}
