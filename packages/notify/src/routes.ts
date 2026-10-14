import { requireRole, requireSuperAdmin, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NotifyService } from "./service";
import { CHANNELS, type Channel } from "./types";

const channel = z.enum(CHANNELS as [Channel, ...Channel[]]);
const varsSchema = z.record(z.union([z.string(), z.number()])).optional();
const scopeQuery = z.object({ scope: z.enum(["tenant", "global"]).optional() });

const providerRef = z
  .object({
    msg91FlowId: z.string().min(1).optional(),
    waTemplate: z.string().min(1).optional(),
    waLanguage: z.string().min(1).optional(),
    params: z.array(z.string()).optional(),
  })
  .strict()
  .nullable()
  .optional();

const upsertBody = z.object({
  key: z.string().min(1).max(100).regex(/^[a-z0-9_.-]+$/i),
  channel,
  locale: z.string().min(2).max(10),
  subject: z.string().max(500).nullable().optional(),
  body: z.string().min(1).max(20_000),
  providerRef,
});

const previewBody = z.object({
  channel,
  locale: z.string().min(2).max(10).optional(),
  key: z.string().min(1).optional(),
  subject: z.string().nullable().optional(),
  body: z.string().optional(),
  vars: varsSchema,
});

/**
 * Template routes manage the tenant's own templates (owner/admin), or global templates
 * when a super-admin passes `?scope=global`.
 */
function templateScope(ctx: RequestContext, query: unknown): string | null {
  const { scope } = scopeQuery.parse(query ?? {});
  if (scope === "global") {
    requireSuperAdmin(ctx);
    return null;
  }
  requireRole(ctx, "owner", "admin");
  return requireTenant(ctx).id;
}

export function notifyRoutes(service: NotifyService) {
  return async (app: FastifyInstance) => {
    app.get("/templates", async (req) => {
      const tenantId = templateScope(req.ctx, req.query);
      return { items: await service.listTemplates(tenantId) };
    });

    app.put("/templates", async (req) => {
      const tenantId = templateScope(req.ctx, req.query);
      const body = upsertBody.parse(req.body);
      return service.upsertTemplate({ ...body, tenantId });
    });

    app.delete("/templates/:id", async (req) => {
      const tenantId = templateScope(req.ctx, req.query);
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      await service.deleteTemplate(id, tenantId);
      return { ok: true };
    });

    app.post("/templates/preview", async (req) => {
      const tenantId = templateScope(req.ctx, req.query);
      const body = previewBody.parse(req.body);
      return service.preview({ ...body, tenantId, locale: body.locale ?? req.ctx.locale });
    });

    app.post("/push-tokens", async (req) => {
      const user = requireUser(req.ctx);
      const body = z
        .object({ token: z.string().min(10).max(4096), platform: z.enum(["android", "ios", "web"]) })
        .parse(req.body);
      await service.registerPushToken({ userId: user.id, tenantId: req.ctx.tenant?.id ?? null, ...body });
      return { ok: true };
    });

    app.delete("/push-tokens", async (req) => {
      const user = requireUser(req.ctx);
      const { token } = z.object({ token: z.string().min(1) }).parse(req.body ?? req.query);
      await service.removePushToken(token, user.id);
      return { ok: true };
    });

    app.get("/log", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const q = z
        .object({
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
          status: z.enum(["queued", "sent", "failed"]).optional(),
        })
        .parse(req.query);
      return { items: await service.log({ tenantId: tenant.id, ...q }) };
    });

    app.post("/test", async (req) => {
      const user = requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const body = z.object({ channel, to: z.string().min(3).max(4096) }).parse(req.body);
      return service.send({
        tenantId: tenant.id,
        userId: user.id,
        channel: body.channel,
        to: body.to,
        subject: "Test message from {{app}}",
        body: "This is a test message from {{app}}. If you received it, {{channel}} delivery works.",
        vars: { channel: body.channel },
        locale: req.ctx.locale,
      });
    });
  };
}
