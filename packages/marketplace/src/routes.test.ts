import { AppError, emptyContext, forbidden, type RequestContext } from "@rbms/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { marketplaceRoutes } from "./routes";
import type { MarketplaceService } from "./service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ID = "44444444-4444-4444-8444-444444444444";
const VENDOR = { id: "55555555-5555-4555-8555-555555555555", status: "active", name: "Murugan" };
const OTHER = "66666666-6666-4666-8666-666666666666";

function stubService(role: "owner" | "staff" = "owner") {
  return {
    publicVendor: vi.fn(async () => ({ id: VENDOR.id, slug: "murugan" })),
    publicSellers: vi.fn(async () => ({ items: [], products: {} })),
    apply: vi.fn(async () => ({ id: VENDOR.id, status: "pending" })),
    memberships: vi.fn(async () => [{ vendorId: VENDOR.id, slug: "murugan", name: "Murugan", role }]),
    resolveVendor: vi.fn(async (_t: string, userId: string, header?: string | null) => {
      if (userId === "stranger") throw forbidden("You're not a seller in this shop");
      if (header && header !== "murugan" && header !== VENDOR.id) throw forbidden("You're not a member of this seller");
      return { vendor: VENDOR, role };
    }),
    vendorSelf: vi.fn(async () => ({ id: VENDOR.id, role })),
    updateProfile: vi.fn(async () => ({ id: VENDOR.id })),
    setPayoutAccount: vi.fn(async () => ({ payoutAccount: { type: "upi" }, payoutAccountStatus: "pending" })),
    listVendorOrders: vi.fn(async () => ({
      items: [
        {
          orderNumber: "ORD/26-27/0001",
          vendorName: "Murugan",
          placedAt: new Date("2026-10-15T04:30:00Z"),
          status: "delivered",
          settlementStatus: "eligible",
          subtotal: 30_000,
          discount: 3000,
          shippingShare: 3750,
          commission: 2700,
          net: 28_050,
          eligibleAt: null,
        },
      ],
      total: 1,
    })),
    listLedger: vi.fn(async () => ({ items: [], total: 0, balance: null })),
    listPayouts: vi.fn(async () => ({ items: [], total: 0 })),
    vendorProducts: vi.fn(async () => ({ items: [], total: 0 })),
    listVendors: vi.fn(async () => ({ items: [], total: 0, counts: {} })),
    createVendor: vi.fn(async () => ({ id: ID })),
    getVendor: vi.fn(async () => ({ id: ID })),
    updateVendor: vi.fn(async () => ({ id: ID })),
    deleteVendor: vi.fn(async () => undefined),
    setVendorStatus: vi.fn(async () => ({ id: ID })),
    addVendorUser: vi.fn(async () => ({ id: ID })),
    removeVendorUser: vi.fn(async () => ({ id: ID })),
    adjust: vi.fn(async () => ({ id: "e1" })),
    runPayouts: vi.fn(async () => ({ created: [], skipped: [] })),
    retryPayout: vi.fn(async () => ({ id: ID })),
    markPayoutPaid: vi.fn(async () => ({ id: ID, status: "paid" })),
    cancelPayout: vi.fn(async () => ({ id: ID, status: "cancelled" })),
    refreshPayouts: vi.fn(async () => []),
    listProductReviews: vi.fn(async () => ({ items: [], total: 0, counts: {} })),
    approveProductReview: vi.fn(async () => ({ id: ID, status: "approved" })),
    rejectProductReview: vi.fn(async () => ({ id: ID, status: "rejected" })),
    vendorStock: vi.fn(async () => ({ items: [], total: 0, locationId: OTHER })),
    adjustVendorStock: vi.fn(async () => ({ item: { qty: 7 }, before: 2, locationId: OTHER })),
    markFulfilment: vi.fn(async () => ({ id: ID })),
  };
}
type Stub = ReturnType<typeof stubService>;

async function build(service: Stub, ctx: Partial<RequestContext> = {}, onResponse?: (req: import("fastify").FastifyRequest) => void) {
  const app = Fastify();
  if (onResponse) app.addHook("onResponse", async (req) => onResponse(req));
  const configs: Record<string, unknown> = {};
  app.addHook("onRoute", (r) => {
    configs[`${r.method} ${r.url}`] = r.config;
  });
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "invalid_input" } });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: { code: "other" } });
  });
  await app.register(async (scoped) => marketplaceRoutes(service as unknown as MarketplaceService)(scoped), { prefix: "/v1/marketplace" });
  await app.ready();
  return { app, configs };
}

const tenant = { id: TENANT, slug: "shop", planId: null, appId: null };
const as = (userId: string, roles: string[] = [], permissions?: string[]): Partial<RequestContext> => ({
  tenant,
  user: { id: userId, sessionId: "s1", platformRoles: [], tenantRoles: roles, permissions },
});
const M = "/v1/marketplace";

describe("public", () => {
  it("seller page needs only a tenant", async () => {
    const service = stubService();
    const { app } = await build(service, { tenant });
    const res = await app.inject({ method: "GET", url: `${M}/public/vendors/murugan?limit=12` });
    expect(res.statusCode).toBe(200);
    expect(service.publicVendor).toHaveBeenCalledWith(TENANT, "murugan", { limit: 12 });
    const { app: none } = await build(stubService());
    expect((await none.inject({ method: "GET", url: `${M}/public/vendors/murugan` })).statusCode).toBe(403);
  });
  it("seller lookup splits comma lists and repeated params, needs only a tenant", async () => {
    const service = stubService();
    const { app, configs } = await build(service, { tenant });
    const res = await app.inject({ method: "GET", url: `${M}/public/sellers?ids=a,b&productIds=p1&productIds=p2,p3` });
    expect(res.statusCode).toBe(200);
    expect(service.publicSellers).toHaveBeenCalledWith(TENANT, { ids: ["a", "b"], productIds: ["p1", "p2", "p3"] });
    expect(configs[`GET ${M}/public/sellers`]).toMatchObject({ feature: "marketplace" });
    expect((await app.inject({ method: "GET", url: `${M}/public/sellers` })).statusCode).toBe(200);
    expect(service.publicSellers).toHaveBeenLastCalledWith(TENANT, { ids: [], productIds: [] });
    const { app: none } = await build(stubService());
    expect((await none.inject({ method: "GET", url: `${M}/public/sellers?ids=a` })).statusCode).toBe(403);
  });
  it("apply needs a signed-in user", async () => {
    const service = stubService();
    const { app } = await build(service, { tenant });
    expect((await app.inject({ method: "POST", url: `${M}/public/vendors/apply`, payload: { name: "X" } })).statusCode).toBe(401);
    const { app: signed } = await build(service, as("u1", ["member"]));
    expect((await signed.inject({ method: "POST", url: `${M}/public/vendors/apply`, payload: { name: "X" } })).statusCode).toBe(200);
    expect(service.apply).toHaveBeenCalledWith(TENANT, "u1", { name: "X" });
  });
});

describe("seller routes", () => {
  it("need a signed-in seller member (403 otherwise)", async () => {
    const { app: anon } = await build(stubService(), { tenant });
    expect((await anon.inject({ method: "GET", url: `${M}/vendor/me` })).statusCode).toBe(401);
    const { app } = await build(stubService(), as("stranger", ["member"]));
    const res = await app.inject({ method: "GET", url: `${M}/vendor/me` });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `${M}/vendor/orders` })).statusCode).toBe(403);
  });

  it("pass the x-vendor header and refuse other sellers", async () => {
    const service = stubService();
    const { app } = await build(service, as("u1", ["member"]));
    expect((await app.inject({ method: "GET", url: `${M}/vendor/me`, headers: { "x-vendor": "murugan" } })).statusCode).toBe(200);
    expect(service.resolveVendor).toHaveBeenCalledWith(TENANT, "u1", "murugan");
    expect((await app.inject({ method: "GET", url: `${M}/vendor/me`, headers: { "x-vendor": "someone-else" } })).statusCode).toBe(403);
  });

  it("/vendor/mine lists memberships without choosing a seller", async () => {
    const service = stubService();
    const { app } = await build(service, as("u1", ["member"]));
    const res = await app.inject({ method: "GET", url: `${M}/vendor/mine` });
    expect(res.json()).toMatchObject({ total: 1, items: [{ slug: "murugan" }] });
    expect(service.resolveVendor).not.toHaveBeenCalled();
  });

  it("lists are always scoped to the seller, whatever the query says", async () => {
    const service = stubService();
    const { app } = await build(service, as("u1", ["member"]));
    await app.inject({ method: "GET", url: `${M}/vendor/orders?vendorId=${OTHER}&status=delivered` });
    expect(service.listVendorOrders).toHaveBeenCalledWith(TENANT, { vendorId: VENDOR.id, status: "delivered" });
    await app.inject({ method: "GET", url: `${M}/vendor/ledger?vendorId=${OTHER}` });
    expect(service.listLedger).toHaveBeenCalledWith(TENANT, { vendorId: VENDOR.id });
    await app.inject({ method: "GET", url: `${M}/vendor/payouts?vendorId=${OTHER}` });
    expect(service.listPayouts).toHaveBeenCalledWith(TENANT, { vendorId: VENDOR.id });
  });

  it("orders export as CSV", async () => {
    const { app } = await build(stubService(), as("u1", ["member"]));
    const res = await app.inject({ method: "GET", url: `${M}/vendor/orders?format=csv` });
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain("ORD/26-27/0001");
    expect(res.body).toContain("280.50");
  });

  it("profile and payout account", async () => {
    const service = stubService();
    const { app } = await build(service, as("u1", ["member"]));
    expect((await app.inject({ method: "PATCH", url: `${M}/vendor/profile`, payload: { description: "Silks" } })).statusCode).toBe(200);
    expect(service.updateProfile).toHaveBeenCalledWith(TENANT, VENDOR, "owner", { description: "Silks" });
    const acc = { type: "upi", vpa: "ab@ybl" };
    expect((await app.inject({ method: "PUT", url: `${M}/vendor/payout-account`, payload: acc })).statusCode).toBe(200);
    expect(service.setPayoutAccount).toHaveBeenCalledWith(TENANT, VENDOR.id, acc, "vendor");

    const { app: staffUser } = await build(stubService("staff"), as("u2", ["member"]));
    expect((await staffUser.inject({ method: "PUT", url: `${M}/vendor/payout-account`, payload: acc })).statusCode).toBe(403);
  });
});

describe("seller reviews, stock and fulfilment", () => {
  it("review status and stock are scoped to the seller whatever the query says", async () => {
    const service = stubService();
    const { app } = await build(service, as("u1", ["member"]));
    await app.inject({ method: "GET", url: `${M}/vendor/product-reviews?vendorId=${OTHER}&productIds=${ID}` });
    expect(service.listProductReviews).toHaveBeenCalledWith(TENANT, { productIds: ID, vendorId: VENDOR.id });
    await app.inject({ method: "GET", url: `${M}/vendor/stock?productIds=${ID}` });
    expect(service.vendorStock).toHaveBeenCalledWith(TENANT, VENDOR, { productIds: ID });
  });

  it("stock adjust passes the seller, variant and user, and records an audit before/after", async () => {
    const service = stubService();
    let detail: unknown;
    const { app, configs } = await build(service, as("u1", ["member"]), (req) => {
      detail = req.auditDetail;
    });
    const body = { mode: "set", qty: 7, reason: "Counted shelf" };
    const res = await app.inject({ method: "POST", url: `${M}/vendor/stock/${ID}/adjust`, payload: body });
    expect(res.statusCode).toBe(200);
    expect(service.adjustVendorStock).toHaveBeenCalledWith(TENANT, VENDOR, ID, body, "u1");
    expect(detail).toEqual({ before: { qty: 2, locationId: OTHER }, after: { qty: 7, vendorId: VENDOR.id } });
    expect(configs[`POST ${M}/vendor/stock/:variantId/adjust`]).toMatchObject({ audit: { action: "marketplace.vendor_stock.adjust", idParam: "variantId" } });
    expect((await app.inject({ method: "POST", url: `${M}/vendor/stock/not-a-uuid/adjust`, payload: body })).statusCode).toBe(400);
  });

  it("packed / shipped go to the seller's own vendor order", async () => {
    const service = stubService();
    const { app } = await build(service, as("u1", ["member"]));
    await app.inject({ method: "POST", url: `${M}/vendor/orders/${ID}/packed` });
    expect(service.markFulfilment).toHaveBeenLastCalledWith(TENANT, VENDOR, ID, "packed", {}, "u1");
    await app.inject({ method: "POST", url: `${M}/vendor/orders/${ID}/shipped`, payload: { trackingNumber: "DTDC123" } });
    expect(service.markFulfilment).toHaveBeenLastCalledWith(TENANT, VENDOR, ID, "shipped", { trackingNumber: "DTDC123" }, "u1");
  });

  it("non-sellers and other sellers are refused before the service runs", async () => {
    const service = stubService();
    const { app } = await build(service, as("stranger", ["member"]));
    for (const [method, url] of [
      ["GET", `${M}/vendor/stock`],
      ["POST", `${M}/vendor/stock/${ID}/adjust`],
      ["POST", `${M}/vendor/orders/${ID}/packed`],
      ["GET", `${M}/vendor/product-reviews`],
    ] as const) {
      expect((await app.inject({ method, url, payload: method === "POST" ? {} : undefined })).statusCode, url).toBe(403);
    }
    const { app: member } = await build(service, as("u1", ["member"]));
    expect((await member.inject({ method: "POST", url: `${M}/vendor/orders/${ID}/packed`, headers: { "x-vendor": "someone-else" } })).statusCode).toBe(403);
    expect(service.adjustVendorStock).not.toHaveBeenCalled();
    expect(service.markFulfilment).not.toHaveBeenCalled();
  });

  it("the review queue is staff only (marketplace.manage)", async () => {
    const service = stubService();
    const { app: seller } = await build(service, as("u1", ["member"]));
    expect((await seller.inject({ method: "POST", url: `${M}/product-reviews/${ID}/approve` })).statusCode).toBe(403);
    const { app } = await build(service, as("owner1", ["owner"]));
    await app.inject({ method: "GET", url: `${M}/product-reviews?status=pending` });
    expect(service.listProductReviews).toHaveBeenCalledWith(TENANT, { status: "pending" });
    await app.inject({ method: "POST", url: `${M}/product-reviews/${ID}/approve` });
    expect(service.approveProductReview).toHaveBeenCalledWith(TENANT, ID, "owner1");
    await app.inject({ method: "POST", url: `${M}/product-reviews/${ID}/reject`, payload: { reason: "Blurry photo" } });
    expect(service.rejectProductReview).toHaveBeenCalledWith(TENANT, ID, { reason: "Blurry photo" }, "owner1");
  });
});

describe("staff routes", () => {
  it("need a staff member with marketplace.manage", async () => {
    const { app: member } = await build(stubService(), as("u1", ["member"]));
    expect((await member.inject({ method: "GET", url: `${M}/vendors` })).statusCode).toBe(403);
    const { app: staff } = await build(stubService(), as("u1", ["staff"], ["orders.manage"]));
    const res = await staff.inject({ method: "GET", url: `${M}/vendors` });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("permission_denied");
    const { app: allowed } = await build(stubService(), as("u1", ["staff"], ["marketplace.*"]));
    expect((await allowed.inject({ method: "GET", url: `${M}/vendors` })).statusCode).toBe(200);
  });

  it("owners manage sellers", async () => {
    const service = stubService();
    const { app } = await build(service, as("owner1", ["owner"]));
    expect((await app.inject({ method: "POST", url: `${M}/vendors`, payload: { name: "Kumar" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${M}/vendors/${ID}/approve` })).statusCode).toBe(200);
    expect(service.setVendorStatus).toHaveBeenLastCalledWith(TENANT, ID, "active");
    await app.inject({ method: "POST", url: `${M}/vendors/${ID}/suspend` });
    expect(service.setVendorStatus).toHaveBeenLastCalledWith(TENANT, ID, "suspended");
    await app.inject({ method: "PUT", url: `${M}/vendors/${ID}/commission`, payload: { commissionBps: 1500 } });
    expect(service.updateVendor).toHaveBeenLastCalledWith(TENANT, ID, { commissionBps: 1500 });
    expect((await app.inject({ method: "PUT", url: `${M}/vendors/${ID}/commission`, payload: { commissionBps: 20_000 } })).statusCode).toBe(400);
    await app.inject({ method: "PUT", url: `${M}/vendors/${ID}/payout-account`, payload: { type: "upi", vpa: "ab@ybl" } });
    expect(service.setPayoutAccount).toHaveBeenLastCalledWith(TENANT, ID, { type: "upi", vpa: "ab@ybl" }, "staff");
    await app.inject({ method: "POST", url: `${M}/vendors/${ID}/adjustments`, payload: { amount: -500, note: "Late shipping" } });
    expect(service.adjust).toHaveBeenCalledWith(TENANT, ID, { amount: -500, note: "Late shipping" }, "owner1");
    await app.inject({ method: "DELETE", url: `${M}/vendors/${ID}/users/${OTHER}` });
    expect(service.removeVendorUser).toHaveBeenCalledWith(TENANT, ID, OTHER);
    expect((await app.inject({ method: "DELETE", url: `${M}/vendors/${ID}` })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: `${M}/vendors/not-a-uuid` })).statusCode).toBe(404);
  });

  it("payout actions", async () => {
    const service = stubService();
    const { app } = await build(service, as("owner1", ["owner"]));
    await app.inject({ method: "POST", url: `${M}/payouts/run`, payload: { until: "2026-10-14" } });
    expect(service.runPayouts).toHaveBeenCalledWith(TENANT, { until: "2026-10-14" }, "owner1");
    await app.inject({ method: "POST", url: `${M}/payouts/${ID}/retry` });
    expect(service.retryPayout).toHaveBeenCalledWith(TENANT, ID);
    await app.inject({ method: "POST", url: `${M}/payouts/${ID}/mark-paid`, payload: { reference: "UTR123" } });
    expect(service.markPayoutPaid).toHaveBeenCalledWith(TENANT, ID, { reference: "UTR123" });
    await app.inject({ method: "POST", url: `${M}/payouts/${ID}/cancel` });
    expect(service.cancelPayout).toHaveBeenCalledWith(TENANT, ID, "owner1");
    expect((await app.inject({ method: "POST", url: `${M}/payouts/${ID}/refresh` })).json()).toEqual({ items: [], total: 0 });
    const csv = await app.inject({ method: "GET", url: `${M}/payouts?format=csv` });
    expect(csv.headers["content-disposition"]).toContain("seller-payouts.csv");
    expect(service.listPayouts).toHaveBeenCalledWith(TENANT, { format: "csv", limit: 500, offset: 0 });
  });

  it("every route declares its feature; staff routes declare marketplace.manage", async () => {
    const { configs } = await build(stubService());
    const entries = Object.entries(configs).filter(([k]) => !k.startsWith("HEAD"));
    expect(entries.length).toBeGreaterThan(25);
    for (const [key, cfg] of entries) {
      const c = cfg as { feature?: string | string[]; permission?: string };
      if (key.includes("/vendor/stock")) expect(c.feature, key).toEqual(["marketplace", "inventory"]);
      else expect(c.feature, key).toMatch(/^marketplace(\.payouts)?$/);
      const isStaff = !key.includes("/public/") && !key.includes("/vendor/");
      if (isStaff) expect(c.permission, key).toBe("marketplace.manage");
      else expect(c.permission, key).toBeUndefined();
      if (key.includes("/payouts")) expect(c.feature, key).toBe("marketplace.payouts");
    }
  });
});
