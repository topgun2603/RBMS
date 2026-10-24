import { AppError, emptyContext, hasPermission, type RequestContext, type UserRef } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { createStaff, permissionPreHandler } from "./index";
import { assertCanManage, validatePermissions } from "./service";
import {
  BUILTIN_ROLES,
  BUILTIN_TEMPLATE_HASHES,
  builtinRoleSyncs,
  DEFAULT_ROLE_KEY,
  permissionsHash,
  PREVIOUS_BUILTIN_PERMISSIONS,
  groupPermissions,
  membershipRoles,
  resolvePermissions,
  ROLE_KEY_RE,
  STAFF_PERMISSIONS,
} from "./templates";

const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: null, appId: null };
const user = (tenantRoles: string[], permissions: string[] = [], platformRoles: string[] = []): UserRef => ({
  id: "u1",
  sessionId: "s1",
  platformRoles,
  tenantRoles,
  permissions,
});

describe("built-in templates", () => {
  it("have valid unique keys and include the staff default", () => {
    const keys = BUILTIN_ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(ROLE_KEY_RE.test(k)).toBe(true);
    expect(keys).toEqual(expect.arrayContaining([DEFAULT_ROLE_KEY, "manager", "cashier", "accountant", "delivery"]));
    for (const r of BUILTIN_ROLES) expect(validatePermissions(r.permissions)).toHaveLength(r.permissions.length);
  });

  it("manager gets everything except settings and staff", () => {
    const perms = resolvePermissions(["staff", "role:manager"], new Map());
    const ctx: RequestContext = { ...emptyContext(), tenant, user: user(["staff", "role:manager"], perms) };
    expect(hasPermission(ctx, "invoices.cancel")).toBe(true);
    expect(hasPermission(ctx, "orders.cancel")).toBe(true);
    expect(hasPermission(ctx, "catalogue.manage")).toBe(true);
    expect(hasPermission(ctx, "cms.manage")).toBe(true);
    expect(hasPermission(ctx, "reviews.manage")).toBe(true);
    expect(hasPermission(ctx, "expenses.manage")).toBe(true);
    expect(hasPermission(ctx, "orders.manage")).toBe(true); // delivery shipments
    expect(hasPermission(ctx, "settings.manage")).toBe(false);
    expect(hasPermission(ctx, "staff.manage")).toBe(false);
  });

  it("cashier: bills, returns, payments, customers, catalogue read, till, dispensing, restaurant orders", () => {
    const perms = resolvePermissions(["staff", "role:cashier"], new Map());
    expect(perms).toEqual([
      "bookings.desk",
      "catalogue.view",
      "customers.create",
      "dining.bill",
      "dining.serve",
      "invoices.create",
      "invoices.credit-note",
      "jewellery.exchange",
      "jobcards.view",
      "loyalty.redeem",
      "medicines.dispense",
      "memberships.checkin",
      "payments.receive",
      "pos.till",
      "pos.weigh",
      "quotations.manage",
      "quotations.view",
      "serials.view",
    ]);
  });

  it("staff default: all *.view + create bills", () => {
    const perms = resolvePermissions(["staff"], new Map());
    const ctx: RequestContext = { ...emptyContext(), tenant, user: user(["staff"], perms) };
    expect(hasPermission(ctx, "reports.view")).toBe(true);
    expect(hasPermission(ctx, "invoices.create")).toBe(true);
    expect(hasPermission(ctx, "invoices.cancel")).toBe(false);
  });

  it("staff default keeps today's daily work: payments, customers, discounts, credit book", () => {
    const perms = resolvePermissions(["staff"], new Map());
    const ctx: RequestContext = { ...emptyContext(), tenant, user: user(["staff"], perms) };
    for (const key of ["payments.receive", "customers.create", "invoices.discount", "invoices.credit-book", "reports.view"]) {
      expect(hasPermission(ctx, key)).toBe(true);
    }
    for (const key of ["inventory.adjust", "catalogue.manage", "settings.manage", "staff.manage"]) expect(hasPermission(ctx, key)).toBe(false);
  });
});

describe("quotation permissions", () => {
  const can = (roles: string[], key: string) => {
    const perms = resolvePermissions(roles, new Map());
    return hasPermission({ ...emptyContext(), tenant, user: user(roles, perms) }, key);
  };
  it("the counter roles make quotations; the read-only demo and the accountant only see them", () => {
    for (const role of ["staff", "role:cashier", "role:manager"]) {
      expect(can([role === "staff" ? "staff" : "staff", role].filter((r, i, a) => a.indexOf(r) === i), "quotations.manage")).toBe(true);
    }
    expect(can(["staff", "role:cashier"], "quotations.view")).toBe(true);
    expect(can(["staff", "role:demo"], "quotations.view")).toBe(true);
    expect(can(["staff", "role:demo"], "quotations.manage")).toBe(false);
    expect(can(["staff", "role:accountant"], "quotations.view")).toBe(true);
    expect(can(["staff", "role:accountant"], "quotations.manage")).toBe(false);
    expect(can(["staff", "role:delivery"], "quotations.view")).toBe(false);
    expect(can(["staff", "role:stock-keeper"], "quotations.manage")).toBe(false);
  });
});

describe("resolvePermissions", () => {
  const map = new Map<string, string[]>([
    ["cashier", ["invoices.create"]],
    ["packer", ["orders.view", "orders.pack"]],
    [DEFAULT_ROLE_KEY, ["reports.view"]],
  ]);

  it("owner/admin → *, member/none → []", () => {
    expect(resolvePermissions(["owner"], map)).toEqual(["*"]);
    expect(resolvePermissions(["admin", "role:cashier"], map)).toEqual(["*"]);
    expect(resolvePermissions(["member", "role:cashier"], map)).toEqual([]);
    expect(resolvePermissions([], map)).toEqual([]);
  });

  it("staff → union of custom roles (tenant edits win over templates)", () => {
    expect(resolvePermissions(["staff", "role:cashier", "role:packer"], map)).toEqual([
      "invoices.create",
      "orders.pack",
      "orders.view",
    ]);
  });

  it("staff without (existing) custom roles → tenant default", () => {
    expect(resolvePermissions(["staff"], map)).toEqual(["reports.view"]);
    expect(resolvePermissions(["staff", "role:deleted"], map)).toEqual(["reports.view"]);
  });

  it("collapses to * when a role grants *", () => {
    expect(resolvePermissions(["staff", "role:x"], new Map([["x", ["*", "a.b"]]]))).toEqual(["*"]);
  });

  it("legacy multi-level data uses the strongest level", () => {
    expect(resolvePermissions(["staff", "admin"], map)).toEqual(["*"]);
  });
});

describe("helpers", () => {
  it("membershipRoles", () => {
    expect(membershipRoles("staff", ["delivery", "cashier", "cashier"])).toEqual(["staff", "role:cashier", "role:delivery"]);
  });

  it("validatePermissions", () => {
    expect(validatePermissions(["orders.*", "*.view", "*", " a.b ", "a.b"])).toEqual(["*", "*.view", "a.b", "orders.*"]);
    for (const bad of ["Orders.view", "orders..view", ".x", "x.", "orders.view!", "a b"]) {
      expect(() => validatePermissions([bad])).toThrow(AppError);
    }
  });

  it("groupPermissions groups and de-duplicates by module", () => {
    const g = groupPermissions([
      { key: "orders.cancel", module: "orders", label: "", description: "" },
      ...STAFF_PERMISSIONS,
      { key: "orders.manage", module: "orders", label: "", description: "" },
      { key: "orders.cancel", module: "orders", label: "dup", description: "" },
    ]);
    expect(g.map((x) => x.module)).toEqual(["orders", "staff"]);
    expect(g[0]!.permissions.map((p) => p.key)).toEqual(["orders.cancel", "orders.manage"]);
  });

  it("assertCanManage", () => {
    const owner = { userId: "o", level: "owner" as const };
    const admin = { userId: "a", level: "admin" as const };
    const manager = { userId: "m", level: "staff" as const };
    expect(() => assertCanManage(owner, { userId: "x", level: "owner" })).not.toThrow();
    expect(() => assertCanManage(admin, { userId: "x", level: "owner" })).toThrow(AppError);
    expect(() => assertCanManage(admin, { userId: "x", level: "staff" }, "admin")).not.toThrow();
    expect(() => assertCanManage(manager, { userId: "x", level: "staff" }, "staff")).not.toThrow();
    expect(() => assertCanManage(manager, { userId: "x", level: "staff" }, "admin")).toThrow(AppError);
    expect(() => assertCanManage(manager, { userId: "x", level: "admin" })).toThrow(AppError);
    expect(() => assertCanManage(manager, { userId: "m", level: "staff" })).toThrow(AppError);
    expect(() => assertCanManage({ userId: "s", level: null, superAdmin: true }, { userId: "x", level: "owner" })).not.toThrow();
  });
});

describe("permissionPreHandler", () => {
  async function build(u: UserRef | null, withTenant = true) {
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant: withTenant ? tenant : null, user: u };
    });
    app.addHook("preHandler", permissionPreHandler);
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, details: err.details } });
      return reply.status(500).send({ error: { code: "internal" } });
    });
    app.get("/open", async () => ({ ok: true }));
    app.post("/cancel", { config: { permission: "invoices.cancel" } }, async () => ({ ok: true }));
    app.post("/both", { config: { permission: ["invoices.create", "invoices.discount"] } }, async () => ({ ok: true }));
    return app;
  }

  it("routes without config.permission pass", async () => {
    const app = await build(null);
    expect((await app.inject({ method: "GET", url: "/open" })).statusCode).toBe(200);
  });

  it("403 permission_denied with the missing key", async () => {
    const app = await build(user(["staff", "role:cashier"], ["invoices.create"]));
    const r = await app.inject({ method: "POST", url: "/cancel" });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toEqual({ error: { code: "permission_denied", details: { permission: "invoices.cancel" } } });
    const both = await app.inject({ method: "POST", url: "/both" });
    expect(both.json().error.details).toEqual({ permission: "invoices.discount" });
  });

  it("wildcards, owners and super-admins pass", async () => {
    for (const u of [user(["staff"], ["invoices.*"]), user(["owner"]), user(["admin"]), user([], [], ["superadmin"])]) {
      const app = await build(u);
      expect((await app.inject({ method: "POST", url: "/both" })).statusCode).toBe(200);
    }
    const sa = await build(user([], [], ["superadmin"]), false);
    expect((await sa.inject({ method: "POST", url: "/cancel" })).statusCode).toBe(200);
  });

  it("401 without a user, 403 without a tenant", async () => {
    expect((await (await build(null)).inject({ method: "POST", url: "/cancel" })).statusCode).toBe(401);
    const noTenant = await (await build(user(["owner"]), false)).inject({ method: "POST", url: "/cancel" });
    expect(noTenant.statusCode).toBe(403);
    expect(noTenant.json().error.code).toBe("forbidden");
  });
});

describe("StaffService.permissionsFor", () => {
  function stubDb(rows: { key: string; permissions: string[] }[]) {
    const where = vi.fn(async () => rows);
    const db = { select: vi.fn(() => ({ from: () => ({ where }) })) } as unknown as Db;
    return { db, where };
  }
  const deps = (db: Db) => ({
    db,
    registry: () => [],
    memberships: {} as never,
    users: {} as never,
  });

  it("owner/admin/member need no query; staff are cached per tenant+roles", async () => {
    const { db, where } = stubDb([{ key: "cashier", permissions: ["invoices.create", "payments.receive"] }]);
    const { resolver, service } = createStaff(deps(db));
    const seed = vi.spyOn(service, "ensureSeeded").mockResolvedValue();
    expect(await resolver.permissionsFor(tenant.id, ["owner"])).toEqual(["*"]);
    expect(await resolver.permissionsFor(tenant.id, ["member"])).toEqual([]);
    expect(where).not.toHaveBeenCalled();

    expect(await resolver.permissionsFor(tenant.id, ["staff", "role:cashier"])).toEqual(["invoices.create", "payments.receive"]);
    expect(await resolver.permissionsFor(tenant.id, ["role:cashier", "staff"])).toEqual(["invoices.create", "payments.receive"]);
    // Other role combinations reuse the cached tenant roles.
    expect(await resolver.permissionsFor(tenant.id, ["staff"])).toEqual([...BUILTIN_ROLES.find((r) => r.key === DEFAULT_ROLE_KEY)!.permissions].sort());
    expect(where).toHaveBeenCalledTimes(1);

    service.invalidate(tenant.id);
    await resolver.permissionsFor(tenant.id, ["staff", "role:cashier"]);
    expect(where).toHaveBeenCalledTimes(2);
    // Built-ins are synced before the tenant's roles are read.
    expect(seed).toHaveBeenCalledWith(tenant.id);
  });

  it("declares feature `staff` and permission `staff.manage`", () => {
    const { module } = createStaff(deps(stubDb([]).db));
    expect(module.id).toBe("staff");
    expect(module.features?.map((f) => f.key)).toEqual(["staff"]);
    expect(module.permissions?.map((p) => p.key)).toEqual(["staff.manage"]);
    expect(module.tables).toHaveProperty("tenantRoles");
  });
});

describe("staff routes (stubbed ports)", () => {
  function build(u: UserRef) {
    const members = new Map<string, { userId: string; roles: string[]; status: "active" | "inactive"; createdAt: Date }>([
      ["22222222-2222-4222-8222-222222222222", { userId: "22222222-2222-4222-8222-222222222222", roles: ["owner"], status: "active", createdAt: new Date() }],
    ]);
    const memberships = {
      addMember: vi.fn(async (_t: string, userId: string, roles: string[]) => {
        const m = { userId, roles, status: "active" as const, createdAt: new Date() };
        members.set(userId, m);
        return m;
      }),
      updateRoles: vi.fn(async (_t: string, userId: string, roles: string[]) => {
        const m = { ...members.get(userId)!, roles };
        members.set(userId, m);
        return m;
      }),
      removeMember: vi.fn(async (_t: string, userId: string) => void members.delete(userId)),
      listMembers: vi.fn(async () => [...members.values()]),
      rolesFor: vi.fn(async (_t: string, userId: string) => members.get(userId)?.roles ?? []),
      getMember: vi.fn(async (_t: string, userId: string) => members.get(userId) ?? null),
    };
    const users = {
      getUsers: vi.fn(async (ids: string[]) =>
        ids.map((id) => ({ id, name: `User ${id.slice(0, 4)}`, phone: null, email: null, lastLoginAt: null })),
      ),
      findOrCreateByTarget: vi.fn(async () => ({ id: "33333333-3333-4333-8333-333333333333" })),
    };
    const quota = { consume: vi.fn(async () => 1), release: vi.fn(async () => {}) };
    const audit = { record: vi.fn(async () => {}) };
    const db = { select: vi.fn(), insert: vi.fn() } as unknown as Db;
    const staff = createStaff({ db, registry: () => STAFF_PERMISSIONS, memberships, users, quota, audit });
    // Role lookups go to the database; stub them with the templates.
    vi.spyOn(staff.service, "listRoles").mockImplementation(async () =>
      BUILTIN_ROLES.map((r) => ({ ...r, id: r.key, tenantId: tenant.id, builtin: true, templateHash: null, createdAt: new Date(), updatedAt: new Date() })),
    );
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant, user: u };
    });
    app.addHook("preHandler", staff.preHandler);
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, details: err.details } });
      if ((err as { name?: string }).name === "ZodError") return reply.status(400).send({ error: { code: "invalid_input" } });
      return reply.status(500).send({ error: { code: "internal", message: (err as Error).message } });
    });
    app.register(async (s) => staff.module.routes!(s), { prefix: "/v1/staff" });
    return { app, memberships, users, quota, audit };
  }

  it("lists members with user details", async () => {
    const { app } = build(user(["owner"]));
    const r = await app.inject({ method: "GET", url: "/v1/staff/members" });
    expect(r.statusCode).toBe(200);
    expect(r.json().items[0]).toMatchObject({ level: "owner", roleKeys: [], active: true, name: "User 2222" });
  });

  it("invites with roles, consumes the staff limit and audits", async () => {
    const { app, memberships, quota, audit } = build(user(["admin"]));
    const r = await app.inject({ method: "POST", url: "/v1/staff/invites", payload: { target: "9876543210", roleKeys: ["cashier"] } });
    expect(r.statusCode).toBe(200);
    expect(memberships.addMember).toHaveBeenCalledWith(tenant.id, "33333333-3333-4333-8333-333333333333", ["staff", "role:cashier"]);
    expect(quota.consume).toHaveBeenCalledWith(tenant, "staff", 1);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "staff.member.invite", summary: "Invited ***3210 as staff" }));
    // Unknown role keys are rejected before anything is created.
    const bad = await app.inject({ method: "POST", url: "/v1/staff/invites", payload: { target: "a@b.co", roleKeys: ["nope"] } });
    expect(bad.statusCode).toBe(400);
  });

  it("releases the limit when adding fails", async () => {
    const { app, memberships, quota } = build(user(["owner"]));
    memberships.addMember.mockRejectedValueOnce(new Error("boom"));
    const r = await app.inject({ method: "POST", url: "/v1/staff/invites", payload: { target: "a@b.co" } });
    expect(r.statusCode).toBe(500);
    expect(quota.release).toHaveBeenCalledWith(tenant, "staff", 1);
  });

  it("staff without staff.manage get 403; with it they cannot touch owners", async () => {
    const plain = build(user(["staff"], ["*.view"]));
    const r = await plain.app.inject({ method: "GET", url: "/v1/staff/members" });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toEqual({ code: "permission_denied", details: { permission: "staff.manage" } });

    const mgr = build(user(["staff"], ["staff.manage"]));
    const patch = await mgr.app.inject({
      method: "PATCH",
      url: "/v1/staff/members/22222222-2222-4222-8222-222222222222",
      payload: { roleKeys: ["cashier"] },
    });
    expect(patch.statusCode).toBe(403);
  });

  it("GET /permissions groups the registry", async () => {
    const { app } = build(user(["owner"]));
    const r = await app.inject({ method: "GET", url: "/v1/staff/permissions" });
    expect(r.json().items).toEqual([{ module: "staff", permissions: STAFF_PERMISSIONS }]);
  });
});

describe("built-in role template sync", () => {
  const manager = BUILTIN_ROLES.find((r) => r.key === "manager")!;
  const oldManager = PREVIOUS_BUILTIN_PERMISSIONS.manager![0]!;
  const row = (key: string, permissions: readonly string[], templateHash: string | null, builtin = true) => ({ key, permissions, templateHash, builtin });

  it("the previous manager template lacked the store permissions the current one has", () => {
    expect(oldManager).not.toContain("cms.*");
    expect(manager.permissions).toEqual(expect.arrayContaining(["cms.*", "reviews.*"]));
    expect(permissionsHash(oldManager)).not.toBe(BUILTIN_TEMPLATE_HASHES.get("manager"));
  });

  it("permissionsHash ignores order and duplicates", () => {
    expect(permissionsHash(["b.view", "a.view", "a.view"])).toBe(permissionsHash(["a.view", "b.view"]));
    expect(permissionsHash(["a.view"])).not.toBe(permissionsHash(["a.view", "b.view"]));
  });

  it("legacy row (no hash) still on an old template → updated to the current one", () => {
    const [s] = builtinRoleSyncs([row("manager", [...oldManager].reverse(), null)]);
    expect(s).toEqual({ key: "manager", permissions: [...manager.permissions].sort(), templateHash: BUILTIN_TEMPLATE_HASHES.get("manager") });
  });

  it("legacy row (no hash) edited by the owner → left alone", () => {
    expect(builtinRoleSyncs([row("manager", [...oldManager, "settings.manage"], null)])).toEqual([]);
    expect(builtinRoleSyncs([row("cashier", ["invoices.create"], null)])).toEqual([]);
  });

  it("legacy row already equal to the current template → only the hash is recorded", () => {
    const cashier = BUILTIN_ROLES.find((r) => r.key === "cashier")!.permissions;
    expect(builtinRoleSyncs([row("cashier", cashier, null)])).toEqual([
      { key: "cashier", templateHash: BUILTIN_TEMPLATE_HASHES.get("cashier") },
    ]);
  });

  it("hashed row: unedited since an older template → updated; edited since → left alone", () => {
    const oldHash = permissionsHash(oldManager);
    expect(builtinRoleSyncs([row("manager", oldManager, oldHash)])).toHaveLength(1);
    expect(builtinRoleSyncs([row("manager", [...oldManager, "cms.*"], oldHash)])).toEqual([]);
  });

  it("up-to-date rows, custom roles and unknown keys → nothing", () => {
    const current = BUILTIN_ROLES.map((r) => row(r.key, r.permissions, BUILTIN_TEMPLATE_HASHES.get(r.key)!));
    // Owner-edited with the current hash recorded: hash no longer matches → left alone.
    const edited = row("delivery", ["orders.view"], BUILTIN_TEMPLATE_HASHES.get("delivery")!);
    expect(builtinRoleSyncs([...current, edited, row("manager", oldManager, null, false), row("packer", ["orders.view"], null)])).toEqual([]);
  });

  it("ensureSeeded inserts missing built-ins with their hash and updates only unedited stale rows", async () => {
    const inserted: unknown[] = [];
    const updates: unknown[] = [];
    const stored = [
      row("manager", oldManager, null),
      row("cashier", ["invoices.create"], null), // edited by the owner
      row("default", BUILTIN_ROLES[0]!.permissions, null),
    ];
    const db = {
      insert: vi.fn(() => ({ values: (v: unknown[]) => ({ onConflictDoNothing: async () => void inserted.push(...v) }) })),
      select: vi.fn(() => ({ from: () => ({ where: async () => stored }) })),
      update: vi.fn(() => ({ set: (v: unknown) => ({ where: async () => void updates.push(v) }) })),
    } as unknown as Db;
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const { service } = createStaff({ db, registry: () => [], memberships: {} as never, users: {} as never, log });
    await service.ensureSeeded(tenant.id);
    expect(inserted).toHaveLength(BUILTIN_ROLES.length);
    expect(inserted[0]).toMatchObject({ key: "default", builtin: true, templateHash: BUILTIN_TEMPLATE_HASHES.get("default") });
    expect(updates).toEqual([
      { permissions: [...manager.permissions].sort(), templateHash: BUILTIN_TEMPLATE_HASHES.get("manager") },
      { templateHash: BUILTIN_TEMPLATE_HASHES.get("default") },
    ]);
    expect(log.info).toHaveBeenCalledWith({ tenantId: tenant.id, roles: ["manager"] }, expect.stringContaining("built-in roles updated"));
    // Once per process per tenant.
    await service.ensureSeeded(tenant.id);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});
