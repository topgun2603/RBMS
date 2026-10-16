"use client";

import { useQuery } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { normalizeCurrent, sortPlans, type PlanInfo, type SubscriptionCurrent } from "./subscriptions";

export const subscriptionKeys = {
  all: ["subscriptions"] as const,
  current: ["subscriptions", "current"] as const,
  invoices: ["subscriptions", "invoices"] as const,
  plans: ["plans", "public"] as const,
};

/** Don't retry 4xx (no permission, route not mounted yet); retry network/5xx once. */
const retry = (n: number, err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 1;

/**
 * GET /v1/subscriptions/current, shared by the shell banner and Plan & billing. Cached for 5 minutes and refreshed
 * every 15 while the tab is open, and when the window regains focus (after paying in another tab).
 */
export function useSubscriptionCurrent(enabled = true) {
  return useQuery<SubscriptionCurrent>({
    queryKey: subscriptionKeys.current,
    queryFn: ({ signal }) => api.get<unknown>("/subscriptions/current", undefined, { signal }).then(normalizeCurrent),
    enabled,
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    refetchOnWindowFocus: true,
    retry,
  });
}

/** Public plans (GET /v1/plans, no token), sorted. */
export function usePublicPlans(enabled = true) {
  return useQuery<PlanInfo[]>({
    queryKey: subscriptionKeys.plans,
    queryFn: ({ signal }) => api<{ items: PlanInfo[] }>("/plans", { anonymous: true, signal }).then((r) => sortPlans(r.items ?? [])),
    enabled,
    staleTime: 10 * 60_000,
    retry,
  });
}
