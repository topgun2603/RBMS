import { AppError, emptyContext, type RequestContext } from "@rbms/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { subscriptionsRoutes } from "./routes";
import type { SubscriptionsService } from "./service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PAYMENT = "22222222-2222-4222-8222-222222222222";

function stub() {
  return {
    allowMock: true,
    providerName: "mock",
    addons: vi.fn(async () => ({ items: [] })),
    addonPreview: vi.fn(async () => ({ kind: "buy" })),
    setAddon: vi.fn(async () => ({ applied: "after_payment" })),
    cancelAddon: vi.fn(async () => ({ applied: "period_end" })),
    cancelAddonPayment: vi.fn(async () => ({ payment: { id: PAYMENT } })),
    mockPay: vi.fn(async () => ({ ok: true })),
    adminAddons: vi.fn(async () => ({ items: [] })),
    compAddon: vi.fn(async () => ({ addons: [] })),
    endAddon: vi.fn(async () => ({ addons: [] })),
  };
}

async function build(service: ReturnType<typeof stub>, ctx: Partial<RequestContext> = {}) {
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "invalid_input" } });
    return reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: { code: "other" } });
  });
  await app.register(async (s) => subscriptionsRoutes(service as unknown as SubscriptionsService)(s), { prefix: "/v1/subscriptions" });
  return app;
}

const shopUser = (roles: string[], permissions: string[] = []): Partial<RequestContext> => ({
  tenant: { id: TENANT, slug: "anbu", planId: "ec-pro", appId: "EC" },
  user: { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: roles, permissions } as RequestContext["user"],
});
const superAdmin: Partial<RequestContext> = { user: { id: "sa", sessionId: "s", platformRoles: ["superadmin"], tenantRoles: [] } as RequestContext["user"] };

describe("add-on routes", () => {
  it("shop owners and admins manage add-ons for their own shop", async () => {
    for (const role of ["owner", "admin"]) {
      const service = stub();
      const app = await build(service, shopUser([role]));
      expect((await app.inject("/v1/subscriptions/addons")).statusCode).toBe(200);
      expect(service.addons).toHaveBeenCalledWith(TENANT);
      const body = { addonId: "ec-extra-staff", quantity: 2 };
      expect((await app.inject({ method: "POST", url: "/v1/subscriptions/addons/preview", payload: body })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/v1/subscriptions/addons", payload: body })).statusCode).toBe(200);
      expect(service.setAddon).toHaveBeenCalledWith(TENANT, body, expect.objectContaining({ userId: "u1" }));
      expect((await app.inject({ method: "POST", url: "/v1/subscriptions/addons/ec-extra-staff/cancel" })).statusCode).toBe(200);
      expect(service.cancelAddon).toHaveBeenCalledWith(TENANT, "ec-extra-staff", expect.anything());
      expect((await app.inject({ method: "POST", url: `/v1/subscriptions/addons/payments/${PAYMENT}/cancel` })).statusCode).toBe(200);
      expect(service.cancelAddonPayment).toHaveBeenCalledWith(TENANT, PAYMENT, expect.anything());
    }
  });

  it("staff without the permission, signed-out users and requests without a shop are refused", async () => {
    const service = stub();
    expect((await (await build(service, shopUser(["staff"]))).inject("/v1/subscriptions/addons")).statusCode).toBe(403);
    expect((await (await build(service, { tenant: shopUser(["owner"]).tenant })).inject("/v1/subscriptions/addons")).statusCode).toBe(401);
    expect((await (await build(service, { user: shopUser(["owner"]).user })).inject("/v1/subscriptions/addons")).statusCode).toBeGreaterThanOrEqual(400);
    expect(service.addons).not.toHaveBeenCalled();
  });

  it("validates the body (quantity a whole number 0..1000)", async () => {
    const service = stub();
    const app = await build(service, shopUser(["owner"]));
    for (const payload of [{ addonId: "x", quantity: -1 }, { addonId: "x", quantity: 1.5 }, { quantity: 1 }]) {
      expect((await app.inject({ method: "POST", url: "/v1/subscriptions/addons", payload })).statusCode).toBe(400);
    }
    expect(service.setAddon).not.toHaveBeenCalled();
  });

  it("super-admin only: a shop's add-ons, comp and end", async () => {
    const service = stub();
    const owner = await build(service, shopUser(["owner"]));
    expect((await owner.inject(`/v1/subscriptions/admin/${TENANT}/addons`)).statusCode).toBe(403);
    expect((await owner.inject({ method: "POST", url: `/v1/subscriptions/admin/${TENANT}/addons/comp`, payload: { addonId: "x" } })).statusCode).toBe(403);
    const admin = await build(service, superAdmin);
    expect((await admin.inject(`/v1/subscriptions/admin/${TENANT}/addons`)).statusCode).toBe(200);
    const comp = await admin.inject({ method: "POST", url: `/v1/subscriptions/admin/${TENANT}/addons/comp`, payload: { addonId: "ec-wa-1000", quantity: 2, until: "2026-12-31" } });
    expect(comp.statusCode).toBe(200);
    const [tenantId, input] = service.compAddon.mock.calls[0] as unknown as [string, { addonId: string; quantity: number; until: Date }];
    expect(tenantId).toBe(TENANT);
    expect(input).toMatchObject({ addonId: "ec-wa-1000", quantity: 2 });
    expect(input.until.toISOString()).toBe("2026-12-31T18:29:59.000Z");
    expect((await admin.inject({ method: "POST", url: `/v1/subscriptions/admin/${TENANT}/addons/ec-wa-1000/end` })).statusCode).toBe(200);
    expect(service.endAddon).toHaveBeenCalledWith(TENANT, "ec-wa-1000", expect.anything());
  });

  it("the mock pay route exists only with the mock provider in development", async () => {
    const service = stub();
    const app = await build(service);
    expect((await app.inject({ method: "POST", url: "/v1/subscriptions/mock/pay", payload: { paymentId: "plink_mock_1" } })).statusCode).toBe(200);
    expect(service.mockPay).toHaveBeenCalledWith("plink_mock_1");
    const live = await build({ ...stub(), allowMock: false, providerName: "razorpay" });
    expect((await live.inject({ method: "POST", url: "/v1/subscriptions/mock/pay", payload: { paymentId: "x" } })).statusCode).toBe(404);
  });
});
