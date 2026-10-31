import { badRequest, requirePermission, requireRole, requireTenant } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ANALYTICS_FEATURE } from "./ports";
import type { AnalyticsService } from "./service";

const overviewQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** sendBeacon posts text/plain; accept a JSON string body too. */
function jsonBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    throw badRequest("Body must be JSON");
  }
}

const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/**
 * Routes under /v1/analytics (feature `analytics`):
 * - `POST /public/events` — public storefront ingest (tenant from host / x-tenant), rate-limited per IP;
 * - `GET /overview?from=&to=` — owner/admin or `reports.view`.
 */
export function analyticsRoutes(service: AnalyticsService) {
  return async (app: FastifyInstance) => {
    app.post(
      "/public/events",
      { config: { feature: ANALYTICS_FEATURE, audit: false }, bodyLimit: 64 * 1024 },
      async (req) => {
        const tenant = requireTenant(req.ctx);
        return service.ingest(tenant.id, jsonBody(req.body), {
          ip: req.ctx.ip,
          userAgent: req.ctx.userAgent ?? header(req.headers["user-agent"]),
          host: req.hostname,
          origin: header(req.headers.origin) ?? header(req.headers.referer),
        });
      },
    );

    app.get("/overview", { config: { feature: ANALYTICS_FEATURE, permission: "reports.view" } }, async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requirePermission(req.ctx, "reports.view");
      const tenant = requireTenant(req.ctx);
      return service.overview(tenant.id, overviewQuery.parse(req.query ?? {}));
    });
  };
}
