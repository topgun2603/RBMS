import { AppError, emptyContext } from "@rbms/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { authContextHook, defaultPermissionsFor } from "./hook";
import type { AuthService } from "./service";

const tenant = { id: "t1", slug: "sri", planId: null, appId: null };

function build(roles: string[], resolver?: { permissionsFor: (t: string, r: string[]) => Promise<string[]> }) {
  const service = {
    cookieName: "sr_session",
    authenticate: vi.fn(async () => ({
      user: { id: "u1", platformRoles: [], locale: "en" },
      session: { id: "s1", mfaAt: null, terminalId: null },
    })),
    shopRequiresMfaFor: vi.fn(async () => false),
  } as unknown as AuthService;
  const memberships = { rolesFor: vi.fn(async () => roles) };
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = emptyContext();
    req.ctx.tenant = req.headers["x-no-tenant"] ? null : tenant;
  });
  authContextHook(service, memberships, undefined, resolver)(app);
  app.get("/me", async (req) => req.ctx.user);
  return { app, memberships };
}

const get = (app: ReturnType<typeof build>["app"], headers: Record<string, string> = {}): Promise<any> =>
  app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer tok", ...headers } }).then((r) => r.json() as any);

describe("authContextHook permissions", () => {
  it("defaults: owner/admin → *, others → []", async () => {
    expect(defaultPermissionsFor(["owner"])).toEqual(["*"]);
    expect(defaultPermissionsFor(["admin", "role:x"])).toEqual(["*"]);
    expect(defaultPermissionsFor(["staff"])).toEqual([]);
    expect((await get(build(["admin"]).app)).permissions).toEqual(["*"]);
    expect((await get(build(["staff"]).app)).permissions).toEqual([]);
  });

  it("uses the resolver with the tenant and roles", async () => {
    const permissionsFor = vi.fn(async () => ["invoices.create"]);
    const { app } = build(["staff", "role:cashier"], { permissionsFor });
    const user = await get(app);
    expect(user.tenantRoles).toEqual(["staff", "role:cashier"]);
    expect(user.permissions).toEqual(["invoices.create"]);
    expect(permissionsFor).toHaveBeenCalledWith("t1", ["staff", "role:cashier"]);
  });

  it("no tenant or no membership → [] without calling the resolver", async () => {
    const permissionsFor = vi.fn(async () => ["*"]);
    expect((await get(build(["staff"], { permissionsFor }).app, { "x-no-tenant": "1" })).permissions).toEqual([]);
    expect((await get(build([], { permissionsFor }).app)).permissions).toEqual([]);
    expect(permissionsFor).not.toHaveBeenCalled();
  });

  it("falls back to defaults when the resolver fails", async () => {
    const permissionsFor = vi.fn(async () => {
      throw new Error("db down");
    });
    expect((await get(build(["owner"], { permissionsFor }).app)).permissions).toEqual(["*"]);
    expect((await get(build(["staff"], { permissionsFor }).app)).permissions).toEqual([]);
  });
});

describe("authContextHook with unknown bearer tokens", () => {
  it("leaves a user set by an earlier hook alone (e.g. an sk_test_ API key)", async () => {
    const service = { cookieName: "sr_session", authenticate: vi.fn(async () => null) } as unknown as AuthService;
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    const apiPrincipal = { id: "key-1", sessionId: "", platformRoles: [], tenantRoles: ["staff"], permissions: ["orders.view"] };
    app.addHook("onRequest", async (req) => {
      req.ctx = emptyContext();
      req.ctx.tenant = tenant;
      req.ctx.user = apiPrincipal;
    });
    authContextHook(service, { rolesFor: vi.fn(async () => []) })(app);
    app.get("/me", async (req) => req.ctx.user);
    const res = await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer sk_test_abcdef123456" } });
    expect(res.json()).toEqual(apiPrincipal);
    expect(service.authenticate).toHaveBeenCalledWith("sk_test_abcdef123456");
  });
});

describe("authContextHook two-factor enforcement", () => {
  function buildMfa(opts: { roles: string[]; mfaAt: Date | null; requireMfa: boolean; terminalId?: string | null }) {
    const service = {
      cookieName: "sr_session",
      authenticate: vi.fn(async () => ({
        user: { id: "u1", platformRoles: [], locale: "en" },
        session: { id: "s1", mfaAt: opts.mfaAt, terminalId: opts.terminalId ?? null },
      })),
      shopRequiresMfaFor: vi.fn(async (_t: string, roles: readonly string[]) => opts.requireMfa && roles.some((r) => ["owner", "admin", "manager"].includes(r))),
    } as unknown as AuthService;
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = emptyContext();
      req.ctx.tenant = tenant;
    });
    app.setErrorHandler((err, _req, reply) =>
      err instanceof AppError ? reply.code(err.status).send({ error: { code: err.code } }) : reply.code(500).send({ error: String(err) }),
    );
    authContextHook(service, { rolesFor: vi.fn(async () => opts.roles) })(app);
    app.get("/v1/orders", async (req) => req.ctx.user);
    app.get("/v1/auth/me", async (req) => req.ctx.user);
    return app;
  }
  const call = (app: ReturnType<typeof buildMfa>, url = "/v1/orders") => app.inject({ method: "GET", url, headers: { authorization: "Bearer tok" } });

  it("refuses an owner's shop request with 403 mfa_required when the shop requires 2FA and the session skipped it", async () => {
    const res = await call(buildMfa({ roles: ["owner"], mfaAt: null, requireMfa: true }));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("mfa_required");
  });

  it("lets a 2FA-passed session, a cashier, or a shop without the requirement through", async () => {
    expect((await call(buildMfa({ roles: ["owner"], mfaAt: new Date(), requireMfa: true }))).json().tenantRoles).toEqual(["owner"]);
    expect((await call(buildMfa({ roles: ["cashier"], mfaAt: null, requireMfa: true }))).json().tenantRoles).toEqual(["cashier"]);
    expect((await call(buildMfa({ roles: ["manager"], mfaAt: null, requireMfa: false }))).json().tenantRoles).toEqual(["manager"]);
    expect((await call(buildMfa({ roles: ["manager"], mfaAt: null, requireMfa: true, terminalId: "term-1" }))).statusCode).toBe(200);
  });

  it("keeps the auth routes working, without shop roles", async () => {
    const res = await call(buildMfa({ roles: ["admin"], mfaAt: null, requireMfa: true }), "/v1/auth/me");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "u1", tenantRoles: [], permissions: [] });
  });
});
