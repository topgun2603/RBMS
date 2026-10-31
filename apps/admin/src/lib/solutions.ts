"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { FeatureDef } from "@/lib/types";

/** One of the predefined solutions (business packs), as `GET /v1/solutions` lists it. */
export interface Solution {
  id: string;
  name: string;
  nameTa: string;
  tagline: string;
  appId: string;
  /** Where the trade picker lists it (food, retail, health, services, education, auto, building, general). */
  group: string;
  preset: { id: string; name: string; primary: string; background: string | null; fontHeading: string } | null;
  categories: string[];
  shops: number;
  /** The solution's feature preset: how many of its app's optional features are on, and whether it was edited. */
  features?: { on: number; switchable: number; customised: boolean };
}

/** `GET /v1/solutions/:id/preset`: which of the app's optional features a new shop of this solution starts with. */
export interface SolutionPreset {
  id: string;
  appId: string;
  switchable: (FeatureDef & { on: boolean; byDefault: boolean })[];
  included: FeatureDef[];
  on: string[];
  customised: boolean;
}

export interface TenantSolution {
  tenantId: string;
  appId: string | null;
  /** Chosen by the shop (null = never chosen). */
  businessType: string | null;
  /** What the shop runs as: the chosen one, else its app's default. */
  effective: string;
}

/** One line of `GET /v1/solutions/demand` ("Not covered"): a trade owners typed that has no pack of its own. */
export interface DemandItem {
  /** Lower-cased, trimmed. */
  label: string;
  shops: number;
  /** The apps of the shops that typed it, most common first. */
  appIds: string[];
  /** The latest shop that typed it (ISO). */
  lastAt: string | null;
}

const sk = {
  all: ["platform", "solutions"] as const,
  demand: ["platform", "solutions", "demand"] as const,
  preset: (id: string) => ["platform", "solutions", "preset", id] as const,
  tenants: (ids: string[]) => ["platform", "solutions", "tenants", ids.join(",")] as const,
};

export function useSolutions() {
  return useQuery({ queryKey: sk.all, queryFn: () => api.get<{ items: Solution[] }>("/solutions", undefined, { tenant: null }).then((r) => r.items), staleTime: 60_000 });
}

/** Typed trades on shops running a general pack, counted: what to build next. */
export function useDemand() {
  return useQuery({ queryKey: sk.demand, queryFn: () => api.get<{ items: DemandItem[]; total: number }>("/solutions/demand", undefined, { tenant: null }), staleTime: 60_000 });
}

export function useTenantSolutions(ids: string[]) {
  return useQuery({
    queryKey: sk.tenants(ids),
    queryFn: () => api.get<{ items: TenantSolution[] }>("/solutions/tenants", { ids: ids.join(",") }, { tenant: null }).then((r) => new Map(r.items.map((x) => [x.tenantId, x]))),
    enabled: ids.length > 0,
  });
}

export function useApplySolution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, ...body }: { tenantId: string; businessType: string; theme: boolean; content: boolean; switchApp: boolean }) =>
      api.put<TenantSolution>(`/solutions/tenants/${tenantId}`, body, { tenant: null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: sk.all });
      void qc.invalidateQueries({ queryKey: ["platform", "tenants"] });
    },
  });
}

export function useSolutionPreset(id: string | null) {
  return useQuery({
    queryKey: sk.preset(id ?? ""),
    queryFn: () => api.get<SolutionPreset>(`/solutions/${id}/preset`, undefined, { tenant: null }),
    enabled: !!id,
  });
}

/** Saves a preset (`features: null` resets it to the default); `applyToShops` also applies it to the solution's shops now. */
export function useSaveSolutionPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; features: string[] | null; applyToShops: boolean }) =>
      api.put<SolutionPreset & { applied: number }>(`/solutions/${id}/preset`, body, { tenant: null }),
    onSuccess: (r) => {
      qc.setQueryData(sk.preset(r.id), r);
      void qc.invalidateQueries({ queryKey: sk.all });
    },
  });
}
