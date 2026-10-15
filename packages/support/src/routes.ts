import { requirePermission, requireRole, requireTenant, requireUser, unauthorized, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { FaqArticleInput, FaqArticlePatch, FaqArticleQuery, FaqCategoryInput, FaqCategoryPatch } from "./faq";
import { SUPPORT_FEATURE_KEYS, SUPPORT_PERMISSION_KEYS } from "./features";
import { csvDisposition, ticketsCsv, type PublicTicketInput, type RequesterMessageInput, type StaffMessageInput, type StaffTicketInput, type TicketListQuery } from "./logic";
import type { RequesterIdentity, SupportService } from "./service";

/** Header carrying a guest's OTP-verified phone token (see `GuestVerifierPort`). */
export const GUEST_TOKEN_HEADER = "x-guest-token";

const idParam = z.object({ id: z.string().uuid() });
const slugParam = z.object({ slug: z.string().trim().toLowerCase().min(1).max(80) });
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

/**
 * The requester of a `/public/tickets*` call: the signed-in user, else the guest token header. 401 without either
 * (the service verifies the token).
 */
export function requesterIdentity(req: FastifyRequest): { tenantId: string; identity: RequesterIdentity } {
  const tenantId = requireTenant(req.ctx).id;
  if (req.ctx.user) return { tenantId, identity: { userId: req.ctx.user.id } };
  const h = req.headers[GUEST_TOKEN_HEADER];
  const token = (Array.isArray(h) ? h[0] : h)?.trim();
  if (!token) throw unauthorized("Sign in or verify your phone number");
  return { tenantId, identity: { guestToken: token } };
}

const TICKETS = SUPPORT_FEATURE_KEYS.base;
const FAQ = SUPPORT_FEATURE_KEYS.faq;
const PUBLIC_TICKETS = { config: { feature: TICKETS, audit: false as const } };
const PUBLIC_FAQ = { config: { feature: FAQ, audit: false as const } };
const staffRoute = (feature: string, action?: string, entity = "support_ticket") => ({
  config: {
    feature,
    permission: SUPPORT_PERMISSION_KEYS.manage,
    ...(action ? { audit: { action, entity, idParam: "id" } } : {}),
  },
});

/**
 * Routes under /v1/support. `/public/tickets*` (feature `support`) need a signed-in user or a guest token;
 * `/public/faq*` (feature `support.faq`) need only a tenant. Everything else needs an owner, admin or staff member with
 * `support.manage`.
 */
export function supportRoutes(service: SupportService) {
  return async (app: FastifyInstance) => {
    // ---- public: tickets
    app.post("/public/tickets", PUBLIC_TICKETS, async (req) => {
      const { tenantId, identity } = requesterIdentity(req);
      return service.createPublicTicket(tenantId, identity, body(req) as unknown as PublicTicketInput);
    });
    app.get("/public/tickets", PUBLIC_TICKETS, async (req) => {
      const { tenantId, identity } = requesterIdentity(req);
      return service.listOwn(tenantId, identity, query(req));
    });
    app.get("/public/tickets/:id/messages", PUBLIC_TICKETS, async (req) => {
      const { id } = idParam.parse(req.params);
      const { tenantId, identity } = requesterIdentity(req);
      return service.publicThread(tenantId, identity, id);
    });
    app.post("/public/tickets/:id/messages", PUBLIC_TICKETS, async (req) => {
      const { id } = idParam.parse(req.params);
      const { tenantId, identity } = requesterIdentity(req);
      return service.replyAsRequester(tenantId, identity, id, body(req) as unknown as RequesterMessageInput);
    });

    // ---- public: FAQ
    app.get("/public/faq", PUBLIC_FAQ, async (req) => service.faqIndex(tid(req)));
    app.get("/public/faq/search", PUBLIC_FAQ, async (req) => service.faqSearch(tid(req), query(req)));
    app.get("/public/faq/:slug", PUBLIC_FAQ, async (req) => {
      const { slug } = slugParam.parse(req.params);
      return service.faqArticle(tid(req), slug);
    });
    app.post("/public/faq/:slug/helpful", PUBLIC_FAQ, async (req) => {
      const { slug } = slugParam.parse(req.params);
      return service.faqHelpful(tid(req), slug, body(req) as { helpful: boolean });
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
        requirePermission(req.ctx, SUPPORT_PERMISSION_KEYS.manage);
      });
      const userOf = (req: { ctx: RequestContext }) => requireUser(req.ctx).id;

      // tickets
      staff.get("/tickets", staffRoute(TICKETS), async (req, reply) => {
        const q = query(req);
        const { format } = formatQuery.parse(q);
        const { format: _f, ...filters } = q;
        if (format !== "csv") return service.list(tid(req), filters as TicketListQuery, userOf(req));
        const result = await service.list(tid(req), { ...filters, limit: 500, offset: 0 } as TicketListQuery, userOf(req));
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", csvDisposition("tickets", q.from, q.to))
          .send(ticketsCsv(result.items));
      });
      staff.post("/tickets", staffRoute(TICKETS, "support.ticket.create"), async (req) =>
        service.createStaffTicket(tid(req), userOf(req), body(req) as unknown as StaffTicketInput),
      );
      staff.get("/tickets/:id", staffRoute(TICKETS), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.get(tid(req), id);
      });
      staff.post("/tickets/:id/assign", staffRoute(TICKETS, "support.ticket.assign"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.assign(tid(req), id, body(req) as { assigneeId: string | null }, userOf(req));
      });
      staff.post("/tickets/:id/status", staffRoute(TICKETS, "support.ticket.status"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.setStatus(tid(req), id, body(req) as never);
      });
      staff.post("/tickets/:id/priority", staffRoute(TICKETS, "support.ticket.priority"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.setPriority(tid(req), id, body(req) as never);
      });
      staff.put("/tickets/:id/tags", staffRoute(TICKETS, "support.ticket.tags"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.setTags(tid(req), id, body(req) as never);
      });
      staff.post("/tickets/:id/messages", staffRoute(TICKETS, "support.ticket.message"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.addStaffMessage(tid(req), id, userOf(req), body(req) as unknown as StaffMessageInput);
      });
      staff.post("/tickets/:id/merge", staffRoute(TICKETS, "support.ticket.merge"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.merge(tid(req), id, body(req) as { intoId: string }, userOf(req));
      });

      // FAQ categories
      staff.get("/faq/categories", staffRoute(FAQ), async (req) => service.listCategories(tid(req)));
      staff.post("/faq/categories", staffRoute(FAQ, "support.faq_category.create", "faq_category"), async (req) =>
        service.createCategory(tid(req), body(req) as unknown as FaqCategoryInput),
      );
      staff.patch("/faq/categories/:id", staffRoute(FAQ, "support.faq_category.update", "faq_category"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateCategory(tid(req), id, body(req) as FaqCategoryPatch);
      });
      staff.delete("/faq/categories/:id", staffRoute(FAQ, "support.faq_category.delete", "faq_category"), async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteCategory(tid(req), id);
        return { ok: true };
      });

      // FAQ articles
      staff.get("/faq/articles", staffRoute(FAQ), async (req) => service.listArticles(tid(req), query(req) as FaqArticleQuery));
      staff.post("/faq/articles", staffRoute(FAQ, "support.faq_article.create", "faq_article"), async (req) =>
        service.createArticle(tid(req), body(req) as unknown as FaqArticleInput),
      );
      staff.get("/faq/articles/:id", staffRoute(FAQ), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.getArticle(tid(req), id);
      });
      staff.patch("/faq/articles/:id", staffRoute(FAQ, "support.faq_article.update", "faq_article"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.updateArticle(tid(req), id, body(req) as FaqArticlePatch);
      });
      staff.post("/faq/articles/:id/publish", staffRoute(FAQ, "support.faq_article.publish", "faq_article"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.publishArticle(tid(req), id);
      });
      staff.post("/faq/articles/:id/unpublish", staffRoute(FAQ, "support.faq_article.unpublish", "faq_article"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.unpublishArticle(tid(req), id);
      });
      staff.delete("/faq/articles/:id", staffRoute(FAQ, "support.faq_article.delete", "faq_article"), async (req) => {
        const { id } = idParam.parse(req.params);
        await service.deleteArticle(tid(req), id);
        return { ok: true };
      });
    });
  };
}
