import { isSuperAdmin, requireRole, requireSuperAdmin, requireTenant, requireUser } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SettingsService } from "./service";

const params = z.object({ namespace: z.string().min(1).max(100) });

export function settingsRoutes(service: SettingsService) {
  return async (app: FastifyInstance) => {
    app.get("/", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      return { items: service.namespaces() };
    });

    app.get("/:namespace", async (req) => {
      const { namespace } = params.parse(req.params);
      const handle = service.handle(namespace);
      const { tenant, user } = req.ctx;
      // Full settings for members of the current tenant (or anyone signed in when there is no tenant);
      // everyone else only gets the namespace's publicKeys.
      const member = !!user && (!tenant || isSuperAdmin(req.ctx) || user.tenantRoles.length > 0);
      const scope = { tenantId: tenant?.id ?? null, userId: member ? (user?.id ?? null) : null };
      const values = member ? await handle.get(scope) : await handle.getPublic(scope);
      return { namespace, values };
    });

    app.put("/:namespace/tenant", async (req) => {
      const { namespace } = params.parse(req.params);
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const values = await service.handle(namespace).setTenant(tenant.id, req.body as never);
      return { namespace, values };
    });

    app.put("/:namespace/me", async (req) => {
      const { namespace } = params.parse(req.params);
      const user = requireUser(req.ctx);
      const tenant = requireTenant(req.ctx);
      const values = await service.handle(namespace).setUser(tenant.id, user.id, req.body as never);
      return { namespace, values };
    });

    app.put("/:namespace/app", async (req) => {
      const { namespace } = params.parse(req.params);
      requireSuperAdmin(req.ctx);
      const values = await service.handle(namespace).setApp(req.body as never);
      return { namespace, values };
    });
  };
}
