"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";

/** What `GET /v1/ai/status` returns (packages/ai AiService.status). */
export interface AiFeatureRow {
  key: string;
  status: "live" | "soon";
  tier: "light" | "standard" | "vision";
  label: string;
  labelTa: string;
  description: string;
  descriptionTa: string;
  /** On for the shop right now (master switch on and this helper not switched off). */
  enabled: boolean;
  /** Not switched off by the owner. */
  allowed: boolean;
}

export interface AiStatus {
  ready: boolean;
  platformEnabled: boolean;
  available: boolean;
  provider: "claude" | "mock" | null;
  mock: boolean;
  shopEnabled: boolean;
  models: { light: string; standard: string; vision: string };
  credits: {
    period: string;
    unlimited: boolean;
    allowance: number;
    allowanceUsed: number;
    topUp: number;
    remaining: number | null;
    usedThisMonth: number;
    creditUsd: number;
    creditInr: number;
  };
  features: AiFeatureRow[];
  settings: { enabled: boolean; maskGstin: boolean; storePrompts: boolean };
}

export interface AiRunRow {
  id: string;
  feature: string;
  label: string;
  labelTa: string;
  tier: string;
  model: string;
  provider: "claude" | "mock";
  status: "ok" | "refused" | "error" | "blocked";
  errorCode: string | null;
  credits: number;
  steps: number;
  latencyMs: number;
  feedback: "accepted" | "edited" | "rejected" | null;
  hasDebug: boolean;
  createdAt: string;
}

export interface AiSettingsValues {
  enabled: boolean;
  features: Record<string, boolean>;
  maskGstin: boolean;
  storePrompts: boolean;
  /** Suggest HSN and GST when the item name box loses focus (about 1 credit each). */
  autoHsn?: boolean;
  /** Daily summary block (see queries-ai-daily.ts). */
  dailySummary?: import("./queries-ai-daily").DailySummarySettings;
}

export interface AiPing {
  ok: true;
  reply: string;
  runId: string;
  credits: number;
  provider: "claude" | "mock";
  model: string;
}

export const aiKeys = {
  status: ["ai", "status"] as const,
  runs: ["ai", "runs"] as const,
  settings: ["ai", "settings"] as const,
};

export function useAiStatus(enabled = true) {
  return useQuery({ queryKey: aiKeys.status, queryFn: () => api.get<AiStatus>("/ai/status"), enabled, staleTime: 15_000 });
}

export function useAiRuns(enabled = true) {
  return useQuery({ queryKey: aiKeys.runs, queryFn: () => api.get<{ items: AiRunRow[] }>("/ai/runs", { limit: 15 }).then((r) => r.items), enabled });
}

export function useAiSettings() {
  return useQuery({ queryKey: aiKeys.settings, queryFn: () => api.get<{ values: AiSettingsValues }>("/settings/ai").then((r) => r.values) });
}

/**
 * Saves the shop's AI settings (`PUT /v1/settings/ai/tenant`). Settings merge one level deep, so `features` is always sent whole.
 */
export function useSaveAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AiSettingsValues>) => api.put<{ values: AiSettingsValues }>("/settings/ai/tenant", patch).then((r) => r.values),
    onSuccess: (values) => {
      qc.setQueryData(aiKeys.settings, values);
      void qc.invalidateQueries({ queryKey: aiKeys.status });
    },
  });
}

/** One-credit connection test (`POST /v1/ai/ping`, needs ai.manage). */
export function usePingAi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<AiPing>("/ai/ping", {}),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: aiKeys.status });
      void qc.invalidateQueries({ queryKey: aiKeys.runs });
    },
  });
}
