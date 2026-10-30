import { requireRole, requireTenant } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { normalizeLocale } from "./client";
import { localeSchema, overrideKeySchema, overrideValueSchema, type I18nService } from "./service";

const appIdSchema = z.string().min(1).max(50);

const messagesQuery = z.object({
  locale: z.string().max(35).optional(),
  app: appIdSchema.optional(),
});

const refBody = z.object({
  locale: localeSchema,
  key: overrideKeySchema,
  appId: appIdSchema.nullish(),
});
const putBody = refBody.extend({ value: overrideValueSchema });

export function i18nRoutes(service: I18nService) {
  return async (app: FastifyInstance) => {
    app.get("/messages", async (req) => {
      const q = messagesQuery.parse(req.query);
      const locale = normalizeLocale(q.locale ?? req.ctx.locale);
      const messages = await service.messages(locale, { appId: q.app ?? null, tenantId: req.ctx.tenant?.id ?? null });
      return { locale, messages };
    });

    app.get("/overrides", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      return { items: await service.listOverrides(tenant.id) };
    });

    app.put("/overrides", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const body = putBody.parse(req.body);
      return service.setOverride({ ...body, tenantId: tenant.id, appId: body.appId ?? null });
    });

    app.delete("/overrides", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const body = refBody.parse(req.body);
      const removed = await service.removeOverride({ ...body, tenantId: tenant.id, appId: body.appId ?? null });
      return { removed };
    });
  };
}
