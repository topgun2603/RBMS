"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";
import { aiKeys } from "./queries-ai";

export interface DailySummarySettings {
  enabled: boolean;
  time: string;
  language: "en" | "ta";
  phones: string[];
  toOwner: boolean;
}
export const DAILY_DEFAULTS: DailySummarySettings = { enabled: false, time: "21:00", language: "en", phones: [], toOwner: true };

export interface SummaryFactsView {
  date: string;
  today: { bills: number; amount: number; cash: number; upi: number; card: number; other: number };
  lastWeek: { date: string; bills: number; amount: number };
  vsLastWeekPct: number | null;
  topItems: { name: string; qty: number; amount: number }[];
  lowStock: { count: number; top: { name: string; qty: number }[] };
  deadStock: { count: number; top: { name: string }[] };
  dues: { count: number; amount: number; overdue: { name: string; phoneMasked: string | null; amount: number; days: number }[] };
  expiring: { batches: number; value: number; days: number } | null;
  purchases: { count: number; amount: number };
  expenses: { count: number; amount: number };
}

export interface DailySummaryView {
  id?: string;
  date: string;
  source: "ai" | "template" | string | null;
  fallbackReason?: string | null;
  language: string;
  narrative: string | null;
  actions: string[];
  facts: SummaryFactsView | null;
  credits: number;
  delivery?: { inApp: boolean; whatsapp: { to: string; status: string }[]; email: { to: string; status: string }[]; skipped: string[] } | null;
  createdAt?: string;
}

const key = ["ai", "daily", "latest"] as const;

export function useLatestDailySummary(enabled = true) {
  return useQuery({ queryKey: key, queryFn: () => api.get<{ summary: DailySummaryView | null }>("/ai/insights/daily/latest").then((r) => r.summary), enabled, staleTime: 60_000, retry: 0 });
}

export function usePreviewDailySummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { date?: string; language?: "en" | "ta" }) => api.post<DailySummaryView>("/ai/insights/daily/preview", body),
    onSettled: () => void qc.invalidateQueries({ queryKey: aiKeys.status }),
  });
}

export function useSendDailySummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<DailySummaryView>("/ai/insights/daily/send", {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: aiKeys.status });
    },
  });
}
