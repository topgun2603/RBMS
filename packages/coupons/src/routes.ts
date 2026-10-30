import { badRequest, isSuperAdmin, permissionDenied, permissionsAllow, requireRole, requireTenant, requireUser, type RequestContext } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { COUPONS_FEATURE } from "./features";
import type { OfferInput, OfferListQuery } from "./offers-service";
import type { CouponInput, CouponListQuery, CouponsService, PublicValidateInput, RedemptionsQuery } from "./service";

const idParam = z.object({ id: z.string().uuid() });
const ID = "/:id([0-9a-fA-F-]{36})";
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const FEATURE = { config: { feature: COUPONS_FEATURE } };

/**
 * Checks a permission once the staff module fills `user.permissions` (docs/commerce-batch1.md §5); patterns such as
 * `coupons.*` count. Until then (no permissions on the user) the base role check is all there is.
 * Throws 403 `permission_denied` `{ permission }`.
 */
export function requirePermission(ctx: RequestContext, key: string): void {
  const user = requireUser(ctx);
  if (isSuperAdmin(ctx)) return;
  const perms = (user as { permissions?: string[] }).permissions;
  if (!perms) return;
  if (permissionsAllow(perms, key)) return;
  throw permissionDenied(key);
}

/** Routes under /v1/coupons: staff CRUD, plus the public checkout preview (tenant from host/`x-tenant`). */
export function couponsRoutes(service: CouponsService) {
  return async (app: FastifyInstance) => {
    app.post("/public/validate", FEATURE, async (req) => {
      const tenant = req.ctx?.tenant;
      if (!tenant) throw badRequest("Unknown shop");
      return service.validatePublic(tenant.id, body(req) as PublicValidateInput);
    });

    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });
      const manage = (req: { ctx: RequestContext }) => requirePermission(req.ctx, "coupons.manage");

      staff.get("/", FEATURE, async (req) => service.list(requireTenant(req.ctx).id, req.query as CouponListQuery));
      staff.post("/", FEATURE, async (req) => {
        manage(req);
        return service.create(requireTenant(req.ctx).id, body(req) as CouponInput);
      });
      staff.get(ID, FEATURE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.get(requireTenant(req.ctx).id, id);
      });
      staff.patch(ID, FEATURE, async (req) => {
        manage(req);
        const { id } = idParam.parse(req.params);
        return service.update(requireTenant(req.ctx).id, id, body(req) as Partial<CouponInput>);
      });
      staff.delete(ID, FEATURE, async (req) => {
        manage(req);
        const { id } = idParam.parse(req.params);
        await service.remove(requireTenant(req.ctx).id, id);
        return { ok: true };
      });
      staff.get(`${ID}/redemptions`, FEATURE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.redemptions(requireTenant(req.ctx).id, id, req.query as RedemptionsQuery);
      });

      // Automatic offers and bundles (same permission as coupons).
      staff.get("/offers", FEATURE, async (req) => service.offers.list(requireTenant(req.ctx).id, req.query as OfferListQuery));
      staff.post("/offers", FEATURE, async (req) => {
        manage(req);
        return service.offers.create(requireTenant(req.ctx).id, body(req) as OfferInput);
      });
      staff.get(`/offers${ID}`, FEATURE, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.offers.get(requireTenant(req.ctx).id, id);
      });
      staff.patch(`/offers${ID}`, FEATURE, async (req) => {
        manage(req);
        const { id } = idParam.parse(req.params);
        return service.offers.update(requireTenant(req.ctx).id, id, body(req) as Partial<OfferInput>);
      });
      staff.delete(`/offers${ID}`, FEATURE, async (req) => {
        manage(req);
        const { id } = idParam.parse(req.params);
        await service.offers.remove(requireTenant(req.ctx).id, id);
        return { ok: true };
      });
      /** Staff "test a cart": prices lines as the checkout would (no usage recorded). */
      staff.post("/offers/preview", FEATURE, async (req) => service.priceCart(requireTenant(req.ctx).id, body(req) as never));
    });
  };
}
