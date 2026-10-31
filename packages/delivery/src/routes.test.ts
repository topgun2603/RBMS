import { AppError, emptyContext, type RequestContext } from "@rbms/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { deliveryRoutes } from "./routes";
import type { DeliveryService } from "./service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ID = "44444444-4444-4444-8444-444444444444";

function stubService(allowMock = true) {
  return {
    allowMock,
    quote: vi.fn(async () => ({ serviceable: true, options: [], zone: null })),
    lookupPincode: vi.fn(async (pin: string) => ({ pincode: pin, city: "Chennai", district: "Chennai", state: "Tamil Nadu", stateCode: "33" })),
    handleShiprocketWebhook: vi.fn(async () => ({ ok: true, result: "processed" })),
    listZones: vi.fn(async () => ({ items: [], total: 0, implicitDefault: true })),
    createZone: vi.fn(async () => ({ id: ID })),
    updateZone: vi.fn(async () => ({ id: ID })),
    deleteZone: vi.fn(async () => undefined),
    listRates: vi.fn(async () => ({ items: [], total: 0 })),
    createRate: vi.fn(async () => ({ id: ID })),
    updateRate: vi.fn(async () => ({ id: ID })),
    deleteRate: vi.fn(async () => undefined),
    getAccount: vi.fn(async () => ({ configured: false })),
    putAccount: vi.fn(async () => ({ configured: true })),
    deleteAccount: vi.fn(async () => undefined),
    createShipment: vi.fn(async () => ({ id: ID })),
    listShipments: vi.fn(async () => ({ items: [], total: 0 })),
    getShipment: vi.fn(async () => ({ id: ID })),
    cancelShipment: vi.fn(async () => ({ id: ID, status: "cancelled" })),
    refreshShipment: vi.fn(async () => ({ id: ID })),
    labelUrl: vi.fn(async () => "https://s3/label.pdf"),
    mockAdvance: vi.fn(async () => ({ id: ID, status: "in_transit" })),
  };
}
type Stub = ReturnType<typeof stubService>;

async function build(service: Stub, ctx: Partial<RequestContext> = {}) {
  const app = Fastify();
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
  await app.register(async (scoped) => deliveryRoutes(service as unknown as DeliveryService)(scoped), { prefix: "/v1/delivery" });
  await app.ready();
  return { app, configs };
}

const tenant = { id: TENANT, slug: "shop", planId: null, appId: null };
const as = (roles: string[], permissions?: string[]): Partial<RequestContext> => ({
  tenant,
  user: { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: roles, permissions },
});

describe("public routes", () => {
  it("quote and pincode need a tenant but no user", async () => {
    const service = stubService();
    const { app } = await build(service, { tenant });
    const q = await app.inject({ method: "POST", url: "/v1/delivery/public/quote", payload: { pincode: "600001", weightGrams: 500, subtotal: 100, cod: true, stateCode: "29" } });
    expect(q.statusCode).toBe(200);
    // stateCode is not taken from public input
    expect(service.quote).toHaveBeenCalledWith(TENANT, { pincode: "600001", weightGrams: 500, subtotal: 100, cod: true });
    const p = await app.inject({ method: "GET", url: "/v1/delivery/public/pincode/600001" });
    expect(p.json()).toMatchObject({ stateCode: "33" });

    const { app: noTenant } = await build(stubService());
    expect((await noTenant.inject({ method: "GET", url: "/v1/delivery/public/pincode/600001" })).statusCode).toBe(403);
  });
});

describe("webhook", () => {
  it("passes tenant, x-api-key and body on both paths", async () => {
    const service = stubService();
    const { app } = await build(service);
    for (const path of ["courier", "shiprocket"]) {
      const res = await app.inject({
        method: "POST",
        url: `/v1/delivery/webhooks/${path}/${TENANT}`,
        headers: { "x-api-key": "tok" },
        payload: { awb: "A1", current_status: "DELIVERED" },
      });
      expect(res.statusCode).toBe(200);
    }
    expect(service.handleShiprocketWebhook).toHaveBeenNthCalledWith(1, TENANT, "tok", { awb: "A1", current_status: "DELIVERED" });
    expect((await app.inject({ method: "POST", url: "/v1/delivery/webhooks/courier/not-a-uuid", payload: {} })).statusCode).toBe(400);
  });
});

describe("staff routes", () => {
  it("need a staff member", async () => {
    const { app } = await build(stubService(), { tenant });
    expect((await app.inject({ method: "GET", url: "/v1/delivery/zones" })).statusCode).toBe(401);
    const { app: member } = await build(stubService(), as(["member"]));
    expect((await member.inject({ method: "GET", url: "/v1/delivery/zones" })).statusCode).toBe(403);
  });

  it("staff can read; writes need settings.manage / orders.manage", async () => {
    const service = stubService();
    const { app } = await build(service, as(["staff"], ["orders.manage"]));
    expect((await app.inject({ method: "GET", url: "/v1/delivery/zones" })).statusCode).toBe(200);
    const denied = await app.inject({ method: "POST", url: "/v1/delivery/zones", payload: { name: "TN" } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("permission_denied");
    expect((await app.inject({ method: "PUT", url: "/v1/delivery/account", payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/delivery/orders/${ID}/shipments`, payload: { provider: "manual" } })).statusCode).toBe(200);
    expect(service.createShipment).toHaveBeenCalledWith(TENANT, ID, { provider: "manual" });
  });

  it("owners do everything", async () => {
    const service = stubService();
    const { app } = await build(service, as(["owner"]));
    expect((await app.inject({ method: "POST", url: "/v1/delivery/zones", payload: { name: "TN" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/v1/delivery/rates/${ID}`, payload: { amount: 100 } })).statusCode).toBe(200);
    expect(service.updateRate).toHaveBeenCalledWith(TENANT, ID, { amount: 100 });
    expect((await app.inject({ method: "DELETE", url: `/v1/delivery/zones/${ID}` })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "GET", url: `/v1/delivery/shipments?orderId=${ID}` })).statusCode).toBe(200);
    expect(service.listShipments).toHaveBeenCalledWith(TENANT, { orderId: ID });
    expect((await app.inject({ method: "POST", url: `/v1/delivery/shipments/${ID}/cancel` })).json()).toMatchObject({ status: "cancelled" });
  });

  it("label redirects to the label URL", async () => {
    const { app } = await build(stubService(), as(["staff"]));
    const res = await app.inject({ method: "GET", url: `/v1/delivery/shipments/${ID}/label` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://s3/label.pdf");
  });

  it("mock-advance exists only when mock is allowed", async () => {
    const { app } = await build(stubService(true), as(["owner"]));
    expect((await app.inject({ method: "POST", url: `/v1/delivery/shipments/${ID}/mock-advance` })).statusCode).toBe(200);
    const { app: prod } = await build(stubService(false), as(["owner"]));
    expect((await prod.inject({ method: "POST", url: `/v1/delivery/shipments/${ID}/mock-advance` })).statusCode).toBe(404);
  });

  it("every route declares its feature; writes declare permissions", async () => {
    const { configs } = await build(stubService());
    const entries = Object.entries(configs).filter(([k]) => !k.startsWith("HEAD"));
    for (const [key, cfg] of entries) {
      if (key.includes("/webhooks/")) continue;
      expect((cfg as { feature?: string }).feature, key).toMatch(/^delivery(\.carriers)?$/);
    }
    expect(configs["POST /v1/delivery/zones"]).toMatchObject({ feature: "delivery", permission: "settings.manage" });
    expect(configs["PUT /v1/delivery/account"]).toMatchObject({ feature: "delivery.carriers", permission: "settings.manage" });
    expect(configs["POST /v1/delivery/orders/:orderId/shipments"]).toMatchObject({ feature: "delivery", permission: "orders.manage" });
  });
});
