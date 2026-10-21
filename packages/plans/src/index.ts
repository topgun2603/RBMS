import { defineModule, requireTenant } from "@srirealtime/core";
import type { FastifyRequest } from "fastify";
import { plansRoutes } from "./routes";
import { planAddons, plans, tenantPlanOverrides, usageCounters, usageCredits } from "./schema";
import { PlansService, type PlansDeps } from "./service";

export * from "./schema";
export * from "./entitlements";
export { seedPlans } from "./seed";
export { PLAN_TIERS, PlansService, addonInputSchema, consumeStatement, overridePatchSchema, planInputSchema, reconcileStatement } from "./service";
export type { AddonInput, AddonRow, OverridePatch, PlanInput, PlanTier, PlansDeps, UsageItem, UsageSource } from "./service";
export { plansRoutes } from "./routes";

export function createPlans(deps: PlansDeps) {
  const service = new PlansService(deps);
  const module = defineModule({
    id: "plans",
    tables: { plans, tenantPlanOverrides, usageCounters, planAddons, usageCredits },
    routes: plansRoutes(service),
  });

  /** Fastify preHandler: 402 unless the current tenant's plan includes `moduleId`. */
  const requireModule =
    (moduleId: string) =>
    async (req: FastifyRequest): Promise<void> => {
      await service.assertModule(requireTenant(req.ctx), moduleId);
    };

  return { service, module, requireModule };
}
