import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { storefrontRoutes } from "./routes";
import type { StorefrontService } from "./service";

const TENANT = { id: "11111111-1111-4111-8111-111111111111", slug: "meena-silks", planId: null, appId: "EC" };
const ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "abcdefghijklmnopqrstuvwx";

function stubService() {
  const ok = async () => ({ ok: true });
  return {
    config: vi.fn(ok),
    createCart: vi.fn(async () => ({ token: TOKEN })),
    getCart: vi.fn(ok),
    setLine: vi.fn(ok),
    applyCoupon: vi.fn(ok),
    removeCoupon: vi.fn(ok),
    setPincode: vi.fn(ok),
    mergeCart: vi.fn(ok),
    track: vi.fn(ok),
    checkout: vi.fn(ok),
    me: vi.fn(ok),
    updateMe: vi.fn(ok),
    listAddresses: vi.fn(ok),
    createAddress: vi.fn(ok),
    updateAddress: vi.fn(ok),
    deleteAddress: vi.fn(ok),
    setDefaultAddress: vi.fn(ok),
    listOrders: vi.fn(ok),
    getOrder: vi.fn(ok),
    cancelOrder: vi.fn(ok),
    listWishlist: vi.fn(ok),
    addWishlist: vi.fn(ok),
    removeWishlist: vi.fn(ok),
  };
}
type Stub = ReturnType<typeof stubService>;

async function build(service: Stub, ctx: Partial<RequestContext> = {}) {
  const app = Fastify();
  const configs = new Map<string, unknown>();
  app.addHook("onRoute", (r) => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    for (const m of methods) configs.set(`${m} ${r.url}`, r.config);
  });
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "invalid_input" } });
    return reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: { code: "other" } });
  });
  await app.register(async (scoped) => storefrontRoutes(service as unknown as StorefrontService)(scoped), { prefix: "/v1/store" });
  await app.ready();
  return { app, configs };
}

const shopper: Partial<RequestContext> = {
  tenant: TENANT,
  user: { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: [] },
};
const anon: Partial<RequestContext> = { tenant: TENANT };

type Inject = { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; url: string; payload?: Record<string, unknown> };

const PUBLIC: Inject[] = [
  { method: "GET", url: "/v1/store/config" },
  { method: "POST", url: "/v1/store/cart" },
  { method: "GET", url: `/v1/store/cart/${TOKEN}?pincode=600001` },
  { method: "PUT", url: `/v1/store/cart/${TOKEN}/lines`, payload: { variantId: ID, qty: 2 } },
  { method: "POST", url: `/v1/store/cart/${TOKEN}/coupon`, payload: { code: "DIWALI" } },
  { method: "DELETE", url: `/v1/store/cart/${TOKEN}/coupon` },
  { method: "POST", url: `/v1/store/cart/${TOKEN}/pincode`, payload: { pincode: "600001" } },
  { method: "GET", url: `/v1/store/track/${TOKEN}` },
];

const SHOPPER: Inject[] = [
  { method: "POST", url: `/v1/store/cart/${TOKEN}/merge` },
  { method: "POST", url: "/v1/store/checkout", payload: { cartToken: TOKEN } },
  { method: "GET", url: "/v1/store/me" },
  { method: "PATCH", url: "/v1/store/me", payload: { name: "Meena" } },
  { method: "GET", url: "/v1/store/me/addresses" },
  { method: "POST", url: "/v1/store/me/addresses", payload: {} },
  { method: "PATCH", url: `/v1/store/me/addresses/${ID}`, payload: {} },
  { method: "DELETE", url: `/v1/store/me/addresses/${ID}` },
  { method: "POST", url: `/v1/store/me/addresses/${ID}/default` },
  { method: "GET", url: "/v1/store/me/orders" },
  { method: "GET", url: `/v1/store/me/orders/${ID}` },
  { method: "POST", url: `/v1/store/me/orders/${ID}/cancel`, payload: { reason: "Ordered twice" } },
  { method: "GET", url: "/v1/store/me/wishlist" },
  { method: "POST", url: "/v1/store/me/wishlist", payload: { productId: ID } },
  { method: "DELETE", url: `/v1/store/me/wishlist/${ID}` },
];

describe("storefront routes", () => {
  it("public routes work without a signed-in user", async () => {
    const { app } = await build(stubService(), anon);
    for (const r of PUBLIC) expect((await app.inject(r)).statusCode, `${r.method} ${r.url}`).toBe(200);
  });

  it("passes tenant, token and bodies to the service", async () => {
    const service = stubService();
    const { app } = await build(service, anon);
    await app.inject(PUBLIC[2]!);
    expect(service.getCart).toHaveBeenCalledWith(TENANT.id, TOKEN, { pincode: "600001" });
    await app.inject(PUBLIC[3]!);
    expect(service.setLine).toHaveBeenCalledWith(TENANT.id, TOKEN, { variantId: ID, qty: 2 });
    await app.inject(PUBLIC[1]!);
    expect(service.createCart).toHaveBeenCalledWith(TENANT.id, null);
    await app.inject(PUBLIC[7]!);
    expect(service.track).toHaveBeenCalledWith(TENANT.id, TOKEN);
  });

  it("a signed-in shopper's new cart is bound to them", async () => {
    const service = stubService();
    const { app } = await build(service, shopper);
    const res = await app.inject({ method: "POST", url: "/v1/store/cart" });
    expect(res.json()).toEqual({ token: TOKEN });
    expect(service.createCart).toHaveBeenCalledWith(TENANT.id, "u1");
  });

  it("shopper routes need a signed-in user (401)", async () => {
    const service = stubService();
    const { app } = await build(service, anon);
    for (const r of SHOPPER) {
      const res = await app.inject(r);
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
      expect(res.json().error.code).toBe("unauthorized");
    }
    expect(service.checkout).not.toHaveBeenCalled();
    expect(service.me).not.toHaveBeenCalled();
  });

  it("shopper routes pass the tenant and user (no tenant role needed)", async () => {
    const service = stubService();
    const { app } = await build(service, shopper);
    for (const r of SHOPPER) expect((await app.inject(r)).statusCode, `${r.method} ${r.url}`).toBe(200);
    expect(service.checkout).toHaveBeenCalledWith(TENANT, "u1", { cartToken: TOKEN });
    expect(service.mergeCart).toHaveBeenCalledWith(TENANT.id, "u1", TOKEN);
    expect(service.cancelOrder).toHaveBeenCalledWith(TENANT.id, "u1", ID, { reason: "Ordered twice" });
    expect(service.removeWishlist).toHaveBeenCalledWith(TENANT.id, "u1", ID);
  });

  it("staff of the shop may shop too", async () => {
    const service = stubService();
    const { app } = await build(service, { ...shopper, user: { ...shopper.user!, tenantRoles: ["owner"] } });
    expect((await app.inject({ method: "GET", url: "/v1/store/me" })).statusCode).toBe(200);
  });

  it("no tenant → 404 store not found, on public and shopper routes", async () => {
    const service = stubService();
    const { app } = await build(service, { user: shopper.user! });
    for (const r of [...PUBLIC, ...SHOPPER]) {
      const res = await app.inject(r);
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(404);
      expect(res.json().error.code).toBe("not_found");
    }
    const { app: noUser } = await build(stubService());
    expect((await noUser.inject({ method: "GET", url: "/v1/store/me" })).statusCode).toBe(404);
  });

  it("bad ids in params → 400", async () => {
    const { app } = await build(stubService(), shopper);
    expect((await app.inject({ method: "GET", url: "/v1/store/me/orders/not-a-uuid" })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: "/v1/store/me/wishlist/123" })).statusCode).toBe(400);
  });

  it("every route declares feature storefront (wishlist also storefront.wishlist) and skips the staff audit", async () => {
    const { configs } = await build(stubService());
    const routes = [...configs.entries()].filter(([k]) => !k.startsWith("HEAD "));
    expect(routes.length).toBe(PUBLIC.length + SHOPPER.length);
    for (const [key, config] of routes) {
      const c = config as { feature?: unknown; audit?: unknown };
      if (key.includes("/me/wishlist")) expect(c.feature, key).toEqual(["storefront", "storefront.wishlist"]);
      else expect(c.feature, key).toBe("storefront");
      expect(c.audit, key).toBe(false);
    }
  });
});
