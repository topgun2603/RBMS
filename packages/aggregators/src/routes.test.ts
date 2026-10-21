import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { aggregatorsRoutes } from "./routes";
import type { AggregatorsService } from "./service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";

function stub() {
  return {
    handleWebhook: vi.fn(async () => ({ ok: true, kind: "order", id: ORDER, duplicate: false })),
    listOrders: vi.fn(async () => ({ items: [], total: 0 })),
    accept: vi.fn(async () => ({ id: ORDER, status: "accepted" })),
    reject: vi.fn(async () => ({ id: ORDER, status: "rejected" })),
    saveConnection: vi.fn(async () => ({ provider: "urbanpiper" })),
    connections: vi.fn(async () => []),
    ecoReport: vi.fn(async () => ({ summary: [] })),
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
  await app.register(async (s) => aggregatorsRoutes(service as unknown as AggregatorsService)(s), { prefix: "/v1/aggregators" });
  return app;
}

const as = (roles: string[]): Partial<RequestContext> => ({
  tenant: { id: TENANT, slug: "annapoorna", planId: null, appId: "RS" },
  user: { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: roles },
});

describe("webhook route", () => {
  it("is public and passes the exact bytes and lower-cased headers", async () => {
    const service = stub();
    const app = await build(service);
    const payload = '{ "order":  {"details": {}} }';
    const res = await app.inject({ method: "POST", url: "/v1/aggregators/urbanpiper/webhook/abcdefghijklmnopqrstuvwx", headers: { "content-type": "application/json", "X-Webhook-Secret": "s3cret" }, payload });
    expect(res.statusCode).toBe(200);
    const [provider, key, raw, headers] = service.handleWebhook.mock.calls[0] as unknown as [string, string, Buffer, Record<string, string>];
    expect([provider, key]).toEqual(["urbanpiper", "abcdefghijklmnopqrstuvwx"]);
    expect(raw.toString("utf8")).toBe(payload);
    expect(headers["x-webhook-secret"]).toBe("s3cret");
  });

  it("returns the service's errors (401 bad signature)", async () => {
    const service = stub();
    service.handleWebhook.mockRejectedValueOnce(new AppError(401, "bad_signature", "no"));
    const app = await build(service);
    const res = await app.inject({ method: "POST", url: "/v1/aggregators/manual/webhook/abcdefghijklmnopqrstuvwx", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(res.statusCode).toBe(401);
  });
});

describe("staff routes", () => {
  it("need a signed-in shop member", async () => {
    const app = await build(stub());
    expect((await app.inject({ method: "GET", url: "/v1/aggregators/orders" })).statusCode).toBeGreaterThanOrEqual(401);
  });

  it("pass ids and bodies through", async () => {
    const service = stub();
    const app = await build(service, as(["staff"]));
    expect((await app.inject({ method: "GET", url: "/v1/aggregators/orders?status=done" })).statusCode).toBe(200);
    expect(service.listOrders).toHaveBeenCalledWith(TENANT, { status: "done" });
    await app.inject({ method: "POST", url: `/v1/aggregators/orders/${ORDER}/accept`, payload: { prepMinutes: 15 } });
    expect(service.accept).toHaveBeenCalledWith(TENANT, ORDER, { prepMinutes: 15 });
    await app.inject({ method: "PUT", url: "/v1/aggregators/connections/urbanpiper", payload: { autoAccept: true } });
    expect(service.saveConnection).toHaveBeenCalledWith(TENANT, "urbanpiper", { autoAccept: true });
    expect((await app.inject({ method: "POST", url: "/v1/aggregators/orders/not-a-uuid/accept" })).statusCode).toBe(404);
  });
});
