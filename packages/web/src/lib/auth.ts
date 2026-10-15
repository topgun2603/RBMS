"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { api } from "./api";
import { setToken, useToken } from "./session";
import type { MeResponse, User } from "./types";

export const meQueryKey = ["me"] as const;

export function useMe() {
  const token = useToken();
  return useQuery({
    queryKey: meQueryKey,
    queryFn: () => api<MeResponse>("/auth/me"),
    enabled: !!token,
    staleTime: 60_000,
  });
}

/** Shop roles that may use a shop app by default (createWebApp `roles` overrides it). */
export const SHOP_ROLES = ["owner", "admin", "staff"] as const;
export const MANAGER_ROLES = ["owner", "admin"] as const;

export const isSuperAdmin = (user?: Pick<User, "platformRoles"> | null) => !!user?.platformRoles?.includes("superadmin");

/** Effective shop roles: a platform super-admin acts as an owner everywhere. */
export function effectiveRoles(me?: MeResponse | null): string[] {
  if (!me) return [];
  return isSuperAdmin(me.user) ? [...new Set(["owner", ...me.tenantRoles])] : me.tenantRoles;
}

/** Signed-in member of this shop with one of `roles` (or a platform super-admin). */
export const hasShopAccess = (me?: MeResponse | null, roles: readonly string[] = SHOP_ROLES) =>
  !!me && effectiveRoles(me).some((r) => roles.includes(r));

/** Owners/admins manage the shop (business profile, feature switches); staff only read. */
export const canManageShop = (me?: MeResponse | null) => hasShopAccess(me, MANAGER_ROLES);

export { roleAllows } from "./permissions";

export function useSignOut(loginPath = "/login") {
  const qc = useQueryClient();
  const router = useRouter();
  return useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setToken(null);
    qc.clear();
    router.replace(loginPath);
  }, [qc, router, loginPath]);
}

/** Best display name for a user-ish object. */
export function displayName(u?: { name?: string | null; email?: string | null; phone?: string | null } | null, fallback = "—") {
  return u?.name || u?.email || u?.phone || fallback;
}
