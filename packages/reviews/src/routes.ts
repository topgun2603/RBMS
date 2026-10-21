import { requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { REVIEW_FEATURE_KEYS, REVIEW_PERMISSION_KEYS } from "./features";
import { productIdsQuerySchema, type PublicReviewQuery, type ReplyInput, type ReviewInput, type StaffReviewQuery } from "./logic";
import type { ReviewsService } from "./service";

/** Staff routes only match UUID-shaped ids, so `/public/*` never reaches them. */
const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const productParam = z.object({ productId: z.string().uuid() });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
/** Shopper routes: any signed-in user, scoped to the current shop (shoppers are not tenant members). */
const shopper = (req: { ctx: RequestContext }) => {
  const user = requireUser(req.ctx);
  return { tenantId: requireTenant(req.ctx).id, userId: user.id };
};

const feature = REVIEW_FEATURE_KEYS.base;
const PUBLIC = { config: { feature } };
/** Shopper writes are not staff actions: no audit entry. */
const SHOPPER = { config: { feature, audit: false as const } };
const staffRoute = (action?: string) => ({
  config: {
    feature,
    permission: REVIEW_PERMISSION_KEYS.manage,
    ...(action ? { audit: { action, entity: "review", idParam: "id" } } : {}),
  },
});

/**
 * Routes under /v1/reviews (feature `reviews`). `/public/*` reads need only a tenant; writing a review and voting need a
 * signed-in shopper; everything else needs an owner, admin or staff member with `reviews.manage`.
 */
export function reviewsRoutes(service: ReviewsService) {
  return async (app: FastifyInstance) => {
    // ---- public
    app.get("/public/products/:productId/reviews", PUBLIC, async (req) => {
      const { productId } = productParam.parse(req.params);
      return service.listPublic(tid(req), productId, query(req) as PublicReviewQuery);
    });
    app.get("/public/summary", PUBLIC, async (req, reply) => {
      reply.header("cache-control", "public, max-age=120");
      return service.shopSummary(tid(req), query(req).limit);
    });
    app.get("/public/ratings", PUBLIC, async (req) => {
      const { productIds } = productIdsQuerySchema.parse(query(req));
      return service.ratings(tid(req), productIds);
    });

    // ---- shopper
    app.get("/public/products/:productId/reviews/mine", PUBLIC, async (req) => {
      const { productId } = productParam.parse(req.params);
      const s = shopper(req);
      return { review: await service.mine(s.tenantId, s.userId, productId) };
    });
    app.post("/public/products/:productId/reviews", SHOPPER, async (req) => {
      const { productId } = productParam.parse(req.params);
      const s = shopper(req);
      return service.submit(s.tenantId, s.userId, productId, body(req) as unknown as ReviewInput);
    });
    app.post("/public/reviews/:id/helpful", SHOPPER, async (req) => {
      const { id } = idParam.parse(req.params);
      const s = shopper(req);
      return service.markHelpful(s.tenantId, s.userId, id);
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
        requirePermission(req.ctx, REVIEW_PERMISSION_KEYS.manage);
      });
      staff.get("/", staffRoute(), async (req) => service.list(tid(req), query(req) as StaffReviewQuery));
      staff.get(ID, staffRoute(), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.get(tid(req), id);
      });
      staff.post(`${ID}/approve`, staffRoute("review.approve"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.approve(tid(req), id);
      });
      staff.post(`${ID}/reject`, staffRoute("review.reject"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.reject(tid(req), id);
      });
      staff.post(`${ID}/reply`, staffRoute("review.reply"), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.reply(tid(req), id, body(req) as ReplyInput);
      });
      staff.delete(ID, staffRoute("review.delete"), async (req) => {
        const { id } = idParam.parse(req.params);
        await service.remove(tid(req), id);
        return { ok: true };
      });
    });
  };
}
