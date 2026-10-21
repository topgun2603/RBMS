import { isSuperAdmin, notFound, requireRole, requireSuperAdmin, requireTenant } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AddonInput, OverridePatch, PlanInput, PlansService } from "./service";

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

    // Add-ons of an app (?app=, else the shop's own app): public ones; super-admins with ?all=1 get every add-on (with
    // ?app= that app's own add-ons only, private included, so the per-app editor shows what it owns).
    app.get("/addons", async (req) => {
      const { all, app: appParam } = listQuery.parse(req.query);
      if (all && isSuperAdmin(req.ctx)) {
        const items = await service.listAddons();
        return { items: appParam ? items.filter((a) => a.appId === appParam || a.appId === null) : items };
      }
      return { items: await service.listAddons({ publicOnly: true, appId: appParam ?? req.ctx.tenant?.appId ?? null }) };
    });

    app.put("/addons/:id", audited("plans.addon.upsert", "plan_addon", "id"), async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = idParam.parse(req.params);
      const body = z.record(z.unknown()).parse(req.body ?? {});
      const before = await service.getAddon(id);
      // upsertAddon validates the full shape with addonInputSchema.
      const addon = await service.upsertAddon({ ...body, id } as AddonInput);
      req.auditSummary = before ? `Add-on ${id} updated` : `Add-on ${id} created`;
      req.auditDetail = { tenantId: null, before, after: addon };
      return addon;
    });

    app.delete("/addons/:id", audited("plans.addon.delete", "plan_addon", "id"), async (req) => {
      requireSuperAdmin(req.ctx);
      const { id } = idParam.parse(req.params);
      const before = await service.getAddon(id);
      await service.deleteAddon(id);
      req.auditSummary = `Add-on ${id} deleted`;
      req.auditDetail = { tenantId: null, before, after: null };
      return { ok: true };
    });

    app.get("/credits/:tenantId", async (req) => {
      requireSuperAdmin(req.ctx);
      const { tenantId } = tenantParam.parse(req.params);
      return { tenantId, credits: await service.credits(tenantId) };
    });

    app.get("/current", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const [entitlements, usage] = await Promise.all([service.entitlements(tenant), service.usageSummary(tenant)]);
      const plan = entitlements.planId ? await service.getPlan(entitlements.planId) : null;
      return { plan, entitlements, usage: { items: usage }, credits: await service.credits(tenant.id) };
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
