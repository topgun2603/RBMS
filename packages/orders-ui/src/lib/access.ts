"use client";

import * as React from "react";
import { useOptionalSession } from "@srirealtime/web";

/** Permission keys the orders UI checks (declared by @srirealtime/orders, coupons and the settings host). */
export const PERMS = {
  manage: "orders.manage",
  cancel: "orders.cancel",
  refund: "orders.refund",
  ship: "orders.ship",
  deliver: "orders.deliver",
  coupons: "coupons.manage",
  settings: "settings.manage",
} as const;

/**
 * Same matching as @srirealtime/core's permissionMatches: `*` is everything, a trailing `.*` covers the module and every
 * key below it, a middle `*` one segment.
 */
export function permissionMatches(granted: string, key: string): boolean {
  if (granted === "*" || granted === key) return true;
  if (!granted.includes("*")) return false;
  const g = granted.split(".");
  const k = key.split(".");
  for (let i = 0; i < g.length; i++) {
    const seg = g[i]!;
    const last = i === g.length - 1;
    if (seg === "*" && last) return k.length >= i;
    if (i >= k.length) return false;
    if (seg !== "*" && seg !== k[i]) return false;
  }
  return g.length === k.length;
}

/**
 * Whether a member holds any of `keys`. Owners/admins (and super-admins) always do. A missing permission list (an API
 * without the staff module) allows staff too: the server's 403 is the last word and is shown as a toast.
 */
export function allows(opts: { canManage: boolean; permissions: readonly string[] | undefined | null }, keys: readonly string[]): boolean {
  if (opts.canManage) return true;
  if (!Array.isArray(opts.permissions)) return true;
  return keys.some((k) => opts.permissions!.some((g) => permissionMatches(g, k)));
}

/** `can("orders.cancel")` / `can(["orders.manage", "orders.ship"])` for the signed-in member. */
export function usePermissions() {
  const session = useOptionalSession();
  return React.useMemo(() => {
    const canManage = !!session?.canManage;
    const permissions = (session?.me as { permissions?: string[] } | undefined)?.permissions;
    const can = (keys: string | readonly string[]) => (session ? allows({ canManage, permissions }, typeof keys === "string" ? [keys] : keys) : false);
    return { can, isManager: canManage };
  }, [session]);
}
