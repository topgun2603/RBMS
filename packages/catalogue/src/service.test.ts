import { emptyContext, notFound, paymentRequired, type RequestContext } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { billingItemSource, inventoryItemCatalog } from "./adapters";
import { createCatalogue } from "./index";
import { catalogueRoutes } from "./routes";
import {
  categoryInputSchema,
  generateVariantsSchema,
  idsQuerySchema,
  itemListQuerySchema,
  productInputSchema,
  productListQuerySchema,
  productPatchSchema,
  publicProductQuerySchema,
  simpleItemInputSchema,
  simpleItemPatchSchema,
  variantInputSchema,
  type CatalogueService,
} from "./service";
import type { CatalogItem } from "./types";

// Never connects.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const uuid = "4b0c2a4e-8f0e-4c1a-9d5e-0f6a1b2c3d4e";

describe("input schemas", () => {
  it("creates a simple product from price/sku with defaults", () => {
    const p = productInputSchema.parse({ name: " Cotton saree ", price: 85_000, sku: "CS-1", hsn: "", brand: "" });
    expect(p).toMatchObject({
      name: "Cotton saree",
      price: 85_000,
      sku: "CS-1",
      hsn: null,
      brand: null,
      gstRate: 0,
      unit: "pcs",
      taxInclusive: false,
      status: "active",
      channels: ["store", "billing"],
      tags: [],
      options: [],
      images: [],
      attributes: {},
    });
    expect(p.variants).toBeUndefined();
  });

  it("needs a price or variants, and at least one variant", () => {
    expect(() => productInputSchema.parse({ name: "x" })).toThrow(ZodError);
    expect(() => productInputSchema.parse({ name: "x", variants: [] })).toThrow(ZodError);
    const p = productInputSchema.parse({ name: "x", variants: [{ price: 100, optionValues: { Size: "M" } }] });
    expect(p.variants?.[0]).toMatchObject({ price: 100, optionValues: { Size: "M" } });
  });

  it("validates money, GST slabs, HSN, slugs, channels and options", () => {
    expect(() => productInputSchema.parse({ name: "x", price: 10.5 })).toThrow(ZodError);
    expect(() => productInputSchema.parse({ name: "x", price: -1 })).toThrow(ZodError);
    expect(() => productInputSchema.parse({ name: "x", price: 1, gstRate: 7 })).toThrow(ZodError);
    expect(() => productInputSchema.parse({ name: "x", price: 1, hsn: "12a" })).toThrow(ZodError);
    expect(() => productInputSchema.parse({ name: "x", price: 1, slug: "Has Space" })).toThrow(ZodError);
    expect(productInputSchema.parse({ name: "x", price: 1, slug: "Silk-Saree" }).slug).toBe("silk-saree");
    expect(() => productInputSchema.parse({ name: "x", price: 1, channels: ["moon"] })).toThrow(ZodError);
    expect(productInputSchema.parse({ name: "x", price: 1, channels: ["store", "store"], tags: ["New", "new"] })).toMatchObject({
      channels: ["store"],
      tags: ["new"],
    });
    expect(() =>
      productInputSchema.parse({ name: "x", price: 1, options: [{ name: "Size", values: ["S"] }, { name: "size", values: ["M"] }] }),
    ).toThrow(ZodError);
    expect(() => productInputSchema.parse({ name: "x", price: 1, options: [1, 2, 3, 4].map((i) => ({ name: `o${i}`, values: ["a"] })) })).toThrow(
      ZodError,
    );
    expect(generateVariantsSchema.parse({ options: [{ name: "Size", values: ["S", "S", "M"] }] }).options[0]!.values).toEqual(["S", "M"]);
    expect(() => generateVariantsSchema.parse({ options: [] })).toThrow(ZodError);
  });

  it("validates variants", () => {
    expect(variantInputSchema.parse({ price: 100, sku: "", mrp: "" })).toMatchObject({ price: 100, sku: null, mrp: null, optionValues: {} });
    expect(() => variantInputSchema.parse({ price: 100, sku: "has space" })).toThrow(ZodError);
    expect(() => variantInputSchema.parse({ price: 100, optionValues: { a: "1", b: "2", c: "3", d: "4" } })).toThrow(ZodError);
  });

  it("patches leave omitted fields undefined and clear empty strings", () => {
    expect(productPatchSchema.parse({})).toEqual({});
    expect(productPatchSchema.parse({ brand: "", gstRate: 5 })).toEqual({ brand: null, gstRate: 5 });
    expect(categoryInputSchema.parse({ name: "Sarees", parentId: "" })).toMatchObject({ name: "Sarees", parentId: null });
  });

  it("parses list queries", () => {
    expect(productListQuerySchema.parse({ limit: "10", status: "draft", channel: "store" })).toMatchObject({ limit: 10, offset: 0, status: "draft" });
    expect(() => productListQuerySchema.parse({ status: "gone" })).toThrow(ZodError);
    expect(publicProductQuerySchema.parse({})).toMatchObject({ sort: "new", limit: 24, offset: 0 });
    expect(() => publicProductQuerySchema.parse({ sort: "cost" })).toThrow(ZodError);
    expect(idsQuerySchema.parse({ ids: `${uuid}, ${uuid}` }).ids).toEqual([uuid, uuid]);
    expect(idsQuerySchema.parse({ ids: [uuid] }).ids).toEqual([uuid]);
    expect(() => idsQuerySchema.parse({ ids: "nope" })).toThrow(ZodError);
    expect(itemListQuerySchema.parse({ limit: "500" }).limit).toBe(500);
  });

  it("accepts billing-style items", () => {
    expect(simpleItemInputSchema.parse({ name: "Saree", rate: 85_000, gstRate: 5, hsn: "" })).toMatchObject({ unit: "pcs", hsn: null });
    expect(() => simpleItemInputSchema.parse({ name: "Saree", rate: 85_000, gstRate: 6 })).toThrow(ZodError);
    expect(simpleItemPatchSchema.parse({ rate: 100 })).toEqual({ rate: 100 });
  });
});

describe("routes", () => {
  const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });
  const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "EC" };
  const staffUser = { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };
  const id = "22222222-2222-4222-8222-222222222222";

  async function build(reqCtx: RequestContext, gate?: (feature: string | string[]) => void) {
    const service = {
      publicCategories: vi.fn(async () => ({ items: [] })),
      publicProducts: vi.fn(async () => ({ items: [], total: 0 })),
      publicProduct: vi.fn(async () => ({ id: "p" })),
      listCategories: vi.fn(async () => ({ items: [], total: 0 })),
      categoryTree: vi.fn(async () => ({ items: [] })),
      createCategory: vi.fn(async () => ({ id: "c" })),
      updateCategory: vi.fn(async () => ({ id: "c" })),
      deleteCategory: vi.fn(async () => undefined),
      reorderCategories: vi.fn(async () => ({ items: [], total: 0 })),
      listProducts: vi.fn(async () => ({ items: [], total: 0 })),
      exportProducts: vi.fn(async () => [
        {
          product: {
            name: "Shirt",
            brand: null,
            hsn: "6205",
            gstRate: 12,
            unit: "pcs",
            taxInclusive: true,
            status: "active",
            channels: ["store", "billing"],
            tags: [],
            slug: "shirt",
          },
          categoryName: "Men, Shirts",
          variant: { title: "M / Red", sku: "SH-M-R", barcode: null, price: 49_900, mrp: null, cost: 30_000 },
        },
      ]),
      createProduct: vi.fn(async () => ({ id: "p" })),
      getProduct: vi.fn(async () => ({ id: "p" })),
      updateProduct: vi.fn(async () => ({ id: "p" })),
      deleteProduct: vi.fn(async () => undefined),
      addVariant: vi.fn(async () => ({ id: "v" })),
      generateVariants: vi.fn(async () => ({ id: "p" })),
      updateVariant: vi.fn(async () => ({ id: "v" })),
      deleteVariant: vi.fn(async () => undefined),
      getVariants: vi.fn(async () => []),
      lookupCode: vi.fn(async () => ({ id: "v" })),
      searchVariants: vi.fn(async () => ({ items: [], total: 0 })),
    } as unknown as CatalogueService;
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = reqCtx;
    });
    // Stands in for the API host's feature preHandler.
    app.addHook("preHandler", async (req) => {
      const feature = req.routeOptions.config.feature;
      if (gate && feature && req.ctx.tenant) gate(feature);
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: true });
    });
    await app.register(catalogueRoutes(service), { prefix: "/v1/catalog" });
    return { app, service };
  }

  it("declares each route's feature in its config", async () => {
    const seen: (string | string[])[] = [];
    const { app, service } = await build(ctx({ tenant, user: staffUser }), (f) => {
      seen.push(f);
      if (f === "catalogue.variants") throw paymentRequired("Variants are not in your plan", { feature: f, reason: "plan" });
    });
    const cases: [string, string, string][] = [
      ["GET", "/v1/catalog/public/categories", "catalogue"],
      ["GET", "/v1/catalog/public/products", "catalogue"],
      ["GET", "/v1/catalog/public/products/silk-saree", "catalogue"],
      ["GET", "/v1/catalog/categories", "catalogue"],
      ["GET", "/v1/catalog/categories/tree", "catalogue"],
      ["POST", "/v1/catalog/categories", "catalogue"],
      ["PUT", "/v1/catalog/categories/order", "catalogue"],
      ["PATCH", `/v1/catalog/categories/${id}`, "catalogue"],
      ["DELETE", `/v1/catalog/categories/${id}`, "catalogue"],
      ["GET", "/v1/catalog/products", "catalogue"],
      ["POST", "/v1/catalog/products", "catalogue"],
      ["GET", `/v1/catalog/products/${id}`, "catalogue"],
      ["PATCH", `/v1/catalog/products/${id}`, "catalogue"],
      ["DELETE", `/v1/catalog/products/${id}`, "catalogue"],
      ["POST", `/v1/catalog/products/${id}/variants`, "catalogue.variants"],
      ["POST", `/v1/catalog/products/${id}/variants/generate`, "catalogue.variants"],
      ["PATCH", `/v1/catalog/variants/${id}`, "catalogue.variants"],
      ["DELETE", `/v1/catalog/variants/${id}`, "catalogue.variants"],
      ["GET", `/v1/catalog/variants?ids=${id}`, "catalogue"],
      ["GET", "/v1/catalog/variants/lookup?code=890123", "catalogue"],
      ["GET", "/v1/catalog/variants/search?q=shirt", "catalogue"],
    ];
    for (const [method, url, feature] of cases) {
      seen.length = 0;
      await app.inject({ method: method as "GET", url, payload: ["POST", "PUT", "PATCH"].includes(method) ? {} : undefined });
      expect([method, url, seen]).toEqual([method, url, [feature]]);
    }
    expect(service.addVariant).not.toHaveBeenCalled();
    expect((await app.inject({ method: "PATCH", url: `/v1/catalog/variants/${id}`, payload: {} })).statusCode).toBe(402);
  });

  it("serves the public storefront with only a tenant", async () => {
    const { app, service } = await build(ctx({ tenant }));
    expect((await app.inject({ url: "/v1/catalog/public/products?sort=price-asc" })).statusCode).toBe(200);
    expect(service.publicProducts).toHaveBeenCalledWith(tenant.id, { sort: "price-asc" });
    expect((await app.inject({ url: "/v1/catalog/public/products/silk-saree" })).statusCode).toBe(200);
    expect(service.publicProduct).toHaveBeenCalledWith(tenant.id, "silk-saree");
    // No tenant → 403; staff routes need a member.
    expect((await (await build(ctx({}))).app.inject({ url: "/v1/catalog/public/products" })).statusCode).toBe(403);
    expect((await app.inject({ url: "/v1/catalog/products" })).statusCode).toBe(401);
  });

  it("requires a staff member of the tenant", async () => {
    const member = { ...staffUser, tenantRoles: ["member"] };
    expect((await (await build(ctx({ tenant, user: member }))).app.inject({ url: "/v1/catalog/products" })).statusCode).toBe(403);
    const { app } = await build(ctx({ tenant, user: staffUser }));
    expect((await app.inject({ url: "/v1/catalog/products" })).statusCode).toBe(200);
  });

  it("passes ids, codes and bodies through", async () => {
    const { app, service } = await build(ctx({ tenant, user: staffUser }));
    const res = await app.inject({ url: `/v1/catalog/variants?ids=${id},${id}` });
    expect(res.json()).toEqual({ items: [] });
    expect(service.getVariants).toHaveBeenCalledWith(tenant.id, [id, id]);
    expect((await app.inject({ url: "/v1/catalog/variants?ids=bad" })).statusCode).toBe(400);
    await app.inject({ url: "/v1/catalog/variants/lookup?code=890123" });
    expect(service.lookupCode).toHaveBeenCalledWith(tenant.id, "890123");
    expect((await app.inject({ url: "/v1/catalog/variants/lookup" })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: `/v1/catalog/products/${id}/variants/generate`, payload: { options: [{ name: "Size", values: ["S"] }] } });
    expect(service.generateVariants).toHaveBeenCalledWith(tenant.id, id, { options: [{ name: "Size", values: ["S"] }] });
    const del = await app.inject({ method: "DELETE", url: `/v1/catalog/variants/${id}` });
    expect(del.json()).toEqual({ ok: true });
    expect((await app.inject({ url: "/v1/catalog/products/not-a-uuid" })).statusCode).toBe(400);
  });

  it("exports products as CSV (one row per variant) on format=csv", async () => {
    const { app, service } = await build(ctx({ tenant, user: staffUser }));
    const res = await app.inject({ url: "/v1/catalog/products?format=csv&status=active&limit=5" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="products-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(service.exportProducts).toHaveBeenCalledWith(tenant.id, { status: "active" });
    expect(service.listProducts).not.toHaveBeenCalled();
    const [header, row] = res.body.replace(/^﻿/, "").split("\r\n");
    expect(header).toBe(
      "Product,Variant,Item name,SKU,Barcode,Category,Brand,HSN,GST %,Unit,Price (Rs),MRP (Rs),Cost (Rs),Tax inclusive,Status,Channels,Tags,Slug",
    );
    expect(row).toBe('Shirt,M / Red,Shirt – M / Red,SH-M-R,,"Men, Shirts",,6205,12,pcs,499.00,,300.00,yes,active,store billing,,shirt');
    expect((await app.inject({ url: "/v1/catalog/products?format=xml" })).statusCode).toBe(400);
  });
});

describe("adapters", () => {
  const item: CatalogItem = {
    id: uuid,
    productId: "p1",
    name: "Shirt – M",
    sku: "SH-M",
    barcode: null,
    hsn: "6205",
    unit: "pcs",
    rate: 44_554,
    price: 49_900,
    taxInclusive: true,
    gstRate: 12,
    image: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  };
  const billingShape = { id: uuid, name: "Shirt – M", hsn: "6205", unit: "pcs", rate: 44_554, gstRate: 12, createdAt: item.createdAt };

  function stub() {
    return {
      listItems: vi.fn(async () => ({ items: [item], total: 1 })),
      getItems: vi.fn(async () => [item]),
      getItem: vi.fn(async (_t: string, id: string) => {
        if (id !== uuid) throw notFound("Item");
        return item;
      }),
      createSimpleProduct: vi.fn(async () => item),
      updateSimpleItem: vi.fn(async (_t: string, id: string) => {
        if (id !== uuid) throw notFound("Item");
        return item;
      }),
      removeItem: vi.fn(async (_t: string, id: string) => {
        if (id !== uuid) throw notFound("Item");
      }),
    };
  }

  it("maps catalogue items to billing items (exclusive rate) and 404s to null/false", async () => {
    const s = stub();
    const src = billingItemSource(s as unknown as CatalogueService);
    expect(await src.list("t", { q: "sh", limit: 50, offset: 0 })).toEqual({ items: [billingShape], total: 1 });
    expect(s.listItems).toHaveBeenCalledWith("t", { q: "sh", limit: 50, offset: 0, channel: "billing" });
    expect(await src.get("t", uuid)).toEqual(billingShape);
    expect(await src.get("t", "other")).toBeNull();
    const input = { name: "Shirt", hsn: null, unit: "pcs", rate: 100, gstRate: 12 };
    expect(await src.create("t", input)).toEqual(billingShape);
    expect(s.createSimpleProduct).toHaveBeenCalledWith("t", { ...input, channels: ["billing", "store"] });
    expect(await src.update("t", uuid, { rate: 5 })).toEqual(billingShape);
    expect(await src.update("t", "other", { rate: 5 })).toBeNull();
    expect(await src.remove("t", uuid)).toBe(true);
    expect(await src.remove("t", "other")).toBe(false);
  });

  it("does not swallow other errors", async () => {
    const s = stub();
    s.getItem.mockRejectedValueOnce(new Error("db down"));
    await expect(billingItemSource(s as unknown as CatalogueService).get("t", uuid)).rejects.toThrow("db down");
  });

  it("serves inventory's catalog port across all channels", async () => {
    const s = stub();
    const cat = inventoryItemCatalog(s as unknown as CatalogueService);
    expect(await cat.listItems("t", "sh")).toEqual([item]);
    expect(s.listItems).toHaveBeenCalledWith("t", { q: "sh", limit: 500, offset: 0 });
    expect(await cat.getItems("t", [uuid])).toEqual([item]);
  });
});

describe("createCatalogue", () => {
  it("returns the service, the module (mounted at /v1/catalog) and the port adapters", () => {
    const { service, module, itemSource, itemCatalog } = createCatalogue({ db });
    expect(module.id).toBe("catalog");
    expect(Object.keys(module.tables ?? {}).sort()).toEqual(["catalogCategories", "catalogProducts", "catalogVariants"]);
    expect(module.features).toEqual([
      expect.objectContaining({ key: "catalogue", module: "catalogue", label: "Product catalogue" }),
      expect.objectContaining({
        key: "catalogue.variants",
        module: "catalogue",
        label: "Variants and options",
        dependsOn: ["catalogue"],
        shopToggle: true,
      }),
    ]);
    expect(service).toBeDefined();
    expect(typeof itemSource.list).toBe("function");
    expect(typeof itemCatalog.getItems).toBe("function");
  });
});
