import { AppError, emptyContext } from "@rbms/core";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { DEMO_ROLE, DEMO_SESSION_MS, demoAuthModule, demoGuard, parseDemoShops, type DemoAuthDeps } from "./demo-auth";
import { SlidingWindow } from "@rbms/auth";

async function guardApp(user: Record<string, unknown> | null, tenant: boolean, createdAt: Date, now = Date.now()) {
  const app = withErrors(Fastify());
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = emptyContext();
    if (tenant) req.ctx.tenant = { id: "t1", slug: "kumar", planId: null, appId: "BL" };
    if (user) req.ctx.user = user as never;
  });
  demoGuard({ sessionCreatedAt: async () => createdAt, now: () => now })(app);
  app.get("/v1/invoices", async () => ({ ok: true }));
  app.post("/v1/invoices/customers", async () => ({ ok: true }));
  app.post("/v1/auth/logout", async () => ({ ok: true }));
  app.get("/v1/importexport/customers.csv", async () => "x");
  app.post("/v1/auth/handoff", async () => ({ ok: true }));
  await app.ready();
  return app;
}
const demoUser = { id: "u", sessionId: "s", platformRoles: ["demo"], tenantRoles: ["staff", DEMO_ROLE], permissions: ["*.view"] };

function withErrors(app: FastifyInstance): FastifyInstance {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    return reply.status(500).send({ error: { code: "internal", message: String(err) } });
  });
  return app;
}

describe("demoGuard", () => {
  it("lets demo users read", async () => {
    const app = await guardApp(demoUser, true, new Date());
    expect((await app.inject({ method: "GET", url: "/v1/invoices?x=1" })).statusCode).toBe(200);
  });
  it("refuses writes with 403 demo_read_only", async () => {
    const app = await guardApp(demoUser, true, new Date());
    const r = await app.inject({ method: "POST", url: "/v1/invoices/customers", payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("demo_read_only");
  });
  it("allows sign-out only", async () => {
    const app = await guardApp(demoUser, true, new Date());
    expect((await app.inject({ method: "POST", url: "/v1/auth/logout" })).statusCode).toBe(200);
  });
  it("blocks exports and handoffs to other shops", async () => {
    const app = await guardApp(demoUser, true, new Date());
    expect((await app.inject({ method: "GET", url: "/v1/importexport/customers.csv" })).json().error.code).toBe("demo_not_available");
    expect((await app.inject({ method: "POST", url: "/v1/auth/handoff" })).json().error.code).toBe("demo_not_available");
  });
  it("refuses another shop (no roles there)", async () => {
    const app = await guardApp({ ...demoUser, tenantRoles: [], permissions: [] }, true, new Date());
    const r = await app.inject({ method: "GET", url: "/v1/invoices" });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("demo_wrong_shop");
  });
  it("expires after two hours", async () => {
    const now = Date.now();
    const app = await guardApp(demoUser, true, new Date(now - DEMO_SESSION_MS - 1000), now);
    const r = await app.inject({ method: "GET", url: "/v1/invoices" });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe("demo_expired");
  });
  it("does not touch normal users", async () => {
    const app = await guardApp({ ...demoUser, platformRoles: [], tenantRoles: ["owner"], permissions: ["*"] }, true, new Date(0));
    expect((await app.inject({ method: "POST", url: "/v1/invoices/customers", payload: {} })).statusCode).toBe(200);
  });
});

function signInDeps(over: Partial<DemoAuthDeps> = {}) {
  const calls: string[] = [];
  const deps: DemoAuthDeps = {
    shops: parseDemoShops("Kumar, arusuvai"),
    tenants: { getBySlug: async (s) => (s === "kumar" || s === "other" ? { id: `id-${s}`, slug: s, status: "active" } : null) },
    users: { ensureDemoUser: async (s) => (calls.push(`user:${s}`), { id: `u-${s}` }) },
    memberships: { rolesFor: async () => [], addMember: async (_t, _u, roles) => void calls.push(`member:${roles.join("+")}`) },
    sessions: { createDemoSession: async (_u, _m, exp) => (calls.push(`session:${exp.getTime()}`), { token: "tok" }) },
    handoffs: {
      create: async (_u, _m, t) => (calls.push(`handoff:${t}`), { code: "c".repeat(24), expiresAt: new Date(), expiresInSeconds: 60 }),
      appUrl: async () => "http://kumar.localhost:3001",
    },
    limiter: new SlidingWindow(3, 60_000),
    loginUrl: (a, c) => `${a}/login?handoff=${c}`,
    ...over,
  };
  return { deps, calls };
}
async function signInApp(deps: DemoAuthDeps) {
  const app = withErrors(Fastify());
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = emptyContext();
    req.ctx.ip = "1.2.3.4";
  });
  await app.register(async (s) => demoAuthModule(deps).routes!(s), { prefix: "/v1/auth/demo" });
  await app.ready();
  return app;
}

describe("POST /v1/auth/demo", () => {
  it("signs in a demo shop: dedicated user, demo role, bound handoff, 2h session", async () => {
    const { deps, calls } = signInDeps({ now: () => 1_000_000 });
    const app = await signInApp(deps);
    const r = await app.inject({ method: "POST", url: "/v1/auth/demo", payload: { shop: "kumar" } });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.url).toBe(`http://kumar.localhost:3001/login?handoff=${"c".repeat(24)}`);
    expect(b.readOnly).toBe(true);
    expect(calls).toEqual(["user:kumar", "member:staff+role:demo", `session:${1_000_000 + DEMO_SESSION_MS}`, "handoff:id-kumar"]);
  });
  it("refuses a shop that is not flagged as demo", async () => {
    const { deps, calls } = signInDeps();
    const app = await signInApp(deps);
    const r = await app.inject({ method: "POST", url: "/v1/auth/demo", payload: { shop: "other" } });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("demo_not_available");
    expect(calls).toEqual([]);
  });
  it("is off when no shops are configured", async () => {
    const { deps } = signInDeps({ shops: parseDemoShops("") });
    const app = await signInApp(deps);
    expect((await app.inject({ method: "POST", url: "/v1/auth/demo", payload: { shop: "kumar" } })).statusCode).toBe(404);
  });
  it("rate-limits per IP", async () => {
    const { deps } = signInDeps();
    const app = await signInApp(deps);
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: "POST", url: "/v1/auth/demo", payload: { shop: "kumar" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/v1/auth/demo", payload: { shop: "kumar" } })).statusCode).toBe(429);
  });
});
