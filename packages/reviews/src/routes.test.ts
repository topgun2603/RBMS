import { emptyContext, type RequestContext } from "@rbms/core";
import { createDb } from "@rbms/db";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createReviews } from "./index";
import { reviewsRoutes } from "./routes";
import type { ReviewsService } from "./service";

// Never connects.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "EC" };
const shopperUser = { id: "33333333-3333-4333-8333-333333333333", sessionId: "s", platformRoles: [], tenantRoles: [] };
const staffUser = { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"], permissions: ["reviews.manage"] };
const id = "22222222-2222-4222-8222-222222222222";
const productId = "44444444-4444-4444-8444-444444444444";
const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });

type Seen = { feature: unknown; permission: unknown; audit: unknown };

async function build(reqCtx: RequestContext) {
  const service = {
    listPublic: vi.fn(async () => ({ items: [], total: 0, summary: { average: 0, count: 0, distribution: {} } })),
    ratings: vi.fn(async () => [{ productId, average: 4.5, count: 2 }]),
    mine: vi.fn(async () => null),
    submit: vi.fn(async () => ({ id })),
    markHelpful: vi.fn(async () => ({ id, helpfulCount: 1, voted: true })),
    list: vi.fn(async () => ({ items: [], total: 0 })),
    get: vi.fn(async () => ({ id })),
    approve: vi.fn(async () => ({ id, status: "approved" })),
    reject: vi.fn(async () => ({ id, status: "rejected" })),
    reply: vi.fn(async () => ({ id })),
    remove: vi.fn(async () => undefined),
    createStaff: vi.fn(async () => ({ id })),
    importCsv: vi.fn(async (_t: string, _u: string | null, input: { dryRun: boolean }) => ({ dryRun: input.dryRun, total: 1, valid: 1, invalid: 0, imported: input.dryRun ? 0 : 1, rows: [] })),
    requestReview: vi.fn(async () => ({ status: "sent", channels: ["whatsapp"] })),
  } as unknown as ReviewsService;
  const seen: Seen[] = [];
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = reqCtx;
  });
  app.addHook("preHandler", async (req) => {
    const c = req.routeOptions.config;
    seen.push({ feature: c.feature, permission: c.permission ?? null, audit: c.audit ?? null });
  });
  app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
    reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: true });
  });
  await app.register(reviewsRoutes(service), { prefix: "/v1/reviews" });
  return { app, service, seen };
}

describe("routes", () => {
  it("declares feature `reviews` everywhere and `reviews.manage` on staff routes", async () => {
    const { app, seen } = await build(ctx({ tenant, user: { ...staffUser, tenantRoles: ["owner"] } }));
    const cases: [string, string, boolean][] = [
      ["GET", `/v1/reviews/public/products/${productId}/reviews`, false],
      ["GET", `/v1/reviews/public/products/${productId}/reviews/mine`, false],
      ["POST", `/v1/reviews/public/products/${productId}/reviews`, false],
      ["POST", `/v1/reviews/public/reviews/${id}/helpful`, false],
      ["GET", `/v1/reviews/public/ratings?productIds=${productId}`, false],
      ["GET", "/v1/reviews/", true],
      ["GET", `/v1/reviews/${id}`, true],
      ["POST", `/v1/reviews/${id}/approve`, true],
      ["POST", `/v1/reviews/${id}/reject`, true],
      ["POST", `/v1/reviews/${id}/reply`, true],
      ["DELETE", `/v1/reviews/${id}`, true],
      ["POST", "/v1/reviews/", true],
      ["POST", "/v1/reviews/import/check", true],
      ["POST", "/v1/reviews/import", true],
      ["POST", "/v1/reviews/requests", true],
    ];
    for (const [method, url, isStaff] of cases) {
      seen.length = 0;
      const res = await app.inject({ method: method as "GET", url, payload: method === "POST" ? (url.endsWith("/requests") ? { orderId: id } : {}) : undefined });
      expect([method, url, res.statusCode]).toEqual([method, url, 200]);
      expect([url, seen[0]?.feature, seen[0]?.permission]).toEqual([url, "reviews", isStaff ? ["reviews.manage"].join() : null]);
    }
  });

  it("serves public reads with only a tenant", async () => {
    const { app, service } = await build(ctx({ tenant }));
    const res = await app.inject({ url: `/v1/reviews/public/products/${productId}/reviews?sort=helpful&rating=5` });
    expect(res.statusCode).toBe(200);
    expect(service.listPublic).toHaveBeenCalledWith(tenant.id, productId, { sort: "helpful", rating: "5" });
    const ratings = await app.inject({ url: `/v1/reviews/public/ratings?productIds=${productId},${id}` });
    expect(ratings.json()).toEqual([{ productId, average: 4.5, count: 2 }]);
    expect(service.ratings).toHaveBeenCalledWith(tenant.id, [productId, id]);
    expect((await app.inject({ url: "/v1/reviews/public/ratings?productIds=bad" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/v1/reviews/public/products/not-a-uuid/reviews" })).statusCode).toBe(400);
    expect((await (await build(ctx({}))).app.inject({ url: `/v1/reviews/public/products/${productId}/reviews` })).statusCode).toBe(403);
  });

  it("shopper writes need a signed-in user and are scoped to them; they skip the staff audit", async () => {
    const anon = await build(ctx({ tenant }));
    expect((await anon.app.inject({ method: "POST", url: `/v1/reviews/public/products/${productId}/reviews`, payload: { rating: 5 } })).statusCode).toBe(401);
    expect((await anon.app.inject({ method: "POST", url: `/v1/reviews/public/reviews/${id}/helpful` })).statusCode).toBe(401);
    expect((await anon.app.inject({ url: `/v1/reviews/public/products/${productId}/reviews/mine` })).statusCode).toBe(401);

    const { app, service, seen } = await build(ctx({ tenant, user: shopperUser }));
    const res = await app.inject({ method: "POST", url: `/v1/reviews/public/products/${productId}/reviews`, payload: { rating: 5, body: "Super" } });
    expect(res.statusCode).toBe(200);
    expect(service.submit).toHaveBeenCalledWith(tenant.id, shopperUser.id, productId, { rating: 5, body: "Super" });
    expect(seen[0]?.audit).toBe(false);
    await app.inject({ method: "POST", url: `/v1/reviews/public/reviews/${id}/helpful` });
    expect(service.markHelpful).toHaveBeenCalledWith(tenant.id, shopperUser.id, id);
    expect((await app.inject({ url: `/v1/reviews/public/products/${productId}/reviews/mine` })).json()).toEqual({ review: null });
    // A shopper is not staff.
    expect((await app.inject({ url: "/v1/reviews/" })).statusCode).toBe(403);
  });

  it("staff routes need the reviews.manage permission and record audit actions", async () => {
    const without = await build(ctx({ tenant, user: { ...staffUser, permissions: ["orders.manage"] } }));
    const denied = await without.app.inject({ method: "POST", url: `/v1/reviews/${id}/approve` });
    expect(denied.statusCode).toBe(403);
    expect(without.service.approve).not.toHaveBeenCalled();

    const { app, service, seen } = await build(ctx({ tenant, user: staffUser }));
    await app.inject({ url: "/v1/reviews/?status=pending&rating=1" });
    expect(service.list).toHaveBeenCalledWith(tenant.id, { status: "pending", rating: "1" });
    seen.length = 0;
    await app.inject({ method: "POST", url: `/v1/reviews/${id}/reply`, payload: { reply: "Thank you!" } });
    expect(service.reply).toHaveBeenCalledWith(tenant.id, id, { reply: "Thank you!" });
    expect(seen[0]?.audit).toEqual({ action: "review.reply", entity: "review", idParam: "id" });
    expect((await app.inject({ method: "DELETE", url: `/v1/reviews/${id}` })).json()).toEqual({ ok: true });
    expect(service.remove).toHaveBeenCalledWith(tenant.id, id);
    expect((await app.inject({ method: "POST", url: "/v1/reviews/nope/approve" })).statusCode).toBe(404);
  });
});

describe("staff-entered reviews: routes", () => {
  it("add, import and review requests need reviews.manage; shoppers and staff without it are refused", async () => {
    for (const user of [shopperUser, { ...staffUser, permissions: ["orders.manage"] }]) {
      const { app, service } = await build(ctx({ tenant, user }));
      expect((await app.inject({ method: "POST", url: "/v1/reviews/", payload: { rating: 5 } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/v1/reviews/import", payload: { csv: "x" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/v1/reviews/import/check", payload: { csv: "x" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/v1/reviews/requests", payload: { orderId: id } })).statusCode).toBe(403);
      expect(service.createStaff).not.toHaveBeenCalled();
      expect(service.importCsv).not.toHaveBeenCalled();
    }
  });

  it("passes the staff user, forces dry run on check, audits create/import/request but not the check", async () => {
    const { app, service, seen } = await build(ctx({ tenant, user: staffUser }));
    seen.length = 0;
    await app.inject({ method: "POST", url: "/v1/reviews/", payload: { productId, rating: 5 } });
    expect(service.createStaff).toHaveBeenCalledWith(tenant.id, staffUser.id, { productId, rating: 5 });
    expect(seen[0]?.audit).toEqual({ action: "review.create", entity: "review", idParam: "id" });
    seen.length = 0;
    const check = await app.inject({ method: "POST", url: "/v1/reviews/import/check", payload: { csv: "a", dryRun: false } });
    expect(check.json()).toMatchObject({ dryRun: true, imported: 0 });
    expect(seen[0]?.audit).toBe(false);
    seen.length = 0;
    const done = await app.inject({ method: "POST", url: "/v1/reviews/import", payload: { csv: "a", dryRun: true, status: "pending" } });
    expect(done.json()).toMatchObject({ dryRun: false, imported: 1 });
    expect(service.importCsv).toHaveBeenLastCalledWith(tenant.id, staffUser.id, { csv: "a", dryRun: false, status: "pending" });
    expect(seen[0]?.audit).toMatchObject({ action: "review.import" });
    expect((await app.inject({ method: "POST", url: "/v1/reviews/requests", payload: { orderId: "bad" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/reviews/requests", payload: { orderId: id } })).json()).toEqual({ status: "sent", channels: ["whatsapp"] });
    expect(service.requestReview).toHaveBeenCalledWith(tenant.id, id);
  });
});

describe("staff-entered reviews: service rules (checked before anything is saved)", () => {
  const input = { productId, rating: 5, authorName: "Priya Sharma", source: "in_store" as const };

  it("validates first, 404s unknown products, refuses future dates", async () => {
    const products = { exists: vi.fn(async (_t: string, p: string) => p === productId) };
    const { service } = createReviews({ db, products });
    await expect(service.createStaff(tenant.id, "u1", { ...input, rating: 0 })).rejects.toBeInstanceOf(ZodError);
    expect(products.exists).not.toHaveBeenCalled();
    await expect(service.createStaff(tenant.id, "u1", { ...input, productId: id })).rejects.toMatchObject({ status: 404 });
    await expect(service.createStaff(tenant.id, "u1", { ...input, date: "2999-01-01" })).rejects.toMatchObject({ status: 400, message: "The date can't be in the future" });
  });

  it("an order number must be a delivered order of this product; never verified on staff's word", async () => {
    const products = { exists: async () => true };
    const noLink = createReviews({ db, products, orders: { hasDelivered: async () => null } });
    await expect(noLink.service.createStaff(tenant.id, "u1", { ...input, orderNumber: "ORD/1" })).rejects.toMatchObject({ status: 400 });
    const find = vi.fn(async () => ({ orderId: id, delivered: false, hasProduct: true }));
    const { service } = createReviews({ db, products, orders: { hasDelivered: async () => null, findForReview: find } });
    await expect(service.createStaff(tenant.id, "u1", { ...input, orderNumber: "ORD/1" })).rejects.toMatchObject({ status: 400, message: "Order ORD/1 isn't delivered yet" });
    expect(find).toHaveBeenCalledWith(tenant.id, "ORD/1", productId);
    find.mockResolvedValueOnce({ orderId: id, delivered: true, hasProduct: false });
    await expect(service.createStaff(tenant.id, "u1", { ...input, orderNumber: "ORD/1" })).rejects.toMatchObject({ message: "Order ORD/1 doesn't include this product" });
    find.mockResolvedValueOnce(null as never);
    await expect(service.createStaff(tenant.id, "u1", { ...input, orderNumber: "ORD/9" })).rejects.toMatchObject({ message: "No order ORD/9 in this shop" });
  });

  it("CSV import reports file errors without touching the database; review requests need the port", async () => {
    const { service } = createReviews({ db, products: { exists: async () => true } });
    expect(await service.importCsv(tenant.id, "u1", { csv: "sku,title\nx,y" })).toMatchObject({ error: "Missing columns: rating, name", imported: 0 });
    await expect(service.importCsv(tenant.id, "u1", { csv: 'sku,rating,name\n"open' })).rejects.toMatchObject({ status: 400 });
    await expect(service.requestReview(tenant.id, id)).rejects.toMatchObject({ status: 400 });
    const send = vi.fn(async () => ({ status: "skipped" as const, reason: "duplicate", channels: [] }));
    const withPort = createReviews({ db, products: { exists: async () => true }, requests: { send } });
    expect(await withPort.service.requestReview(tenant.id, id)).toEqual({ status: "skipped", reason: "duplicate", channels: [] });
  });
});

describe("createReviews", () => {
  it("returns the service, the module (with feature and permission) and the catalogue ratings port", async () => {
    const products = { exists: vi.fn(async () => true) };
    const { service, module, ratingsPort } = createReviews({ db, products });
    expect(module.id).toBe("reviews");
    expect(Object.keys(module.tables ?? {}).sort()).toEqual(["productReviews", "reviewVotes"]);
    expect(module.features).toEqual([expect.objectContaining({ key: "reviews", module: "reviews", shopToggle: true })]);
    expect(module.permissions).toEqual([expect.objectContaining({ key: "reviews.manage", module: "reviews" })]);
    const spy = vi.spyOn(service, "ratings").mockResolvedValue([]);
    await ratingsPort.ratings("t", ["p"]);
    expect(spy).toHaveBeenCalledWith("t", ["p"]);
  });

  it("ratings are zeros when the shop has reviews off (without touching the database)", async () => {
    const featureGate = { isEnabled: vi.fn(async () => false) };
    const { service } = createReviews({ db, products: { exists: async () => true }, featureGate });
    expect(await service.ratings(tenant.id, [productId, productId])).toEqual([{ productId, average: 0, count: 0 }]);
    expect(featureGate.isEnabled).toHaveBeenCalledWith(tenant.id, "reviews");
    expect(await service.ratings(tenant.id, [])).toEqual([]);
  });

  it("submit validates before any lookup and 404s unknown products", async () => {
    const products = { exists: vi.fn(async () => false) };
    const { service } = createReviews({ db, products });
    await expect(service.submit(tenant.id, shopperUser.id, productId, { rating: 9 })).rejects.toBeInstanceOf(ZodError);
    expect(products.exists).not.toHaveBeenCalled();
    await expect(service.submit(tenant.id, shopperUser.id, productId, { rating: 4 })).rejects.toMatchObject({ status: 404 });
  });

  it("settings fall back to verified when the port fails", async () => {
    const { service } = createReviews({ db, products: { exists: async () => true }, settings: { get: async () => Promise.reject(new Error("down")) } });
    expect(await service.settings(tenant.id)).toEqual({ autoApprove: "verified" });
    const all = createReviews({ db, products: { exists: async () => true }, settings: { get: async () => ({ autoApprove: "all" }) } });
    expect(await all.service.settings(tenant.id)).toEqual({ autoApprove: "all" });
  });
});
