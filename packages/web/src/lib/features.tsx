"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useTenantSlug } from "./tenant";
import type { FeatureReason, FeaturesResponse, FeatureState } from "./types";

/** One feature key, or several that must all be on. */
export type FeatureReq = string | readonly string[];

export const featureKeys = {
  all: ["features"] as const,
  mine: (tenant: string | null | undefined) => ["features", "mine", tenant ?? null] as const,
};

/** Accepts a partial response (e.g. no `enabled`) and fills the gaps. */
export function normalizeFeatures(raw: Partial<FeaturesResponse> | null | undefined): FeaturesResponse {
  const features = (raw?.features ?? []).map((f) => ({
    ...f,
    dependsOn: f.dependsOn ?? [],
    shopToggle: !!f.shopToggle,
    reason: f.enabled ? null : (f.reason ?? null),
    shopEnabled: f.shopEnabled ?? null,
    available: f.available ?? f.enabled,
  }));
  return {
    appId: raw?.appId ?? null,
    planId: raw?.planId ?? null,
    features,
    enabled: raw?.enabled ?? features.filter((f) => f.enabled).map((f) => f.key),
  };
}

/** `invoices.*` grants every `invoices…` key; anything else grants exactly itself. */
export function grantAllows(grants: readonly string[], key: string): boolean {
  return grants.some((g) => {
    if (g === key) return true;
    if (!g.endsWith(".*")) return false;
    const prefix = g.slice(0, -2);
    return key === prefix || key.startsWith(`${prefix}.`);
  });
}

export const toKeys = (req: FeatureReq | undefined): string[] => (req === undefined ? [] : typeof req === "string" ? [req] : [...req]);

/** Result of checking a feature requirement. `cause` is the feature that is really off (follows dependencies). */
export type FeatureCheck =
  | { ok: true }
  | { ok: false; key: string; cause: string; reason: FeatureReason; state?: FeatureState; causeState?: FeatureState };

/**
 * Pure checker over a GET /v1/features answer. `data` undefined (not loaded / failed) fails open: the API enforces
 * features anyway. A key the server doesn't know counts as off (reason "app"). `allow` is a module's own restriction.
 */
export function featureChecker(data: FeaturesResponse | undefined) {
  const byKey = new Map((data?.features ?? []).map((f) => [f.key, f]));
  const rootCause = (key: string, seen = new Set<string>()): { cause: string; reason: FeatureReason } => {
    const st = byKey.get(key);
    if (!st) return { cause: key, reason: "app" };
    if (st.reason === "dependency" && !seen.has(key)) {
      seen.add(key);
      const dep = st.dependsOn.find((d) => !byKey.get(d)?.enabled);
      if (dep) return rootCause(dep, seen);
    }
    return { cause: key, reason: st.reason ?? "app" };
  };
  const check = (req: FeatureReq | undefined, allow?: readonly string[]): FeatureCheck => {
    for (const key of toKeys(req)) {
      if (allow && !grantAllows(allow, key)) return { ok: false, key, cause: key, reason: "app", state: byKey.get(key) };
      if (!data) continue;
      const st = byKey.get(key);
      if (st?.enabled) continue;
      const { cause, reason } = rootCause(key);
      return { ok: false, key, cause, reason, state: st, causeState: byKey.get(cause) };
    }
    return { ok: true };
  };
  return { byKey, check };
}

interface FeaturesValue {
  /** True once the server answered (or failed: the client then fails open; the API still enforces). */
  ready: boolean;
  data: FeaturesResponse | undefined;
  error: unknown;
  features: FeatureState[];
  state: (key: string) => FeatureState | undefined;
  /** `allow` = a module's own restriction (WebModule.features) on top of the server. */
  check: (req: FeatureReq | undefined, allow?: readonly string[]) => FeatureCheck;
  refetch: () => void;
}

const FeaturesContext = React.createContext<FeaturesValue | null>(null);

/** Restriction of the module rendering this subtree (set by the module router). */
export const FeatureAllowContext = React.createContext<readonly string[] | undefined>(undefined);

/** Loads GET /v1/features for the current shop and answers "is X on?" for everything below. */
export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const slug = useTenantSlug();
  const query = useQuery({
    queryKey: featureKeys.mine(slug),
    // Public endpoint: no bearer token, so an expired session can't bounce public pages to the login screen.
    queryFn: () => api.get<FeaturesResponse>("/features", undefined, { anonymous: true }).then(normalizeFeatures),
    enabled: !!slug,
    staleTime: 60_000,
    retry: 1,
  });
  const data = query.data;
  const value = React.useMemo<FeaturesValue>(() => {
    const { byKey, check } = featureChecker(data);
    return {
      ready: !slug || query.isSuccess || query.isError,
      data,
      error: query.error,
      features: data?.features ?? [],
      state: (key) => byKey.get(key),
      check,
      refetch: () => void query.refetch(),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query object identity changes every render
  }, [data, slug, query.isSuccess, query.isError, query.error]);
  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>;
}

function useFeaturesContext(): FeaturesValue {
  const ctx = React.useContext(FeaturesContext);
  if (!ctx) throw new Error("useFeatures must be used inside <FeaturesProvider>");
  return ctx;
}

/**
 * Feature state for the current shop. Inside a module, `isEnabled`/`check` also apply the module's own restriction
 * (`billingModule({ features })`). `isEnabled` is false while the server hasn't answered.
 */
export function useFeatures() {
  const ctx = useFeaturesContext();
  const allow = React.useContext(FeatureAllowContext);
  return React.useMemo(
    () => ({
      ...ctx,
      check: (req: FeatureReq | undefined, extraAllow?: readonly string[]) => ctx.check(req, extraAllow ?? allow),
      isEnabled: (req: FeatureReq | undefined) => (ctx.ready ? ctx.check(req, allow).ok : toKeys(req).length === 0),
    }),
    [ctx, allow],
  );
}

/** Is this feature (or every one of these) on for the current shop? */
export function useFeature(req: FeatureReq): boolean {
  return useFeatures().isEnabled(req);
}

/** Renders `children` only when the feature(s) are on. */
export function Feature({ when, fallback = null, children }: { when: FeatureReq; fallback?: React.ReactNode; children: React.ReactNode }) {
  return <>{useFeature(when) ? children : fallback}</>;
}

/** Owner switch for a shopToggle feature (PUT /v1/features/toggles/:key). Updates the cached feature state. */
export function useToggleFeature() {
  const qc = useQueryClient();
  const slug = useTenantSlug();
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      api.put<FeatureState[]>(`/features/toggles/${encodeURIComponent(key)}`, { enabled }),
    onSuccess: (features) => {
      qc.setQueryData<FeaturesResponse>(featureKeys.mine(slug), (old) =>
        normalizeFeatures({ appId: old?.appId ?? null, planId: old?.planId ?? null, features, enabled: undefined }),
      );
      // Pages that were showing data of a feature that just changed should reload it.
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "features" && q.queryKey[0] !== "me" });
    },
  });
}
