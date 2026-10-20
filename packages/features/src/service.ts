import {
  badRequest,
  featureDisabled,
  notFound,
  paymentRequired,
  type FeatureDef,
  type TenantRef,
} from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeGrants, resolveFeatures, type FeatureState, type Reason } from "./resolve";
import { appProfiles, tenantFeatureToggles, type AppProfileRow } from "./schema";

/** Implemented by the plans module (`plans.service` satisfies it). */
export interface PlanEntitlementsPort {
  entitlements(tenant: TenantRef): Promise<{ planId: string | null; modules: string[]; features: Record<string, boolean> }>;
}

/** Implemented by the tenancy module (`tenancy.service` satisfies it). */
export interface TenantLookupPort {
  getRef(tenantId: string): Promise<TenantRef | null>;
  /** Number of tenants per app id, for the super-admin profile list. Optional. */
  countByApp?(): Promise<Record<string, number>>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export interface FeaturesDeps {
  db: Db;
  /** Every registered feature, collected from the mounted modules. Called lazily, so modules may be added later. */
  registry: () => FeatureDef[];
  plans: PlanEntitlementsPort;
  tenants: TenantLookupPort;
  log?: LoggerPort;
  /** Per-tenant resolution cache TTL, default 60s. */
  cacheTtlMs?: number;
}

export interface TenantFeatures {
  appId: string | null;
  planId: string | null;
  features: FeatureState[];
  /** Keys of the enabled features. */
  enabled: string[];
}

export interface AppProfile {
  appId: string;
  name: string;
  features: string[];
}

export interface AppProfileListItem extends AppProfile {
  tenantCount: number;
}

export const appIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/, "Invalid app id");
export const profileInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  features: z.array(z.string().min(1).max(80)).max(500),
});
export type ProfileInput = z.input<typeof profileInputSchema>;

interface CacheEntry {
  appId: string | null;
  planId: string | null;
  value: TenantFeatures;
  expires: number;
}

const MAX_CACHE_ENTRIES = 10_000;

/** The error for a feature that is off, by reason: plan → 402 plan_limit, otherwise 403 feature_disabled. */
export function featureError(state: Pick<FeatureState, "key" | "label" | "reason">) {
  const reason: Reason = state.reason ?? "app";
  if (reason === "plan") {
    return paymentRequired(`${state.label} is not included in your plan`, { feature: state.key, reason: "plan" });
  }
  const message =
    reason === "shop"
      ? `${state.label} is turned off in your settings`
      : reason === "dependency"
        ? `${state.label} needs another feature that is turned off`
        : `${state.label} is not available in this app`;
  return featureDisabled(state.key, reason, message);
}

export class FeaturesService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly ttl: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly deps: FeaturesDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.ttl = deps.cacheTtlMs ?? 60_000;
  }

  /** Every registered feature (duplicate keys keep the first declaration). */
  registry(): FeatureDef[] {
    const seen = new Set<string>();
    const out: FeatureDef[] = [];
    for (const def of this.deps.registry()) {
      if (seen.has(def.key)) {
        this.log.warn({ feature: def.key }, "features: duplicate feature key ignored");
        continue;
      }
      seen.add(def.key);
      out.push(def);
    }
    return out;
  }

  // ---------------------------------------------------------------- resolution

  /** Feature states for a tenant. Cached per tenant for 60s (and re-resolved if its app or plan changed). */
  async resolve(tenant: TenantRef): Promise<TenantFeatures> {
    const appId = tenant.appId ?? null;
    const now = Date.now();
    const hit = this.cache.get(tenant.id);
    if (hit && hit.expires > now && hit.appId === appId && hit.planId === tenant.planId) return hit.value;

    const [profile, toggleRows, ent] = await Promise.all([
      appId ? this.getProfile(appId) : null,
      this.db
        .select({ feature: tenantFeatureToggles.feature, enabled: tenantFeatureToggles.enabled })
        .from(tenantFeatureToggles)
        .where(eq(tenantFeatureToggles.tenantId, tenant.id)),
      this.deps.plans.entitlements(tenant),
    ]);
    const toggles = Object.fromEntries(toggleRows.map((r) => [r.feature, r.enabled]));
    const { features, enabled } = resolveFeatures({
      registry: this.registry(),
      app: profile ? profile.features : null,
      plan: { modules: ent.modules, features: ent.features },
      toggles,
    });
    const value: TenantFeatures = { appId, planId: ent.planId, features, enabled };
    if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.clear();
    this.cache.set(tenant.id, { appId, planId: tenant.planId, value, expires: now + this.ttl });
    return value;
  }

  /** Looks a tenant up by id through the tenant lookup port. */
  tenantRef(tenantId: string): Promise<TenantRef | null> {
    return this.deps.tenants.getRef(tenantId);
  }

  private async ref(tenantOrId: TenantRef | string): Promise<TenantRef | null> {
    return typeof tenantOrId === "string" ? this.tenantRef(tenantOrId) : tenantOrId;
  }

  /** Whether `key` is on for the tenant. Accepts a TenantRef or a tenant id (unknown tenants → false). */
  async isEnabled(tenantOrId: TenantRef | string, key: string): Promise<boolean> {
    const tenant = await this.ref(tenantOrId);
    if (!tenant) return false;
    return (await this.resolve(tenant)).enabled.includes(key);
  }

  /** Throws 402 plan_limit `{ feature, reason: "plan" }` or 403 feature_disabled `{ feature, reason }` unless every key is on. */
  async assert(tenant: TenantRef, keys: string | readonly string[]): Promise<void> {
    const list = typeof keys === "string" ? [keys] : keys;
    if (list.length === 0) return;
    const { features } = await this.resolve(tenant);
    for (const key of list) {
      const state = features.find((f) => f.key === key);
      if (!state) {
        this.log.warn({ feature: key }, "features: route needs an unregistered feature");
        throw featureDisabled(key, "app", "This feature is not available");
      }
      if (!state.enabled) throw featureError(state);
    }
  }

  /** Drops cached resolutions for one tenant (toggle, plan change), or all. */
  invalidate(tenantId?: string) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  /** Drops every cached resolution (app profile changes affect many tenants). */
  invalidateAll() {
    this.cache.clear();
  }

  // ---------------------------------------------------------------- shop switches

  /**
   * The shop owner's switch. 404 for unknown features, 400 for features that aren't `shopToggle`, and the
   * plan/app/dependency error when enabling a feature that isn't available. Returns the new states.
   */
  async setToggle(tenant: TenantRef, key: string, enabled: boolean, userId: string | null = null): Promise<FeatureState[]> {
    const def = this.registry().find((d) => d.key === key);
    if (!def) throw notFound("Feature");
    if (!def.shopToggle) throw badRequest("This feature can't be switched by the shop");
    if (enabled) {
      const state = (await this.resolve(tenant)).features.find((f) => f.key === key)!;
      if (!state.available) throw featureError(state);
    }
    await this.db
      .insert(tenantFeatureToggles)
      .values({ tenantId: tenant.id, feature: key, enabled, updatedBy: userId })
      .onConflictDoUpdate({
        target: [tenantFeatureToggles.tenantId, tenantFeatureToggles.feature],
        set: { enabled, updatedBy: userId, updatedAt: new Date() },
      });
    this.invalidate(tenant.id);
    return (await this.resolve(tenant)).features;
  }

  /**
   * Writes several shop switches at once (a solution preset applied to a shop). Only `shopToggle` features are
   * written; unlike setToggle, switching on a feature the plan or app doesn't allow is stored without error (it stays
   * off until it becomes available). Returns how many switches were written.
   */
  async applyToggles(tenantId: string, toggles: Readonly<Record<string, boolean>>, userId: string | null = null): Promise<number> {
    const switchable = new Set(this.registry().filter((d) => d.shopToggle).map((d) => d.key));
    const rows = Object.entries(toggles)
      .filter(([key]) => switchable.has(key))
      .map(([feature, enabled]) => ({ tenantId, feature, enabled, updatedBy: userId }));
    if (rows.length === 0) return 0;
    await this.db
      .insert(tenantFeatureToggles)
      .values(rows)
      .onConflictDoUpdate({
        target: [tenantFeatureToggles.tenantId, tenantFeatureToggles.feature],
        set: { enabled: sql`excluded.enabled`, updatedBy: userId, updatedAt: new Date() },
      });
    this.invalidate(tenantId);
    return rows.length;
  }

  // ---------------------------------------------------------------- app profiles

  async getProfile(appId: string): Promise<AppProfile | null> {
    const [row] = await this.db.select().from(appProfiles).where(eq(appProfiles.appId, appId)).limit(1);
    return row ? toProfile(row) : null;
  }

  async listProfiles(): Promise<AppProfileListItem[]> {
    const [rows, counts] = await Promise.all([
      this.db.select().from(appProfiles).orderBy(asc(appProfiles.appId)),
      this.deps.tenants.countByApp?.() ?? Promise.resolve({} as Record<string, number>),
    ]);
    return rows.map((r) => ({ ...toProfile(r), tenantCount: counts[r.appId] ?? 0 }));
  }

  /** Creates or replaces a profile. Keys are validated against the registry and dependencies are added. */
  async putProfile(appId: string, input: ProfileInput): Promise<AppProfile> {
    const id = appIdSchema.parse(appId);
    const p = profileInputSchema.parse(input);
    const { features, unknown } = normalizeGrants(p.features, this.registry());
    if (unknown.length > 0) throw badRequest(`Unknown features: ${unknown.join(", ")}`, { unknown });
    const [row] = await this.db
      .insert(appProfiles)
      .values({ appId: id, name: p.name, features })
      .onConflictDoUpdate({ target: appProfiles.appId, set: { name: p.name, features, updatedAt: new Date() } })
      .returning();
    this.invalidateAll();
    return toProfile(row!);
  }

  async deleteProfile(appId: string): Promise<void> {
    const rows = await this.db.delete(appProfiles).where(eq(appProfiles.appId, appId)).returning({ appId: appProfiles.appId });
    if (rows.length === 0) throw notFound("App profile");
    this.invalidateAll();
  }

  /** Clears a tenant's switches (e.g. when the shop is deleted). */
  async clearToggles(tenantId: string, key?: string): Promise<void> {
    await this.db
      .delete(tenantFeatureToggles)
      .where(and(eq(tenantFeatureToggles.tenantId, tenantId), key ? eq(tenantFeatureToggles.feature, key) : undefined));
    this.invalidate(tenantId);
  }
}

const toProfile = (r: AppProfileRow): AppProfile => ({ appId: r.appId, name: r.name, features: r.features });
