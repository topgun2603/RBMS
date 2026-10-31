import { badRequest, BASE_ROLES, CUSTOM_ROLE_PREFIX, type BaseRole } from "@rbms/core";

/** `role:<key>` entries for custom roles (keys are defined by the staff module). */
export const CUSTOM_ROLE_RE = /^role:[a-z][a-z0-9-]{1,31}$/;

/** Highest first: when several base levels are sent, the strongest one is kept. */
const LEVEL_ORDER: readonly BaseRole[] = ["owner", "admin", "staff", "member"];

export const isBaseRole = (r: string): r is BaseRole => (BASE_ROLES as readonly string[]).includes(r);
export const isCustomRole = (r: string) => CUSTOM_ROLE_RE.test(r);

/** The member's base level (the strongest when legacy data holds several); null when none. */
export function baseLevel(roles: readonly string[]): BaseRole | null {
  return LEVEL_ORDER.find((l) => roles.includes(l)) ?? null;
}

/** Custom role keys without the `role:` prefix, e.g. ["cashier"]. */
export const customRoleKeys = (roles: readonly string[]) =>
  roles.filter(isCustomRole).map((r) => r.slice(CUSTOM_ROLE_PREFIX.length));

/**
 * Validates and normalises membership roles for add/update: exactly one base level (owner|admin|staff|member) plus
 * optional `role:<key>` entries. Several base levels (older admin UIs send e.g. ["admin", "staff"]) collapse to the
 * strongest one. Anything else is rejected with 400. Result: `[base, ...sorted unique custom roles]`.
 */
export function normalizeMemberRoles(roles: readonly string[]): string[] {
  const cleaned = roles.map((r) => r.trim());
  const invalid = cleaned.filter((r) => !isBaseRole(r) && !isCustomRole(r));
  if (invalid.length) throw badRequest(`Invalid role: ${invalid[0]}`, { roles: invalid });
  const base = baseLevel(cleaned);
  if (!base) throw badRequest("A member needs one base role: owner, admin, staff or member");
  const custom = [...new Set(cleaned.filter(isCustomRole))].sort();
  if (custom.length > 20) throw badRequest("Too many roles");
  return [base, ...custom];
}
