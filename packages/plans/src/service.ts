import { badRequest, notFound, paymentRequired, type TenantRef } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CORE_MODULES,
  hasModuleIn,
  isMonthlyKey,
  isUnlimited,
  LIFETIME,
  limitIn,
  offeredBy,
  periodFor,
  resolveEntitlements,
  type AddonGrant,
  type Entitlements,
} from "./entitlements";
import {
  ADDON_KINDS,
  planAddons,
  plans,
  tenantPlanOverrides,
  usageCounters,
  usageCredits,
  type Plan,
  type PlanAddon,
  type TenantPlanOverride,
} from "./schema";

export interface PlansDeps {
  db: Db;
  /** Modules always enabled regardless of plan. Defaults to CORE_MODULES. */
  corePlanModules?: string[];
  /** Plan used for tenants whose plan_id is null. Default "free". Set null to give them core modules only. */
  defaultPlanId?: string | null;
  /** Entitlements cache TTL, default 60s. */
  cacheTtlMs?: number;
  /**
   * Lifetime keys whose usage is the count of real rows elsewhere (e.g. `staff` = active non-owner memberships).
   * For these the counter is only a reservation ledger: usage and limit checks use the larger of the counter and the
   * real count, and `reconcileUsage` resets the counter to the real count. Rows created outside `consume` (seeds,
   * imports, direct membership routes) are counted that way.
   */
  usageSources?: Record<string, UsageSource>;
  /** A counter touched within this window may hold an in-flight reservation; reconcile leaves it alone. Default 60 s. */
  reconcileSettleMs?: number;
  /**
   * The tenant's active add-ons (subscriptions module: effective quantity now, paid or complimentary). Absent: no
   * add-ons. Called when entitlements are resolved (cached with them; `invalidate(tenantId)` when they change).
   */
  addons?: (tenantId: string) => Promise<{ addonId: string; quantity: number }[]>;
  /** The app profile's grant list (null: no profile, everything offered). Feature add-ons only unlock what it offers. */
  appFeatures?: (appId: string) => Promise<readonly string[] | null>;
  /** Called after `invalidate` (e.g. the features module drops its cached resolution too). */
  onInvalidate?: (tenantId?: string) => void;
}

/** The real usage of a lifetime key. */
export interface UsageSource {
  /** Current usage of one tenant. */
  count(tenantId: string): Promise<number>;
  /** Usage of every tenant that has any (absent tenants count as 0); used by `reconcileUsage()` without a tenant. */
  countAll(): Promise<Map<string, number>>;
}

/** A module id ("invoices") or a feature key ("invoices.credit-book"). */
/** A module id, a feature key (`module.name`) or a module wildcard (`module.*`). */
const moduleId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}(\.([a-z][a-z0-9-]{0,39}|\*))?$/, "Invalid module id, feature key or module.* wildcard");
const usageKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "Invalid key");
/** Plain flags ("remove_branding") or feature keys ("invoices.reminders": false denies that feature). */
const featureKey = z.string().regex(/^[a-z][a-z0-9_-]{0,63}(\.[a-z][a-z0-9_-]{0,63})?$/, "Invalid key");
const limitsSchema = z.record(usageKey, z.number().int().min(-1));
const featuresSchema = z.record(featureKey, z.boolean());

/** Plan tiers, lowest first: a shop moving to another app keeps its tier. */
export const PLAN_TIERS = ["free", "starter", "pro", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const planInputSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "Invalid plan id"),
  appId: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{1,7}$/, "Invalid app id")
    .nullable()
    .optional(),
  tier: z.enum(PLAN_TIERS).nullable().optional(),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  priceMonthlyPaise: z.number().int().min(0).default(0),
  priceYearlyPaise: z.number().int().min(0).default(0),
  modules: z.array(moduleId).max(200).default([]),
  limits: limitsSchema.default({}),
  features: featuresSchema.default({}),
  isPublic: z.boolean().default(true),
  sort: z.number().int().default(0),
});
export type PlanInput = z.input<typeof planInputSchema>;

/** Each given field replaces the stored one. */
export const overridePatchSchema = z.object({
  addModules: z.array(moduleId).max(200).optional(),
  removeModules: z.array(moduleId).max(200).optional(),
  limits: limitsSchema.optional(),
  features: featuresSchema.optional(),
});
export type OverridePatch = z.input<typeof overridePatchSchema>;

/** A plan add-on (docs/verticals.md "Plan add-ons"). */
export const addonInputSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "Invalid add-on id"),
    code: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "Invalid add-on code"),
    appId: z
      .string()
      .regex(/^[A-Z][A-Z0-9]{1,7}$/, "Invalid app id")
      .nullable()
      .optional(),
    kind: z.enum(ADDON_KINDS),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).nullable().optional(),
    limits: z.record(usageKey, z.number().int().min(1)).default({}),
    modules: z.array(moduleId).max(50).default([]),
    priceMonthlyPaise: z.number().int().min(0).default(0),
    priceYearlyPaise: z.number().int().min(0).default(0),
    priceOncePaise: z.number().int().min(0).default(0),
    minQuantity: z.number().int().min(1).max(1000).default(1),
    maxQuantity: z.number().int().min(1).max(1000).default(1),
    tiers: z.array(z.enum(PLAN_TIERS)).max(PLAN_TIERS.length).default([]),
    isPublic: z.boolean().default(true),
    sort: z.number().int().default(0),
  })
  .superRefine((a, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (a.minQuantity > a.maxQuantity) issue("maxQuantity", "Max quantity must be at least the min quantity");
    if (a.kind === "limit" && Object.keys(a.limits).length === 0) issue("limits", "A limit add-on adds at least one limit");
    if (a.kind === "feature" && a.modules.length === 0) issue("modules", "A feature add-on unlocks at least one feature");
    if (a.kind !== "feature" && a.modules.length) issue("modules", "Only feature add-ons unlock features");
    if (a.kind === "feature" && Object.keys(a.limits).length) issue("limits", "Feature add-ons don't add limits");
    if (a.kind === "credits") {
      if (Object.keys(a.limits).length === 0) issue("limits", "A credits pack grants credits for at least one monthly key");
      for (const k of Object.keys(a.limits)) if (!isMonthlyKey(k)) issue("limits", `Credits are for monthly keys (…_per_month), not "${k}"`);
    }
  });
export type AddonInput = z.input<typeof addonInputSchema>;

export interface UsageItem {
  key: string;
  period: string;
  limit: number;
  used: number;
  /** null when unlimited. */
  remaining: number | null;
  /** The plan's own limit (plan + override), before add-ons; equals `limit` without add-ons. */
  base?: number;
  /** What active add-ons add to the limit. */
  addon?: number;
  /** Credits left (packs): used once the monthly allowance is used up; they never reset. */
  credits?: number;
}

/** Add-on as stored, with the per-app selection (`listAddons({ appId })`) applied. */
export type AddonRow = PlanAddon;

interface CacheEntry {
  planId: string | null;
  value: Entitlements;
  expires: number;
}

/**
 * The atomic consume statement: inserts the counter or adds `amount`, but the update only happens
 * while the new value stays within `limit`. Returns no row when the limit would be exceeded.
 */
export function consumeStatement(
  db: Db,
  args: {
    tenantId: string;
    key: string;
    period: string;
    amount: number;
    limit: number;
    /** The real usage (keys with a UsageSource): the counter never counts up from below it. */
    floor?: number;
  },
) {
  const stored = sql`${sql.identifier("usage_counters")}.${sql.identifier("value")}`;
  const current = args.floor === undefined ? stored : sql`greatest(${stored}, ${args.floor})`;
  return db
    .insert(usageCounters)
    .values({ tenantId: args.tenantId, key: args.key, period: args.period, value: (args.floor ?? 0) + args.amount })
    .onConflictDoUpdate({
      target: [usageCounters.tenantId, usageCounters.key, usageCounters.period],
      set: { value: sql`${current} + ${args.amount}`, updatedAt: sql`now()` },
      ...(isUnlimited(args.limit) ? {} : { setWhere: sql`${current} + ${args.amount} <= ${args.limit}` }),
    })
    .returning({ value: usageCounters.value });
}

/**
 * Sets a lifetime counter to the real usage, unless it already matches or was written within `settleMs` (it may hold
 * a reservation whose row isn't inserted yet). Idempotent. Returns a row only when it wrote something.
 */
export function reconcileStatement(db: Db, args: { tenantId: string; key: string; value: number; settleMs: number }) {
  const t = sql.identifier("usage_counters");
  return db
    .insert(usageCounters)
    .values({ tenantId: args.tenantId, key: args.key, period: LIFETIME, value: args.value })
    .onConflictDoUpdate({
      target: [usageCounters.tenantId, usageCounters.key, usageCounters.period],
      set: { value: args.value, updatedAt: sql`now()` },
      setWhere: sql`${t}.${sql.identifier("value")} <> ${args.value} and ${t}.${sql.identifier("updated_at")} < now() - make_interval(secs => ${args.settleMs / 1000})`,
    })
    .returning({ value: usageCounters.value });
}

export class PlansService {
  private readonly db: Db;
  private readonly core: readonly string[];
  private readonly defaultPlanId: string | null;
  private readonly ttl: number;
  private readonly cache = new Map<string, CacheEntry>();
  /** Default (free) plan id per app. */
  private readonly defaults = new Map<string, { id: string | null; expires: number }>();
  private readonly sources: Record<string, UsageSource>;
  private readonly settleMs: number;
  private readonly deps: PlansDeps;

  constructor(deps: PlansDeps) {
    this.deps = deps;
    this.db = deps.db;
    this.sources = deps.usageSources ?? {};
    for (const key of Object.keys(this.sources)) {
      if (periodFor(key) !== LIFETIME) throw new Error(`plans: usage source "${key}" must be a lifetime key`);
    }
    this.settleMs = deps.reconcileSettleMs ?? 60_000;
    this.core = deps.corePlanModules ?? CORE_MODULES;
    this.defaultPlanId = deps.defaultPlanId === undefined ? "free" : deps.defaultPlanId;
    this.ttl = deps.cacheTtlMs ?? 60_000;
  }

  // ---------------------------------------------------------------- catalogue

  /**
   * The catalogue. With `appId`: that app's plans, or the shared plans (no app) when the app has none of its own.
   * Without: every plan.
   */
  async listPlans(opts: { publicOnly?: boolean; appId?: string | null } = {}): Promise<Plan[]> {
    const all = await this.db
      .select()
      .from(plans)
      .where(opts.publicOnly ? eq(plans.isPublic, true) : undefined)
      .orderBy(asc(plans.sort), asc(plans.priceMonthlyPaise));
    if (opts.appId === undefined) return all;
    const own = opts.appId ? all.filter((p) => p.appId === opts.appId) : [];
    return own.length ? own : all.filter((p) => p.appId === null);
  }

  /** Whether a shop of `appId` may be on the plan: the app's own plans, or shared plans when the app has none. */
  async offeredTo(plan: Pick<Plan, "appId">, appId: string | null | undefined): Promise<boolean> {
    if (plan.appId) return plan.appId === appId;
    if (!appId) return true;
    const [own] = await this.db.select({ id: plans.id }).from(plans).where(eq(plans.appId, appId)).limit(1);
    return !own;
  }

  /** The app's plan of a tier (its own, else the shared one of that tier). */
  async planForTier(appId: string | null | undefined, tier: string): Promise<Plan | null> {
    if (appId) {
      const [own] = await this.db
        .select()
        .from(plans)
        .where(and(eq(plans.appId, appId), eq(plans.tier, tier)))
        .orderBy(asc(plans.sort))
        .limit(1);
      if (own) return own;
    }
    const [shared] = await this.db
      .select()
      .from(plans)
      .where(and(isNull(plans.appId), or(eq(plans.tier, tier), eq(plans.id, tier))))
      .orderBy(asc(plans.sort))
      .limit(1);
    return shared ?? null;
  }

  /** Plan id for shops without one: the app's free plan, else the configured default ("free"). */
  async defaultPlanFor(appId: string | null | undefined): Promise<string | null> {
    if (this.defaultPlanId === null) return null;
    const now = Date.now();
    const key = appId ?? "";
    const hit = this.defaults.get(key);
    if (hit && hit.expires > now) return hit.id;
    const id = appId ? ((await this.planForTier(appId, "free"))?.id ?? this.defaultPlanId) : this.defaultPlanId;
    this.defaults.set(key, { id, expires: now + this.ttl });
    return id;
  }

  async getPlan(id: string): Promise<Plan | null> {
    const [p] = await this.db.select().from(plans).where(eq(plans.id, id)).limit(1);
    return p ?? null;
  }

  async upsertPlan(input: PlanInput): Promise<Plan> {
    const p = planInputSchema.parse(input);
    const values = { ...p, description: p.description ?? null };
    const { id: _id, ...set } = values;
    const [row] = await this.db
      .insert(plans)
      .values(values)
      .onConflictDoUpdate({ target: plans.id, set: { ...set, updatedAt: new Date() } })
      .returning();
    this.invalidate();
    return row!;
  }

  /** Deletes a plan. Tenants still pointing at it fall back to core modules only. */
  async deletePlan(id: string): Promise<void> {
    const rows = await this.db.delete(plans).where(eq(plans.id, id)).returning({ id: plans.id });
    if (rows.length === 0) throw notFound("Plan");
    this.invalidate();
  }

  // ---------------------------------------------------------------- add-ons (catalogue)

  /**
   * The add-on catalogue. With `appId`: the app's own add-ons plus the shared ones (no app) whose `code` the app has
   * not replaced. Without: every add-on.
   */
  async listAddons(opts: { publicOnly?: boolean; appId?: string | null } = {}): Promise<PlanAddon[]> {
    const all = await this.db
      .select()
      .from(planAddons)
      .where(opts.publicOnly ? eq(planAddons.isPublic, true) : undefined)
      .orderBy(asc(planAddons.sort), asc(planAddons.id));
    if (opts.appId === undefined) return all;
    const own = opts.appId ? all.filter((a) => a.appId === opts.appId) : [];
    const codes = new Set(own.map((a) => a.code));
    return [...own, ...all.filter((a) => a.appId === null && !codes.has(a.code))].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  }

  async getAddon(id: string): Promise<PlanAddon | null> {
    const [a] = await this.db.select().from(planAddons).where(eq(planAddons.id, id)).limit(1);
    return a ?? null;
  }

  async upsertAddon(input: AddonInput): Promise<PlanAddon> {
    const a = addonInputSchema.parse(input);
    const values = { ...a, appId: a.appId ?? null, description: a.description ?? null };
    const { id: _id, ...set } = values;
    const [row] = await this.db
      .insert(planAddons)
      .values(values)
      .onConflictDoUpdate({ target: planAddons.id, set: { ...set, updatedAt: new Date() } })
      .returning();
    this.invalidate();
    return row!;
  }

  /** Deletes an add-on from the catalogue. Shops that have it stop getting what it adds (their rows stay). */
  async deleteAddon(id: string): Promise<void> {
    const rows = await this.db.delete(planAddons).where(eq(planAddons.id, id)).returning({ id: planAddons.id });
    if (rows.length === 0) throw notFound("Add-on");
    this.invalidate();
  }

  // ---------------------------------------------------------------- credits

  /** Credit balances by key (keys never bought are absent). */
  async credits(tenantId: string): Promise<Record<string, number>> {
    const rows = await this.db.select({ key: usageCredits.key, balance: usageCredits.balance }).from(usageCredits).where(eq(usageCredits.tenantId, tenantId));
    return Object.fromEntries(rows.map((r) => [r.key, r.balance]));
  }

  /** Adds credits (a pack was paid for, or the platform gave them). Returns the new balances. */
  async grantCredits(tenantId: string, grants: Record<string, number>): Promise<Record<string, number>> {
    for (const [key, n] of Object.entries(grants)) {
      if (!Number.isInteger(n) || n <= 0) continue;
      usageKey.parse(key);
      await this.db
        .insert(usageCredits)
        .values({ tenantId, key, balance: n, granted: n })
        .onConflictDoUpdate({
          target: [usageCredits.tenantId, usageCredits.key],
          set: { balance: sql`${usageCredits.balance} + ${n}`, granted: sql`${usageCredits.granted} + ${n}`, updatedAt: sql`now()` },
        });
    }
    return this.credits(tenantId);
  }

  /** Takes `amount` credits if the balance has them (atomic). */
  private async takeCredits(tenantId: string, key: string, amount: number): Promise<boolean> {
    const rows = await this.db
      .update(usageCredits)
      .set({ balance: sql`${usageCredits.balance} - ${amount}`, used: sql`${usageCredits.used} + ${amount}`, updatedAt: sql`now()` })
      .where(and(eq(usageCredits.tenantId, tenantId), eq(usageCredits.key, key), sql`${usageCredits.balance} >= ${amount}`))
      .returning({ balance: usageCredits.balance });
    return rows.length > 0;
  }

  private async returnCredits(tenantId: string, key: string, amount: number) {
    await this.db
      .update(usageCredits)
      .set({ balance: sql`${usageCredits.balance} + ${amount}`, used: sql`greatest(${usageCredits.used} - ${amount}, 0)` })
      .where(and(eq(usageCredits.tenantId, tenantId), eq(usageCredits.key, key)));
  }

  // ---------------------------------------------------------------- overrides

  async getOverride(tenantId: string): Promise<TenantPlanOverride | null> {
    const [o] = await this.db.select().from(tenantPlanOverrides).where(eq(tenantPlanOverrides.tenantId, tenantId)).limit(1);
    return o ?? null;
  }

  async setOverride(tenantId: string, patch: OverridePatch): Promise<TenantPlanOverride> {
    const p = overridePatchSchema.parse(patch);
    const [row] = await this.db
      .insert(tenantPlanOverrides)
      .values({ tenantId, ...p })
      .onConflictDoUpdate({ target: tenantPlanOverrides.tenantId, set: { ...p, updatedAt: new Date() } })
      .returning();
    this.invalidate(tenantId);
    return row!;
  }

  // ---------------------------------------------------------------- entitlements

  /** Drops cached entitlements for one tenant, or all when no id is given. Wire to tenancy's onPlanChange. */
  invalidate(tenantId?: string) {
    if (tenantId) this.cache.delete(tenantId);
    else {
      this.cache.clear();
      this.defaults.clear();
    }
    this.deps.onInvalidate?.(tenantId);
  }

  /** Plan + override + active add-ons (limits add up × quantity; feature add-ons only unlock what the app offers). */
  async entitlements(tenant: TenantRef): Promise<Entitlements> {
    const planId = tenant.planId ?? (await this.defaultPlanFor(tenant.appId));
    const now = Date.now();
    const hit = this.cache.get(tenant.id);
    if (hit && hit.expires > now && hit.planId === planId) return hit.value;

    const [plan, override, grants] = await Promise.all([planId ? this.getPlan(planId) : null, this.getOverride(tenant.id), this.addonGrants(tenant.id)]);
    let offered: ((key: string) => boolean) | undefined;
    if (grants.some((g) => g.kind === "feature") && tenant.appId && this.deps.appFeatures) {
      const list = await this.deps.appFeatures(tenant.appId);
      offered = (key) => offeredBy(list, key);
    }
    const value = resolveEntitlements(plan, override, this.core, { addons: grants, offered });
    this.cache.set(tenant.id, { planId, value, expires: now + this.ttl });
    return value;
  }

  /** The app profile's grant list (`deps.appFeatures`; null = no profile or not wired, everything offered). */
  async appFeatures(appId: string): Promise<readonly string[] | null> {
    return this.deps.appFeatures ? this.deps.appFeatures(appId) : null;
  }

  /** The tenant's active add-ons joined with the catalogue (unknown add-on ids are skipped). */
  private async addonGrants(tenantId: string): Promise<AddonGrant[]> {
    if (!this.deps.addons) return [];
    const active = (await this.deps.addons(tenantId)).filter((a) => a.quantity > 0);
    if (!active.length) return [];
    const rows = await this.db.select().from(planAddons).where(inArray(planAddons.id, [...new Set(active.map((a) => a.addonId))]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return active.flatMap((a) => {
      const r = byId.get(a.addonId);
      return r ? [{ id: r.id, kind: r.kind, quantity: a.quantity, limits: r.limits, modules: r.modules }] : [];
    });
  }

  async hasModule(tenant: TenantRef, moduleId: string): Promise<boolean> {
    return hasModuleIn(await this.entitlements(tenant), moduleId);
  }

  async assertModule(tenant: TenantRef, moduleId: string): Promise<void> {
    if (!(await this.hasModule(tenant, moduleId))) {
      throw paymentRequired(`${moduleId} is not included in your plan`, { module: moduleId });
    }
  }

  async hasFeature(tenant: TenantRef, feature: string): Promise<boolean> {
    return (await this.entitlements(tenant)).features[feature] === true;
  }

  /** -1 = unlimited; a key missing from the plan means 0. */
  async limit(tenant: TenantRef, key: string): Promise<number> {
    return limitIn(await this.entitlements(tenant), key);
  }

  // ---------------------------------------------------------------- usage

  /** Current usage; for keys with a usage source, the larger of the counter and the real count. */
  async usage(tenant: TenantRef, key: string, now = new Date()): Promise<number> {
    const [stored, real] = await Promise.all([this.storedUsage(tenant.id, key, now), this.sources[key]?.count(tenant.id)]);
    return Math.max(stored, real ?? 0);
  }

  private async storedUsage(tenantId: string, key: string, now: Date): Promise<number> {
    const [row] = await this.db
      .select({ value: usageCounters.value })
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.tenantId, tenantId),
          eq(usageCounters.key, key),
          eq(usageCounters.period, periodFor(key, now)),
        ),
      )
      .limit(1);
    return row?.value ?? 0;
  }

  /**
   * Atomically adds `amount` to the counter if it stays within the plan limit (add-ons included). For monthly keys,
   * what the allowance can't take comes from the tenant's credits (packs): the monthly allowance first, then credits;
   * the counter only counts the allowance part. Throws paymentRequired when neither covers it. Returns the counter
   * value. Safe under concurrency (conditional upserts / updates).
   */
  async consume(tenant: TenantRef, key: string, amount = 1): Promise<number> {
    if (!Number.isInteger(amount) || amount <= 0) throw badRequest("Amount must be a positive integer");
    const limit = await this.limit(tenant, key);
    const now = new Date();
    const source = this.sources[key];
    // Credits only stand behind finite monthly allowances (lifetime keys like staff are sized by limit add-ons).
    const creditable = !source && !isUnlimited(limit) && isMonthlyKey(key);
    const exceeded = async () => {
      const [used, credits] = await Promise.all([this.usage(tenant, key, now), creditable ? this.credits(tenant.id) : Promise.resolve({} as Record<string, number>)]);
      return paymentRequired(`Your plan's limit for ${key} has been reached`, { key, limit, used, credits: credits[key] ?? 0 });
    };
    if (!isUnlimited(limit) && amount > limit && !creditable) throw await exceeded();

    const attempt = async () => {
      const floor = source ? await source.count(tenant.id) : undefined;
      // The insert branch of the upsert has no limit check, so a real count already at the limit stops here.
      if (!isUnlimited(limit) && (floor ?? 0) + amount > limit) return [];
      return consumeStatement(this.db, { tenantId: tenant.id, key, period: periodFor(key, now), amount, limit, floor });
    };
    let rows = await attempt();
    // The counter may be stale-high (rows removed without `release`): settle it to the real count and try once more.
    if (rows.length === 0 && source && (await this.reconcileUsage(key, tenant.id)).fixed > 0) rows = await attempt();
    if (rows.length === 0 && creditable) {
      // Allowance left this month, then credits for the rest; a race on the counter gives the credits back and retries.
      for (let i = 0; i < 2; i++) {
        const used = await this.storedUsage(tenant.id, key, now);
        const inAllowance = Math.max(0, Math.min(amount, limit - used));
        if (!(await this.takeCredits(tenant.id, key, amount - inAllowance))) break;
        if (inAllowance === 0) return used;
        const r = await consumeStatement(this.db, { tenantId: tenant.id, key, period: periodFor(key, now), amount: inAllowance, limit });
        if (r.length) return r[0]!.value;
        await this.returnCredits(tenant.id, key, amount - inAllowance);
      }
    }
    if (rows.length === 0) throw await exceeded();
    return rows[0]!.value;
  }

  /**
   * Resets the counters of keys with a usage source to the real count, for one tenant or for every tenant (startup and
   * the `plans.reconcile-usage` job). Idempotent; counters written in the last `reconcileSettleMs` are left alone.
   */
  async reconcileUsage(key?: string, tenantId?: string): Promise<{ checked: number; fixed: number }> {
    const keys = key ? (this.sources[key] ? [key] : []) : Object.keys(this.sources);
    let checked = 0;
    let fixed = 0;
    for (const k of keys) {
      const source = this.sources[k]!;
      let real: Map<string, number>;
      if (tenantId) real = new Map([[tenantId, await source.count(tenantId)]]);
      else {
        real = await source.countAll();
        // Counters of tenants that have no rows any more go back to 0.
        const stored = await this.db
          .select({ tenantId: usageCounters.tenantId })
          .from(usageCounters)
          .where(and(eq(usageCounters.key, k), eq(usageCounters.period, LIFETIME)));
        for (const r of stored) if (!real.has(r.tenantId)) real.set(r.tenantId, 0);
      }
      for (const [t, value] of real) {
        checked++;
        fixed += (await reconcileStatement(this.db, { tenantId: t, key: k, value, settleMs: this.settleMs })).length;
      }
    }
    return { checked, fixed };
  }

  /** Gives back usage (e.g. a staff member was removed). Never goes below 0. */
  async release(tenant: TenantRef, key: string, amount = 1): Promise<void> {
    if (!Number.isInteger(amount) || amount <= 0) throw badRequest("Amount must be a positive integer");
    await this.db
      .update(usageCounters)
      .set({ value: sql`greatest(${usageCounters.value} - ${amount}, 0)` })
      .where(
        and(
          eq(usageCounters.tenantId, tenant.id),
          eq(usageCounters.key, key),
          eq(usageCounters.period, periodFor(key)),
        ),
      );
  }

  /**
   * Limit and current usage for every limit key in the tenant's entitlements (and keys that only have credits): the
   * plan's own limit (`base`), what add-ons add (`addon`) and credits left (`credits`).
   */
  async usageSummary(tenant: TenantRef): Promise<UsageItem[]> {
    const [ent, credits] = await Promise.all([this.entitlements(tenant), this.credits(tenant.id)]);
    const keys = [...new Set([...Object.keys(ent.limits), ...Object.keys(credits).filter((k) => (credits[k] ?? 0) > 0)])].sort();
    if (keys.length === 0) return [];
    const now = new Date();
    const rows = await this.db
      .select({ key: usageCounters.key, period: usageCounters.period, value: usageCounters.value })
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.tenantId, tenant.id),
          inArray(usageCounters.key, keys),
          inArray(usageCounters.period, [LIFETIME, periodFor("x_per_month", now)]),
        ),
      );
    const real = new Map(
      await Promise.all(
        keys.filter((k) => this.sources[k]).map(async (k) => [k, await this.sources[k]!.count(tenant.id)] as const),
      ),
    );
    return keys.map((key) => {
      const period = periodFor(key, now);
      const stored = rows.find((r) => r.key === key && r.period === period)?.value ?? 0;
      const used = Math.max(stored, real.get(key) ?? 0);
      const limit = limitIn(ent, key);
      const addon = isUnlimited(limit) ? 0 : (ent.addonLimits?.[key] ?? 0);
      const item: UsageItem = { key, period, limit, used, remaining: isUnlimited(limit) ? null : Math.max(limit - used, 0), base: isUnlimited(limit) ? limit : limit - addon, addon };
      if (credits[key] !== undefined) item.credits = credits[key];
      return item;
    });
  }
}
