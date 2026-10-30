import { documented, notFound, requireRole, requireSuperAdmin, requireTenant } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { FeaturesService, ProfileInput } from "./service";

const keyParam = z.object({ key: z.string().min(1).max(80) });
const appParam = z.object({ appId: z.string().min(1).max(32) });
const tenantParam = z.object({ tenantId: z.string().uuid() });
const toggleBody = z.object({ enabled: z.boolean() });

/** One feature's state for the shop (`FeatureState`). */
export const featureStateSchema = z.object({
  key: z.string(),
  module: z.string(),
  label: z.string(),
  description: z.string(),
  dependsOn: z.array(z.string()),
  /** The owner may switch it on / off in Settings. */
  shopToggle: z.boolean(),
  enabled: z.boolean(),
  /** Why it's off: the first failing level, in the order app -> plan -> dependency -> shop. Null when enabled. */
  reason: z.enum(["app", "plan", "dependency", "shop"]).nullable(),
  /** App, plan and dependencies allow it (the feature's own shop switch aside). */
  available: z.boolean(),
  /** The owner's switch; null = never touched (the feature's default applies). */
  shopEnabled: z.boolean().nullable(),
});
/** `TenantFeatures` as JSON (API document, mobile client): gate screens on `enabled`. */
export const tenantFeaturesSchema = z.object({
  appId: z.string().nullable(),
  planId: z.string().nullable(),
  features: z.array(featureStateSchema),
  /** Keys of the enabled features. */
  enabled: z.array(z.string()),
});

/** Routes under /v1/features (docs/features.md). */
export function featuresRoutes(service: FeaturesService) {
  return async (app: FastifyInstance) => {
    // Any request with a tenant (public, so storefronts and share pages can read it too).
    app.get("/", documented({ response: tenantFeaturesSchema }), async (req) => service.resolve(requireTenant(req.ctx)));

    app.put("/toggles/:key", async (req) => {
      const user = requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const { key } = keyParam.parse(req.params);
      const { enabled } = toggleBody.parse(req.body ?? {});
      return service.setToggle(tenant, key, enabled, user.id);
    });

    // ---- super-admin
    app.get("/registry", async (req) => {
      requireSuperAdmin(req.ctx);
      return { items: service.registry() };
    });

    app.get("/apps", async (req) => {
      requireSuperAdmin(req.ctx);
      return { items: await service.listProfiles() };
    });

    app.put("/apps/:appId", async (req) => {
      requireSuperAdmin(req.ctx);
      const { appId } = appParam.parse(req.params);
      return service.putProfile(appId, (req.body ?? {}) as ProfileInput);
    });

    app.delete("/apps/:appId", async (req) => {
      requireSuperAdmin(req.ctx);
      const { appId } = appParam.parse(req.params);
      await service.deleteProfile(appId);
      return { ok: true };
    });

    app.get("/tenants/:tenantId", async (req) => {
      requireSuperAdmin(req.ctx);
      const { tenantId } = tenantParam.parse(req.params);
      const tenant = await service.tenantRef(tenantId);
      if (!tenant) throw notFound("Tenant");
      return service.resolve(tenant);
    });
  };
}
