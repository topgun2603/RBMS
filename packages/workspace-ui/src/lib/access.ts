"use client";

import { useOptionalSession } from "@srirealtime/web";
import { permissionsAllow } from "./permissions";

export const PERMISSIONS = {
  staff: "staff.manage",
  audit: "audit.view",
  importexport: "importexport.run",
  subscriptions: "subscriptions.manage",
} as const;

/**
 * Whether the signed-in member holds `key`. Owners, admins and super-admins always do; staff need it in the
 * permissions `/auth/me` returns. `explicit` ignores broad patterns such as the staff default's `*.view` (the audit log
 * is owner/admin unless a role grants `audit.view` itself). Without a permission list the server decides (its 403 is
 * shown as a friendly panel).
 */
export function useHasPermission(key: string, opts: { explicit?: boolean } = {}): boolean {
  const session = useOptionalSession();
  if (!session) return false;
  if (session.canManage) return true;
  const perms = (session.me as { permissions?: string[] }).permissions;
  if (!Array.isArray(perms)) return true;
  if (opts.explicit) {
    const [module] = key.split(".");
    return perms.some((p) => p === "*" || p === key || p === `${module}.*`);
  }
  return permissionsAllow(perms, key);
}

/** The signed-in user's id (null outside the signed-in area). */
export function useMyUserId(): string | null {
  return useOptionalSession()?.me.user.id ?? null;
}
