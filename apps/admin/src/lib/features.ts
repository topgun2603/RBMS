"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import type { Translator } from "@rbms/i18n/client";
import { api } from "./api";
import { humanizeKey } from "./format";
import { tOr } from "./i18n";
import { useTenantSlug, useToken } from "./session";
import type { AppProfile, FeatureDef, FeaturesResponse, FeatureState } from "./types";

/** Query keys for /v1/features (all under "features" so one invalidate refreshes everything). */
export const featureKeys = {
  all: ["features"] as const,
  mine: (tenant: string | null) => ["features", "mine", tenant] as const,
  registry: ["features", "registry"] as const,
  apps: ["features", "apps"] as const,
  tenant: (tenantId: string) => ["features", "tenant", tenantId] as const,
};

/** Accepts a partial response (e.g. no `enabled`) and fills the gaps. */
export function normalizeFeatures(raw: Partial<FeaturesResponse> | null | undefined): FeaturesResponse {
  const features = (raw?.features ?? []).map((f) => ({
    ...f,
    dependsOn: f.dependsOn ?? [],
    shopToggle: !!f.shopToggle,
    reason: f.enabled ? null : (f.reason ?? null),
    shopEnabled: f.shopEnabled ?? null,
  }));
  return {
    appId: raw?.appId ?? null,
    planId: raw?.planId ?? null,
    features,
    enabled: raw?.enabled ?? features.filter((f) => f.enabled).map((f) => f.key),
  };
}

/**
 * Features of the current workspace (GET /v1/features), cached for a minute.
 * `isEnabled(key)` / `isModuleOff(module)` are safe to call while loading (they return true / false).
 */
export function useFeatures(opts: { enabled?: boolean } = {}) {
  const token = useToken();
  const tenant = useTenantSlug();
  const query = useQuery({
    queryKey: featureKeys.mine(tenant),
    queryFn: () => api.get<FeaturesResponse>("/features").then(normalizeFeatures),
    enabled: !!token && !!tenant && (opts.enabled ?? true),
    staleTime: 60_000,
    retry: 1,
  });
  const data = query.data;
  const enabledSet = React.useMemo(() => new Set(data?.enabled ?? []), [data]);

  /** True while unknown, so nothing flickers off before the answer arrives. */
  const isEnabled = React.useCallback((key: string) => !data || enabledSet.has(key), [data, enabledSet]);
  /** True only when the module declares features and every one of them is off. */
  const isModuleOff = React.useCallback(
    (module: string) => {
      const fs = data?.features.filter((f) => f.module === module) ?? [];
      return fs.length > 0 && fs.every((f) => !f.enabled);
    },
    [data],
  );

  return { query, data, features: data?.features ?? [], isEnabled, isModuleOff };
}

export function useFeature(key: string): boolean {
  return useFeatures().isEnabled(key);
}

/** Every registered feature (super-admin). */
export function useFeatureRegistry() {
  return useQuery({
    queryKey: featureKeys.registry,
    queryFn: () => api.get<{ items: FeatureDef[] }>("/features/registry", undefined, { tenant: null }).then((r) => r.items ?? []),
    staleTime: 5 * 60_000,
  });
}

export function useAppProfiles() {
  return useQuery({
    queryKey: featureKeys.apps,
    queryFn: () => api.get<{ items: AppProfile[] }>("/features/apps", undefined, { tenant: null }).then((r) => r.items ?? []),
  });
}

// ---------------------------------------------------------------------------------------------
// Grouping and labels

export interface ModuleGroup<T extends { key: string; module: string }> {
  module: string;
  items: T[];
}

/** Groups by module, keeping first-seen module order; the base feature (key === module) comes first. */
export function groupByModule<T extends { key: string; module: string }>(items: T[]): ModuleGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const list = map.get(it.module);
    if (list) list.push(it);
    else map.set(it.module, [it]);
  }
  return [...map.entries()].map(([module, list]) => ({
    module,
    items: [...list].sort((a, b) => Number(b.key === module) - Number(a.key === module)),
  }));
}

/** Translated feature label (admin.featureNames.<key>), else the server's English label. */
export const featureLabel = (t: Translator, f: { key: string; label?: string }) =>
  tOr(t, `admin.featureNames.${f.key}`, f.label || humanizeKey(f.key));

/** Translated module name (admin.featureModules.<id>), else the base feature's label, else the id. */
export function moduleLabel(t: Translator, module: string, items: { key: string; label?: string }[]) {
  const base = items.find((i) => i.key === module);
  return tOr(t, `admin.featureModules.${module}`, base?.label || humanizeKey(module));
}

// ---------------------------------------------------------------------------------------------
// Dependency closure (used by the feature matrix)

interface Graph {
  byKey: Map<string, FeatureDef>;
  dependents: Map<string, string[]>;
}

export function buildGraph(defs: FeatureDef[]): Graph {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const dependents = new Map<string, string[]>();
  for (const d of defs) {
    for (const dep of d.dependsOn ?? []) {
      const list = dependents.get(dep);
      if (list) list.push(d.key);
      else dependents.set(dep, [d.key]);
    }
  }
  return { byKey, dependents };
}

/** Turns `keys` on plus everything they (transitively) depend on. `added` = extra keys switched on. */
export function switchOn(selected: Iterable<string>, keys: string[], graph: Graph) {
  const next = new Set(selected);
  const added: string[] = [];
  const stack = [...keys];
  const requested = new Set(keys);
  while (stack.length) {
    const k = stack.pop()!;
    if (!graph.byKey.has(k)) continue;
    if (!next.has(k)) {
      next.add(k);
      if (!requested.has(k)) added.push(k);
    }
    for (const dep of graph.byKey.get(k)?.dependsOn ?? []) if (!next.has(dep)) stack.push(dep);
  }
  return { next, added };
}

/** Turns `keys` off plus everything that (transitively) depends on them. `removed` = extra keys switched off. */
export function switchOff(selected: Iterable<string>, keys: string[], graph: Graph) {
  const next = new Set(selected);
  const removed: string[] = [];
  const stack = [...keys];
  const requested = new Set(keys);
  while (stack.length) {
    const k = stack.pop()!;
    if (next.has(k)) {
      next.delete(k);
      if (!requested.has(k)) removed.push(k);
    }
    for (const d of graph.dependents.get(k) ?? []) if (next.has(d)) stack.push(d);
  }
  return { next, removed };
}

// ---------------------------------------------------------------------------------------------
// Grants (plan `modules` / app profile `features`) ⇄ selected feature keys

/**
 * Reads a grant list into the set of feature keys it switches on, plus entries the registry doesn't
 * know (plain module ids such as "notify" that declare no features; kept as-is).
 *
 * Same rule as the server (packages/features grants()): a feature key grants itself, `module.*` grants
 * the whole module, and a bare module id is just that module's base feature ("inventory" = stock only).
 */
export function expandGrants(grants: string[], defs: FeatureDef[]) {
  const byKey = new Set(defs.map((d) => d.key));
  const modules = new Map<string, string[]>();
  for (const d of defs) modules.set(d.module, [...(modules.get(d.module) ?? []), d.key]);
  const selected = new Set<string>();
  const unknown: string[] = [];
  for (const g of grants.map((g) => g.trim()).filter(Boolean)) {
    const moduleKeys = g.endsWith(".*") ? modules.get(g.slice(0, -2)) : undefined;
    if (moduleKeys) moduleKeys.forEach((k) => selected.add(k));
    else if (byKey.has(g)) selected.add(g);
    else if (!unknown.includes(g)) unknown.push(g);
  }
  return { selected, unknown };
}

/**
 * Plan form: `module.*` when every feature of the module is on (so features added to the module later are
 * included), otherwise the individual keys.
 */
export function compressGrants(selected: Set<string>, defs: FeatureDef[]): string[] {
  const out: string[] = [];
  for (const g of groupByModule(defs)) {
    const on = g.items.filter((i) => selected.has(i.key)).map((i) => i.key);
    if (on.length === 0) continue;
    if (on.length === g.items.length) out.push(`${g.module}.*`);
    else out.push(...on);
  }
  return out;
}

/** App profiles: the explicit feature keys, in registry order. */
export function explicitGrants(selected: Set<string>, defs: FeatureDef[]): string[] {
  return groupByModule(defs).flatMap((g) => g.items.filter((i) => selected.has(i.key)).map((i) => i.key));
}

/** Optimistic local view of a shop switch; the server's answer replaces it. */
export function applyToggleLocally(states: FeatureState[], key: string, on: boolean): FeatureState[] {
  const next = states.map((f) => (f.key === key ? { ...f, enabled: on, shopEnabled: on, reason: on ? null : ("shop" as const) } : f));
  if (on) return next;
  // Everything that (transitively) depends on it goes off with it.
  const off = new Set([key]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of next) {
      if (!off.has(f.key) && f.dependsOn.some((d) => off.has(d))) {
        off.add(f.key);
        grew = true;
      }
    }
  }
  return next.map((f) =>
    f.key !== key && off.has(f.key) && f.enabled ? { ...f, enabled: false, available: false, reason: "dependency" as const } : f,
  );
}
