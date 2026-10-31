import { AppError, emptyContext, requirePermission, type TenantRef } from "@rbms/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { apiKeyGuard, createApiKeyHook, type StoredApiKey } from "./hook";
import { generateApiKey } from "./keys";
import { TokenBucketLimiter } from "./ratelimit";

const TENANT: TenantRef = { id: "11111111-1111-4111-8111-111111111111", slug: "meena", planId: null, appId: "BL" };
const OTHER: TenantRef = { id: "22222222-2222-4222-8222-222222222222", slug: "other", planId: null, appId: "BL" };
const NOW = new Date("2026-10-15T10:00:00Z");

async function build(opts: { key?: Partial<StoredApiKey>; production?: boolean; hostTenant?: TenantRef | null; limiter?: TokenBucketLimiter } = {}) {
  const live = generateApiKey("live");
  const test = generateApiKey("test");
  const key: StoredApiKey = { id: "k1", tenantId: TENANT.id, scopes: ["invoices.create"], expiresAt: null, revokedAt: null, lastUsedAt: null, ...opts.key };
  const store = {
    findByHash: vi.fn(async (h: string) => (h === live.hash || h === test.hash ? key : null)),
    touch: vi.fn(async () => {}),
  };
  const tenants = { byId: vi.fn(async (id: string) => (id === TENANT.id ? TENANT : id === OTHER.id ? OTHER : null)) };
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = emptyContext();
    // stand-in for tenancy: x-tenant header → tenant
    const slug = req.headers["x-tenant"];
    req.ctx.tenant = slug === "meena" ? TENANT : slug === "other" ? OTHER : (opts.hostTenant ?? null);
  });
  createApiKeyHook({ store, tenants, production: opts.production ?? true, now: () => NOW, limiter: opts.limiter })(app);
  app.addHook("preHandler", apiKeyGuard(["/v1/platform"]));
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    return reply.status(500).send({ error: { code: "internal", message: String(err) } });
  });
  app.get("/v1/whoami", async (req) => ({ tenant: req.ctx.tenant, user: req.ctx.user }));
  app.post("/v1/invoices/", async (req) => {
    requirePermission(req.ctx, "invoices.create");
    return { ok: true };
  });
  app.post("/v1/invoices/:id/cancel", async (req) => {
    requirePermission(req.ctx, "invoices.cancel");
    return { ok: true };
  });
  app.post("/v1/developer/keys", async () => ({ created: true }));
  app.post("/v1/anything", { config: { apiKey: false } }, async () => ({ ok: true }));
  app.get("/v1/platform/tenants", async () => ({ ok: true }));
  await app.ready();
  const auth = (t: string) => ({ authorization: `Bearer ${t}` });
  return { app, store, tenants, live: live.token, test: test.token, auth };
}

describe("apiKeyHook", () => {
  it("sets the tenant and an API principal for a valid key", async () => {
    const { app, live, auth, store } = await build();
    const r = await app.inject({ method: "GET", url: "/v1/whoami", headers: auth(live) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      tenant: TENANT,
      user: { id: "key:k1", sessionId: "", platformRoles: [], tenantRoles: ["staff"], permissions: ["invoices.create"], apiKey: true, apiKeyId: "k1" },
    });
    expect(r.headers["x-ratelimit-remaining"]).toBe("599");
    expect(store.touch).toHaveBeenCalledWith("k1", NOW);
  });

  it("throttles last_used writes to once a minute", async () => {
    const { app, live, auth, store } = await build({ key: { lastUsedAt: new Date(NOW.getTime() - 30_000) } });
    await app.inject({ method: "GET", url: "/v1/whoami", headers: auth(live) });
    expect(store.touch).not.toHaveBeenCalled();
    const b = await build({ key: { lastUsedAt: new Date(NOW.getTime() - 61_000) } });
    await b.app.inject({ method: "GET", url: "/v1/whoami", headers: b.auth(b.live) });
    await b.app.inject({ method: "GET", url: "/v1/whoami", headers: b.auth(b.live) });
    expect(b.store.touch).toHaveBeenCalledTimes(1);
  });

  it("scopes are the permissions", async () => {
    const { app, live, auth } = await build();
    expect((await app.inject({ method: "POST", url: "/v1/invoices/", headers: auth(live) })).statusCode).toBe(200);
    const denied = await app.inject({ method: "POST", url: "/v1/invoices/x/cancel", headers: auth(live) });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("permission_denied");
  });

  it("leaves non-key bearers and requests without a bearer to auth", async () => {
    const { app, store } = await build();
    const r = await app.inject({ method: "GET", url: "/v1/whoami", headers: { authorization: "Bearer some-session-token" } });
    expect(r.json().user).toBeNull();
    expect((await app.inject({ method: "GET", url: "/v1/whoami" })).json().user).toBeNull();
    expect(store.findByHash).not.toHaveBeenCalled();
  });

  it("401 for unknown, malformed, revoked and expired keys", async () => {
    const { app, auth } = await build();
    const unknown = await app.inject({ method: "GET", url: "/v1/whoami", headers: auth(generateApiKey("live").token) });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.code).toBe("invalid_api_key");
    expect((await app.inject({ method: "GET", url: "/v1/whoami", headers: auth("sk_live_short") })).statusCode).toBe(401);

    const revoked = await build({ key: { revokedAt: new Date(NOW.getTime() - 1000) } });
    const r = await revoked.app.inject({ method: "GET", url: "/v1/whoami", headers: revoked.auth(revoked.live) });
    expect(r.statusCode).toBe(401);
    expect(r.json().error.message).toMatch(/revoked/);

    const expired = await build({ key: { expiresAt: new Date(NOW.getTime() - 1000) } });
    const e = await expired.app.inject({ method: "GET", url: "/v1/whoami", headers: expired.auth(expired.live) });
    expect(e.statusCode).toBe(401);
    expect(e.json().error.message).toMatch(/expired/);

    const future = await build({ key: { expiresAt: new Date(NOW.getTime() + 1000) } });
    expect((await future.app.inject({ method: "GET", url: "/v1/whoami", headers: future.auth(future.live) })).statusCode).toBe(200);
  });

  it("refuses sk_test_ keys in production, accepts them elsewhere", async () => {
    const p = await build({ production: true });
    expect((await p.app.inject({ method: "GET", url: "/v1/whoami", headers: p.auth(p.test) })).statusCode).toBe(401);
    const d = await build({ production: false });
    expect((await d.app.inject({ method: "GET", url: "/v1/whoami", headers: d.auth(d.test) })).statusCode).toBe(200);
  });

  it("403 when x-tenant or the host's tenant is another shop; ok when it matches", async () => {
    const { app, live, auth } = await build();
    expect((await app.inject({ method: "GET", url: "/v1/whoami", headers: { ...auth(live), "x-tenant": "meena" } })).statusCode).toBe(200);
    const mismatch = await app.inject({ method: "GET", url: "/v1/whoami", headers: { ...auth(live), "x-tenant": "other" } });
    expect(mismatch.statusCode).toBe(403);
    const unknownSlug = await app.inject({ method: "GET", url: "/v1/whoami", headers: { ...auth(live), "x-tenant": "ghost" } });
    expect(unknownSlug.statusCode).toBe(403);
    const host = await build({ hostTenant: OTHER });
    expect((await host.app.inject({ method: "GET", url: "/v1/whoami", headers: host.auth(host.live) })).statusCode).toBe(403);
  });

  it("401 when the key's shop is gone", async () => {
    const { app, live, auth } = await build({ key: { tenantId: "33333333-3333-4333-8333-333333333333" } });
    expect((await app.inject({ method: "GET", url: "/v1/whoami", headers: auth(live) })).statusCode).toBe(401);
  });

  it("rate limits per key with 429 and retry-after", async () => {
    const { app, live, auth } = await build({ limiter: new TokenBucketLimiter(3, 60_000) });
    for (let i = 0; i < 3; i++) expect((await app.inject({ method: "GET", url: "/v1/whoami", headers: auth(live) })).statusCode).toBe(200);
    const r = await app.inject({ method: "GET", url: "/v1/whoami", headers: auth(live) });
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe("rate_limited");
    expect(Number(r.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });
});

describe("apiKeyGuard", () => {
  it("keeps API keys away from key management, apiKey:false routes and denied prefixes", async () => {
    const { app, live, auth } = await build({ key: { scopes: ["*"] } });
    for (const [method, url] of [
      ["POST", "/v1/developer/keys"],
      ["POST", "/v1/anything"],
      ["GET", "/v1/platform/tenants"],
    ] as const) {
      const r = await app.inject({ method, url, headers: auth(live) });
      expect(r.statusCode, url).toBe(403);
    }
    // the same routes are fine without a key (auth decides)
    expect((await app.inject({ method: "POST", url: "/v1/developer/keys" })).statusCode).toBe(200);
  });
});
