import { emptyContext } from "@srirealtime/core";
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
      session: { id: "s1" },
    })),
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
