import { AI_CREDITS_KEY, createAi, resolveAiConfig, type AiEnvInput, type AiSettings, type CreditBalance, type CreditsPort } from "@rbms/ai";
import { AppError, type TenantRef } from "@rbms/core";
import type { Db } from "@rbms/db";
import { inArray } from "@rbms/db";
import type { PlansService } from "@rbms/plans";
import { tenants } from "@rbms/tenancy";

/** The slice of the plans module AI credits use (a PlansService fits; tests pass a fake). */
export type PlansCredits = Pick<PlansService, "limit" | "usage" | "credits" | "consume">;

/**
 * AI credits on the plans module: the monthly allowance is the plan limit `ai_credits_per_month` (a `_per_month` key,
 * so the counter resets each IST month by itself) and top-ups are the shop's credit packs for the same key
 * (`credits` add-ons, bought through subscriptions). `consume` already takes the allowance first, then the packs.
 */
export function planCredits(plans: PlansCredits, tenantRef: (tenantId: string) => Promise<TenantRef | null>, now: () => Date = () => new Date()): CreditsPort {
  const IST = 330 * 60_000;
  const period = () => {
    const l = new Date(now().getTime() + IST);
    return `${l.getUTCFullYear()}-${String(l.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const ref = async (tenantId: string) => {
    const t = await tenantRef(tenantId);
    if (!t) throw new AppError(404, "not_found", "Shop not found");
    return t;
  };
  const balance = async (tenantId: string): Promise<CreditBalance> => {
    const t = await ref(tenantId);
    const [limit, used, packs] = await Promise.all([plans.limit(t, AI_CREDITS_KEY), plans.usage(t, AI_CREDITS_KEY), plans.credits(tenantId)]);
    const unlimited = limit < 0;
    const topUp = Math.max(0, packs[AI_CREDITS_KEY] ?? 0);
    return {
      period: period(),
      unlimited,
      allowance: unlimited ? 0 : limit,
      allowanceUsed: used,
      topUp,
      remaining: unlimited ? null : Math.max(0, limit - used) + topUp,
    };
  };
  return {
    balance,
    async charge(tenantId, credits) {
      const t = await ref(tenantId);
      // Never take more than is left: the run already happened, so a shortfall is ours, not an error for the shop.
      for (let attempt = 0; attempt < 2; attempt++) {
        const b = await balance(tenantId);
        const take = b.remaining === null ? credits : Math.min(credits, b.remaining);
        if (take <= 0) return 0;
        try {
          await plans.consume(t, AI_CREDITS_KEY, take);
          return take;
        } catch (e) {
          if (!(e instanceof AppError) || e.status !== 402) throw e; // somebody else used credits meanwhile: look again
        }
      }
      return 0;
    },
  };
}

export interface AiKitDeps {
  db: Db;
  env: AiEnvInput;
  plans: PlansCredits;
  tenantRef: (tenantId: string) => Promise<TenantRef | null>;
  /** The settings namespace "ai" (`settings.handle("ai")`). */
  settings: { get(scope: { tenantId: string }): Promise<unknown> };
  isEnabled: (tenantId: string, key: string) => Promise<boolean>;
  log: { warn(o: object, m?: string): void; error(o: object, m?: string): void };
}

/** AI foundation wiring (docs/ai.md): provider from the environment, credits on the plans module, shop names for the platform table. */
export function createAiKit(deps: AiKitDeps) {
  const config = resolveAiConfig(deps.env);
  deps.log.warn(
    { provider: config.providerKind, enabled: config.enabled, models: config.models },
    config.providerKind === "mock" ? "ai: using the MOCK provider (no ANTHROPIC_API_KEY); nothing is sent to a model" : "ai: ready",
  );
  return createAi({
    db: deps.db,
    config,
    settings: { get: async (tenantId) => (await deps.settings.get({ tenantId })) as AiSettings },
    featureOn: (tenantId) => deps.isEnabled(tenantId, "ai"),
    featureEnabled: (tenantId, key) => deps.isEnabled(tenantId, key),
    credits: planCredits(deps.plans, deps.tenantRef),
    shops: async (ids) => {
      if (ids.length === 0) return new Map();
      const rows = await deps.db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name }).from(tenants).where(inArray(tenants.id, ids));
      return new Map(rows.map((r) => [r.id, { slug: r.slug, name: r.name }]));
    },
    log: deps.log,
  });
}
