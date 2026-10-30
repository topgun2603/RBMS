import { AppError, emptyContext, type RequestContext } from "@rbms/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { paymentsRoutes } from "./routes";
import type { PaymentsService } from "./service";

const TENANT = "11111111-1111-4111-8111-111111111111";

function stubService(allowMock = true) {
  return {
    allowMock,
    checkout: vi.fn(async () => ({ orderId: "mock_1", provider: "mock" })),
    verify: vi.fn(async () => ({ status: "paid", amount: 100 })),
    mockComplete: vi.fn(async () => ({ status: "paid", amount: 100 })),
    handleWebhook: vi.fn(async () => ({ ok: true, result: "processed" })),
    getAccount: vi.fn(async () => ({ configured: false })),
    putAccount: vi.fn(async () => ({ configured: true })),
    deleteAccount: vi.fn(async () => undefined),
    listOrders: vi.fn(async () => ({ items: [], total: 0 })),
  };
}
type Stub = ReturnType<typeof stubService>;

async function build(service: Stub, ctx: Partial<RequestContext> = {}) {
  const app = Fastify();
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
  await app.register(async (scoped) => paymentsRoutes(service as unknown as PaymentsService)(scoped), { prefix: "/v1/payments" });
  return app;
}

const as = (roles: string[]): Partial<RequestContext> => ({
  tenant: { id: TENANT, slug: "shop", planId: null, appId: null },
  user: { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: roles },
});

describe("public routes", () => {
  it("checkout, verify and mock/complete need no auth", async () => {
    const service = stubService();
    const app = await build(service);
    expect((await app.inject({ method: "POST", url: "/v1/payments/checkout", payload: { kind: "invoice", ref: "x" } })).statusCode).toBe(200);
    expect(service.checkout).toHaveBeenCalledWith({ kind: "invoice", ref: "x" });
    expect((await app.inject({ method: "POST", url: "/v1/payments/verify", payload: { orderId: "o" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/payments/mock/complete", payload: { orderId: "mock_1" } })).statusCode).toBe(200);
  });

  it("does not register mock/complete when mock is off", async () => {
    const app = await build(stubService(false));
    expect((await app.inject({ method: "POST", url: "/v1/payments/mock/complete", payload: {} })).statusCode).toBe(404);
  });
});

describe("webhook route", () => {
  it("passes the exact raw JSON bytes and headers to the service", async () => {
    const service = stubService();
    const app = await build(service);
    const payload = '{ "event":"payment.captured",  "payload": {} }';
    const res = await app.inject({
      method: "POST",
      url: `/v1/payments/webhooks/razorpay/${TENANT}`,
      headers: { "content-type": "application/json", "x-razorpay-signature": "sig", "x-razorpay-event-id": "evt_1" },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const [tenantId, raw, sig, eventId] = service.handleWebhook.mock.calls[0] as unknown as [string, Buffer, string, string];
    expect(tenantId).toBe(TENANT);
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(raw.toString()).toBe(payload);
    expect(sig).toBe("sig");
    expect(eventId).toBe("evt_1");
  });

  it("maps a bad signature to 400 and rejects bad tenant ids", async () => {
    const service = stubService();
    service.handleWebhook.mockRejectedValueOnce(new AppError(400, "invalid_signature", "bad"));
    const app = await build(service);
    const res = await app.inject({
      method: "POST",
      url: `/v1/payments/webhooks/razorpay/${TENANT}`,
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_signature");
    const bad = await app.inject({ method: "POST", url: "/v1/payments/webhooks/razorpay/nope", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(bad.statusCode).toBe(400);
  });

  it("keeps normal JSON parsing for other routes", async () => {
    const service = stubService();
    const app = await build(service);
    await app.inject({ method: "POST", url: "/v1/payments/checkout", payload: { kind: "invoice", ref: "abc" } });
    expect(service.checkout).toHaveBeenCalledWith({ kind: "invoice", ref: "abc" });
  });
});

describe("owner and staff routes", () => {
  it("require sign-in", async () => {
    const app = await build(stubService());
    expect((await app.inject({ method: "GET", url: "/v1/payments/account" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/payments/orders" })).statusCode).toBe(401);
  });

  it("account routes are owner/admin only", async () => {
    const service = stubService();
    const staff = await build(service, as(["staff"]));
    expect((await staff.inject({ method: "GET", url: "/v1/payments/account" })).statusCode).toBe(403);
    expect((await staff.inject({ method: "PUT", url: "/v1/payments/account", payload: {} })).statusCode).toBe(403);
    expect((await staff.inject({ method: "DELETE", url: "/v1/payments/account" })).statusCode).toBe(403);

    const owner = await build(service, as(["owner"]));
    expect((await owner.inject({ method: "GET", url: "/v1/payments/account" })).statusCode).toBe(200);
    expect(service.getAccount).toHaveBeenCalledWith(TENANT);
    const put = await owner.inject({ method: "PUT", url: "/v1/payments/account", payload: { keyId: "rzp_test_x", enabled: true } });
    expect(put.statusCode).toBe(200);
    expect(service.putAccount).toHaveBeenCalledWith(TENANT, { keyId: "rzp_test_x", enabled: true });
    const del = await owner.inject({ method: "DELETE", url: "/v1/payments/account" });
    expect(del.json()).toEqual({ ok: true });
  });

  it("orders are visible to staff", async () => {
    const service = stubService();
    const app = await build(service, as(["staff"]));
    const res = await app.inject({ method: "GET", url: "/v1/payments/orders?purposeKind=invoice&limit=5" });
    expect(res.statusCode).toBe(200);
    expect(service.listOrders).toHaveBeenCalledWith(TENANT, { purposeKind: "invoice", limit: "5" });
    const member = await build(service, as(["member"]));
    expect((await member.inject({ method: "GET", url: "/v1/payments/orders" })).statusCode).toBe(403);
  });
});
