import { badRequest, notFound, paymentRequired, type TenantRef } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  CORE_MODULES,
  hasModuleIn,
  isUnlimited,
  LIFETIME,
  limitIn,
  periodFor,
  resolveEntitlements,
  type Entitlements,
} from "./entitlements";
import { plans, tenantPlanOverrides, usageCounters, type Plan, type TenantPlanOverride } from "./schema";

export interface PlansDeps {
  db: Db;
  /** Modules always enabled regardless of plan. Defaults to CORE_MODULES. */
  corePlanModules?: string[];
  /** Plan used for tenants whose plan_id is null. Default "free". Set null to give them core modules only. */
  defaultPlanId?: string | null;
  /** Entitlements cache TTL, default 60s. */
  cacheTtlMs?: number;
}

const moduleId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "Invalid module id");
const usageKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, "Invalid key");
const limitsSchema = z.record(usageKey, z.number().int().min(-1));
const featuresSchema = z.record(usageKey, z.boolean());

export const planInputSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, "Invalid plan id"),
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

export interface UsageItem {
  key: string;
  period: string;
  limit: number;
  used: number;
  /** null when unlimited. */
  remaining: number | null;
}

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
  args: { tenantId: string; key: string; period: string; amount: number; limit: number },
) {
  const current = sql`${sql.identifier("usage_counters")}.${sql.identifier("value")}`;
  return db
    .insert(usageCounters)
    .values({ tenantId: args.tenantId, key: args.key, period: args.period, value: args.amount })
    .onConflictDoUpdate({
      target: [usageCounters.tenantId, usageCounters.key, usageCounters.period],
      set: { value: sql`${current} + ${args.amount}`, updatedAt: sql`now()` },
      ...(isUnlimited(args.limit) ? {} : { setWhere: sql`${current} + ${args.amount} <= ${args.limit}` }),
    })
    .returning({ value: usageCounters.value });
}

export class PlansService {
  private readonly db: Db;
  private readonly core: readonly string[];
  private readonly defaultPlanId: string | null;
  private readonly ttl: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(deps: PlansDeps) {
    this.db = deps.db;
    this.core = deps.corePlanModules ?? CORE_MODULES;
    this.defaultPlanId = deps.defaultPlanId === undefined ? "free" : deps.defaultPlanId;
    this.ttl = deps.cacheTtlMs ?? 60_000;
  }

  // ---------------------------------------------------------------- catalogue

  async listPlans(opts: { publicOnly?: boolean } = {}): Promise<Plan[]> {
    return this.db
      .select()
      .from(plans)
      .where(opts.publicOnly ? eq(plans.isPublic, true) : undefined)
      .orderBy(asc(plans.sort), asc(plans.priceMonthlyPaise));
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
    else this.cache.clear();
  }

  async entitlements(tenant: TenantRef): Promise<Entitlements> {
    const planId = tenant.planId ?? this.defaultPlanId;
    const now = Date.now();
    const hit = this.cache.get(tenant.id);
    if (hit && hit.expires > now && hit.planId === planId) return hit.value;

    const [plan, override] = await Promise.all([planId ? this.getPlan(planId) : null, this.getOverride(tenant.id)]);
    const value = resolveEntitlements(plan, override, this.core);
    this.cache.set(tenant.id, { planId, value, expires: now + this.ttl });
    return value;
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

  async usage(tenant: TenantRef, key: string, now = new Date()): Promise<number> {
    const [row] = await this.db
      .select({ value: usageCounters.value })
      .from(usageCounters)
      .where(
        and(
          eq(usageCounters.tenantId, tenant.id),
          eq(usageCounters.key, key),
          eq(usageCounters.period, periodFor(key, now)),
        ),
      )
      .limit(1);
    return row?.value ?? 0;
  }

  /**
   * Atomically adds `amount` to the counter if it stays within the plan limit; throws paymentRequired
   * otherwise. Returns the new usage. Safe under concurrency (single conditional upsert).
   */
  async consume(tenant: TenantRef, key: string, amount = 1): Promise<number> {
    if (!Number.isInteger(amount) || amount <= 0) throw badRequest("Amount must be a positive integer");
    const limit = await this.limit(tenant, key);
    const now = new Date();
    const exceeded = async () => {
      const used = await this.usage(tenant, key, now);
      return paymentRequired(`Your plan's limit for ${key} has been reached`, { key, limit, used });
    };
    if (!isUnlimited(limit) && amount > limit) throw await exceeded();

    const rows = await consumeStatement(this.db, { tenantId: tenant.id, key, period: periodFor(key, now), amount, limit });
    if (rows.length === 0) throw await exceeded();
    return rows[0]!.value;
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

  /** Limit and current usage for every limit key in the tenant's entitlements. */
  async usageSummary(tenant: TenantRef): Promise<UsageItem[]> {
    const ent = await this.entitlements(tenant);
    const keys = Object.keys(ent.limits).sort();
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
    return keys.map((key) => {
      const period = periodFor(key, now);
      const used = rows.find((r) => r.key === key && r.period === period)?.value ?? 0;
      const limit = limitIn(ent, key);
      return { key, period, limit, used, remaining: isUnlimited(limit) ? null : Math.max(limit - used, 0) };
    });
  }
}
