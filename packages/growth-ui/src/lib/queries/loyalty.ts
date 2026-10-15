"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiDownload } from "@srirealtime/web";
import { retry4xx } from "../http";
import type { LedgerEntry, LedgerType, LoyaltyMember, LoyaltySettings, MemberDetail, MemberSort, Paged } from "../types";

const L = "/loyalty";
export const MEMBERS_PAGE = 50;
export const LEDGER_PAGE = 50;

export interface MemberFilters {
  q?: string;
  tier?: string;
  sort?: MemberSort;
}

export const lk = {
  all: ["loyalty"] as const,
  settings: ["loyalty", "settings"] as const,
  members: (f: MemberFilters) => ["loyalty", "members", f] as const,
  member: (id: string, type?: LedgerType) => ["loyalty", "member", id, type ?? null] as const,
  summary: ["loyalty", "summary"] as const,
};

export function useLoyaltySettings() {
  return useQuery({ queryKey: lk.settings, queryFn: () => api.get<LoyaltySettings>(`${L}/settings`), retry: retry4xx });
}

export function useSaveLoyaltySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<LoyaltySettings>) => api.put<LoyaltySettings>(`${L}/settings`, patch),
    onSuccess: (s) => {
      qc.setQueryData(lk.settings, s);
      // Tier names and point values show up in member rows.
      void qc.invalidateQueries({ queryKey: ["loyalty", "members"] });
    },
  });
}

/** Members, 50 per page, "Load more" appends. */
export function useMembers(f: MemberFilters) {
  return useInfiniteQuery({
    queryKey: lk.members(f),
    queryFn: ({ pageParam }) =>
      api.get<Paged<LoyaltyMember>>(`${L}/members`, { q: f.q || undefined, tier: f.tier || undefined, sort: f.sort ?? "recent", limit: MEMBERS_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    retry: retry4xx,
  });
}

export function downloadMembersCsv(f: MemberFilters) {
  return apiDownload(`${L}/members`, { format: "csv", q: f.q || undefined, tier: f.tier || undefined, sort: f.sort ?? "recent" }, "loyalty-members.csv");
}

/** Member header (balance, tier, next tier, expiring soon). */
export function useMember(id: string) {
  return useQuery({
    queryKey: lk.member(id),
    queryFn: () => api.get<MemberDetail>(`${L}/members/${id}`, { limit: 1, offset: 0 }),
    enabled: !!id,
    retry: retry4xx,
  });
}

/** The member's points history, newest first, 50 per page, optional type filter. */
export function useLedger(id: string, type?: LedgerType) {
  return useInfiniteQuery({
    queryKey: ["loyalty", "ledger", id, type ?? null],
    queryFn: ({ pageParam }) => api.get<MemberDetail>(`${L}/members/${id}`, { type, limit: LEDGER_PAGE, offset: pageParam }).then((d) => d.ledger),
    initialPageParam: 0,
    getNextPageParam: (last: Paged<LedgerEntry>, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    enabled: !!id,
    placeholderData: keepPreviousData,
    retry: retry4xx,
  });
}

export function useAdjustPoints(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { points: number; reason: string }) => api.post<{ member: LoyaltyMember; entry: LedgerEntry }>(`${L}/members/${id}/adjust`, b),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["loyalty"] });
    },
  });
}

/**
 * Members count + points liability for the dashboard. The list API has no sum, so the liability adds up the top
 * 500 members by points (exact when the shop has ≤ 500 members, otherwise a lower bound).
 */
export function useLoyaltySummary() {
  return useQuery({
    queryKey: lk.summary,
    queryFn: async () => {
      const page = await api.get<Paged<LoyaltyMember>>(`${L}/members`, { sort: "points", limit: 500, offset: 0 });
      const liability = page.items.reduce((s, m) => s + m.pointsValue, 0);
      const points = page.items.reduce((s, m) => s + m.pointsBalance, 0);
      return { members: page.total, liability, points, exact: page.items.length >= page.total };
    },
    staleTime: 60_000,
    retry: retry4xx,
  });
}
