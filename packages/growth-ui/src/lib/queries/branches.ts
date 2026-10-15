"use client";

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import { retry4xx } from "../http";
import type { Branch, BranchInput, BranchSummary, BranchUser, Paged, StaffMember, StockLocation } from "../types";

const B = "/branches";

export const bk = {
  all: ["branches"] as const,
  list: ["branches", "list"] as const,
  users: (id: string) => ["branches", "users", id] as const,
  summary: (from: string, to: string) => ["branches", "summary", from, to] as const,
  locations: ["inventory", "locations", "all"] as const,
  staff: ["staff", "members"] as const,
};

export function useBranches() {
  return useQuery({ queryKey: bk.list, queryFn: () => api.get<Paged<Branch>>(B, { includeInactive: true }), retry: retry4xx });
}

export function useBranchSummary(from: string, to: string) {
  return useQuery({
    queryKey: bk.summary(from, to),
    queryFn: () => api.get<BranchSummary>(`${B}/summary`, { from, to }),
    placeholderData: keepPreviousData,
    retry: retry4xx,
  });
}

/** Stock locations (inventory.locations) to link a branch to. */
export function useLocations(enabled = true) {
  return useQuery({
    queryKey: bk.locations,
    queryFn: () => api.get<Paged<StockLocation>>("/inventory/locations", { includeInactive: false }).then((r) => r.items),
    enabled,
    staleTime: 60_000,
    retry: retry4xx,
  });
}

/** Shop staff (staff module), for branch assignments. */
export function useStaff(enabled = true) {
  return useQuery({
    queryKey: bk.staff,
    queryFn: () => api.get<Paged<StaffMember>>("/staff/members").then((r) => r.items),
    enabled,
    retry: retry4xx,
  });
}

/** Assignments of every branch: userId → { branchIds, homeBranchId }. */
export function useAssignments(branches: Branch[] | undefined) {
  const results = useQueries({
    queries: (branches ?? []).map((b) => ({
      queryKey: bk.users(b.id),
      queryFn: () => api.get<BranchUser[] | Paged<BranchUser>>(`${B}/${b.id}/users`).then((r) => (Array.isArray(r) ? r : r.items)),
      retry: retry4xx,
    })),
  });
  const pending = results.some((r) => r.isPending);
  const error = results.find((r) => r.isError)?.error ?? null;
  const byUser = new Map<string, { branchIds: string[]; homeBranchId: string | null }>();
  for (const r of results) {
    for (const u of r.data ?? []) {
      const cur = byUser.get(u.userId) ?? { branchIds: [], homeBranchId: null };
      cur.branchIds.push(u.branchId);
      if (u.isDefault) cur.homeBranchId = u.branchId;
      byUser.set(u.userId, cur);
    }
  }
  return { byUser, pending, error, refetch: () => results.forEach((r) => void r.refetch()) };
}

export function useSaveBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: BranchInput }) => (id ? api.patch<Branch>(`${B}/${id}`, body) : api.post<Branch>(B, body)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: bk.all });
      void qc.invalidateQueries({ queryKey: ["inventory", "locations"] });
    },
  });
}

/** Closes a branch (DELETE) or reopens it (PATCH active). */
export function useSetBranchActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => (active ? api.patch<Branch>(`${B}/${id}`, { active: true }) : api.delete<Branch>(`${B}/${id}`)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: bk.all }),
  });
}

export function useSetUserBranches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, branchIds, defaultBranchId }: { userId: string; branchIds: string[]; defaultBranchId: string | null }) =>
      api.put(`${B}/users/${userId}`, { branchIds, defaultBranchId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["branches", "users"] }),
  });
}
