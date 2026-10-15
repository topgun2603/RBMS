import { AppError, emptyContext, requireBranch, type RequestContext, type UserRef } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { branchContextHook, resolveRequestBranch, type BranchDirectory } from "./hook";
import type { Assignment, BranchLite } from "./logic";
import { branchesRoutes } from "./routes";
import type { BranchesService } from "./service";

const T = "11111111-1111-4111-8111-111111111111";
const U = "22222222-2222-4222-8222-222222222222";
const MAIN: BranchLite = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "MAIN", locationId: "l-main", isDefault: true };
const MDU: BranchLite = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "MDU", locationId: "l-mdu", isDefault: false };

const tenant = { id: T, slug: "raja", planId: "pro", appId: "BL" };
const user = (roles: string[], platformRoles: string[] = []): UserRef => ({
  id: U,
  sessionId: "s",
  platformRoles,
  tenantRoles: roles,
  permissions: roles.includes("owner") ? ["*"] : [],
});
const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), tenant, ...patch });

function directory(opts: { on?: boolean; branches?: BranchLite[]; assignments?: Assignment[] } = {}): BranchDirectory {
  return {
    featureOn: vi.fn(async () => opts.on ?? true),
    activeBranches: vi.fn(async () => opts.branches ?? [MAIN, MDU]),
    assignments: vi.fn(async () => opts.assignments ?? []),
  };
}

const ref = (b: BranchLite) => ({ id: b.id, code: b.code, locationId: b.locationId });

describe("resolveRequestBranch", () => {
  it("is null without a tenant, with the feature off, or without branches", async () => {
    const d = directory();
    expect(await resolveRequestBranch(d, { ...emptyContext() }, "MDU")).toBeNull();
    expect(await resolveRequestBranch(directory({ on: false }), ctx({ user: user(["owner"]) }), "MDU")).toBeNull();
    expect(await resolveRequestBranch(directory({ branches: [] }), ctx({ user: user(["owner"]) }), "MDU")).toBeNull();
  });

  it("owners and super-admins pick any branch", async () => {
    expect(await resolveRequestBranch(directory(), ctx({ user: user(["owner"]) }), "mdu")).toEqual(ref(MDU));
    expect(await resolveRequestBranch(directory(), ctx({ user: user(["owner"]) }), undefined)).toEqual(ref(MAIN));
    expect(await resolveRequestBranch(directory(), ctx({ user: user([], ["superadmin"]) }), MDU.id)).toEqual(ref(MDU));
  });

  it("staff are limited to their branches", async () => {
    const d = directory({ assignments: [{ branchId: MDU.id, isDefault: true }] });
    const c = ctx({ user: user(["staff"]) });
    expect(await resolveRequestBranch(d, c, undefined)).toEqual(ref(MDU));
    await expect(resolveRequestBranch(d, c, "MAIN")).rejects.toMatchObject({ status: 403, code: "branch_forbidden" });
    await expect(resolveRequestBranch(d, c, "NOPE")).rejects.toMatchObject({ status: 404, code: "branch_not_found" });
    expect(await resolveRequestBranch(d, c, "MAIN", { lenient: true })).toEqual(ref(MDU));
  });

  it("anonymous and non-member requests get the default branch without looking up assignments", async () => {
    const d = directory();
    expect(await resolveRequestBranch(d, ctx({}), "MDU")).toEqual(ref(MAIN));
    expect(await resolveRequestBranch(d, ctx({ user: user([]) }), "MDU")).toEqual(ref(MAIN));
    expect(d.assignments).not.toHaveBeenCalled();
  });
});

describe("context hook", () => {
  async function app(d: BranchDirectory, c: () => RequestContext) {
    const a = Fastify();
    a.decorateRequest("ctx", null as never);
    a.addHook("onRequest", async (req) => {
      req.ctx = c();
    });
    branchContextHook(d)(a);
    a.setErrorHandler((err, _req, reply) => {
      if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
      return reply.status(500).send({ error: { code: "internal" } });
    });
    a.get("/v1/x", async (req) => ({ branch: req.ctx.branch ?? null }));
    a.get("/v1/needs", async (req) => requireBranch(req.ctx));
    a.get("/v1/branches/mine", async (req) => ({ branch: req.ctx.branch ?? null }));
    return a;
  }

  it("fills ctx.branch from the header", async () => {
    const a = await app(directory(), () => ctx({ user: user(["admin"]) }));
    const r = await a.inject({ url: "/v1/x", headers: { "x-branch": "MDU" } });
    expect(r.json()).toEqual({ branch: ref(MDU) });
  });

  it("fails a forbidden header except on GET /v1/branches/mine", async () => {
    const d = directory({ assignments: [{ branchId: MDU.id, isDefault: true }] });
    const a = await app(d, () => ctx({ user: user(["staff"]) }));
    const bad = await a.inject({ url: "/v1/x", headers: { "x-branch": "MAIN" } });
    expect(bad.statusCode).toBe(403);
    expect(bad.json().error.code).toBe("branch_forbidden");
    const mine = await a.inject({ url: "/v1/branches/mine", headers: { "x-branch": "MAIN" } });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toEqual({ branch: ref(MDU) });
  });

  it("requireBranch answers 400 branch_required when the shop has no branches", async () => {
    const a = await app(directory({ on: false }), () => ctx({ user: user(["owner"]) }));
    const r = await a.inject({ url: "/v1/needs" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("branch_required");
  });
});

describe("routes", () => {
  function routesApp(c: RequestContext) {
    const service = {
      mine: vi.fn(async () => ({ items: [], total: 0, defaultBranchId: MAIN.id, currentBranchId: MDU.id })),
      list: vi.fn(async () => ({ items: [], total: 0 })),
      deactivate: vi.fn(async () => ({ id: MDU.id })),
      removeUser: vi.fn(async () => undefined),
    };
    const a = Fastify();
    a.decorateRequest("ctx", null as never);
    a.addHook("onRequest", async (req) => {
      req.ctx = c;
    });
    a.setErrorHandler((err, _req, reply) => {
      if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
      return reply.status(500).send({ error: { code: "internal", message: (err as Error).message } });
    });
    a.register(branchesRoutes(service as unknown as BranchesService), { prefix: "/v1/branches" });
    return { a, service };
  }

  it("declares the feature and permission on every route", async () => {
    const seen: { url: string; method: string | string[]; config: unknown }[] = [];
    const a = Fastify();
    a.decorateRequest("ctx", null as never);
    a.addHook("onRoute", (r) => {
      seen.push({ url: r.url, method: r.method, config: r.config });
    });
    await a.register(branchesRoutes({} as BranchesService), { prefix: "/v1/branches" });
    await a.ready();
    expect(seen.length).toBeGreaterThan(10);
    for (const r of seen) {
      const config = r.config as { feature?: string; permission?: string };
      expect(config.feature, r.url).toBe("multi-branch");
      if (!r.url.endsWith("/mine")) expect(config.permission, `${r.method} ${r.url}`).toBe("branches.manage");
    }
  });

  it("GET /mine works for plain staff and passes the current branch", async () => {
    const { a, service } = routesApp(ctx({ user: user(["staff"]), branch: ref(MDU) }));
    const r = await a.inject({ url: "/v1/branches/mine" });
    expect(r.statusCode).toBe(200);
    expect(service.mine).toHaveBeenCalledWith(T, { userId: U, fullAccess: false }, MDU.id);
  });

  it("management routes need branches.manage", async () => {
    const staff = routesApp(ctx({ user: user(["staff"]) }));
    const denied = await staff.a.inject({ url: "/v1/branches" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("permission_denied");

    const granted = routesApp(ctx({ user: { ...user(["staff"]), permissions: ["branches.*"] } }));
    expect((await granted.a.inject({ url: "/v1/branches" })).statusCode).toBe(200);
  });

  it("shoppers (members) are refused", async () => {
    const { a } = routesApp(ctx({ user: user(["member"]) }));
    expect((await a.inject({ url: "/v1/branches/mine" })).statusCode).toBe(403);
  });

  it("DELETE closes the branch; DELETE /:id/users/:userId unassigns", async () => {
    const { a, service } = routesApp(ctx({ user: user(["owner"]) }));
    expect((await a.inject({ method: "DELETE", url: `/v1/branches/${MDU.id}` })).statusCode).toBe(200);
    expect(service.deactivate).toHaveBeenCalledWith(T, MDU.id);
    const r = await a.inject({ method: "DELETE", url: `/v1/branches/${MDU.id}/users/${U}` });
    expect(r.json()).toEqual({ ok: true });
    expect(service.removeUser).toHaveBeenCalledWith(T, MDU.id, U);
  });
});
