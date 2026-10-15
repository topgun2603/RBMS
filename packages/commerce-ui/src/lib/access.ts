"use client";

import { useOptionalSession } from "@srirealtime/web";

/** Permission that covers prices, costs and every catalogue write (declared by @srirealtime/catalogue). */
export const MANAGE_PERMISSION = "catalogue.manage";

/**
 * Whether the signed-in member may manage the catalogue. Owners, admins and super-admins always may; staff need
 * `catalogue.manage` in the permissions `/auth/me` returns. When the API sends no permission list at all, staff are
 * allowed and the server's 403 (shown as a friendly toast) is the last word.
 */
export function useCanManageCatalogue(): boolean {
  const session = useOptionalSession();
  if (!session) return false;
  if (session.canManage) return true;
  const perms = (session.me as { permissions?: string[] }).permissions;
  if (!Array.isArray(perms)) return true;
  return perms.includes("*") || perms.includes(MANAGE_PERMISSION) || perms.includes("catalogue.*");
}
