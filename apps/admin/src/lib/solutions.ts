"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** One of the predefined solutions (business packs), as `GET /v1/solutions` lists it. */
export interface Solution {
  id: string;
  name: string;
  nameTa: string;
  tagline: string;
  appId: string;
  preset: { id: string; name: string; primary: string; background: string | null; fontHeading: string } | null;
  categories: string[];
  shops: number;
}

export interface TenantSolution {
  tenantId: string;
  appId: string | null;
  /** Chosen by the shop (null = never chosen). */
  businessType: string | null;
  /** What the shop runs as: the chosen one, else its app's default. */
  effective: string;
}

const sk = { all: ["platform", "solutions"] as const, tenants: (ids: string[]) => ["platform", "solutions", "tenants", ids.join(",")] as const };

export function useSolutions() {
  return useQuery({ queryKey: sk.all, queryFn: () => api.get<{ items: Solution[] }>("/solutions", undefined, { tenant: null }).then((r) => r.items), staleTime: 60_000 });
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
