import { documented, requireRole, requireTenant } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { BrandingService } from "./service";
import { brandTokensSchema } from "./tokens";

/** `Branding` as JSON (API document, mobile client): the shop's name, logos, design tokens and the CSS built from them. */
export const brandingSchema = z.object({
  appName: z.string().nullable(),
  logoUrl: z.string().nullable(),
  logoDarkUrl: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  tokens: brandTokensSchema,
  css: z.string(),
});

/** Routes under /v1/branding. */
export function brandingRoutes(service: BrandingService) {
  return async (app: FastifyInstance) => {
    // Public: the current tenant's branding, or platform defaults when there is no tenant.
    app.get("/", documented({ response: brandingSchema }), async (req) => (req.ctx.tenant ? service.get(req.ctx.tenant.id) : service.platform()));

    app.get("/theme.css", async (req, reply) => {
      const branding = req.ctx.tenant ? await service.get(req.ctx.tenant.id) : service.platform();
      reply.header("content-type", "text/css; charset=utf-8");
      reply.header("cache-control", "public, max-age=300");
      // Responses differ per tenant host/header, so shared caches must key on them.
      reply.header("vary", "Host, X-Tenant");
      return branding.css;
    });

    app.put("/", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      return service.update(tenant.id, req.body ?? {});
    });

    app.delete("/", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      return service.reset(tenant.id);
    });

    app.post("/preview", async (req) => {
      requireRole(req.ctx, "owner", "admin");
      const tenant = requireTenant(req.ctx);
      const { css, warnings } = await service.previewTokens(tenant.id, req.body ?? {});
      return { css, warnings };
    });
  };
}
