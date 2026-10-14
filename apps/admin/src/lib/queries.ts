"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { normalizeCurrentPlan } from "./format";
import type { Member, NotifyLogEntry, Plan } from "./types";

/** Shared queries (same keys everywhere so pages share the cache). */

export const qk = {
  currentPlan: ["plans", "current"] as const,
  plans: (all = false) => ["plans", "list", all] as const,
  members: ["tenancy", "members"] as const,
  notifyLog: (limit: number) => ["notify", "log", limit] as const,
  templates: ["notify", "templates"] as const,
  settings: ["settings"] as const,
  settingsNs: (ns: string) => ["settings", ns] as const,
  uploads: (purpose?: string) => ["uploads", purpose ?? "all"] as const,
  consentMe: ["consent", "me"] as const,
  sessions: ["auth", "sessions"] as const,
  overrides: ["i18n", "overrides"] as const,
  messages: (locale: string) => ["i18n", "messages-raw", locale] as const,
  branding: ["branding-editor"] as const,
};

export function useCurrentPlan() {
  return useQuery({
    queryKey: qk.currentPlan,
    queryFn: async () => normalizeCurrentPlan(await api.get<unknown>("/plans/current")),
  });
}

export function usePlans(all = false) {
  return useQuery({
    queryKey: qk.plans(all),
    queryFn: () => api.get<{ items: Plan[] }>("/plans", all ? { all: 1 } : undefined).then((r) => r.items),
    staleTime: 5 * 60_000,
  });
}

export function useMembers() {
  return useQuery({
    queryKey: qk.members,
    queryFn: () => api.get<{ items: Member[] }>("/tenancy/members").then((r) => r.items),
  });
}

export function useNotifyLog(limit = 50) {
  return useQuery({
    queryKey: qk.notifyLog(limit),
    queryFn: () => api.get<{ items: NotifyLogEntry[] }>("/notify/log", { limit }).then((r) => r.items),
  });
}
