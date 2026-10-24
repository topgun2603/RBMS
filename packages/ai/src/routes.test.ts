import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AI_FEATURES, AI_PERMISSIONS, AI_PERMISSION_KEYS } from "./features";
import { aiAdminRoutes, aiRoutes } from "./routes";
import type { AiService } from "./service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";

function stub() {
  return {
    status: vi.fn(async (t: string) => ({ ready: true, tenant: t })),
    usage: vi.fn(async (_t: string, days: number) => ({ days, byFeature: [], byDay: [], savedWithoutEdits: null })),
    recentRuns: vi.fn(async () => []),
    feedback: vi.fn(async (_t: string, id: string, outcome: string) => ({ ok: true, runId: id, outcome })),
    run: vi.fn(async () => ({ output: "OK", runId: RUN, credits: 1, provider: "mock", model: "claude-haiku-5-5", usage: {} })),
    adminUsage: vi.fn(async (month?: string) => ({ period: month ?? "2026-10", items: [] })),
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
    return reply.status(500).send({ error: { code: "other" } });
  });
  await app.register(async (s) => aiRoutes(service as unknown as AiService)(s), { prefix: "/v1/ai" });
  await app.register(async (s) => aiAdminRoutes(service as unknown as AiService)(s), { prefix: "/v1/admin/ai" });
  return app;
}

const tenant = { id: TENANT, slug: "kumar", planId: "bl-starter", appId: "BL" };
const as = (roles: string[], permissions: string[] = []): Partial<RequestContext> => ({
  tenant,
  user: { id: "u1", sessionId: "s", platformRoles: [], tenantRoles: roles, permissions } as RequestContext["user"],
});
const owner = as(["owner"], ["*"]);
const demo: Partial<RequestContext> = { tenant, user: { id: "d", sessionId: "s", platformRoles: ["demo"], tenantRoles: ["staff", "role:demo"], permissions: ["*.view", "invoices.credit-book"] } as RequestContext["user"] };
const superAdmin: Partial<RequestContext> = { user: { id: "sa", sessionId: "s", platformRoles: ["superadmin"], tenantRoles: [] } as RequestContext["user"] };

describe("ai routes", () => {
  it("status needs a signed-in member of a shop and reads that shop only", async () => {
    const s = stub();
    expect((await (await build(s)).inject("/v1/ai/status")).statusCode).toBe(401);
    const res = await (await build(s, owner)).inject("/v1/ai/status");
    expect(res.statusCode).toBe(200);
    expect(s.status).toHaveBeenCalledWith(TENANT);
  });

  it("usage and recent runs are for ai.manage: owners yes, plain staff no, staff with the permission yes", async () => {
    const s = stub();
    expect((await (await build(s, owner)).inject("/v1/ai/usage?days=7")).statusCode).toBe(200);
    expect(s.usage).toHaveBeenCalledWith(TENANT, 7);
    expect((await (await build(s, as(["staff"], ["*.view", "ai.use"]))).inject("/v1/ai/usage")).statusCode).toBe(403);
    expect((await (await build(s, as(["staff"], ["ai.manage"]))).inject("/v1/ai/runs")).statusCode).toBe(200);
    expect((await (await build(s, owner)).inject("/v1/ai/usage?days=0")).statusCode).toBe(400);
  });

  it("feedback needs ai.use and a valid outcome", async () => {
    const s = stub();
    const url = `/v1/ai/runs/${RUN}/feedback`;
    const ok = await (await build(s, as(["staff"], ["ai.use"]))).inject({ method: "POST", url, payload: { outcome: "edited", note: "changed the rate" } });
    expect(ok.statusCode).toBe(200);
    expect(s.feedback).toHaveBeenCalledWith(TENANT, RUN, "edited", "changed the rate");
    expect((await (await build(s, as(["staff"], ["*.view"]))).inject({ method: "POST", url, payload: { outcome: "accepted" } })).statusCode).toBe(403);
    expect((await (await build(s, owner)).inject({ method: "POST", url, payload: { outcome: "great" } })).statusCode).toBe(400);
    expect((await (await build(s, owner)).inject({ method: "POST", url: "/v1/ai/runs/not-an-id/feedback", payload: { outcome: "accepted" } })).statusCode).toBe(400);
  });

  it("the read-only demo role cannot spend credits, give feedback or see usage", async () => {
    const s = stub();
    const app = await build(s, demo);
    expect((await app.inject({ method: "POST", url: "/v1/ai/ping" })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/ai/runs/${RUN}/feedback`, payload: { outcome: "accepted" } })).statusCode).toBe(403);
    expect((await app.inject("/v1/ai/usage")).statusCode).toBe(403);
    expect(s.run).not.toHaveBeenCalled();
    expect(s.feedback).not.toHaveBeenCalled();
  });

  it("the connection test runs a one-credit light-tier request as the signed-in user", async () => {
    const s = stub();
    const res = await (await build(s, owner)).inject({ method: "POST", url: "/v1/ai/ping" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, reply: "OK", credits: 1, provider: "mock" });
    expect(s.run).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, userId: "u1", feature: "ping", tier: "light" }));
  });

  it("platform usage is for super-admins only", async () => {
    const s = stub();
    expect((await (await build(s, owner)).inject("/v1/admin/ai/usage")).statusCode).toBe(403);
    expect((await (await build(s)).inject("/v1/admin/ai/usage")).statusCode).toBe(401);
    const res = await (await build(s, superAdmin)).inject("/v1/admin/ai/usage?month=2026-09");
    expect(res.statusCode).toBe(200);
    expect(s.adminUsage).toHaveBeenCalledWith("2026-09");
  });
});

describe("ai feature and permission keys", () => {
  it("declares one shop-toggle feature and two permissions", () => {
    expect(AI_FEATURES.map((f) => f.key)).toEqual(["ai"]);
    expect(AI_FEATURES[0]!.shopToggle).toBe(true);
    expect(AI_PERMISSIONS.map((p) => p.key)).toEqual([AI_PERMISSION_KEYS.use, AI_PERMISSION_KEYS.manage]);
  });
});
