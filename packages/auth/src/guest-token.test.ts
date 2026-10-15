import { emptyContext, type AppError } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { signGuestToken, verifyGuestTokenWith } from "./guest-token";
import { createAuth } from "./index";

const SECRET = "s3cret-guest-token-secret";
const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const PHONE = "+919876543210";

describe("guest tokens", () => {
  const now = new Date("2026-10-15T10:00:00Z");
  const token = signGuestToken(SECRET, { tenantId: T1, phone: PHONE, expiresAt: new Date(now.getTime() + 60 * 60_000) });

  it("round-trips", () => {
    expect(verifyGuestTokenWith(SECRET, T1, token, now)).toEqual({ phone: PHONE });
    const [payload] = token.split(".");
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toEqual({ t: T1, p: PHONE, exp: Math.floor(now.getTime() / 1000) + 3600 });
  });

  it("rejects expired tokens", () => {
    expect(verifyGuestTokenWith(SECRET, T1, token, new Date(now.getTime() + 60 * 60_000))).toBeNull();
    expect(verifyGuestTokenWith(SECRET, T1, token, new Date(now.getTime() + 59 * 60_000))).not.toBeNull();
  });

  it("rejects another tenant and another secret", () => {
    expect(verifyGuestTokenWith(SECRET, T2, token, now)).toBeNull();
    expect(verifyGuestTokenWith("other-secret", T1, token, now)).toBeNull();
    expect(verifyGuestTokenWith("", T1, token, now)).toBeNull();
  });

  it("rejects tampered tokens", () => {
    const [payload, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ t: T1, p: "+919999999999", exp: 9_999_999_999 })).toString("base64url");
    expect(verifyGuestTokenWith(SECRET, T1, `${forged}.${sig}`, now)).toBeNull();
    const flipped = sig.slice(0, -2) + (sig.endsWith("AA") ? "BB" : "AA");
    expect(verifyGuestTokenWith(SECRET, T1, `${payload}.${flipped}`, now)).toBeNull();
    expect(verifyGuestTokenWith(SECRET, T1, payload, now)).toBeNull();
    expect(verifyGuestTokenWith(SECRET, T1, `${token}.x`, now)).toBeNull();
    expect(verifyGuestTokenWith(SECRET, T1, "", now)).toBeNull();
  });

  it("signs with a domain prefix (not a bare HMAC of the payload)", async () => {
    const { createHmac } = await import("node:crypto");
    const [payload, sig] = token.split(".") as [string, string];
    expect(sig).not.toBe(createHmac("sha256", SECRET).update(payload).digest("base64url"));
    expect(sig).toBe(createHmac("sha256", SECRET).update(`guest.${payload}`).digest("base64url"));
  });
});

describe("AuthService guest verification (no database)", () => {
  const base = {
    db: {} as Db,
    otp: { sendOtp: vi.fn() },
    memberships: { rolesFor: vi.fn(async () => []) },
  };
  const config = { sessionTtlDays: 30, otpTtlMinutes: 10, testOtp: { code: "123456", targets: ["+9199990*", "e2e@example.com"] } };

  it("answers 503 not_configured without a secret", async () => {
    const { service } = createAuth({ ...base, config });
    await expect(service.verifyGuestOtp({ target: "+919999012345", code: "123456", tenantId: T1 })).rejects.toMatchObject({
      status: 503,
      code: "not_configured",
    });
    expect(service.verifyGuestToken(T1, "x.y")).toBeNull();
  });

  it("only accepts phone targets", async () => {
    const { service } = createAuth({ ...base, config: { ...config, guestTokenSecret: SECRET } });
    await expect(service.verifyGuestOtp({ target: "e2e@example.com", code: "123456", tenantId: T1 })).rejects.toMatchObject({ status: 400 });
  });

  it("issues a tenant-bound token for a test identity without creating a user", async () => {
    const { service } = createAuth({ ...base, config: { ...config, guestTokenSecret: SECRET, guestTokenTtlMinutes: 15 } });
    await expect(service.verifyGuestOtp({ target: "99990 12345", code: "000000", tenantId: T1 })).rejects.toMatchObject({ status: 400 });
    const before = Date.now();
    const r = await service.verifyGuestOtp({ target: "99990 12345", code: "123 456", tenantId: T1 });
    expect(r.phone).toBe("+919999012345");
    expect(r.expiresAt.getTime() - before).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
    expect(r.expiresAt.getTime() - before).toBeLessThanOrEqual(15 * 60_000 + 1000);
    expect(service.verifyGuestToken(T1, r.guestToken)).toEqual({ phone: "+919999012345" });
    expect(service.verifyGuestToken(T2, r.guestToken)).toBeNull();
  });

  it("POST /guest/verify needs a tenant", async () => {
    const { service, module } = createAuth({ ...base, config: { ...config, guestTokenSecret: SECRET } });
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = emptyContext();
      req.ctx.tenant = req.headers["x-tenant"] ? { id: T1, slug: "sri", planId: null, appId: null } : null;
    });
    app.setErrorHandler((err, _req, reply) => {
      const e = err as unknown as AppError;
      reply.status(e.status ?? 500).send({ code: e.code });
    });
    await app.register(async (scope) => module.routes!(scope));
    const body = { target: "+919999012345", code: "123456" };
    const none = await app.inject({ method: "POST", url: "/guest/verify", payload: body });
    expect(none.statusCode).toBe(400);
    expect(none.json()).toEqual({ code: "tenant_required" });
    const ok = await app.inject({ method: "POST", url: "/guest/verify", payload: body, headers: { "x-tenant": "1" } });
    expect(ok.statusCode).toBe(200);
    const json = ok.json() as { guestToken: string; phone: string; expiresAt: string };
    expect(json.phone).toBe("+919999012345");
    expect(service.verifyGuestToken(T1, json.guestToken)).toEqual({ phone: "+919999012345" });
  });
});
