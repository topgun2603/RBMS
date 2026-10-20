import { isSuperAdmin, notFound, requireRole, requireSuperAdmin, requireTenant } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { OverridePatch, PlanInput, PlansService } from "./service";

const idParam = z.object({ id: z.string().min(1).max(40) });
const tenantParam = z.object({ tenantId: z.string().uuid() });
const listQuery = z.object({
  all: z.enum(["1", "true"]).optional(),
  /** The app whose plans to list (pricing pages, sign-up); defaults to the requesting shop's app. */
  app: z.string().regex(/^[A-Z][A-Z0-9]{1,7}$/).optional(),
});

/** Super-admin plan routes: plan definitions are platform events (tenant null); overrides belong to their shop. */
const audited = (action: string, entity: string, idParam: string) => ({ config: { audit: { action, entity, idParam } } });

/**
 * Routes under /v1/plans. Changing a tenant's plan lives in tenancy
 * (PATCH /v1/tenancy/tenants/:id/plan); apps/api wires tenancy's onPlanChange to service.invalidate.
 */
export function plansRoutes(service: PlansService) {
  return async (app: FastifyInstance) => {
    // Public plans of an app (?app=, else the shop's own app); super-admins can pass ?all=1 for every plan of every
    // app, private ones included (with ?app= too: that app's, private included).
    app.get("/", async (req) => {
      const { all, app: appParam } = listQuery.parse(req.query);
      const admin = Boolean(all && isSuperAdmin(req.ctx));
      const appId = appParam ?? req.ctx.tenant?.appId ?? undefined;
      if (admin) return { items: await service.listPlans({ appId: appParam }) };
      return { items: await service.listPlans({ publicOnly: true, appId: appId ?? null }) };
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

    app.put("/:id", audited("plans.plan.upsert", "plan", "id"), async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = idParam.parse(req.params);
      const body = z.record(z.unknown()).parse(req.body ?? {});
      const before = await service.getPlan(id);
      // upsertPlan validates the full shape with planInputSchema.
      const plan = await service.upsertPlan({ ...body, id } as PlanInput);
      req.auditSummary = before ? `Plan ${id} updated` : `Plan ${id} created`;
      req.auditDetail = { tenantId: null, before, after: plan };
      return plan;
    });

    app.delete("/:id", audited("plans.plan.delete", "plan", "id"), async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = idParam.parse(req.params);
      const before = await service.getPlan(id);
      await service.deletePlan(id);
      req.auditSummary = `Plan ${id} deleted`;
      req.auditDetail = { tenantId: null, before, after: null };
      return { ok: true };
    });

    app.get("/overrides/:tenantId", async (req) => {
      requireSuperAdmin(req.ctx);
      const { tenantId } = tenantParam.parse(req.params);
      return (await service.getOverride(tenantId)) ?? { tenantId, addModules: [], removeModules: [], limits: {}, features: {} };
    });

    app.put("/overrides/:tenantId", audited("plans.override.set", "plan_override", "tenantId"), async (req) => {
      requireSuperAdmin(req.ctx);
      const { tenantId } = tenantParam.parse(req.params);
      const before = await service.getOverride(tenantId);
      // setOverride validates with overridePatchSchema.
      const after = await service.setOverride(tenantId, (req.body ?? {}) as OverridePatch);
      req.auditSummary = "Plan override changed";
      req.auditDetail = { tenantId, before, after };
      return after;
    });
  };
}
