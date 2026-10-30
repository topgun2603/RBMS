import { notFound, requireUser, type RequestContext, type TenantRef } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { STOREFRONT_FEATURES_KEYS } from "./features";
import type { StorefrontService } from "./service";

const BASE = { config: { feature: STOREFRONT_FEATURES_KEYS.base, audit: false as const } };
const WISHLIST = { config: { feature: [STOREFRONT_FEATURES_KEYS.base, STOREFRONT_FEATURES_KEYS.wishlist], audit: false as const } };

const tokenParam = z.object({ token: z.string().min(1).max(64) });
const idParam = z.object({ id: z.string().uuid() });
const productParam = z.object({ productId: z.string().uuid() });
const accessParam = z.object({ accessToken: z.string().min(1).max(64) });
const slugParam = z.object({ slug: z.string().trim().min(1).max(80) });
const cartQuery = z.object({ pincode: z.string().trim().max(10).optional() });

/** The store is the request's tenant (host / `x-tenant`); a request without one has no store → 404. */
export function storeOf(ctx: RequestContext): TenantRef {
  if (!ctx.tenant) throw notFound("Store");
  return ctx.tenant;
}

/** A signed-in shopper of the current store (any user; staff of the shop may shop too). 404 without a store, 401 without a user. */
export function shopperOf(ctx: RequestContext): { tenant: TenantRef; userId: string } {
  const tenant = storeOf(ctx);
  return { tenant, userId: requireUser(ctx).id };
}

/**
 * Routes under /v1/store. Public (tenant from host): config, cart by token, tracking. Shopper (signed in): /me*,
 * cart merge, checkout. Every route declares feature `storefront`; wishlist routes also `storefront.wishlist`.
 */
export function storefrontRoutes(service: StorefrontService) {
  return async (app: FastifyInstance) => {
    // ---------------------------------------------------------------- public
    app.get("/config", BASE, async (req) => service.config(storeOf(req.ctx)));

    app.post("/cart", BASE, async (req) => service.createCart(storeOf(req.ctx).id, req.ctx.user?.id ?? null));
    app.get("/cart/:token", BASE, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.getCart(storeOf(req.ctx).id, token, cartQuery.parse(req.query ?? {}));
    });
    app.put("/cart/:token/lines", BASE, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.setLine(storeOf(req.ctx).id, token, req.body);
    });
    app.post("/cart/:token/coupon", BASE, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.applyCoupon(storeOf(req.ctx).id, token, req.body);
    });
    app.delete("/cart/:token/coupon", BASE, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.removeCoupon(storeOf(req.ctx).id, token);
    });
    app.post("/cart/:token/pincode", BASE, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.setPincode(storeOf(req.ctx).id, token, req.body);
    });
    /** Adds a bundle's items as a group (offers price it). */
    app.post("/cart/:token/bundle", BASE, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.addBundle(storeOf(req.ctx).id, token, req.body);
    });
    /** Offer badges and bundles of a product (`productId`). */
    app.get("/promotions", BASE, async (req) => service.promotions(storeOf(req.ctx).id, req.query));
    app.get("/bundles", BASE, async (req) => service.listBundles(storeOf(req.ctx).id, req.query));
    app.get("/bundles/:slug", BASE, async (req) => {
      const { slug } = slugParam.parse(req.params);
      return service.getBundle(storeOf(req.ctx).id, slug);
    });
    /** Stock flags by item id (`?itemIds=a,b`): inventory for stocked shops, "sold out today" for dishes, else all in stock. */
    app.get("/availability", BASE, async (req) => service.publicAvailability(storeOf(req.ctx).id, req.query));
    app.get("/track/:accessToken", BASE, async (req) => {
      const { accessToken } = accessParam.parse(req.params);
      return service.track(storeOf(req.ctx).id, accessToken);
    });

    // ---------------------------------------------------------------- shopper
    app.post("/cart/:token/merge", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      const { token } = tokenParam.parse(req.params);
      return service.mergeCart(s.tenant.id, s.userId, token);
    });
    app.post("/checkout", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      return service.checkout(s.tenant, s.userId, req.body);
    });

    app.get("/me", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      return service.me(s.tenant.id, s.userId);
    });
    app.patch("/me", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      return service.updateMe(s.tenant.id, s.userId, req.body);
    });

    app.get("/me/addresses", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      return service.listAddresses(s.tenant.id, s.userId);
    });
    app.post("/me/addresses", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      return service.createAddress(s.tenant.id, s.userId, req.body);
    });
    app.patch("/me/addresses/:id", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      const { id } = idParam.parse(req.params);
      return service.updateAddress(s.tenant.id, s.userId, id, req.body);
    });
    app.delete("/me/addresses/:id", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      const { id } = idParam.parse(req.params);
      return service.deleteAddress(s.tenant.id, s.userId, id);
    });
    app.post("/me/addresses/:id/default", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      const { id } = idParam.parse(req.params);
      return service.setDefaultAddress(s.tenant.id, s.userId, id);
    });

    app.get("/me/orders", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      return service.listOrders(s.tenant.id, s.userId, req.query);
    });
    app.get("/me/orders/:id", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      const { id } = idParam.parse(req.params);
      return service.getOrder(s.tenant.id, s.userId, id);
    });
    app.post("/me/orders/:id/cancel", BASE, async (req) => {
      const s = shopperOf(req.ctx);
      const { id } = idParam.parse(req.params);
      return service.cancelOrder(s.tenant.id, s.userId, id, req.body);
    });

    app.get("/me/wishlist", WISHLIST, async (req) => {
      const s = shopperOf(req.ctx);
      return service.listWishlist(s.tenant.id, s.userId);
    });
    app.post("/me/wishlist", WISHLIST, async (req) => {
      const s = shopperOf(req.ctx);
      return service.addWishlist(s.tenant.id, s.userId, req.body);
    });
    app.delete("/me/wishlist/:productId", WISHLIST, async (req) => {
      const s = shopperOf(req.ctx);
      const { productId } = productParam.parse(req.params);
      return service.removeWishlist(s.tenant.id, s.userId, productId);
    });
  };
}
