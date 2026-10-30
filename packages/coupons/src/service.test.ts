import { emptyContext, type RequestContext } from "@rbms/core";
import { createDb } from "@rbms/db";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createCoupons } from "./index";
import { couponsRoutes } from "./routes";
import { AppError } from "@rbms/core";
import { count, sql } from "drizzle-orm";
import { coupons } from "./schema";
import {
  COUPON_SORT,
  COUPON_STATUSES,
  couponError,
  couponInputSchema,
  couponListConditions,
  couponStatusCondition,
  couponStatusSql,
  listQuerySchema,
  lockCouponStatement,
  publicValidateSchema,
  type CouponsService,
} from "./service";

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

describe("list query", () => {
  const T = "11111111-1111-4111-8111-111111111111";
  const NOW = new Date("2026-10-17T06:30:00.000Z");
  const where = (q: Record<string, unknown>, withStatus = true) =>
    db.select().from(coupons).where(couponListConditions(T, listQuerySchema.parse(q), NOW, withStatus)).toSQL();

  it("keeps the 50 / 200 limits the pickers use, takes comma lists, rejects unknown values", () => {
    expect(listQuerySchema.parse({})).toMatchObject({ limit: 50, offset: 0 });
    expect(listQuerySchema.parse({ limit: "200" }).limit).toBe(200);
    expect(() => listQuerySchema.parse({ limit: "201" })).toThrow(ZodError);
    expect(listQuerySchema.parse({ status: "active,used_up", type: "flat", q: "  " })).toMatchObject({ status: ["active", "used_up"], type: ["flat"], q: undefined });
    expect(() => listQuerySchema.parse({ status: "live" })).toThrow(ZodError);
    expect(() => listQuerySchema.parse({ type: "bogo" })).toThrow(ZodError);
  });

  it("filters by tenant, type, on/off and code/description search", () => {
    const q = where({ type: "percent,flat", active: "false", q: "diwali_10" });
    expect(q.sql).toContain('"coupons"."tenant_id" = $1');
    expect(q.sql).toContain('"coupons"."type" in ($2, $3)');
    expect(q.sql).toContain('"coupons"."active" = $4');
    expect(q.sql).toContain('("coupons"."code" ilike $5 or "coupons"."description" ilike $6)');
    expect(q.params).toEqual([T, "percent", "flat", false, "%diwali\\_10%", "%diwali\\_10%"]);
  });

  it("expresses each derived status as SQL with the same precedence as the CASE", () => {
    const render = (s: (typeof COUPON_STATUSES)[number]) => db.select().from(coupons).where(couponStatusCondition(s, NOW)).toSQL();
    expect(render("off").sql).toMatch(/where "coupons"\."active" = \$1$/);
    expect(render("off").params).toEqual([false]);
    const expired = render("expired");
    expect(expired.sql).toContain('"coupons"."ends_at" is not null and "coupons"."ends_at" < $2::timestamptz');
    expect(expired.params).toEqual([true, NOW.toISOString()]);
    const scheduled = render("scheduled").sql;
    expect(scheduled).toContain("not (");
    expect(scheduled).toContain('"coupons"."starts_at" > $');
    const usedUp = render("used_up").sql;
    expect(usedUp).toContain('"coupons"."usage_limit" is not null');
    expect(usedUp).toContain(`>= "coupons"."usage_limit"`);
    expect(usedUp).toContain(`from "coupon_redemptions" where "coupon_redemptions"."coupon_id" = "coupons"."id" and "coupon_redemptions"."status" = 'active'`);
    const active = render("active").sql;
    expect(active.match(/not \(/g)).toHaveLength(3);
    // Dates are bound as ISO strings, never raw Date objects.
    for (const s of COUPON_STATUSES) expect(render(s).params.some((p) => p instanceof Date)).toBe(false);
  });

  it("ORs the chosen statuses; the facet WHERE leaves status out", () => {
    const q = where({ status: "expired,off", type: "flat" });
    expect(q.sql).toContain(" or ");
    expect(q.params).toEqual(expect.arrayContaining([T, true, NOW.toISOString(), false, "flat"]));
    const facet = where({ status: "expired,off", type: "flat" }, false);
    expect(facet.params).toEqual([T, "flat"]);
  });

  it("counts every status in one CASE grouped by position", () => {
    const q = db.select({ key: couponStatusSql(NOW), n: count() }).from(coupons).where(couponListConditions(T, listQuerySchema.parse({}), NOW, false)).groupBy(sql`1`).toSQL();
    expect(q.sql).toMatch(/^select case when "coupons"\."active" = \$1 then 'off' when .* then 'expired' when .* then 'scheduled' when .* then 'used_up' else 'active' end, count\(\*\)/);
    expect(q.sql).toMatch(/group by 1$/);
  });

  it("sorts by code, uses, ends and created only (default newest first)", () => {
    expect(COUPON_SORT.default).toBe("-created");
    expect([...COUPON_SORT.keys].sort()).toEqual(["code", "created", "ends", "uses"]);
    const render = (s?: string) => db.select().from(coupons).orderBy(...COUPON_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "coupons"."created_at" desc nulls last, "coupons"."id" desc');
    expect(render("code")).toContain('order by "coupons"."code" asc nulls last, "coupons"."id" asc');
    expect(render("-ends")).toContain('order by "coupons"."ends_at" desc nulls last');
    expect(render("-uses")).toMatch(/order by \(select count\(\*\)::int from "coupon_redemptions" .*\) desc nulls last/);
    expect(() => render("value")).toThrow(AppError);
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
      priceCart: vi.fn(async () => ({ discount: 0 })),
      offers: {
        list: vi.fn(async () => ({ items: [], total: 0 })),
        create: vi.fn(async () => ({ id: "o1" })),
        get: vi.fn(async () => ({ id: "o1" })),
        update: vi.fn(async () => ({ id: "o1" })),
        remove: vi.fn(async () => undefined),
      },
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

  it("serves offer CRUD and the staff pricing preview under the coupons feature", async () => {
    expect((await (await build(ctx({ tenant }))).app.inject({ url: "/v1/coupons/offers" })).statusCode).toBe(401);
    const { app, service, features } = await build(ctx({ tenant, user: staffUser }));
    expect((await app.inject({ url: "/v1/coupons/offers?kind=bundle" })).statusCode).toBe(200);
    expect(service.offers.list).toHaveBeenCalledWith(tenant.id, { kind: "bundle" });
    await app.inject({ method: "POST", url: "/v1/coupons/offers", payload: { kind: "bxgy" } });
    expect(service.offers.create).toHaveBeenCalledWith(tenant.id, { kind: "bxgy" });
    await app.inject({ url: `/v1/coupons/offers/${id}` });
    expect(service.offers.get).toHaveBeenCalledWith(tenant.id, id);
    await app.inject({ method: "PATCH", url: `/v1/coupons/offers/${id}`, payload: { active: false } });
    expect(service.offers.update).toHaveBeenCalledWith(tenant.id, id, { active: false });
    expect((await app.inject({ method: "DELETE", url: `/v1/coupons/offers/${id}` })).json()).toEqual({ ok: true });
    await app.inject({ method: "POST", url: "/v1/coupons/offers/preview", payload: { channel: "store", lines: [] } });
    expect(service.priceCart).toHaveBeenCalledWith(tenant.id, { channel: "store", lines: [] });
    expect(new Set(features)).toEqual(new Set(["coupons"]));
    const cashier = await build(ctx({ tenant, user: { ...staffUser, permissions: ["invoices.create"] } }));
    expect((await cashier.app.inject({ method: "POST", url: "/v1/coupons/offers", payload: {} })).statusCode).toBe(403);
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
    expect(Object.keys(module.tables ?? {}).sort()).toEqual(["couponRedemptions", "coupons", "offerRedemptions", "offers"]);
    expect(module.features?.map((f) => f.key)).toEqual(["coupons"]);
    expect(module.permissions.map((p) => p.key)).toEqual(["coupons.manage"]);
    expect(typeof service.redeem).toBe("function");
  });
});
