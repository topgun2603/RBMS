import { AppError, documented, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { z, ZodError } from "zod";
import { buildOpenApi, createRouteCollector, moduleOf, toOpenApiPath } from "./openapi";
import { developerRoutes } from "./routes";
import type { DeveloperService } from "./service";

describe("path conversion", () => {
  it("turns Fastify params into OpenAPI templates", () => {
    expect(toOpenApiPath("/v1/invoices/:id([0-9a-fA-F-]{36})/payments/:paymentId")).toEqual({
      path: "/v1/invoices/{id}/payments/{paymentId}",
      params: ["id", "paymentId"],
    });
    expect(toOpenApiPath("/v1/invoices/")).toEqual({ path: "/v1/invoices", params: [] });
    expect(toOpenApiPath("/v1/files/*")).toEqual({ path: "/v1/files/{wildcard}", params: ["wildcard"] });
    expect(moduleOf({ prefix: "/v1/orders", url: "/v1/orders/x" })).toBe("orders");
    expect(moduleOf({ prefix: "", url: "/health" })).toBe("other");
  });
});

describe("route collector + document", () => {
  it("captures module routes with feature/permission and builds OpenAPI 3.1", async () => {
    const collector = createRouteCollector();
    const app = Fastify();
    // host-side rule that annotates a permission while routes register (like apps/api routeRules)
    app.addHook("onRoute", (r) => {
      if (r.method === "POST" && r.url === "/v1/invoices") r.config = { ...(r.config ?? {}), permission: "invoices.create" };
    });
    collector.register(app);
    app.get("/health", async () => ({ ok: true }));
    await app.register(
      async (s) => {
        s.get("/", { config: { feature: "invoices" } }, async () => ({}));
        s.post("/", { config: { feature: "invoices" } }, async () => ({}));
        s.get("/:id([0-9a-fA-F-]{36})", { config: { feature: ["invoices", "invoices.reports"] } }, async () => ({}));
        s.get("/public/share/:token", { config: { feature: "invoices" } }, async () => ({}));
      },
      { prefix: "/v1/invoices" },
    );
    await app.register(
      async (s) => {
        s.post("/keys", { config: { feature: "developer", permission: "developer.manage", apiKey: false, summary: "Create an API key" } }, async () => ({}));
      },
      { prefix: "/v1/developer" },
    );
    await app.register(async (s) => s.get("/tenants", async () => ({})), { prefix: "/v1/platform" });
    await app.ready();

    const routes = collector.routes();
    expect(routes.find((r) => r.method === "POST" && r.url === "/v1/invoices")).toMatchObject({
      prefix: "/v1/invoices",
      feature: ["invoices"],
      permission: ["invoices.create"],
    });

    const doc = buildOpenApi(routes, { hidePrefixes: ["/v1/platform"], serverUrl: "https://api.example.com" });
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers).toEqual([{ url: "https://api.example.com" }]);
    expect(doc.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.tags.map((t) => t.name)).toEqual(["developer", "invoices"]);
    expect(Object.keys(doc.paths).sort()).toEqual(["/v1/developer/keys", "/v1/invoices", "/v1/invoices/public/share/{token}", "/v1/invoices/{id}"]);
    const list = doc.paths["/v1/invoices"]!;
    expect(Object.keys(list).sort()).toEqual(["get", "post"]); // HEAD left out
    expect(list.post).toMatchObject({ tags: ["invoices"], "x-feature": ["invoices"], "x-permission": ["invoices.create"] });
    expect(doc.paths["/v1/invoices/{id}"]!.get).toMatchObject({
      "x-feature": ["invoices", "invoices.reports"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    });
    expect(doc.paths["/v1/invoices/public/share/{token}"]!.get).toMatchObject({ security: [] });
    expect(doc.paths["/v1/developer/keys"]!.post).toMatchObject({ summary: "Create an API key", "x-api-key": false });
    const ids = Object.values(doc.paths).flatMap((p) => Object.values(p).map((o) => (o as { operationId: string }).operationId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});

describe("typed routes (documented)", () => {
  it("puts body, query and response schemas in the document", async () => {
    const collector = createRouteCollector();
    const app = Fastify();
    collector.register(app);
    const body = z.object({ target: z.string().min(3), channel: z.enum(["sms", "email"]).optional() });
    const query = z.object({ limit: z.coerce.number().int().optional(), q: z.string() });
    const response = z.object({ id: z.string().uuid(), name: z.string().nullable(), at: z.string().datetime() });
    await app.register(
      async (s) => {
        s.post("/thing", documented({ body, response }, { feature: "x" }), async () => ({}));
        s.get("/things", documented({ query, response: z.object({ items: z.array(response) }) }), async () => ({}));
        s.get("/plain", async () => ({}));
      },
      { prefix: "/v1/demo" },
    );
    await app.ready();
    const doc = buildOpenApi(collector.routes());

    const post = doc.paths["/v1/demo/thing"]!.post as Record<string, any>;
    expect(post["x-typed"]).toBe(true);
    expect(post["x-feature"]).toEqual(["x"]);
    expect(post.requestBody).toMatchObject({
      required: true,
      content: { "application/json": { schema: { type: "object", required: ["target"], properties: { channel: { enum: ["sms", "email"] } } } } },
    });
    expect(post.responses["200"].content["application/json"].schema.properties).toEqual({
      id: { type: "string", format: "uuid" },
      name: { type: ["string", "null"] },
      at: { type: "string", format: "date-time" },
    });
    expect(post.responses.default.content["application/json"].schema).toEqual({ $ref: "#/components/schemas/Error" });
    expect(doc.components.schemas.Error.required).toEqual(["error"]);

    const list = doc.paths["/v1/demo/things"]!.get as Record<string, any>;
    expect(list.parameters).toEqual([
      { name: "limit", in: "query", required: false, schema: { type: "integer" } },
      { name: "q", in: "query", required: true, schema: { type: "string" } },
    ]);
    expect(JSON.stringify(doc)).not.toContain("$schema");

    const plain = doc.paths["/v1/demo/plain"]!.get as Record<string, any>;
    expect(plain["x-typed"]).toBeUndefined();
    expect(plain.responses["200"]).toEqual({ description: "OK" });
  });
});

describe("developer routes", () => {
  const TENANT = { id: "11111111-1111-4111-8111-111111111111", slug: "meena", planId: null, appId: null };
  const KEY_ID = "44444444-4444-4444-8444-444444444444";
  async function build(ctx: Partial<RequestContext>) {
    const service = {
      openApi: vi.fn(() => ({ openapi: "3.1.0", paths: {} })),
      eventCatalogue: vi.fn(() => ({ items: [], total: 0 })),
      createKey: vi.fn(async () => ({ key: { id: KEY_ID }, token: "sk_test_x" })),
      revokeKey: vi.fn(async () => ({ id: KEY_ID, status: "revoked" })),
      listEndpoints: vi.fn(async () => ({ items: [], total: 0 })),
    };
    const app = Fastify();
    const configs: Record<string, unknown> = {};
    app.addHook("onRoute", (r) => {
      configs[`${r.method} ${r.url}`] = r.config;
    });
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), ...ctx };
    });
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
      if (err instanceof ZodError) return reply.status(400).send({ error: { code: "invalid_input" } });
      return reply.status(500).send({ error: { code: "other" } });
    });
    await app.register(async (s) => developerRoutes(service as unknown as DeveloperService)(s), { prefix: "/v1/developer" });
    await app.ready();
    return { app, service, configs };
  }
  const owner = { tenant: TENANT, user: { id: "u1", sessionId: "s", platformRoles: [], tenantRoles: ["owner"], permissions: ["*"] } };
  const apiKey = {
    tenant: TENANT,
    user: { id: `key:${KEY_ID}`, sessionId: "", platformRoles: [], tenantRoles: ["staff"], permissions: ["*"], apiKey: true, apiKeyId: KEY_ID } as never,
  };

  it("serves openapi.json without sign-in; every route declares the feature, staff routes the permission", async () => {
    const { app, configs } = await build({});
    expect((await app.inject({ method: "GET", url: "/v1/developer/openapi.json" })).json()).toMatchObject({ openapi: "3.1.0" });
    for (const [route, cfg] of Object.entries(configs)) {
      if (route.startsWith("HEAD")) continue;
      expect((cfg as { feature?: string }).feature, route).toBe("developer");
      if (!route.endsWith("/openapi.json")) expect((cfg as { permission?: string }).permission, route).toBe("developer.manage");
    }
  });

  it("owners create keys with their full access; API keys can't touch key routes", async () => {
    const { app, service } = await build(owner);
    const r = await app.inject({ method: "POST", url: "/v1/developer/keys", payload: { name: "Tally sync", scopes: ["invoices.*"] } });
    expect(r.statusCode).toBe(200);
    expect(service.createKey).toHaveBeenCalledWith(TENANT.id, { name: "Tally sync", scopes: ["invoices.*"] }, { userId: "u1", fullAccess: true, permissions: ["*"] });

    const k = await build(apiKey);
    expect((await k.app.inject({ method: "POST", url: "/v1/developer/keys", payload: { name: "x", scopes: ["*"] } })).statusCode).toBe(403);
    expect((await k.app.inject({ method: "POST", url: `/v1/developer/keys/${KEY_ID}/revoke` })).statusCode).toBe(403);
    expect(k.service.createKey).not.toHaveBeenCalled();
    // webhooks are fine for a key holding developer.manage
    expect((await k.app.inject({ method: "GET", url: "/v1/developer/endpoints" })).statusCode).toBe(200);
  });

  it("staff without developer.manage are refused", async () => {
    const { app } = await build({ tenant: TENANT, user: { id: "u2", sessionId: "s", platformRoles: [], tenantRoles: ["staff"], permissions: ["invoices.*"] } });
    expect((await app.inject({ method: "GET", url: "/v1/developer/endpoints" })).statusCode).toBe(403);
    const anon = await build({ tenant: TENANT });
    expect((await anon.app.inject({ method: "GET", url: "/v1/developer/endpoints" })).statusCode).toBe(401);
  });
});
