import { AppError, emptyContext, type FeatureDef, type TenantRef } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createFeatures } from "./index";
import { resolveFeatures } from "./resolve";
import { featuresRoutes, tenantFeaturesSchema } from "./routes";

// postgres-js connects lazily; these tests never touch the database (resolve is stubbed).
const { db, close } = createDb("postgres://user:pass@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const REGISTRY: FeatureDef[] = [
  { key: "invoices", module: "invoices", label: "GST bills", description: "" },
  { key: "invoices.reminders", module: "invoices", label: "Reminders", description: "", dependsOn: ["invoices"], shopToggle: true },
  { key: "invoices.credit-book", module: "invoices", label: "Credit book", description: "", dependsOn: ["invoices"], shopToggle: true },
  { key: "payments", module: "payments", label: "Online payments", description: "", shopToggle: true },
];

const tenant: TenantRef = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "starter", appId: "BL" };

function build(opts: { modules?: string[]; toggles?: Record<string, boolean>; app?: string[] | null } = {}) {
  const plans = { entitlements: vi.fn(async (_t: TenantRef) => ({ planId: "starter", modules: opts.modules ?? ["invoices", "payments"], features: {} })) };
  const tenants = { getRef: vi.fn(async (id: string) => (id === tenant.id ? tenant : null)) };
  const f = createFeatures({ db, registry: () => REGISTRY, plans, tenants });
  vi.spyOn(f.service, "resolve").mockImplementation(async (t) => {
    const ent = await plans.entitlements(t);
    const r = resolveFeatures({ registry: f.service.registry(), app: opts.app ?? null, plan: ent, toggles: opts.toggles ?? {} });
    return { appId: t.appId, planId: ent.planId, ...r };
  });
  return { ...f, plans, tenants };
}

async function caught(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected a rejection");
}

describe("FeaturesService.assert / isEnabled", () => {
  it("passes when every key is on", async () => {
    const { service } = build();
    await expect(service.assert(tenant, ["invoices", "payments"])).resolves.toBeUndefined();
  });

  it("plan → 402 plan_limit with { feature, reason: plan }", async () => {
    const { service } = build({ modules: ["invoices", "invoices.credit-book", "payments"]});
    const err = await caught(service.assert(tenant, "invoices.reminders"));
    expect(err.status).toBe(402);
    expect(err.code).toBe("plan_limit");
    expect(err.details).toEqual({ feature: "invoices.reminders", reason: "plan" });
  });

  it("shop / app / dependency → 403 feature_disabled", async () => {
    const shop = await caught(build({ toggles: { payments: false } }).service.assert(tenant, "payments"));
    expect(shop).toMatchObject({ status: 403, code: "feature_disabled", details: { feature: "payments", reason: "shop" } });

    const app = await caught(build({ app: ["invoices"] }).service.assert(tenant, "payments"));
    expect(app.details).toEqual({ feature: "payments", reason: "app" });

    const dep = await caught(build({ modules: ["invoices.credit-book"] }).service.assert(tenant, "invoices.credit-book"));
    expect(dep.details).toEqual({ feature: "invoices.credit-book", reason: "dependency" });
  });

  it("unregistered keys are refused", async () => {
    const err = await caught(build().service.assert(tenant, "nope"));
    expect(err).toMatchObject({ status: 403, code: "feature_disabled" });
  });

  it("isEnabled accepts a tenant id and looks the tenant up", async () => {
    const { service, tenants } = build({ toggles: { payments: false } });
    expect(await service.isEnabled(tenant.id, "invoices")).toBe(true);
    expect(await service.isEnabled(tenant.id, "payments")).toBe(false);
    expect(tenants.getRef).toHaveBeenCalledWith(tenant.id);
    expect(await service.isEnabled("22222222-2222-4222-8222-222222222222", "invoices")).toBe(false);
    expect(await service.isEnabled(tenant, "invoices")).toBe(true);
  });

  it("setToggle refuses unknown and non-toggle features", async () => {
    const { service } = build();
    await expect(service.setToggle(tenant, "nope", true)).rejects.toMatchObject({ status: 404 });
    await expect(service.setToggle(tenant, "invoices", false)).rejects.toMatchObject({ status: 400 });
  });

  it("setToggle refuses enabling a feature the plan doesn't include", async () => {
    const { service } = build({ modules: ["invoices", "invoices.credit-book"] });
    await expect(service.setToggle(tenant, "payments", true)).rejects.toMatchObject({ status: 402, details: { reason: "plan" } });
  });

  it("validates profile keys before writing", async () => {
    const { service } = build();
    await expect(service.putProfile("EC", { name: "Ecommerce", features: ["invoices", "bogus"] })).rejects.toMatchObject({
      status: 400,
      details: { unknown: ["bogus"] },
    });
    await expect(service.putProfile("bad id!", { name: "x", features: [] })).rejects.toThrow();
  });

  it("registry drops duplicate keys", () => {
    const f = createFeatures({
      db,
      registry: () => [...REGISTRY, REGISTRY[0]!],
      plans: { entitlements: async () => ({ planId: null, modules: [], features: {} }) },
      tenants: { getRef: async () => null },
    });
    expect(f.service.registry()).toHaveLength(REGISTRY.length);
  });
});

describe("preHandler", () => {
  async function app(ctxTenant: TenantRef | null, opts: Parameters<typeof build>[0] = {}) {
    const f = build(opts);
    const server = Fastify();
    server.decorateRequest("ctx", null as never);
    server.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant: ctxTenant };
    });
    server.addHook("preHandler", f.preHandler);
    server.setErrorHandler((err, _req, reply) => {
      const e = err as AppError;
      return reply.status(e.status ?? 500).send({ code: e.code, details: e.details });
    });
    server.get("/plain", async () => ({ ok: true }));
    server.get("/book", { config: { feature: "invoices.credit-book" } }, async () => ({ ok: true }));
    server.get("/both", { config: { feature: ["invoices", "payments"] } }, async () => ({ ok: true }));
    return { server, ...f };
  }

  it("does nothing for routes without a feature", async () => {
    const { server, service } = await app(tenant, { modules: [] });
    expect((await server.inject("/plain")).statusCode).toBe(200);
    expect(service.resolve).not.toHaveBeenCalled();
  });

  it("does nothing without a tenant", async () => {
    const { server, service } = await app(null, { modules: [] });
    expect((await server.inject("/book")).statusCode).toBe(200);
    expect(service.resolve).not.toHaveBeenCalled();
  });

  it("enforces the route's feature for tenant requests", async () => {
    const ok = await app(tenant, { modules: ["invoices.*"] });
    expect((await ok.server.inject("/book")).statusCode).toBe(200);

    const plan = await app(tenant, { modules: ["invoices", "invoices.reminders", "payments"] });
    const res = await plan.server.inject("/book");
    expect(res.statusCode).toBe(402);
    expect(res.json()).toEqual({ code: "plan_limit", details: { feature: "invoices.credit-book", reason: "plan" } });

    const shop = await app(tenant, { toggles: { payments: false } });
    const both = await shop.server.inject("/both");
    expect(both.statusCode).toBe(403);
    expect(both.json().details).toEqual({ feature: "payments", reason: "shop" });
  });
});

describe("GET /v1/features", () => {
  it("answers TenantFeatures matching tenantFeaturesSchema (every FeatureState field)", async () => {
    const f = build({ modules: ["invoices", "invoices.reminders"], toggles: { "invoices.reminders": false } });
    const server = Fastify();
    server.decorateRequest("ctx", null as never);
    server.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant };
    });
    await server.register(featuresRoutes(f.service), { prefix: "/v1/features" });
    const res = await server.inject("/v1/features");
    expect(res.statusCode).toBe(200);
    const json = res.json();
    // Equality also catches fields the schema doesn't document (zod strips unknown keys).
    expect(tenantFeaturesSchema.parse(json)).toEqual(json);
    expect(json.features.find((s: { key: string }) => s.key === "invoices.reminders")).toMatchObject({ enabled: false, reason: "shop", shopEnabled: false });
    expect(json.features.find((s: { key: string }) => s.key === "payments")).toMatchObject({ reason: "plan", shopEnabled: null });
    await server.close();
  });
});
