import type { Db } from "@rbms/db";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { authRoutes, okResponse } from "./routes";
import { AuthService } from "./service";

describe("POST /v1/auth/logout", () => {
  it("revokes the session, clears the cookie and answers okResponse", async () => {
    const service = new AuthService({
      db: {} as Db,
      config: { sessionTtlDays: 30, otpTtlMinutes: 10 },
      otp: { sendOtp: vi.fn() },
      memberships: { rolesFor: async () => [] },
    });
    const revoke = vi.spyOn(service, "revokeSession").mockResolvedValue(undefined as never);
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { tenant: null, user: { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: [] }, locale: "en" } as never;
    });
    await app.register(async (r) => authRoutes(service)(r), { prefix: "/v1/auth" });
    const res = await app.inject({ method: "POST", url: "/v1/auth/logout" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(okResponse.parse(json)).toEqual(json);
    expect(revoke).toHaveBeenCalledWith("s1", "u1");
    expect(String(res.headers["set-cookie"])).toMatch(/Max-Age=0/);
    await app.close();
  });
});
