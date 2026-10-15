import { emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createCoupons } from "./index";
import { couponsRoutes } from "./routes";
import { couponError, couponInputSchema, lockCouponStatement, publicValidateSchema, type CouponsService } from "./service";

// Never connects: only used to render SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const CAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("couponInputSchema", () => {
  it("upper-cases codes and fills defaults", () => {
    const c = couponInputSchema.parse({ code: " diwali10 ", type: "percent", value: 10 });
    expect(c).toMatchObject({
      code: "DIWALI10",
      minOrder: 0,
      appliesTo: "all",
      targetIds: [],
      channels: ["store"],
      active: true,
      firstOrderOnly: false,
      maxDiscount: null,
      startsAt: null,
      endsAt: null,
    });
  });
  it("validates values per type", () => {
    expect(() => couponInputSchema.parse({ code: "X10", type: "percent", value: 0 })).toThrow(ZodError);
    expect(() => couponInputSchema.parse({ code: "X10", type: "percent", value: 101 })).toThrow(ZodError);
    expect(() => couponInputSchema.parse({ code: "X10", type: "flat", value: 0 })).toThrow(ZodError);
    expect(couponInputSchema.parse({ code: "SHIPFREE", type: "free_shipping", value: 500 }).value).toBe(0);
  });
  it("rejects bad codes", () => {
    expect(() => couponInputSchema.parse({ code: "ab", type: "flat", value: 100 })).toThrow(ZodError);
    expect(() => couponInputSchema.parse({ code: "HELLO WORLD", type: "flat", value: 100 })).toThrow(ZodError);
  });
  it("needs targets when not for all items", () => {
    expect(() => couponInputSchema.parse({ code: "SAREE20", type: "percent", value: 20, appliesTo: "categories" })).toThrow(ZodError);
    const c = couponInputSchema.parse({ code: "SAREE20", type: "percent", value: 20, appliesTo: "categories", targetIds: [CAT, CAT] });
    expect(c.targetIds).toEqual([CAT]);
    expect(couponInputSchema.parse({ code: "ALL20", type: "percent", value: 20, targetIds: [CAT] }).targetIds).toEqual([]);
  });
  it("reads IST days and ISO date-times; end after start", () => {
    const c = couponInputSchema.parse({ code: "PONGAL", type: "flat", value: 5000, startsAt: "2027-01-14", endsAt: "2027-01-17" });
    expect(c.startsAt?.toISOString()).toBe("2027-01-13T18:30:00.000Z");
    expect(c.endsAt?.toISOString()).toBe("2027-01-17T18:29:59.999Z");
    const iso = couponInputSchema.parse({ code: "FLASH", type: "flat", value: 5000, startsAt: "2027-01-14T10:00:00+05:30" });
    expect(iso.startsAt?.toISOString()).toBe("2027-01-14T04:30:00.000Z");
    expect(() => couponInputSchema.parse({ code: "PONGAL", type: "flat", value: 1, startsAt: "2027-01-17", endsAt: "2027-01-14" })).toThrow(ZodError);
    expect(() => couponInputSchema.parse({ code: "PONGAL", type: "flat", value: 1, startsAt: "soon" })).toThrow(ZodError);
  });
  it("restricts channels", () => {
    expect(() => couponInputSchema.parse({ code: "X10", type: "flat", value: 1, channels: [] })).toThrow(ZodError);
    expect(() => couponInputSchema.parse({ code: "X10", type: "flat", value: 1, channels: ["tv"] })).toThrow(ZodError);
    expect(couponInputSchema.parse({ code: "X10", type: "flat", value: 1, channels: ["store", "pos", "store"] }).channels).toEqual(["store", "pos"]);
  });
  it("validates the public preview body", () => {
    expect(() => publicValidateSchema.parse({ code: "X", subtotal: -1 })).toThrow(ZodError);
    expect(publicValidateSchema.parse({ code: "X10", subtotal: 100, lines: [{ amount: 100, productId: "" }] }).lines?.[0]?.productId).toBeNull();
  });
});

describe("redeem locking", () => {
  it("locks the coupon row with SELECT … FOR UPDATE", () => {
    const { sql, params } = lockCouponStatement(db, "t1", "DIWALI10").toSQL();
    expect(sql).toMatch(/from "coupons" where \("coupons"\."tenant_id" = \$1 and "coupons"\."code" = \$2\) for update$/);
    expect(params).toEqual(["t1", "DIWALI10"]);
  });
  it("throws 409 coupon_invalid with the reason", () => {
    expect(couponError("usage_limit")).toMatchObject({ status: 409, code: "coupon_invalid", details: { reason: "usage_limit" } });
  });
});

describe("routes", () => {
  const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });
  const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "EC" };
  const staffUser = { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };

  async function build(reqCtx: RequestContext) {
    const service = {
      list: vi.fn(async () => ({ items: [], total: 0 })),
      create: vi.fn(async () => ({ id: "c1" })),
      get: vi.fn(async () => ({ id: "c1" })),
      update: vi.fn(async () => ({ id: "c1" })),
      remove: vi.fn(async () => undefined),
      redemptions: vi.fn(async () => ({ items: [], total: 0 })),
      validatePublic: vi.fn(async () => ({ valid: false, reason: "not_found", message: "x" })),
    } as unknown as CouponsService;
    const features: unknown[] = [];
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = reqCtx;
    });
    app.addHook("preHandler", async (req) => {
      features.push(req.routeOptions.config.feature);
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: true });
    });
    await app.register(couponsRoutes(service), { prefix: "/v1/coupons" });
    return { app, service, features };
  }
  const id = "22222222-2222-4222-8222-222222222222";

  it("needs a staff member for CRUD and declares the coupons feature", async () => {
    expect((await (await build(ctx({ tenant }))).app.inject({ url: "/v1/coupons" })).statusCode).toBe(401);
    const { app, service, features } = await build(ctx({ tenant, user: staffUser }));
    expect((await app.inject({ url: "/v1/coupons?active=true" })).statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(tenant.id, { active: "true" });
    await app.inject({ method: "POST", url: "/v1/coupons", payload: { code: "X10" } });
    expect(service.create).toHaveBeenCalledWith(tenant.id, { code: "X10" });
    await app.inject({ method: "PATCH", url: `/v1/coupons/${id}`, payload: { active: false } });
    expect(service.update).toHaveBeenCalledWith(tenant.id, id, { active: false });
    expect((await app.inject({ method: "DELETE", url: `/v1/coupons/${id}` })).json()).toEqual({ ok: true });
    await app.inject({ url: `/v1/coupons/${id}/redemptions` });
    expect(service.redemptions).toHaveBeenCalled();
    expect(new Set(features)).toEqual(new Set(["coupons"]));
  });

  it("enforces coupons.manage once permissions are present", async () => {
    const cashier = { ...staffUser, permissions: ["invoices.create"] };
    const { app, service } = await build(ctx({ tenant, user: cashier }));
    expect((await app.inject({ method: "POST", url: "/v1/coupons", payload: {} })).statusCode).toBe(403);
    expect(service.create).not.toHaveBeenCalled();
    expect((await app.inject({ url: "/v1/coupons" })).statusCode).toBe(200);
    const manager = await build(ctx({ tenant, user: { ...staffUser, permissions: ["coupons.manage"] } }));
    expect((await manager.app.inject({ method: "POST", url: "/v1/coupons", payload: {} })).statusCode).toBe(200);
  });

  it("accepts permission patterns (the Manager role's coupons.*)", async () => {
    const manager = await build(ctx({ tenant, user: { ...staffUser, permissions: ["*.view", "coupons.*"] } }));
    expect((await manager.app.inject({ method: "POST", url: "/v1/coupons", payload: {} })).statusCode).toBe(200);
    const other = await build(ctx({ tenant, user: { ...staffUser, permissions: ["*.view", "orders.*"] } }));
    expect((await other.app.inject({ method: "POST", url: "/v1/coupons", payload: {} })).statusCode).toBe(403);
  });

  it("serves the public preview with the request's tenant, no auth", async () => {
    const { app, service } = await build(ctx({ tenant }));
    const res = await app.inject({ method: "POST", url: "/v1/coupons/public/validate", payload: { code: "X10", subtotal: 100 } });
    expect(res.statusCode).toBe(200);
    expect(service.validatePublic).toHaveBeenCalledWith(tenant.id, { code: "X10", subtotal: 100 });
    const none = await build(ctx({}));
    expect((await none.app.inject({ method: "POST", url: "/v1/coupons/public/validate", payload: {} })).statusCode).toBe(400);
  });
});

describe("createCoupons", () => {
  it("returns the module with tables, features and permissions", () => {
    const { module, service } = createCoupons({ db });
    expect(module.id).toBe("coupons");
    expect(Object.keys(module.tables ?? {}).sort()).toEqual(["couponRedemptions", "coupons"]);
    expect(module.features?.map((f) => f.key)).toEqual(["coupons"]);
    expect(module.permissions.map((p) => p.key)).toEqual(["coupons.manage"]);
    expect(typeof service.redeem).toBe("function");
  });
});
