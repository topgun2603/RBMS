"use client";

import { useOptionalSession } from "@rbms/web";

/** `*`, exact keys, `module.*` and `*.<action>` patterns (same rules as @rbms/core's permissionMatches). */
export function permissionMatches(granted: string, key: string): boolean {
  if (granted === "*" || granted === key) return true;
  if (!granted.includes("*")) return false;
  const g = granted.split(".");
  const k = key.split(".");
  for (let i = 0; i < g.length; i++) {
    const seg = g[i]!;
    if (seg === "*" && i === g.length - 1) return k.length >= i;
    if (i >= k.length) return false;
    if (seg !== "*" && seg !== k[i]) return false;
  }
  return g.length === k.length;
}

/**
 * Whether the signed-in member holds a permission. Owners, admins and super-admins always do; staff need it in the
 * permissions `/auth/me` returns. With no permission list at all the server's 403 is the last word.
 */
export function useHasPermission(key: string): boolean {
  const session = useOptionalSession();
  if (!session) return false;
  if (session.canManage) return true;
  const perms = (session.me as { permissions?: string[] }).permissions;
  if (!Array.isArray(perms)) return true;
  return perms.some((p) => permissionMatches(p, key));
}

export const EXPENSES_PERMISSION = "expenses.manage";
export const QUOTATIONS_VIEW_PERMISSION = "quotations.view";
export const QUOTATIONS_MANAGE_PERMISSION = "quotations.manage";
