/** Pure entitlement logic: plan + override → modules, limits and features. */

/** Modules every tenant gets regardless of plan. */
export const CORE_MODULES: readonly string[] = [
  "auth",
  "tenancy",
  "branding",
  "plans",
  "notify",
  "uploads",
  "i18n",
  "ui",
  "admin",
  "settings",
  "jobs",
  "consent",
  // Plan & billing (docs/batch5.md): every plan, the free one included, must reach the page that upgrades it.
  "subscriptions",
];

export const UNLIMITED = -1;
export const LIFETIME = "lifetime";

export interface PlanLike {
  id: string;
  modules: string[];
  limits: Record<string, number>;
  features: Record<string, boolean>;
}

export interface OverrideLike {
  addModules: string[];
  removeModules: string[];
  limits: Record<string, number>;
  features: Record<string, boolean>;
}

export interface Entitlements {
  planId: string | null;
  /** Sorted, de-duplicated module ids (core modules included). */
  modules: string[];
  limits: Record<string, number>;
  features: Record<string, boolean>;
  /** Active add-ons counted in (limit and feature kinds), with their quantity. */
  addons?: { id: string; quantity: number }[];
  /** What add-ons added to each finite limit (absent keys: nothing). */
  addonLimits?: Record<string, number>;
}

/** An active add-on of a tenant, joined with its catalogue entry. */
export interface AddonGrant {
  id: string;
  kind: "limit" | "feature" | "credits";
  quantity: number;
  /** Per unit (limit kind). */
  limits: Record<string, number>;
  /** Unlocked keys (feature kind). */
  modules: string[];
}

/**
 * Whether an app profile's grant list offers `key` (a feature key, a bare module id or `module.*`): the key itself or
 * its module's wildcard; a wildcard only through the same wildcard. `null` (no profile) offers everything.
 */
export function offeredBy(list: readonly string[] | null | undefined, key: string): boolean {
  if (!list) return true;
  if (list.includes(key)) return true;
  const module = key.split(".")[0]!;
  return !key.endsWith(".*") && list.includes(`${module}.*`);
}

/**
 * Core modules are always on. Plan modules plus override `addModules` plus feature add-ons (only keys `offered` by the
 * shop's app), minus `removeModules` (which can't remove core modules; a manual block wins over an add-on).
 * Override limits/features replace the plan's per key; limit add-ons then add `per unit × quantity` on top (an
 * unlimited limit stays unlimited). Credits are balances, not limits (see PlansService.consume).
 */
export function resolveEntitlements(
  plan: PlanLike | null,
  override: OverrideLike | null,
  coreModules: readonly string[] = CORE_MODULES,
  extra: { addons?: AddonGrant[]; offered?: (key: string) => boolean } = {},
): Entitlements {
  const core = new Set(coreModules);
  const offered = extra.offered ?? (() => true);
  const active = (extra.addons ?? []).filter((a) => a.kind !== "credits" && a.quantity > 0);
  const addonModules = active.filter((a) => a.kind === "feature").flatMap((a) => a.modules.filter(offered));
  const modules = new Set<string>([...core, ...(plan?.modules ?? []), ...(override?.addModules ?? []), ...addonModules]);
  for (const m of override?.removeModules ?? []) if (!core.has(m)) modules.delete(m);
  const limits: Record<string, number> = { ...(plan?.limits ?? {}), ...(override?.limits ?? {}) };
  const addonLimits: Record<string, number> = {};
  for (const a of active) {
    if (a.kind !== "limit") continue;
    for (const [key, perUnit] of Object.entries(a.limits)) {
      if (!Number.isFinite(perUnit) || perUnit <= 0) continue;
      const base = limits[key];
      if (base !== undefined && base < 0) continue;
      const add = Math.floor(perUnit) * a.quantity;
      limits[key] = Math.max(0, Math.floor(base ?? 0)) + add;
      addonLimits[key] = (addonLimits[key] ?? 0) + add;
    }
  }
  const out: Entitlements = {
    planId: plan?.id ?? null,
    modules: [...modules].sort(),
    limits,
    features: { ...(plan?.features ?? {}), ...(override?.features ?? {}) },
  };
  if (active.length) {
    out.addons = active.map((a) => ({ id: a.id, quantity: a.quantity }));
    out.addonLimits = addonLimits;
  }
  return out;
}

export const hasModuleIn = (e: Entitlements, moduleId: string) => e.modules.includes(moduleId);

/** The limit for `key`: -1 unlimited, a missing key means 0 (not allowed). */
export function limitIn(e: Entitlements, key: string): number {
  const v = e.limits[key];
  if (v === undefined || !Number.isFinite(v)) return 0;
  return v < 0 ? UNLIMITED : Math.floor(v);
}

export const isUnlimited = (limit: number) => limit < 0;

export const isMonthlyKey = (key: string) => key.endsWith("_per_month");

/** India Standard Time, UTC+05:30 — monthly quotas roll over at IST midnight. */
export const IST_OFFSET_MINUTES = 330;

/** "2026-10" for `_per_month` keys (in the given UTC offset, IST by default), "lifetime" otherwise. */
export function periodFor(key: string, now: Date = new Date(), tzOffsetMinutes = IST_OFFSET_MINUTES): string {
  if (!isMonthlyKey(key)) return LIFETIME;
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Whether using `amount` more would stay within `limit` given `used`. */
export function withinLimit(limit: number, used: number, amount: number): boolean {
  return isUnlimited(limit) || used + amount <= limit;
}
