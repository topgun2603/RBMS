/**
 * Database test of the API document shapes (routes.ts): runs the product and category routes the mobile app uses
 * (list with and without stock, get, create, update, archive, variant add / update / delete) against Postgres and
 * checks every JSON answer with its response schema, so the schemas can't drift from what the routes really return.
 * Runs only with `CATALOGUE_TEST_DATABASE_URL` set (a development Postgres with the catalogue tables migrated and
 * pg_trgm installed); it copies the tables into a throw-away schema and drops it afterwards.
 *   PowerShell: $env:CATALOGUE_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError, type ZodTypeAny } from "zod";
import { categoryListSchema, catalogueRoutes, productListSchema, productSchema, variantSchema } from "./routes";
import { CatalogueService } from "./service";

const URL_ = process.env.CATALOGUE_TEST_DATABASE_URL;
const SCHEMA = `catalogue_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["catalog_categories", "catalog_products", "catalog_variants", "catalog_collections"];
const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "BL" };
const user = { id: "22222222-2222-4222-8222-222222222222", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };

describe.skipIf(!URL_)("catalogue API shapes against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let service: CatalogueService;
  /** Toggles the fake stock port (every tracked variant: 3 on hand, reorder at 5 → "low"). */
  let stockOn = false;

  async function call<T extends ZodTypeAny>(schema: T, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) {
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(200);
    const json = res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(`${method} ${url}: ${parsed.error.message}`);
    // zod strips unknown keys, so equality also catches fields the schema doesn't document.
    expect(parsed.data, `${method} ${url}: undocumented fields`).toEqual(json);
    return parsed.data as ReturnType<T["parse"]>;
  }

  beforeAll(async () => {
    const u = new URL(URL_!);
    // public last: pg_trgm's operators and functions live there.
    u.searchParams.set("search_path", `${SCHEMA},public`);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    service = new CatalogueService({
      db,
      stock: {
        variantLevels: () => sql`select 3::numeric as qty, 5::numeric as reorder, true as track`,
        enabled: async () => stockOn,
      },
    });
    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant, user } as RequestContext;
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
    });
    await app.register(catalogueRoutes(service), { prefix: "/v1/catalog" });
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("categories, products and variants match their response schemas", async () => {
    const cat = await service.createCategory(tenant.id, { name: "Sarees", seo: { title: "Silk sarees" } });
    await service.createCategory(tenant.id, { name: "Silk", parentId: cat.id });
    const cats = await call(categoryListSchema, "GET", "/v1/catalog/categories");
    expect(cats.items.map((c) => c.name)).toEqual(expect.arrayContaining(["Sarees", "Silk"]));

    // A simple product (one default variant) and one with options and variants.
    const simple = await call(productSchema, "POST", "/v1/catalog/products", {
      name: "Rice 1kg",
      hsn: "1006",
      gstRate: 5,
      unit: "kg",
      price: 6000,
      mrp: 6500,
      sku: "RICE-1",
      barcode: "8901000000011",
    });
    expect(simple.variants).toHaveLength(1);
    const saree = await call(productSchema, "POST", "/v1/catalog/products", {
      name: "Kanchi silk saree",
      categoryId: cat.id,
      hsn: "5007",
      gstRate: 5,
      taxInclusive: true,
      channels: ["store", "billing", "pos"],
      tags: ["silk"],
      attributes: { Fabric: "Silk" },
      options: [{ name: "Colour", values: ["Red", "Green"] }],
      images: [{ url: "https://img.example/saree.jpg" }, { url: "https://img.example/saree-2.jpg", alt: "Back" }],
      seo: { title: "Kanchi saree" },
      variants: [
        { optionValues: { Colour: "Red" }, price: 999_900, mrp: 1_200_000, cost: 600_000, sku: "KS-RED" },
        { optionValues: { Colour: "Green" }, price: 999_900, barcode: "8901000000028", weightGrams: 700 },
      ],
    });
    expect(await call(productSchema, "GET", `/v1/catalog/products/${saree.id}`)).toEqual(saree);
    const renamed = await call(productSchema, "PATCH", `/v1/catalog/products/${simple.id}`, { name: "Ponni rice 1kg", brand: "Sri", description: "" });
    expect(renamed.name).toBe("Ponni rice 1kg");

    // Variant writes (catalogue.variants).
    const v = await call(variantSchema, "POST", `/v1/catalog/products/${saree.id}/variants`, { optionValues: { Colour: "Blue" }, price: 899_900 });
    const v2 = await call(variantSchema, "PATCH", `/v1/catalog/variants/${v.id}`, { price: 949_900, mrp: 1_100_000, sku: "KS-BLUE", barcode: "8901000000035" });
    expect(v2).toMatchObject({ price: 949_900, sku: "KS-BLUE" });
    expect((await app.inject({ method: "DELETE", url: `/v1/catalog/variants/${v.id}` })).json()).toEqual({ ok: true });

    // The staff list without stock, then with stock on (the `stock` column and facet).
    const list = await call(productListSchema, "GET", "/v1/catalog/products?limit=10&sort=name");
    expect(list.total).toBe(2);
    expect(list.items[0]).not.toHaveProperty("stock");
    stockOn = true;
    const withStock = await call(productListSchema, "GET", `/v1/catalog/products?q=saree&status=active&categoryId=${cat.id}`);
    expect(withStock.items[0]?.stock).toEqual({ qty: 6, status: "low" });
    expect(withStock.facets.stock).toBeTruthy();
    stockOn = false;

    // Archive (soft delete).
    const del = await app.inject({ method: "DELETE", url: `/v1/catalog/products/${simple.id}` });
    expect(del.json()).toEqual({ ok: true });
    expect((await call(productListSchema, "GET", "/v1/catalog/products")).total).toBe(1);
  });
});
