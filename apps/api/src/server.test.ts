import { badRequest, defineModule } from "@rbms/core";
import { createMonitoring, type ErrorContext } from "@rbms/monitoring";
import { describe, expect, it, vi } from "vitest";
import { bearerMatches } from "./ops";
import { buildServer, requestIdFor } from "./server";

const silent = { info() {}, warn() {}, error() {} };

async function setup(opts: { probes?: Record<string, () => Promise<unknown>>; failContext?: boolean; metricsToken?: string } = {}) {
  const monitoring = createMonitoring({ log: silent });
  const captured: Array<{ err: unknown; ctx?: ErrorContext }> = [];
  vi.spyOn(monitoring.reporter, "capture").mockImplementation((err, ctx) => {
    captured.push({ err, ctx });
    return "0".repeat(32);
  });
  const contextHook = (app: import("fastify").FastifyInstance) =>
    app.addHook("onRequest", async (req) => {
      if (opts.failContext) throw new Error("database is down");
      req.ctx.tenant = { id: "tenant-1", slug: "anbu", planId: null, appId: null };
    });
  const app = await buildServer({
    corsOrigins: [],
    contextHooks: [contextHook],
    modules: [
      defineModule({
        id: "demo",
        routes: (r) => {
          r.get("/boom", async () => {
            throw new Error("kaboom token=abc");
          });
          r.get("/bad", async () => {
            throw badRequest("nope");
          });
          r.get("/ok", async (req) => ({ tenant: req.ctx.tenant?.id }));
        },
      }),
    ],
    errorReporter: monitoring.reporter,
    ops: {
      metrics: monitoring.metrics,
      probes: (opts.probes ?? { postgres: async () => {} }) as never,
      readyTimeoutMs: 100,
      metricsToken: opts.metricsToken,
      version: { sha: "abc123", buildTime: "2026-10-16T00:00:00Z", startedAt: "x", node: "v22", env: "test" },
    },
  });
  return { app, captured };
}

describe("error reporting", () => {
  it("reports 5xx with request id, tenant and route, and answers with the request id", async () => {
    const { app, captured } = await setup();
    const res = await app.inject({ url: "/v1/demo/boom", headers: { "x-request-id": "req-12345678", authorization: "Bearer s3cret" } });
    expect(res.statusCode).toBe(500);
    expect(res.headers["x-request-id"]).toBe("req-12345678");
    expect(res.json()).toEqual({ error: { code: "internal", message: "Something went wrong", requestId: "req-12345678" } });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.ctx).toMatchObject({ requestId: "req-12345678", tenantId: "tenant-1", route: "/v1/demo/boom", method: "GET" });
  });

  it("never reports 4xx", async () => {
    const { app, captured } = await setup();
    expect((await app.inject({ url: "/v1/demo/bad" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/v1/demo/missing" })).statusCode).toBe(404);
    expect(captured).toHaveLength(0);
  });
});

describe("ops routes", () => {
  it("/health answers even when the tenancy/auth pipeline is failing", async () => {
    const { app } = await setup({ failContext: true });
    expect((await app.inject({ url: "/health" })).json()).toEqual({ ok: true });
    expect((await app.inject({ url: "/v1/demo/ok" })).statusCode).toBe(500);
  });

  it("/ready is 200 when every probe passes and 503 with per-dependency status otherwise", async () => {
    const ok = await setup({ probes: { postgres: async () => {}, redis: async () => ({ status: "ready" }) } });
    const good = await ok.app.inject({ url: "/ready" });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toMatchObject({ status: "ok", checks: { postgres: { ok: true }, redis: { ok: true } } });

    const bad = await setup({
      probes: {
        postgres: async () => {},
        redis: async () => {
          throw new Error("connect ECONNREFUSED redis://:hunter2@10.0.0.5:6379");
        },
        queue: () => new Promise(() => {}),
      },
    });
    const res = await bad.app.inject({ url: "/ready" });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe("fail");
    expect(body.checks.postgres.ok).toBe(true);
    expect(body.checks.redis.ok).toBe(false);
    expect(body.checks.queue).toMatchObject({ ok: false, error: "timed out after 100 ms" });
    expect(res.body).not.toContain("hunter2");
    expect(res.body).not.toContain("10.0.0.5");
  });

  it("/version reports the build", async () => {
    const { app } = await setup();
    expect((await app.inject({ url: "/version" })).json()).toMatchObject({ sha: "abc123", buildTime: "2026-10-16T00:00:00Z" });
  });

  it("/metrics is off without a token and bearer-protected with one", async () => {
    expect((await (await setup()).app.inject({ url: "/metrics" })).statusCode).toBe(404);
    const { app } = await setup({ metricsToken: "t".repeat(20) });
    await app.inject({ url: "/v1/demo/ok" });
    expect((await app.inject({ url: "/metrics" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/metrics", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    const res = await app.inject({ url: "/metrics", headers: { authorization: `Bearer ${"t".repeat(20)}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain('srikit_http_requests_total{method="GET",route="/v1/demo/ok",status="200"} 1');
  });
});

describe("helpers", () => {
  it("keeps a sane caller request id and replaces anything else", () => {
    expect(requestIdFor("abc-12345")).toBe("abc-12345");
    expect(requestIdFor("short")).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFor("bad id with spaces")).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFor(["a", "b"])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("compares bearer tokens exactly", () => {
    expect(bearerMatches("Bearer abc", "abc")).toBe(true);
    expect(bearerMatches("bearer abc", "abc")).toBe(true);
    expect(bearerMatches("Bearer abcd", "abc")).toBe(false);
    expect(bearerMatches(undefined, "abc")).toBe(false);
    expect(bearerMatches("Basic abc", "abc")).toBe(false);
  });
});

describe("client IP behind proxies", () => {
  const ipServer = (trustProxyHops?: number) =>
    buildServer({
      corsOrigins: [],
      contextHooks: [],
      trustProxyHops,
      modules: [defineModule({ id: "ip", routes: (r) => r.get("/", async (req) => ({ ip: req.ctx.ip })) })],
    });
  const ipOf = async (app: Awaited<ReturnType<typeof ipServer>>, xff?: string) =>
    (await app.inject({ url: "/v1/ip", remoteAddress: "10.0.0.5", headers: xff ? { "x-forwarded-for": xff } : {} })).json().ip;

  it("ignores X-Forwarded-For entries the client wrote: one trusted hop by default", async () => {
    const app = await ipServer();
    // The load balancer appends the real client (203.0.113.9) to whatever the client sent.
    expect(await ipOf(app, "6.6.6.6, 203.0.113.9")).toBe("203.0.113.9");
    expect(await ipOf(app, "203.0.113.9")).toBe("203.0.113.9");
    expect(await ipOf(app)).toBe("10.0.0.5");
  });

  it("follows the configured hop count", async () => {
    expect(await ipOf(await ipServer(2), "6.6.6.6, 203.0.113.9, 10.0.0.7")).toBe("203.0.113.9");
    expect(await ipOf(await ipServer(0), "6.6.6.6, 203.0.113.9")).toBe("10.0.0.5");
  });

  it("still takes the shop's custom domain from X-Forwarded-Host (the store proxy)", async () => {
    const app = await buildServer({
      corsOrigins: [],
      contextHooks: [],
      modules: [defineModule({ id: "host", routes: (r) => r.get("/", async (req) => ({ host: req.hostname })) })],
    });
    const res = await app.inject({ url: "/v1/host", remoteAddress: "10.0.0.5", headers: { "x-forwarded-host": "shop.example.in" } });
    expect(res.json().host).toBe("shop.example.in");
  });
});
