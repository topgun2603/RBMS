/** Pure feature resolution (no database): registry + app profile + plan + shop switches → per-feature state. */
import { featureDefaultOn, type FeatureDef } from "@rbms/core";

export type Reason = "app" | "plan" | "shop" | "dependency";

export interface FeatureState {
  key: string;
  module: string;
  label: string;
  description: string;
  dependsOn: string[];
  shopToggle: boolean;
  enabled: boolean;
  /** Why it's off: the first failing level, in the order app → plan → dependency → shop. Null when enabled. */
  reason: Reason | null;
  /** App, plan and dependencies allow it (the feature's own shop switch aside). */
  available: boolean;
  /** The owner's switch; null = never touched (the feature's `defaultOn` applies). */
  shopEnabled: boolean | null;
}

export interface PlanGrants {
  /** Module ids and feature keys from the plan (`plans.modules`). */
  modules: string[];
  /** `features[key] === false` denies that feature even when `modules` grants it. */
  features: Record<string, boolean>;
}

export interface ResolveInput {
  registry: readonly FeatureDef[];
  /** The app profile's grants; null = no profile, so the app level allows everything registered. */
  app: readonly string[] | null;
  plan: PlanGrants;
  /** The shop owner's switches by feature key (only `shopToggle` features are read). */
  toggles: Readonly<Record<string, boolean>>;
  /** The shop's app, for features on by default only in some apps (`defaultOnApps`). */
  appId?: string | null;
}

export interface Resolution {
  features: FeatureState[];
  /** Keys of enabled features, in registry order. */
  enabled: string[];
}

/** `"inventory.*"`: grants every feature of the `inventory` module. */
export const wildcard = (module: string) => `${module}.*`;

/**
 * Whether a grant list (app profile or plan modules) grants `def`: the list names the feature key itself, or the
 * module wildcard `module.*`. A bare module id is just the module's base feature key (`inventory` = stock tracking
 * only), so `["inventory"]` grants stock without `inventory.purchases`.
 */
export function grants(list: readonly string[], def: Pick<FeatureDef, "key" | "module">): boolean {
  return list.includes(def.key) || list.includes(wildcard(def.module));
}

const planAllows = (plan: PlanGrants, def: FeatureDef) => grants(plan.modules, def) && plan.features[def.key] !== false;

/** The shop owner's effective switch for a feature (non-toggle features are always on). */
export function shopAllows(def: FeatureDef, toggles: Readonly<Record<string, boolean>>, appId: string | null = null): boolean {
  if (!def.shopToggle) return true;
  return toggles[def.key] ?? featureDefaultOn(def, appId);
}

/**
 * Resolves every registered feature. A dependency that is unregistered, disabled for any reason, or part of a cycle
 * makes the dependent feature fail with reason "dependency".
 */
export function resolveFeatures(input: ResolveInput): Resolution {
  const byKey = new Map(input.registry.map((d) => [d.key, d]));
  const memo = new Map<string, { enabled: boolean; reason: Reason | null; available: boolean }>();
  const visiting = new Set<string>();

  const evaluate = (key: string): { enabled: boolean; reason: Reason | null; available: boolean } => {
    const cached = memo.get(key);
    if (cached) return cached;
    const def = byKey.get(key);
    // Unregistered: off. Reported as "app" (no mounted module offers it).
    if (!def) return { enabled: false, reason: "app", available: false };
    // A cycle: this key is already being evaluated further up the chain.
    if (visiting.has(key)) return { enabled: false, reason: "dependency", available: false };

    visiting.add(key);
    let reason: Reason | null = null;
    if (input.app && !grants(input.app, def)) reason = "app";
    else if (!planAllows(input.plan, def)) reason = "plan";
    else if ((def.dependsOn ?? []).some((d) => !evaluate(d).enabled)) reason = "dependency";
    visiting.delete(key);

    const available = reason === null;
    if (available && !shopAllows(def, input.toggles, input.appId ?? null)) reason = "shop";
    const result = { enabled: reason === null, reason, available };
    memo.set(key, result);
    return result;
  };

  const features = input.registry.map((def): FeatureState => {
    const r = evaluate(def.key);
    return {
      key: def.key,
      module: def.module,
      label: def.label,
      description: def.description,
      dependsOn: def.dependsOn ?? [],
      shopToggle: def.shopToggle ?? false,
      enabled: r.enabled,
      reason: r.reason,
      available: r.available,
      shopEnabled: def.shopToggle ? (input.toggles[def.key] ?? null) : null,
    };
  });
  return { features, enabled: features.filter((f) => f.enabled).map((f) => f.key) };
}

/**
 * Validates a grant list against the registry and adds missing dependencies (transitively). Each entry must be a
 * registered feature key or a module wildcard (`module.*`) of a module that declares features. Returns the
 * de-duplicated list (input order first) and the unknown entries.
 */
export function normalizeGrants(
  list: readonly string[],
  registry: readonly FeatureDef[],
): { features: string[]; unknown: string[] } {
  const valid = new Set([...registry.map((d) => d.key), ...registry.map((d) => wildcard(d.module))]);
  const unknown = list.filter((k) => !valid.has(k));
  const out = [...new Set(list.filter((k) => valid.has(k)))];

  // Adding a dependency can't remove a grant, so iterate until nothing more is needed (bounded by the registry size).
  for (let round = 0; round <= registry.length; round++) {
    let added = false;
    for (const def of registry) {
      if (!grants(out, def)) continue;
      for (const dep of def.dependsOn ?? []) {
        const depDef = registry.find((d) => d.key === dep);
        if (depDef && !grants(out, depDef)) {
          out.push(dep);
          added = true;
        }
      }
    }
    if (!added) break;
  }
  return { features: out, unknown: [...new Set(unknown)] };
}
