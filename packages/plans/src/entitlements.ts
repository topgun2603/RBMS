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
}

/**
 * Core modules are always on. Plan modules plus override `addModules`, minus `removeModules`
 * (which can't remove core modules). Override limits/features replace the plan's per key.
 */
export function resolveEntitlements(
  plan: PlanLike | null,
  override: OverrideLike | null,
  coreModules: readonly string[] = CORE_MODULES,
): Entitlements {
  const core = new Set(coreModules);
  const modules = new Set<string>([...core, ...(plan?.modules ?? []), ...(override?.addModules ?? [])]);
  for (const m of override?.removeModules ?? []) if (!core.has(m)) modules.delete(m);
  return {
    planId: plan?.id ?? null,
    modules: [...modules].sort(),
    limits: { ...(plan?.limits ?? {}), ...(override?.limits ?? {}) },
    features: { ...(plan?.features ?? {}), ...(override?.features ?? {}) },
  };
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
