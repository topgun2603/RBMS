"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";

/**
 * Money helpers of AI Phase 5 part B (docs/ai.md): credit risk bands, the 30-day cash-flow forecast, the loan readiness
 * pack and GSTR-2B explanations. The API computes every number; the browser only draws them, and repeats the one sum the
 * cash-flow sliders need (`projectBalances`).
 */

export type RiskBand = "A" | "B" | "C" | "D" | "new";
export type Lang = "en" | "ta";

export interface RiskListItem {
  customerId: string;
  band: RiskBand;
  score: number | null;
  enough: boolean;
  openAmount: number;
  overdueAmount: number;
}

export interface RiskFactor {
  key: string;
  tone: "good" | "bad" | "neutral";
  weight: number;
  en: string;
  ta: string;
}

export interface RiskDetail {
  customerId: string;
  band: RiskBand;
  score: number | null;
  enough: boolean;
  factors: RiskFactor[];
  limit: { amount: number | null; current: number | null; action: "raise" | "lower" | "keep" | "none"; en: string; ta: string };
  metrics: {
    creditBills: number;
    tenureDays: number;
    monthlyPurchase: number;
    onTimeShare: number | null;
    avgDaysLate: number | null;
    avgDaysToPay: number | null;
    openAmount: number;
    overdueAmount: number;
    oldestOverdueDays: number;
    utilisation: number | null;
    trend: "rising" | "steady" | "falling";
    lateness: { key: string; amount: number; share: number }[];
  };
  hint: { en: string; ta: string } | null;
}

/** Whole list for the credit book badges. A 403 (no credit-book permission, helper off) means "show nothing". */
export function useRiskList(enabled = true) {
  return useQuery({
    queryKey: ["ai", "money", "risk"],
    queryFn: () => api.get<{ items: RiskListItem[] }>("/ai/money/credit-risk").then((r) => new Map(r.items.map((i) => [i.customerId, i]))),
    enabled,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
}

export function useRiskDetail(customerId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["ai", "money", "risk", customerId],
    queryFn: () => api.get<RiskDetail>(`/ai/money/credit-risk/${customerId}`),
    enabled: enabled && !!customerId,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
}

export function useRiskExplain(customerId: string) {
  return useMutation({
    mutationFn: (lang: Lang) => api.post<{ text: string; source: "ai" | "template"; credits: number; fallbackReason: string | null }>(`/ai/money/credit-risk/${customerId}/explain`, { lang }),
  });
}

// ------------------------------------------------------------------ cash flow

export type ItemKind = "collection" | "supplier" | "recurring" | "po";
export interface FlowDay {
  date: string;
  weekday: number;
  salesIn: number;
  collectionsIn: number;
  supplierOut: number;
  recurringOut: number;
  poOut: number;
  festival: string | null;
}
export interface FlowItem {
  date: string;
  kind: ItemKind;
  label: string;
  amount: number;
  chance?: number;
  spread?: boolean;
}
export interface Cashflow {
  today: string;
  horizon: number;
  opening: { amount: number | null; source: "entered" | "till" | "none"; asOf: string | null };
  balanceKnown: boolean;
  startBalance: number;
  threshold: number;
  days: FlowDay[];
  items: FlowItem[];
  recurring: { category: string; amount: number; dayOfMonth: number; months: number; nextDate: string }[];
  festivals: { id: string; name: string; nameTa: string; date: string; windowStart: string; windowEnd: string; ratio: number | null }[];
  assumptions: { weekdayAverage: number[]; historyDays: number };
  forecast: { balances: number[]; lowest: { date: string; balance: number }; end: number; totalIn: number; totalOut: number };
  warning: { date: string; balance: number; shortBy: number; reason: { kind: ItemKind | "none"; label: string; amount: number; date: string } } | null;
  suggestions: { kind: "collect" | "delay_po"; duesTotal?: number; po?: { number: string; delayDays: number } }[];
  topDues: { label: string; amount: number; band: RiskBand }[];
}

export interface Adjust {
  salesPct: number;
  collectionPct: number;
}

/** The same sum the server uses: start + sales x (1 + s) + collections x c - supplier - expenses - orders, day by day. */
export function projectBalances(f: Pick<Cashflow, "days" | "startBalance">, adj: Adjust): number[] {
  const s = 1 + adj.salesPct / 100;
  const c = adj.collectionPct / 100;
  let bal = f.startBalance;
  return f.days.map((d) => {
    bal += d.salesIn * s + d.collectionsIn * c - d.supplierOut - d.recurringOut - d.poOut;
    return Math.round(bal);
  });
}

export function useCashflow(enabled = true) {
  return useQuery({
    queryKey: ["ai", "money", "cashflow"],
    queryFn: () => api.get<Cashflow>("/ai/money/cashflow"),
    enabled,
    staleTime: 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  });
}

export interface CashflowWords {
  explanation: string;
  suggestions: string[];
  source: "ai" | "template";
  fallbackReason: string | null;
  credits: number;
}
export function useCashflowExplain() {
  return useMutation({ mutationFn: (lang: Lang) => api.post<CashflowWords>("/ai/money/cashflow/explain", { lang }) });
}

export interface CashflowSettings {
  openingBalance: number | null;
  asOf: string | null;
  minBalance: number;
}
export function useCashflowSettings(enabled = true) {
  return useQuery({ queryKey: ["ai", "money", "cashflow", "settings"], queryFn: () => api.get<CashflowSettings>("/ai/money/cashflow/settings"), enabled, retry: 0 });
}
export function useSaveCashflowSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { openingBalance: number | null; minBalance: number }) => api.put<CashflowSettings>("/ai/money/cashflow/settings", b),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai", "money", "cashflow"] }),
  });
}

// ------------------------------------------------------------------ loan pack

export interface LoanSection {
  key: string;
  en: string;
  ta: string;
  descEn: string;
  descTa: string;
}
export interface LoanConsent {
  sections: LoanSection[];
  disclaimer: { en: string; ta: string };
}
export interface LoanMonth {
  month: string;
  sales: number;
  taxable: number;
  bills: number;
  gstOutput: number;
  purchasesTaxable: number;
  gstr1Filed: boolean;
  marginPct: number | null;
}
export interface LoanFacts {
  from: string;
  to: string;
  months: LoanMonth[];
  totals: { sales: number; bills: number; avgMonthly: number; best: { month: string; sales: number } | null; worst: { month: string; sales: number } | null; growthPct: number | null; marginPct: number | null; gstOutput: number; gstr1FiledMonths: number };
  concentration: { top: { label: string; total: number; sharePct: number; bills: number }[]; top1SharePct: number; top5SharePct: number; namesShown: boolean };
  receivables: { buckets: { key: string; amount: number; count: number }[]; total: number; customers: number; over60Pct: number | null };
  payables: { total: number; overdue: number } | null;
  stockValue: number | null;
  balance: { average: number | null; averageDailyCollections: number };
  sections: string[];
}
export interface LoanPack {
  id: string;
  createdAt: string;
  showNames: boolean;
  facts: LoanFacts;
  cover: { en: string; ta: string; source: "ai" | "template" };
  credits: number;
  share: { active: boolean; expiresAt: string | null; token: string | null };
  coverFallbackReason?: string | null;
}

export function useLoanConsent(enabled = true) {
  return useQuery({ queryKey: ["ai", "money", "loan", "consent"], queryFn: () => api.get<LoanConsent>("/ai/money/loan-pack/consent"), enabled, retry: 0 });
}
export function useLoanPacks(enabled = true) {
  return useQuery({ queryKey: ["ai", "money", "loan", "list"], queryFn: () => api.get<{ items: { id: string; createdAt: string; showNames: boolean; shareActive: boolean }[] }>("/ai/money/loan-pack"), enabled, retry: 0 });
}
export function useLoanPack(id: string | null) {
  return useQuery({ queryKey: ["ai", "money", "loan", id], queryFn: () => api.get<LoanPack>(`/ai/money/loan-pack/${id}`), enabled: !!id, retry: 0 });
}
export function useMakeLoanPack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { showNames: boolean }) => api.post<LoanPack>("/ai/money/loan-pack", { consent: true, showNames: b.showNames }),
    onSuccess: (p) => {
      qc.setQueryData(["ai", "money", "loan", p.id], p);
      void qc.invalidateQueries({ queryKey: ["ai", "money", "loan", "list"] });
    },
  });
}
export function useShareLoanPack(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: number) => api.post<{ token: string; expiresAt: string; path: string }>(`/ai/money/loan-pack/${id}/share`, { days }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai", "money", "loan", id] }),
  });
}
export function useRevokeLoanPack(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<{ ok: boolean }>(`/ai/money/loan-pack/${id}/share`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ai", "money", "loan", id] }),
  });
}

// ------------------------------------------------------------------ GSTR-2B

export interface Explain2bGroup {
  group: "missing_in_2b" | "missing_in_books" | "amount_mismatch" | "fuzzy";
  title: { en: string; ta: string };
  count: number;
  tax: number;
  text: string;
  source: "ai" | "template";
  examples: { supplier: string; number: string; tax: number }[];
}
export function useExplain2b(month: string) {
  return useMutation({
    mutationFn: (lang: Lang) => api.post<{ month: string; groups: Explain2bGroup[]; aiNote: string | null; credits: number }>(`/ai/money/gst-2b/${month}/explain`, { lang }),
  });
}
