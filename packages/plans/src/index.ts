import { defineModule, requireTenant } from "@srirealtime/core";
import type { FastifyRequest } from "fastify";
import { plansRoutes } from "./routes";
import { plans, tenantPlanOverrides, usageCounters } from "./schema";
import { PlansService, type PlansDeps } from "./service";

export * from "./schema";
export * from "./entitlements";
export { seedPlans } from "./seed";
export { PlansService, consumeStatement, overridePatchSchema, planInputSchema } from "./service";
export type { OverridePatch, PlanInput, PlansDeps, UsageItem } from "./service";
export { plansRoutes } from "./routes";

export function createPlans(deps: PlansDeps) {
  const service = new PlansService(deps);
  const module = defineModule({
    id: "plans",
    tables: { plans, tenantPlanOverrides, usageCounters },
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
