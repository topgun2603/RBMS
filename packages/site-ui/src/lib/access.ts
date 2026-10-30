"use client";

import { permissionsAllow, useOptionalSession } from "@rbms/web";

/** Permissions this module checks (declared by @rbms/cms, reviews, staff and the settings host). */
export const PERMS = {
  cms: "cms.manage",
  reviews: "reviews.manage",
  settings: "settings.manage",
  reports: "reports.view",
} as const;

/**
 * Pure check with the kit's `permissionsAllow` (same wildcard rules as the server: `*`, the exact key, `cms.*`,
 * `*.view` → `reports.view`). A missing list (older API) defers to the server.
 */
export function permits(perms: readonly string[] | undefined, key: string): boolean {
  if (!Array.isArray(perms)) return true;
  return permissionsAllow(perms, key);
}

/**
 * Whether the signed-in member holds `key`. Owners, admins and super-admins always do; staff need it in the
 * permissions `/auth/me` returns. The server's 403 stays the last word (shown as a friendly message).
 */
export function useCan(key: string): boolean {
  const session = useOptionalSession();
  if (!session) return false;
  if (session.canManage) return true;
  return permits((session.me as { permissions?: string[] }).permissions, key);
}

/** Owner/admin: shop settings (`PUT /settings/*\/tenant`) and domains need the role, not only a permission. */
export function useIsManager(): boolean {
  return useOptionalSession()?.canManage ?? false;
}
