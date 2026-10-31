import { defineModule } from "@rbms/core";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RATE_LIMIT, isAuthSensitive, isRateLimitExempt, MemoryWindowCounter, sharedWindowCounter, type RateLimitConfig } from "./http-guard";
import { buildServer } from "./server";

async function app(rate: Partial<RateLimitConfig> = {}, hsts = false) {
  return buildServer({
    corsOrigins: [],
    contextHooks: [],
    rateLimit: { ...DEFAULT_RATE_LIMIT, ...rate },
    security: { hsts },
    modules: [
      defineModule({
        id: "auth",
        routes: (r) => {
          r.post("/otp/verify", async () => ({ ok: true }));
          r.get("/config", async () => ({ ok: true }));
        },
      }),
      defineModule({
        id: "payments",
        routes: (r) => {
          r.post("/webhooks/razorpay", async () => ({ ok: true }));
          r.get("/file", async (_req, reply) => reply.header("content-type", "application/pdf").send("x"));
        },
      }),
    ],
  });
}

describe("rate limit", () => {
  it("answers 429 in the repo error shape after the per-IP budget, with Retry-After", async () => {
    const a = await app({ ipMax: 3 });
    for (let i = 0; i < 3; i++) expect((await a.inject({ url: "/v1/auth/config" })).statusCode).toBe(200);
    const r = await a.inject({ url: "/v1/auth/config" });
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe("rate_limited");
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("is stricter on the sign-in routes", async () => {
    const a = await app({ authMax: 2 });
    for (let i = 0; i < 2; i++) expect((await a.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: {} })).statusCode).toBe(200);
    expect((await a.inject({ method: "POST", url: "/v1/auth/otp/verify", payload: {} })).statusCode).toBe(429);
    expect((await a.inject({ url: "/v1/auth/config" })).statusCode).toBe(200);
  });

  it("never limits health or webhooks", async () => {
    const a = await app({ ipMax: 1 });
    for (let i = 0; i < 5; i++) {
      expect((await a.inject({ url: "/health" })).statusCode).toBe(200);
      expect((await a.inject({ method: "POST", url: "/v1/payments/webhooks/razorpay", payload: {} })).statusCode).toBe(200);
    }
  });

  it("can be switched off", async () => {
    const a = await app({ enabled: false, ipMax: 1 });
    for (let i = 0; i < 5; i++) expect((await a.inject({ url: "/v1/auth/config" })).statusCode).toBe(200);
  });

  it("falls back to memory when the shared counter fails", async () => {
    const a = await app({ ipMax: 1, counter: { hit: async () => Promise.reject(new Error("redis down")) } });
    expect((await a.inject({ url: "/v1/auth/config" })).statusCode).toBe(200);
    expect((await a.inject({ url: "/v1/auth/config" })).statusCode).toBe(429);
  });

  it("classifies routes", () => {
    expect(isRateLimitExempt({ method: "GET", url: "/ready" })).toBe(true);
    expect(isRateLimitExempt({ method: "POST", url: "/v1/aggregators/zomato/webhook/abc" })).toBe(true);
    expect(isRateLimitExempt({ method: "GET", url: "/v1/invoices" })).toBe(false);
    expect(isAuthSensitive({ method: "POST", url: "/v1/auth/mfa/verify" })).toBe(true);
    expect(isAuthSensitive({ method: "GET", url: "/v1/auth/config" })).toBe(false);
  });

  it("memory counter resets after the window", async () => {
    let t = 0;
    const c = new MemoryWindowCounter(() => t);
    expect((await c.hit("k", 1000)).count).toBe(1);
    expect((await c.hit("k", 1000)).count).toBe(2);
    t = 1500;
    expect((await c.hit("k", 1000)).count).toBe(1);
  });
});

describe("security headers", () => {
  it("sets the API headers, HSTS only when asked, no framing of JSON", async () => {
    const dev = await (await app({}, false)).inject({ url: "/v1/auth/config" });
    expect(dev.headers["x-content-type-options"]).toBe("nosniff");
    expect(dev.headers["referrer-policy"]).toBe("no-referrer");
    expect(dev.headers["x-frame-options"]).toBe("DENY");
    expect(dev.headers["strict-transport-security"]).toBeUndefined();
    const prod = await (await app({}, true)).inject({ url: "/v1/auth/config" });
    expect(prod.headers["strict-transport-security"]).toContain("max-age=31536000");
  });

  it("leaves non-JSON documents frameable", async () => {
    const r = await (await app()).inject({ url: "/v1/payments/file" });
    expect(r.headers["x-frame-options"]).toBeUndefined();
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("body limit", () => {
  it("rejects bodies over the limit with 413", async () => {
    const a = await buildServer({
      corsOrigins: [],
      contextHooks: [],
      bodyLimit: 1024,
      modules: [defineModule({ id: "x", routes: (r) => void r.post("/p", async () => ({ ok: true })) })],
    });
    const r = await a.inject({ method: "POST", url: "/v1/x/p", payload: { s: "a".repeat(3000) } });
    expect(r.statusCode).toBe(413);
  });
});

describe("sharedWindowCounter", () => {
  it("uses the shared counter, and this process's memory while it fails", async () => {
    const shared = { hit: vi.fn(async () => ({ count: 7, resetMs: 500 })) };
    expect(await sharedWindowCounter(shared).hit("k", 1000)).toEqual({ count: 7, resetMs: 500 });
    shared.hit.mockRejectedValue(new Error("redis down"));
    const c = sharedWindowCounter(shared);
    expect((await c.hit("k", 1000)).count).toBe(1);
    expect((await c.hit("k", 1000)).count).toBe(2);
    expect((await sharedWindowCounter(null).hit("k", 1000)).count).toBe(1);
  });
});
