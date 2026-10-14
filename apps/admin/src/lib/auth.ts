"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { api } from "./api";
import { setTenantSlug, setToken, useTenantSlug, useToken } from "./session";
import type { MeResponse, MyTenant, User } from "./types";

export const meQueryKey = ["me"] as const;
export const myTenantsQueryKey = ["tenancy", "mine"] as const;

export function useMe() {
  const token = useToken();
  const tenant = useTenantSlug();
  return useQuery({
    queryKey: [...meQueryKey, tenant],
    queryFn: () => api<MeResponse>("/auth/me"),
    enabled: !!token,
    staleTime: 60_000,
  });
}

export function useMyTenants(enabled = true) {
  const token = useToken();
  return useQuery({
    queryKey: myTenantsQueryKey,
    queryFn: () => api<{ items: MyTenant[] }>("/tenancy/mine", { tenant: null }).then((r) => r.items),
    enabled: !!token && enabled,
    staleTime: 60_000,
  });
}

export const isSuperAdmin = (user?: Pick<User, "platformRoles"> | null) => !!user?.platformRoles?.includes("superadmin");

export const canManageTenant = (roles?: string[]) => !!roles?.some((r) => r === "owner" || r === "admin");

/** Switches the active workspace and refetches everything under the new x-tenant. */
export function useSwitchTenant() {
  const qc = useQueryClient();
  return useCallback(
    (slug: string | null) => {
      setTenantSlug(slug);
      // Drop workspace-scoped data, but keep the workspace list: it doesn't depend on the
      // current workspace, and resetting it makes the picker flash empty mid-click.
      void qc.resetQueries({
        predicate: (q) => !(q.queryKey[0] === myTenantsQueryKey[0] && q.queryKey[1] === myTenantsQueryKey[1]),
      });
    },
    [qc],
  );
}

export function useSignOut() {
  const qc = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setToken(null);
    setTenantSlug(null);
    qc.clear();
    router.replace("/login");
  }, [qc, router]);
}

/** Best display name for a user-ish object. */
export function displayName(u?: { name?: string | null; email?: string | null; phone?: string | null } | null, fallback = "—") {
  return u?.name || u?.email || u?.phone || fallback;
}
