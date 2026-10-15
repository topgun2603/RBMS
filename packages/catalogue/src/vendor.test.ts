import { emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import {
  CATALOGUE_VENDOR_ROUTES,
  catalogueRoutes,
  isCatalogueStaff,
  isCatalogueVendorCandidate,
  isCatalogueVendorRoute,
  vendorIdOf,
} from "./routes";
import type { CatalogueService, VendorScopePort } from "./service";

const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "EC" };
const id = "22222222-2222-4222-8222-222222222222";
const staffUser = { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };
const seller = { id: "u2", sessionId: "s2", platformRoles: [], tenantRoles: ["member"] };
const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });

async function build(reqCtx: RequestContext, vendorScope?: VendorScopePort) {
  const fn = () => vi.fn(async () => ({ id: "x", items: [], total: 0 }));
  const service = {
    listCategories: fn(),
    categoryTree: fn(),
    createCategory: fn(),
    listProducts: fn(),
    exportProducts: vi.fn(async () => []),
    createProduct: fn(),
    getProduct: fn(),
    updateProduct: fn(),
    deleteProduct: fn(),
    addVariant: fn(),
    generateVariants: fn(),
    updateVariant: fn(),
    deleteVariant: fn(),
    listCollections: fn(),
    getVariants: vi.fn(async () => []),
  } as unknown as CatalogueService & Record<string, ReturnType<typeof vi.fn>>;
  const seen: (string | null)[] = [];
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = reqCtx;
  });
  app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
    reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: true });
  });
  app.addHook("onSend", async (req) => {
    seen.push(vendorIdOf(req));
  });
  await app.register(catalogueRoutes(service, vendorScope ? { vendorScope } : {}), { prefix: "/v1/catalog" });
  return { app, service, seen };
}

describe("vendor route keys", () => {
  it("lists the seller routes under /v1/catalog", () => {
    expect(CATALOGUE_VENDOR_ROUTES).toEqual([
      "GET /v1/catalog/categories",
      "GET /v1/catalog/categories/tree",
      "GET /v1/catalog/products",
      "POST /v1/catalog/products",
      "GET /v1/catalog/products/:id",
      "PATCH /v1/catalog/products/:id",
      "DELETE /v1/catalog/products/:id",
      "POST /v1/catalog/products/:id/variants",
      "POST /v1/catalog/products/:id/variants/generate",
      "PATCH /v1/catalog/variants/:id",
      "DELETE /v1/catalog/variants/:id",
    ]);
    expect(isCatalogueVendorRoute("get", "/v1/catalog/products/")).toBe(true);
    expect(isCatalogueVendorRoute("POST", "/v1/catalog/categories")).toBe(false);
    expect(isCatalogueVendorRoute("GET", "/v1/catalog/collections")).toBe(false);
    expect(isCatalogueVendorRoute("GET", undefined)).toBe(false);
  });

  it("tells the host which requests skip its permission check", () => {
    const req = (c: RequestContext, method = "PATCH", url = "/v1/catalog/products/:id") => ({ method, routeOptions: { url }, ctx: c }) as never;
    expect(isCatalogueStaff(ctx({ tenant, user: staffUser }))).toBe(true);
    expect(isCatalogueStaff(ctx({ tenant, user: { ...seller, platformRoles: ["superadmin"] } }))).toBe(true);
    expect(isCatalogueStaff(ctx({ tenant, user: seller }))).toBe(false);
    expect(isCatalogueVendorCandidate(req(ctx({ tenant, user: seller })))).toBe(true);
    expect(isCatalogueVendorCandidate(req(ctx({ tenant, user: staffUser })))).toBe(false);
    expect(isCatalogueVendorCandidate(req(ctx({ tenant })))).toBe(false);
    expect(isCatalogueVendorCandidate(req(ctx({ tenant, user: seller }), "POST", "/v1/catalog/collections"))).toBe(false);
  });
});

describe("vendor-scoped routes", () => {
  it("without vendorScope, non-staff users stay forbidden", async () => {
    const { app } = await build(ctx({ tenant, user: seller }));
    expect((await app.inject({ url: "/v1/catalog/products" })).statusCode).toBe(403);
  });

  it("scopes a seller to their products on the vendor routes", async () => {
    const vendorFor = vi.fn(async () => "vendor-1");
    const { app, service, seen } = await build(ctx({ tenant, user: seller }), { vendorFor });
    const scope = { vendorId: "vendor-1" };

    expect((await app.inject({ url: "/v1/catalog/products?q=saree", headers: { "x-vendor": "acme" } })).statusCode).toBe(200);
    expect(vendorFor).toHaveBeenCalledWith(tenant.id, seller.id, "acme");
    expect(service.listProducts).toHaveBeenCalledWith(tenant.id, { q: "saree" }, scope);
    expect(seen.at(-1)).toBe("vendor-1");

    await app.inject({ url: "/v1/catalog/products?format=csv" });
    expect(service.exportProducts).toHaveBeenCalledWith(tenant.id, {}, scope);
    expect(vendorFor).toHaveBeenLastCalledWith(tenant.id, seller.id, null);

    const cases: [string, string, string, unknown?][] = [
      ["GET", "/v1/catalog/categories", "listCategories"],
      ["GET", "/v1/catalog/categories/tree", "categoryTree"],
      ["POST", "/v1/catalog/products", "createProduct", { name: "x", price: 100 }],
      ["GET", `/v1/catalog/products/${id}`, "getProduct"],
      ["PATCH", `/v1/catalog/products/${id}`, "updateProduct", { name: "y" }],
      ["DELETE", `/v1/catalog/products/${id}`, "deleteProduct"],
      ["POST", `/v1/catalog/products/${id}/variants`, "addVariant", { price: 1 }],
      ["POST", `/v1/catalog/products/${id}/variants/generate`, "generateVariants", { options: [] }],
      ["PATCH", `/v1/catalog/variants/${id}`, "updateVariant", { price: 2 }],
      ["DELETE", `/v1/catalog/variants/${id}`, "deleteVariant"],
    ];
    for (const [method, url, name, payload] of cases) {
      const res = await app.inject({ method: method as "GET", url, payload: payload as never });
      expect([method, url, res.statusCode]).toEqual([method, url, 200]);
      const call = (service[name] as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
      expect(call.at(-1)).toEqual(name.endsWith("Categories") || name === "categoryTree" ? tenant.id : scope);
    }
    expect(service.createProduct).toHaveBeenLastCalledWith(tenant.id, { name: "x", price: 100 }, scope);
  });

  it("keeps sellers out of every other staff route", async () => {
    const vendorFor = vi.fn(async () => "vendor-1");
    const { app } = await build(ctx({ tenant, user: seller }), { vendorFor });
    expect((await app.inject({ url: "/v1/catalog/collections" })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/catalog/categories", payload: { name: "x" } })).statusCode).toBe(403);
    expect((await app.inject({ url: `/v1/catalog/variants?ids=${id}` })).statusCode).toBe(403);
    expect(vendorFor).not.toHaveBeenCalled();
  });

  it("forbids signed-in users who aren't sellers; anonymous users get 401", async () => {
    const vendorFor = vi.fn(async () => null);
    const { app, service } = await build(ctx({ tenant, user: seller }), { vendorFor });
    expect((await app.inject({ url: "/v1/catalog/products" })).statusCode).toBe(403);
    expect(service.listProducts).not.toHaveBeenCalled();
    const anon = await build(ctx({ tenant }), { vendorFor });
    expect((await anon.app.inject({ url: "/v1/catalog/products" })).statusCode).toBe(401);
    const noTenant = await build(ctx({ user: seller }), { vendorFor: vi.fn(async () => "vendor-1") });
    expect((await noTenant.app.inject({ url: "/v1/catalog/products" })).statusCode).toBe(403);
  });

  it("leaves staff calls exactly as before (no scope, seller resolution skipped)", async () => {
    const vendorFor = vi.fn(async () => "vendor-1");
    const { app, service, seen } = await build(ctx({ tenant, user: staffUser }), { vendorFor });
    await app.inject({ url: "/v1/catalog/products" });
    await app.inject({ method: "PATCH", url: `/v1/catalog/products/${id}`, payload: { vendorId: null } });
    await app.inject({ url: "/v1/catalog/collections" });
    expect(service.listProducts).toHaveBeenCalledWith(tenant.id, {});
    expect((service.listProducts as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(2);
    expect((service.updateProduct as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([tenant.id, id, { vendorId: null }]);
    expect(service.listCollections).toHaveBeenCalled();
    expect(vendorFor).not.toHaveBeenCalled();
    expect(seen).toEqual([null, null, null]);
  });
});

describe("vendorId on product inputs", () => {
  it("accepts a seller id or null (empty = null) on create and patch", async () => {
    const { productInputSchema, productPatchSchema } = await import("./service");
    expect(productInputSchema.parse({ name: "x", price: 1, vendorId: id }).vendorId).toBe(id);
    expect(productInputSchema.parse({ name: "x", price: 1, vendorId: "" }).vendorId).toBeNull();
    expect(productInputSchema.parse({ name: "x", price: 1 }).vendorId).toBeUndefined();
    expect(productPatchSchema.parse({ vendorId: null }).vendorId).toBeNull();
    expect(() => productPatchSchema.parse({ vendorId: "acme" })).toThrow(ZodError);
  });
});
