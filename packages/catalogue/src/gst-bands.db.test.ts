/**
 * Price-band GST (apparel / footwear) on catalogue products against Postgres: the rule is stored and returned, each
 * variant's billing item is banded at its own price (5% at or below ₹2,625 incl. GST, 18% above), the store / POS
 * lookups carry the rule, and clearing it brings the flat rate back. Runs only with `CATALOGUE_TEST_DATABASE_URL`.
 */
import { emptyContext, type RequestContext } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { APPAREL_FOOTWEAR_GST_RULE as RULE, exclusiveOf } from "@rbms/gst";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { catalogueRoutes, productSchema } from "./routes";
import { CatalogueService } from "./service";

const URL_ = process.env.CATALOGUE_TEST_DATABASE_URL;
const SCHEMA = `catalogue_gst_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["catalog_categories", "catalog_products", "catalog_variants", "catalog_collections"];
const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "BL" };
const user = { id: "22222222-2222-4222-8222-222222222222", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };

describe.skipIf(!URL_)("price-band GST in the catalogue (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let service: CatalogueService;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", `${SCHEMA},public`);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    service = new CatalogueService({ db });
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

  it("stores the rule and bands each variant at its own price", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/catalog/products",
      payload: {
        name: "Silk kurta",
        hsn: "6211",
        gstRate: 5,
        gstRule: RULE,
        taxInclusive: true,
        options: [{ name: "Fabric", values: ["Cotton silk", "Pure silk"] }],
        variants: [
          { optionValues: { Fabric: "Cotton silk" }, price: 262_500 },
          { optionValues: { Fabric: "Pure silk" }, price: 349_900 },
        ],
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    const product = productSchema.parse(res.json());
    expect(product.gstRule).toEqual(RULE);
    const [cotton, silk] = product.variants;
    const items = await service.getItems(tenant.id, [cotton!.id, silk!.id]);
    expect(items.map((i) => [i.gstRate, i.rate])).toEqual([
      [5, exclusiveOf(262_500, 5, true)],
      [18, exclusiveOf(349_900, 18, true)],
    ]);
    expect(items[0]!.gstRule).toEqual(RULE);
    const store = await service.storeVariants(tenant.id, [silk!.id]);
    expect(store[0]).toMatchObject({ gstRate: 18, gstRule: RULE });

    // A malformed rule is refused; clearing it goes back to the flat rate.
    const bad = await app.inject({ method: "PATCH", url: `/v1/catalog/products/${product.id}`, payload: { gstRule: { kind: "price-band", threshold: 0, below: 5, above: 18 } } });
    expect(bad.statusCode).toBe(400);
    const cleared = await app.inject({ method: "PATCH", url: `/v1/catalog/products/${product.id}`, payload: { gstRule: null } });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().gstRule).toBeNull();
    expect((await service.getItems(tenant.id, [silk!.id]))[0]).toMatchObject({ gstRate: 5, rate: exclusiveOf(349_900, 5, true) });
    expect((await service.getItems(tenant.id, [silk!.id]))[0]!.gstRule).toBeUndefined();
  });
});
