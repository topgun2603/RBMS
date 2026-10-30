import { AppError, emptyContext, type RequestContext, type UserRef } from "@rbms/core";
import type { Db } from "@rbms/db";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { csvField, toCsv } from "./csv";
import { defaultAction, deriveAuditEvent, istDayEnd, istDayStart, splitRoute, type AuditRequestInfo } from "./derive";
import { auditCsv, canViewAudit, createAudit } from "./index";
import type { AuditEventRow } from "./schema";

const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: null, appId: null };
const user = (tenantRoles: string[] = ["staff"], permissions: string[] = [], platformRoles: string[] = []): UserRef => ({
  id: "22222222-2222-4222-8222-222222222222",
  sessionId: "s1",
  platformRoles,
  tenantRoles,
  permissions,
});
const ctx = (patch: Partial<RequestContext> = {}): RequestContext => ({
  ...emptyContext(),
  tenant,
  user: user(),
  ip: "10.0.0.1",
  userAgent: "UA/1",
  ...patch,
});
const info = (patch: Partial<AuditRequestInfo> = {}): AuditRequestInfo => ({
  method: "POST",
  routeUrl: "/v1/invoices/:id/cancel",
  params: { id: "inv-1" },
  statusCode: 200,
  config: undefined,
  ctx: ctx(),
  ...patch,
});

describe("action derivation", () => {
  it("splits /v1/<module> routes", () => {
    expect(splitRoute("/v1/invoices/:id/cancel")).toEqual({ moduleId: "invoices", pattern: "/:id/cancel" });
    expect(splitRoute("/v1/catalog")).toEqual({ moduleId: "catalog", pattern: "/" });
    expect(splitRoute("/v1/catalog/")).toEqual({ moduleId: "catalog", pattern: "/" });
    expect(splitRoute("/health")).toBeNull();
    expect(splitRoute(undefined)).toBeNull();
    expect(defaultAction("orders", "PATCH", "/:id")).toBe("orders.patch /:id");
  });

  it("default event: module action, module entity, :id param, ip + user agent, no body", () => {
    expect(deriveAuditEvent(info({ summary: "INV-1 cancelled" }))).toEqual({
      tenantId: tenant.id,
      actorUserId: user().id,
      action: "invoices.post /:id/cancel",
      entityType: "invoices",
      entityId: "inv-1",
      summary: "INV-1 cancelled",
      ip: "10.0.0.1",
      userAgent: "UA/1",
    });
  });

  it("honours config.audit action/entity/idParam", () => {
    const e = deriveAuditEvent(
      info({
        routeUrl: "/v1/inventory/items/:itemId/adjust",
        params: { itemId: "it-9", other: "x" },
        config: { action: "stock.adjust", entity: "item", idParam: "itemId" },
      }),
    );
    expect(e).toMatchObject({ action: "stock.adjust", entityType: "item", entityId: "it-9" });
  });

  it("entity id falls back to the first param, or null", () => {
    expect(deriveAuditEvent(info({ routeUrl: "/v1/staff/members/:userId", params: { userId: "u9" } }))?.entityId).toBe("u9");
    expect(deriveAuditEvent(info({ routeUrl: "/v1/catalog/products", params: {} }))?.entityId).toBeNull();
    expect(deriveAuditEvent(info({ config: { action: "a", entity: "b", idParam: "missing" } }))?.entityId).toBeNull();
  });

  it.each([
    ["config.audit false", info({ config: false })],
    ["GET", info({ method: "GET" })],
    ["HEAD", info({ method: "HEAD" })],
    ["4xx", info({ statusCode: 403 })],
    ["5xx", info({ statusCode: 500 })],
    ["3xx", info({ statusCode: 302 })],
    ["no user", info({ ctx: ctx({ user: null }) })],
    ["no tenant", info({ ctx: ctx({ tenant: null }) })],
    ["no ctx", info({ ctx: null })],
    ["outside /v1", info({ routeUrl: "/health" })],
    ["unknown route", info({ routeUrl: undefined })],
  ])("skips %s", (_name, i) => {
    expect(deriveAuditEvent(i)).toBeNull();
  });

  it("platform events: super-admin or explicit config without a shop → tenant null", () => {
    const sa = ctx({ tenant: null, user: user([], [], ["superadmin"]) });
    expect(deriveAuditEvent(info({ ctx: sa }))).toMatchObject({ tenantId: null, actorUserId: user().id });
    const explicit = info({ ctx: ctx({ tenant: null }), config: { action: "x.do", entity: "x" } });
    expect(deriveAuditEvent(explicit)).toMatchObject({ tenantId: null, action: "x.do" });
  });

  it("auditDetail: tenant override (incl. null) and before/after snapshots", () => {
    const target = "33333333-3333-4333-8333-333333333333";
    const sa = ctx({ tenant: null, user: user([], [], ["superadmin"]) });
    const e = deriveAuditEvent(info({ ctx: sa, detail: { tenantId: target, before: { planId: "a" }, after: { planId: "b" } } }));
    expect(e).toMatchObject({ tenantId: target, before: { planId: "a" }, after: { planId: "b" } });
    expect(deriveAuditEvent(info({ detail: { tenantId: null } }))?.tenantId).toBeNull();
    // A plain request without a shop, config or detail is still skipped (see "skips no tenant").
    expect(deriveAuditEvent(info({ ctx: ctx({ tenant: null }), detail: { after: { a: 1 } } }))).toMatchObject({ tenantId: null });
    expect(deriveAuditEvent(info())).not.toHaveProperty("before");
    expect(deriveAuditEvent(info({ detail: { entityId: "new-1" } }))?.entityId).toBe("new-1");
  });

  it("records PUT/PATCH/DELETE and 201/204", () => {
    for (const method of ["put", "PATCH", "DELETE"]) expect(deriveAuditEvent(info({ method }))).not.toBeNull();
    expect(deriveAuditEvent(info({ statusCode: 204 }))).not.toBeNull();
    expect(deriveAuditEvent(info({ statusCode: 201 }))).not.toBeNull();
  });

  it("clips the summary and user agent", () => {
    const e = deriveAuditEvent(info({ summary: "x".repeat(900), ctx: ctx({ userAgent: "u".repeat(900) }) }))!;
    expect(e.summary).toHaveLength(500);
    expect(e.userAgent).toHaveLength(500);
  });

  it("IST day bounds", () => {
    expect(istDayStart("2026-10-15").toISOString()).toBe("2026-10-14T18:30:00.000Z");
    expect(istDayEnd("2026-10-15").toISOString()).toBe("2026-10-15T18:30:00.000Z");
  });
});

describe("csv", () => {
  it("quotes, guards formulas, BOM + CRLF", () => {
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField(null)).toBe("");
    expect(toCsv([{ a: 1 }], [{ header: "A", value: (r) => r.a }])).toBe("﻿A\r\n1\r\n");
  });

  it("audit rows", () => {
    const row: AuditEventRow = {
      id: "e1",
      tenantId: tenant.id,
      actorUserId: "u1",
      action: "invoices.post /:id/cancel",
      entityType: "invoices",
      entityId: "inv-1",
      summary: "Cancelled, duplicate",
      before: { status: "issued" },
      after: null,
      ip: "1.2.3.4",
      userAgent: "UA",
      createdAt: new Date("2026-10-15T05:00:00Z"),
    };
    const csv = auditCsv([row]);
    expect(csv.split("\r\n")[0]).toBe("﻿Time,User,Action,Entity type,Entity id,Summary,IP,User agent");
    expect(csv.split("\r\n")[1]).toBe('2026-10-15T05:00:00.000Z,u1,invoices.post /:id/cancel,invoices,inv-1,"Cancelled, duplicate",1.2.3.4,UA');
    expect(auditCsv([row], true).split("\r\n")[0]).toContain("Time,Tenant,User");
  });
});

describe("canViewAudit", () => {
  it("owner/admin/super-admin and explicit grants only", () => {
    expect(canViewAudit(ctx({ user: user(["owner"]) }))).toBe(true);
    expect(canViewAudit(ctx({ user: user(["admin"]) }))).toBe(true);
    expect(canViewAudit(ctx({ user: user([], [], ["superadmin"]) }))).toBe(true);
    expect(canViewAudit(ctx({ user: user(["staff"], ["audit.view"]) }))).toBe(true);
    expect(canViewAudit(ctx({ user: user(["staff"], ["*.view", "invoices.create"]) }))).toBe(false);
    expect(canViewAudit(ctx({ user: null }))).toBe(false);
  });
});

describe("onResponse hook", () => {
  function build(insert: () => Promise<unknown>, u: UserRef | null = user()) {
    const values = vi.fn(insert);
    const db = { insert: vi.fn(() => ({ values })) } as unknown as Db;
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const audit = createAudit({ db, log });
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant, user: u, ip: "9.9.9.9", userAgent: "UA" };
    });
    app.addHook("onResponse", audit.onResponse);
    app.setErrorHandler((err, _req, reply) =>
      reply.status(err instanceof AppError ? err.status : 500).send({ error: { code: "x" } }),
    );
    app.register(
      async (s) => {
        s.post("/items/:id/archive", async (req) => {
          req.auditSummary = "Archived";
          return { ok: true };
        });
        s.post("/secret", { config: { audit: false } }, async () => ({ ok: true }));
        s.post("/fail", async () => {
          throw new AppError(400, "bad", "no");
        });
        s.get("/items", async () => ({ items: [] }));
      },
      { prefix: "/v1/catalog" },
    );
    return { app, values, log };
  }

  it("records successful mutations without the body", async () => {
    const { app, values } = build(async () => undefined);
    const r = await app.inject({ method: "POST", url: "/v1/catalog/items/p1/archive", payload: { password: "hunter2" } });
    expect(r.statusCode).toBe(200);
    await vi.waitFor(() => expect(values).toHaveBeenCalledTimes(1));
    const row = (values.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      tenantId: tenant.id,
      action: "catalog.post /items/:id/archive",
      entityType: "catalog",
      entityId: "p1",
      summary: "Archived",
      ip: "9.9.9.9",
      userAgent: "UA",
    });
    expect(JSON.stringify(row)).not.toContain("hunter2");
  });

  it("skips GETs, failures, audit:false and anonymous requests", async () => {
    const { app, values } = build(async () => undefined);
    await app.inject({ method: "GET", url: "/v1/catalog/items" });
    await app.inject({ method: "POST", url: "/v1/catalog/secret" });
    await app.inject({ method: "POST", url: "/v1/catalog/fail" });
    const anon = build(async () => undefined, null);
    await anon.app.inject({ method: "POST", url: "/v1/catalog/items/p1/archive" });
    await new Promise((r) => setTimeout(r, 20));
    expect(values).not.toHaveBeenCalled();
    expect(anon.values).not.toHaveBeenCalled();
  });

  it("a failing write never fails the request", async () => {
    const { app, values, log } = build(async () => {
      throw new Error("db down");
    });
    const r = await app.inject({ method: "POST", url: "/v1/catalog/items/p1/archive" });
    expect(r.statusCode).toBe(200);
    await vi.waitFor(() => expect(log.error).toHaveBeenCalled());
    expect(values).toHaveBeenCalledTimes(1);
  });

  it("record() stores platform events with a null tenant and never throws", async () => {
    const values = vi.fn(async () => undefined);
    const db = { insert: vi.fn(() => ({ values })) } as unknown as Db;
    const { service } = createAudit({ db });
    await service.record({ tenantId: null, actorUserId: "u1", action: "auth.login", entityType: "user", entityId: "u1" });
    expect((values.mock.calls[0] as unknown[])[0]).toMatchObject({ tenantId: null, action: "auth.login" });
    const failing = createAudit({ db: { insert: () => ({ values: async () => Promise.reject(new Error("x")) }) } as unknown as Db });
    await expect(failing.service.record({ tenantId: null, actorUserId: null, action: "a", entityType: "b" })).resolves.toBeUndefined();
  });

  it("declares feature `audit` and permission `audit.view`", () => {
    const { module } = createAudit({ db: {} as Db });
    expect(module.id).toBe("audit");
    expect(module.features?.map((f) => f.key)).toEqual(["audit"]);
    expect(module.permissions?.map((p) => p.key)).toEqual(["audit.view"]);
  });
});
