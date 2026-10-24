import { notFound, requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyContextConfig, FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { RenderedDocument, DocumentsService } from "./service";

const fileParam = z.object({ file: z.string().min(1).max(200) });
const tokenParam = z.object({ token: z.string().min(1).max(140) });
const localeQuery = z.object({ locale: z.string().max(10).optional() }).passthrough();

/** "<id>.pdf" → id; anything else is a 404. */
function stripPdf(file: string): string {
  const m = /^([A-Za-z0-9_-]{1,128})\.pdf$/.exec(file);
  if (!m) throw notFound("Document");
  return m[1]!;
}

function sendPdf(reply: FastifyReply, doc: RenderedDocument) {
  return reply
    .header("content-type", "application/pdf")
    .header("content-disposition", `inline; filename="${doc.filename.replace(/"/g, "")}"`)
    .header("cache-control", "private, no-store")
    .header("x-content-type-options", "nosniff")
    .send(doc.pdf);
}

/** Checks `permission` on the user when the auth module fills `permissions` (staff package); otherwise base roles decide. */
function checkPermission(ctx: RequestContext, permission: string | undefined) {
  if (!permission) return;
  const perms = (ctx.user as { permissions?: string[] } | null)?.permissions;
  if (!perms) return;
  if (ctx.user?.platformRoles.includes("superadmin")) return;
  if (perms.includes("*") || perms.includes(permission)) return;
  requireRole(ctx, "owner", "admin");
}

const routeConfig = (feature: string, permission?: string) => ({
  config: { feature, ...(permission ? { permission } : {}) } as FastifyContextConfig,
});

/**
 * Routes under /v1/documents:
 * - `GET /:type/:id.pdf?locale=` (staff; one route per registered type so each declares its own feature)
 * - `GET /public/invoice/:token.pdf?locale=` (no auth; tenant comes from the share token through the invoices port)
 * Types must be registered before the host registers these routes.
 */
export function documentsRoutes(service: DocumentsService) {
  return async (app: FastifyInstance) => {
    app.get("/public/invoice/:file", routeConfig("invoices"), async (req, reply) => {
      const { file } = fileParam.parse(req.params);
      const token = tokenParam.parse({ token: stripPdf(file) }).token;
      const { locale } = localeQuery.parse(req.query ?? {});
      return sendPdf(reply, await service.renderPublicInvoice(token, { locale: locale ?? req.ctx?.locale }));
    });

    app.get("/public/quotation/:file", routeConfig("invoices.quotations"), async (req, reply) => {
      const { file } = fileParam.parse(req.params);
      const token = tokenParam.parse({ token: stripPdf(file) }).token;
      const { locale } = localeQuery.parse(req.query ?? {});
      return sendPdf(reply, await service.renderPublicQuotation(token, { locale: locale ?? req.ctx?.locale }));
    });

    app.get("/types", routeConfig("documents"), async (req) => {
      requireTenant(req.ctx);
      requireRole(req.ctx, "owner", "admin", "staff");
      return { items: service.registry.list().map((t) => ({ key: t.key, paper: t.paper, feature: t.feature })) };
    });

    for (const type of service.registry.list()) {
      app.get(`/${type.key}/:file`, routeConfig(type.feature, type.permission), async (req, reply) => {
        const tenant = requireTenant(req.ctx);
        requireRole(req.ctx, "owner", "admin", "staff");
        checkPermission(req.ctx, type.permission);
        const { file } = fileParam.parse(req.params);
        const id = stripPdf(file);
        const { locale, ...rest } = localeQuery.parse(req.query ?? {});
        const query = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === "string" ? v : undefined]));
        return sendPdf(reply, await service.render(tenant.id, type.key, id, { locale: locale ?? req.ctx.locale, query }));
      });
    }
  };
}
