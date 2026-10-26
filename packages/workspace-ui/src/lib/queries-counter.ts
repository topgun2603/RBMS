"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";

/** Client for /v1/ai/counter (AI Phase 5 part A): unusual-activity alerts, staff coaching notes, shift planning. Owners and managers only. */

export interface AlertView {
  key: string;
  type: string;
  severity: "info" | "watch" | "high";
  date: string;
  staff: { key: string; name: string } | null;
  title: { en: string; ta: string };
  detail: { en: string; ta: string };
  facts: Record<string, number | string>;
  drill: { kind: string; staff: string; date: string; days?: number; sessionId?: string } | null;
  reviewed: { at: string; by: string | null; note: string | null } | null;
}
export interface AlertsView {
  today: string;
  from: string;
  alerts: AlertView[];
  open: number;
}
export interface DrillRow {
  id: string;
  number: string | null;
  at: string;
  total: number;
  discount: number;
  reason: string | null;
  label: string | null;
}

export interface CoachMetricsView {
  enough: boolean;
  bills: number;
  billsPerDay: number;
  avgBill: number;
  itemsPerBill: number;
  voidRatePct: number;
  discountSharePct: number;
  busiest: number[];
  shop: { people: number; billsPerPerson: number; avgBill: number; itemsPerBill: number };
  billsVsLastWeekPct: number | null;
}
export interface CoachNote {
  notes: string[];
  source: string;
  credits: number;
  createdAt: string;
}
export interface CoachingView {
  weekStart: string;
  weekEnd: string;
  people: { staff: string; name: string; metrics: CoachMetricsView; notes: Partial<Record<"en" | "ta", CoachNote>> }[];
}

export interface ShiftPlanView {
  weekStart: string;
  days: {
    date: string;
    weekday: number;
    uplift: { festival: { id: string; name: string; nameTa: string; date: string }; factor: number; source: "history" | "default" } | null;
    cells: { hour: number; expectedBills: number; staff: number }[];
    peakHour: number | null;
    peakStaff: number;
    expectedBills: number;
    staffHours: number;
  }[];
  target: { billsPerStaffHour: number; source: "setting" | "median" | "fallback" };
  weeksUsed: number;
  fromHour: number;
  toHour: number;
  totals: { staffHours: number; expectedBills: number };
}
export interface CounterSettingsView {
  billsPerStaffHour?: number | null;
  alertsInSummary?: boolean;
}

const k = ["ai", "counter"] as const;

export const useAlerts = (days: number) => useQuery({ queryKey: [...k, "alerts", days], queryFn: () => api.get<AlertsView>("/ai/counter/alerts", { days }), staleTime: 30_000, retry: 0 });
export const useDrill = (ref: AlertView["drill"], enabled: boolean) =>
  useQuery({ queryKey: [...k, "drill", ref], queryFn: () => api.get<{ items: DrillRow[] }>("/ai/counter/alerts/drill", { ...ref! }), enabled: enabled && !!ref, staleTime: 60_000, retry: 0 });
export function useReviewAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { key: string; undo?: boolean }) => api.post<unknown>("/ai/counter/alerts/review", b),
    onSettled: () => void qc.invalidateQueries({ queryKey: [...k, "alerts"] }),
  });
}

export const useCoaching = (week?: string) => useQuery({ queryKey: [...k, "coaching", week ?? "last"], queryFn: () => api.get<CoachingView>("/ai/counter/coaching", week ? { week } : undefined), staleTime: 30_000, retry: 0 });
export function useGenerateCoaching() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { week?: string; staff?: string[]; lang: "en" | "ta" }) => api.post<{ credits: number; people: { staff: string; notes: string[] }[] }>("/ai/counter/coaching/generate", b),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [...k, "coaching"] });
      void qc.invalidateQueries({ queryKey: ["ai", "status"] });
    },
  });
}

export const useShifts = (week: "next" | "this") =>
  useQuery({ queryKey: [...k, "shifts", week], queryFn: () => api.get<{ plan: ShiftPlanView; summary: { en: string; ta: string } }>("/ai/counter/shifts", { week }), staleTime: 30_000, retry: 0 });
export const useCounterSettings = () => useQuery({ queryKey: [...k, "settings"], queryFn: () => api.get<CounterSettingsView>("/ai/counter/settings"), staleTime: 30_000, retry: 0 });
export function useSaveCounterSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: CounterSettingsView) => api.put<CounterSettingsView>("/ai/counter/settings", b),
    onSettled: () => void qc.invalidateQueries({ queryKey: k }),
  });
}
