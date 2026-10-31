"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@rbms/web";
import { retry4xx } from "./http";
import type { CheckinResult, ExpiringMembership, MemberDetail, MembershipsSettings, MembershipsSummary, Plan, ShopItem, Subscription, TodayCheckin } from "./types";

const MS = "/memberships";

/** Query keys. Lists start with these prefixes so mutations can invalidate them. */
export const mk = {
  all: ["memberships"] as const,
  members: ["memberships", "members"] as const,
  member: (id: string) => ["memberships", "member", id] as const,
  plans: (all: boolean) => ["memberships", "plans", all ? "all" : "active"] as const,
  summary: ["memberships", "summary"] as const,
  expiring: (within?: number) => ["memberships", "expiring", within ?? "default"] as const,
  today: ["memberships", "checkins", "today"] as const,
  settings: ["memberships", "settings"] as const,
  items: (q: string) => ["memberships", "shop-items", q] as const,
};

/** The front desk list refreshes every 30 s (paused in background tabs). */
export const DESK_POLL_MS = 30_000;

export function usePlans(all = false) {
  return useQuery({ queryKey: mk.plans(all), queryFn: () => api.get<{ items: Plan[] }>(`${MS}/plans`, { all: all ? 1 : undefined }), retry: retry4xx });
}

export function useMember(id: string) {
  return useQuery({ queryKey: mk.member(id), queryFn: () => api.get<MemberDetail>(`${MS}/members/${id}`), retry: retry4xx });
}

export function useSummary() {
  return useQuery({ queryKey: mk.summary, queryFn: () => api.get<MembershipsSummary>(`${MS}/reports/summary`), retry: retry4xx });
}

export function useExpiring(within?: number) {
  return useQuery({
    queryKey: mk.expiring(within),
    queryFn: () => api.get<{ items: ExpiringMembership[] }>(`${MS}/reports/expiring`, { within }),
    retry: retry4xx,
  });
}

export function useTodayCheckins(enabled = true) {
  return useQuery({
    queryKey: mk.today,
    queryFn: () => api.get<{ date: string; items: TodayCheckin[] }>(`${MS}/checkins/today`),
    refetchInterval: DESK_POLL_MS,
    enabled,
    retry: retry4xx,
  });
}

export function useMembershipSettings() {
  return useQuery({ queryKey: mk.settings, queryFn: () => api.get<MembershipsSettings>(`${MS}/settings`), retry: retry4xx });
}

/** Billing items (catalogue variants) matching `q`, for the plan's catalogue item. */
export function useShopItems(q: string, enabled = true) {
  return useQuery({
    queryKey: mk.items(q),
    queryFn: ({ signal }) => api.get<{ items: ShopItem[] }>("/invoices/items", { q: q || undefined, limit: 12 }, { signal }),
    placeholderData: keepPreviousData,
    enabled,
    retry: retry4xx,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: mk.all });
}

export type PlanBody = Omit<Plan, "id" | "sort"> & { sort?: number };

export function useSavePlan(id?: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: PlanBody) => (id ? api.patch<Plan>(`${MS}/plans/${id}`, body) : api.post<Plan>(`${MS}/plans`, body)),
    onSuccess: invalidate,
  });
}

export function usePlanActions() {
  const invalidate = useInvalidate();
  return {
    toggle: useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch<Plan>(`${MS}/plans/${id}`, { active }), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => api.delete(`${MS}/plans/${id}`), onSuccess: invalidate }),
  };
}

export interface SellBody {
  planId: string;
  startDate?: string;
  billNow?: boolean;
  price?: number;
}

export interface MemberBody {
  name: string;
  phone?: string | null;
  notes?: string | null;
  plan?: SellBody;
}

export function useCreateMember() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: MemberBody) => api.post<MemberDetail>(`${MS}/members`, body), onSuccess: invalidate });
}

export function useMemberActions(id: string) {
  const invalidate = useInvalidate();
  return {
    update: useMutation({ mutationFn: (body: Omit<MemberBody, "plan">) => api.patch<MemberDetail>(`${MS}/members/${id}`, body), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: () => api.delete(`${MS}/members/${id}`), onSuccess: invalidate }),
    sell: useMutation({ mutationFn: (body: SellBody) => api.post<Subscription>(`${MS}/members/${id}/subscriptions`, body), onSuccess: invalidate }),
  };
}

export function useSubscriptionActions() {
  const invalidate = useInvalidate();
  const at = (id: string, action: string) => `${MS}/subscriptions/${id}/${action}`;
  return {
    renew: useMutation({
      mutationFn: ({ id, ...b }: { id: string; planId?: string; billNow?: boolean; price?: number }) => api.post<Subscription>(at(id, "renew"), b),
      onSuccess: invalidate,
    }),
    freeze: useMutation({ mutationFn: ({ id, ...b }: { id: string; from?: string }) => api.post<Subscription>(at(id, "freeze"), b), onSuccess: invalidate }),
    unfreeze: useMutation({ mutationFn: (id: string) => api.post<Subscription & { credited: number; frozenDays: number }>(at(id, "unfreeze")), onSuccess: invalidate }),
    cancel: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<Subscription>(at(id, "cancel"), { reason }), onSuccess: invalidate }),
    bill: useMutation({ mutationFn: (id: string) => api.post<Subscription>(at(id, "bill"), {}), onSuccess: invalidate }),
  };
}

export function useCheckIn() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { memberId?: string; code?: string; note?: string | null }) => api.post<CheckinResult>(`${MS}/checkins`, body),
    onSuccess: (r) => (r.ok ? invalidate() : undefined),
  });
}

export function useUndoCheckin() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.delete(`${MS}/checkins/${id}`), onSuccess: invalidate });
}

export function useSaveMembershipSettings() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: Partial<MembershipsSettings>) => api.put<MembershipsSettings>(`${MS}/settings`, body), onSuccess: invalidate });
}
