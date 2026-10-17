"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiDownload } from "@srirealtime/web";
import { retry4xx } from "../http";
import type { LedgerEntry, LedgerType, LoyaltyMember, LoyaltySettings, LoyaltySummary, MemberDetail, Paged } from "../types";

const L = "/loyalty";
export const LEDGER_PAGE = 50;

/** The members table (useServerTable): server default sort, the same as packages/loyalty `MEMBER_SORT_DEFAULT`. */
export const MEMBERS_DEFAULT_SORT = "-lastActivity";

export const lk = {
  all: ["loyalty"] as const,
  settings: ["loyalty", "settings"] as const,
  /** Prefix of every members list query (the table appends its params). */
  members: ["loyalty", "members"] as const,
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
      void qc.invalidateQueries({ queryKey: lk.members });
      void qc.invalidateQueries({ queryKey: lk.summary });
    },
  });
}

/** CSV of the members under the table's current search, tier filter and sort (`apiParams` minus paging). */
export function downloadMembersCsv(params: Record<string, string | number>) {
  const { limit: _l, offset: _o, ...rest } = params;
  return apiDownload(`${L}/members`, { ...rest, format: "csv" }, "loyalty-members.csv");
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

/** Members, unused points and their value (points liability) over the whole shop: `GET /loyalty/summary`. */
export function useLoyaltySummary() {
  return useQuery({
    queryKey: lk.summary,
    queryFn: () => api.get<LoyaltySummary>(`${L}/summary`),
    staleTime: 60_000,
    retry: retry4xx,
  });
}
