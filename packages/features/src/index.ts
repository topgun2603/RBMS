import { defineModule, type FeatureGatePort } from "@srirealtime/core";
import type { FastifyRequest } from "fastify";
import { featuresRoutes } from "./routes";
import { appProfiles, tenantFeatureToggles } from "./schema";
import { FeaturesService, type FeaturesDeps } from "./service";

export * from "./schema";
export * from "./resolve";
export * from "./service";
export { featuresRoutes } from "./routes";

/**
 * Feature switches: every module declares features; a feature is on for a shop only when its app profile, plan,
 * owner switch and dependencies allow it (docs/features.md).
 */
export function createFeatures(deps: FeaturesDeps) {
  const service = new FeaturesService(deps);
  const module = defineModule({
    id: "features",
    tables: { appProfiles, tenantFeatureToggles },
    routes: featuresRoutes(service),
  });

  /**
   * Fastify preHandler the host adds globally. When the route declares `config.feature` and the request has a
   * tenant, every listed feature must be on. Without a tenant it does nothing (public routes check themselves).
   */
  const preHandler = async (req: FastifyRequest): Promise<void> => {
    const feature = req.routeOptions?.config?.feature;
    if (!feature || (Array.isArray(feature) && feature.length === 0)) return;
    const tenant = req.ctx?.tenant;
    if (!tenant) return;
    await service.assert(tenant, feature);
  };

  /** For modules that check features outside the request pipeline (public links, jobs). */
  const gate: FeatureGatePort = { isEnabled: (tenantId, key) => service.isEnabled(tenantId, key) };

  return { service, module, preHandler, gate };
}
