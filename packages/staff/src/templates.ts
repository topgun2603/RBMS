import { CUSTOM_ROLE_PREFIX, FULL_ACCESS_ROLES, type PermissionDef } from "@srirealtime/core";

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  permissions: string[];
}

/** Key of the built-in role that applies to staff without any custom role. */
export const DEFAULT_ROLE_KEY = "default";

/** Role keys: lowercase, 2–32 chars, used as `role:<key>` in memberships. */
export const ROLE_KEY_RE = /^[a-z][a-z0-9-]{1,31}$/;

/** A permission key or pattern: segments of [a-z][a-z0-9-]* or `*`, e.g. "invoices.cancel", "orders.*", "*.view", "*". */
export const PERMISSION_PATTERN_RE = /^(\*|[a-z][a-z0-9-]*)(\.(\*|[a-z][a-z0-9-]*))*$/;

/**
 * Built-in role templates, seeded lazily per tenant (`builtin = true`: editable, not deletable).
 * Keys follow the batch-1 permission list; invoices/inventory/payments routes are annotated in the integration step.
 */
export const BUILTIN_ROLES: readonly RoleTemplate[] = [
  {
    key: DEFAULT_ROLE_KEY,
    name: "Staff (default)",
    description:
      "Applies to staff members without a custom role: view everything, create bills (with discounts), receive payments, add customers and use the credit book.",
    // Everything staff could do before roles existed, except cancelling bills and managing stock, catalogue or settings.
    permissions: ["*.view", "invoices.create", "invoices.discount", "payments.receive", "customers.create", "invoices.credit-book"],
  },
  {
    key: "manager",
    name: "Manager",
    description: "Runs the shop day to day: everything except settings and team management.",
    permissions: [
      "*.view",
      "catalogue.*",
      "orders.*",
      "coupons.*",
      "inventory.*",
      "invoices.*",
      "payments.*",
      "customers.*",
      "reports.*",
      "expenses.*",
      "documents.*",
      "importexport.*",
      "audit.view",
    ],
  },
  {
    key: "cashier",
    name: "Cashier",
    description: "Creates bills, receives payments and adds customers.",
    permissions: ["invoices.create", "payments.receive", "customers.create", "catalogue.view"],
  },
  {
    key: "accountant",
    name: "Accountant",
    description: "Reports, credit book, purchases and expenses.",
    permissions: ["reports.view", "invoices.credit-book", "inventory.purchases", "expenses.manage"],
  },
  {
    key: "delivery",
    name: "Delivery",
    description: "Sees orders and marks them shipped or delivered.",
    permissions: ["orders.view", "orders.ship", "orders.deliver"],
  },
];

export const BUILTIN_ROLE_KEYS: readonly string[] = BUILTIN_ROLES.map((r) => r.key);

/** Permissions of the staff module. */
export const STAFF_PERMISSIONS: PermissionDef[] = [
  { key: "staff.manage", module: "staff", label: "Manage team and roles", description: "Invite members, assign roles and edit custom roles." },
];

const LEVELS = ["owner", "admin", "staff", "member"] as const;
export type Level = (typeof LEVELS)[number];

/** The member's base level (strongest when legacy data holds several), or null. */
export const levelOf = (roles: readonly string[]): Level | null => LEVELS.find((l) => roles.includes(l)) ?? null;

/** `role:<key>` entries → keys. */
export const roleKeysOf = (roles: readonly string[]): string[] =>
  roles.filter((r) => r.startsWith(CUSTOM_ROLE_PREFIX)).map((r) => r.slice(CUSTOM_ROLE_PREFIX.length));

/** Membership roles for a level plus custom role keys. */
export const membershipRoles = (level: Level, roleKeys: readonly string[]): string[] => [
  level,
  ...[...new Set(roleKeys)].sort().map((k) => `${CUSTOM_ROLE_PREFIX}${k}`),
];

/**
 * Pure permission resolution:
 * - owner/admin → ["*"];
 * - staff → union of their custom roles' permissions; when none of them exists (or none assigned) → the tenant's
 *   default role (built-in `default`, which owners can edit);
 * - member or no base level → [].
 * `roleMap` = tenant role key → permissions (missing built-ins fall back to the templates).
 */
export function resolvePermissions(roles: readonly string[], roleMap: ReadonlyMap<string, readonly string[]>): string[] {
  const level = levelOf(roles);
  if (level && FULL_ACCESS_ROLES.includes(level)) return ["*"];
  if (level !== "staff") return [];
  const lookup = (key: string) => roleMap.get(key) ?? BUILTIN_ROLES.find((r) => r.key === key)?.permissions;
  const out = new Set<string>();
  let found = false;
  for (const key of roleKeysOf(roles)) {
    const perms = lookup(key);
    if (!perms) continue;
    found = true;
    for (const p of perms) out.add(p);
  }
  if (!found) for (const p of lookup(DEFAULT_ROLE_KEY) ?? []) out.add(p);
  if (out.has("*")) return ["*"];
  return [...out].sort();
}

/** The registry grouped by module, modules and keys sorted. */
export function groupPermissions(defs: readonly PermissionDef[]): { module: string; permissions: PermissionDef[] }[] {
  const byModule = new Map<string, Map<string, PermissionDef>>();
  for (const d of defs) {
    const m = byModule.get(d.module) ?? new Map<string, PermissionDef>();
    if (!m.has(d.key)) m.set(d.key, d);
    byModule.set(d.module, m);
  }
  return [...byModule.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, m]) => ({ module, permissions: [...m.values()].sort((a, b) => a.key.localeCompare(b.key)) }));
}
