import { isSuperAdmin, requireTenant, requireUser, type RequestContext, type UserRef } from "./context";
import { permissionDenied } from "./errors";

/**
 * A permission a module declares, e.g. `{ key: "invoices.cancel", module: "invoices", label: "Cancel bills" }`.
 * Keys are `<module>.<action>` (more dot segments allowed). The staff module lists them to build custom roles.
 */
export interface PermissionDef {
  /** e.g. "invoices.cancel" */
  key: string;
  /** e.g. "invoices" */
  module: string;
  /** English label, e.g. "Cancel bills". */
  label: string;
  description: string;
}

/** Base membership levels. Every member holds exactly one (see tenancy's role validation). */
export const BASE_ROLES = ["owner", "admin", "staff", "member"] as const;
export type BaseRole = (typeof BASE_ROLES)[number];

/** Base levels that hold every permission in their tenant. */
export const FULL_ACCESS_ROLES: readonly string[] = ["owner", "admin"];

/** Prefix of custom role entries in `tenant_memberships.roles`, e.g. "role:cashier". */
export const CUSTOM_ROLE_PREFIX = "role:";

/**
 * Does the granted pattern cover `key`?
 * - `*` matches everything;
 * - a `*` segment matches exactly one segment (`*.view` matches `reports.view`), except as the last segment where it
 *   matches one or more (`invoices.*` matches `invoices.cancel` and `invoices.reports.view`);
 * - `module.*` also matches the bare `module` key (same as feature grants).
 */
export function permissionMatches(granted: string, key: string): boolean {
  if (granted === "*" || granted === key) return true;
  if (!granted.includes("*")) return false;
  const g = granted.split(".");
  const k = key.split(".");
  for (let i = 0; i < g.length; i++) {
    const seg = g[i]!;
    const last = i === g.length - 1;
    if (seg === "*" && last) return k.length >= i; // `module.*` also matches `module` itself
    if (i >= k.length) return false;
    if (seg !== "*" && seg !== k[i]) return false;
  }
  return g.length === k.length;
}

/** True when any granted pattern covers `key`. */
export const permissionsAllow = (granted: readonly string[] | undefined, key: string): boolean =>
  (granted ?? []).some((g) => permissionMatches(g, key));

const hasFullAccess = (user: UserRef) => user.tenantRoles.some((r) => FULL_ACCESS_ROLES.includes(r));

/**
 * True when the signed-in user holds every key: super-admins, owners and admins always do; others need a
 * matching entry in `user.permissions` (filled by auth). False without a user, or without a tenant (non super-admin).
 */
export function hasPermission(ctx: RequestContext, ...keys: string[]): boolean {
  const user = ctx.user;
  if (!user) return false;
  if (isSuperAdmin(ctx)) return true;
  if (!ctx.tenant) return false;
  if (hasFullAccess(user)) return true;
  return keys.every((k) => permissionsAllow(user.permissions, k));
}

/**
 * Throws unless the user holds every key (see `hasPermission`): 401 without a user, 403 `forbidden` without a tenant,
 * 403 `permission_denied` `{ permission }` naming the first missing key.
 */
export function requirePermission(ctx: RequestContext, ...keys: string[]): UserRef {
  const user = requireUser(ctx);
  if (isSuperAdmin(ctx)) return user;
  requireTenant(ctx);
  if (hasFullAccess(user)) return user;
  const missing = keys.find((k) => !permissionsAllow(user.permissions, k));
  if (missing) throw permissionDenied(missing);
  return user;
}
