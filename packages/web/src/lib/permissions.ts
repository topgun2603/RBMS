/**
 * Client-side permission checks for the shell (Gated.permission) and pages. Pure, unit-tested in permissions.test.ts.
 * The API is the authority (`requirePermission` in @srirealtime/core); this only hides what would be refused anyway.
 */

/** `roles` undefined or empty = everyone; else the user needs at least one of them. */
export const roleAllows = (userRoles: readonly string[], roles?: readonly string[]) =>
  !roles || roles.length === 0 || userRoles.some((r) => roles.includes(r));

/** One permission key, or several of which any one is enough. */
export type PermissionReq = string | readonly string[];

/**
 * Does the granted pattern cover `key`? Mirrors @srirealtime/core's `permissionMatches` exactly (the kit can't depend
 * on core): `*` matches everything; a `*` segment matches exactly one segment (`*.view` → `reports.view`), except as the
 * last segment where it matches one or more (`orders.*` → `orders.ship`, `orders.returns.approve`); `module.*` also
 * matches the bare `module` key.
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
export const permissionsAllow = (granted: readonly string[] | undefined | null, key: string): boolean =>
  (granted ?? []).some((g) => permissionMatches(g, key));

export const toPermissionKeys = (req: PermissionReq | undefined): string[] =>
  req === undefined ? [] : typeof req === "string" ? [req] : [...req];

export interface PermissionHolder {
  /** Owner/admin of the shop, or a platform super-admin: holds every permission (the API agrees). */
  fullAccess: boolean;
  /** `permissions` from GET /auth/me. null/undefined = the API didn't send a list (no staff module): allow. */
  permissions: readonly string[] | null | undefined;
}

/**
 * Whether the member may see something that requires `req`. No requirement (undefined or []) → yes. An array is
 * **any-of**: holding one of the keys is enough. Full-access members always pass; a missing permission list fails open
 * (the server's 403 is the last word).
 */
export function permissionAllows(holder: PermissionHolder, req: PermissionReq | undefined, opts: { explicit?: boolean } = {}): boolean {
  const keys = toPermissionKeys(req);
  if (keys.length === 0 || holder.fullAccess) return true;
  if (!Array.isArray(holder.permissions)) return true;
  const granted = holder.permissions;
  return keys.some((k) => (opts.explicit ? explicitlyGranted(granted, k) : permissionsAllow(granted, k)));
}

/**
 * Explicit grant: the key itself, `<module>.*` or `*`; broad cross-module patterns such as the staff default's
 * `*.view` don't count. Mirrors the API checks that refuse those (e.g. the audit log's `audit.view`).
 */
export function explicitlyGranted(granted: readonly string[], key: string): boolean {
  const [module] = key.split(".");
  return granted.some((g) => g === "*" || g === key || g === `${module}.*`);
}
