import { isSuperAdmin, notFound, requireRole, requireSuperAdmin, requireTenant } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { OverridePatch, PlanInput, PlansService } from "./service";

const idParam = z.object({ id: z.string().min(1).max(40) });
const tenantParam = z.object({ tenantId: z.string().uuid() });
const listQuery = z.object({ all: z.enum(["1", "true"]).optional() });

/**
 * Routes under /v1/plans. Changing a tenant's plan lives in tenancy
 * (PATCH /v1/tenancy/tenants/:id/plan); apps/api wires tenancy's onPlanChange to service.invalidate.
 */
export function plansRoutes(service: PlansService) {
  return async (app: FastifyInstance) => {
    // Public plans; super-admins can pass ?all=1 to include private ones.
    app.get("/", async (req) => {
      const { all } = listQuery.parse(req.query);
      const publicOnly = !(all && isSuperAdmin(req.ctx));
      return { items: await service.listPlans({ publicOnly }) };
    });

    app.get("/current", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const [entitlements, usage] = await Promise.all([service.entitlements(tenant), service.usageSummary(tenant)]);
      const plan = entitlements.planId ? await service.getPlan(entitlements.planId) : null;
      return { plan, entitlements, usage: { items: usage } };
    });

    app.get("/:id", async (req) => {
      const { id } = idParam.parse(req.params);
      const plan = await service.getPlan(id);
      if (!plan || (!plan.isPublic && !isSuperAdmin(req.ctx))) throw notFound("Plan");
      return plan;
    });

    app.put("/:id", async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = idParam.parse(req.params);
      const body = z.record(z.unknown()).parse(req.body ?? {});
      // upsertPlan validates the full shape with planInputSchema.
      return service.upsertPlan({ ...body, id } as PlanInput);
    });

    app.delete("/:id", async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = idParam.parse(req.params);
      await service.deletePlan(id);
      return { ok: true };
    });

    app.get("/overrides/:tenantId", async (req) => {
      requireSuperAdmin(req.ctx);
      const { tenantId } = tenantParam.parse(req.params);
      return (await service.getOverride(tenantId)) ?? { tenantId, addModules: [], removeModules: [], limits: {}, features: {} };
    });

    app.put("/overrides/:tenantId", async (req) => {
      requireSuperAdmin(req.ctx);
      const { tenantId } = tenantParam.parse(req.params);
      // setOverride validates with overridePatchSchema.
      return service.setOverride(tenantId, (req.body ?? {}) as OverridePatch);
    });
  };
}
