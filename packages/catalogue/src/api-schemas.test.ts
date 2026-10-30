import { emptyContext, type RequestContext } from "@rbms/core";
import type { Db } from "@rbms/db";
import Fastify, { type RouteOptions } from "fastify";
import { describe, expect, it } from "vitest";
import { catalogueRoutes, variantLookupSchema, variantSearchResultSchema } from "./routes";
import { CatalogueService } from "./service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";

type Op = { m: string; args: unknown[] };

/** Chainable drizzle fake: awaiting a query resolves to `resolve(ops)` for that query's builder calls. */
function fakeDb(resolve: (ops: Op[]) => unknown[]) {
  let current: Op[] = [];
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then")
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
            const ops = current;
            current = [];
            return Promise.resolve(resolve(ops)).then(res, rej);
          };
        return (...args: unknown[]) => {
          current.push({ m: String(prop), args });
          return chain;
        };
      },
    },
  );
  return chain as Db;
}

const product = {
  id: PRODUCT,
  tenantId: TENANT,
  name: "Saree",
  slug: "saree",
  description: null,
  brand: null,
  categoryId: "44444444-4444-4444-8444-444444444444",
  hsn: "5007",
  gstRate: 5,
  unit: "pcs",
  taxInclusive: true,
  status: "active",
  channels: ["store", "billing", "pos"],
  tags: [],
  attributes: {},
  options: [{ name: "Colour", values: ["Red"] }],
  images: [{ url: "https://img.example/saree.jpg", alt: null }],
  seo: null,
  vendorId: null,
  searchText: "",
  deletedAt: null,
  createdAt: new Date("2026-10-01T05:00:00Z"),
  updatedAt: new Date("2026-10-01T05:00:00Z"),
};
const variant = {
  id: "33333333-3333-4333-8333-333333333333",
  tenantId: TENANT,
  productId: PRODUCT,
  sku: "SAR-RED",
  barcode: "8901234567890",
  title: "Red",
  optionValues: { Colour: "Red" },
  price: 99_900,
  mrp: 120_000,
  cost: 60_000,
  weightGrams: null,
  position: 0,
  isDefault: true,
  deletedAt: null,
  createdAt: new Date("2026-10-01T05:00:00Z"),
  updatedAt: new Date("2026-10-01T05:00:00Z"),
};

describe("POS lookups match their API document shapes", () => {
  async function build() {
    // Joined page queries get the variant row; the count query gets a total.
    const db = fakeDb((ops) => (ops.some((o) => o.m === "limit") ? [{ v: variant, p: product }] : [{ total: 1 }]));
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = {
        ...emptyContext(),
        tenant: { id: TENANT, slug: "sri", planId: "pro", appId: "BL" },
        user: { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] },
      } as RequestContext;
    });
    await app.register(catalogueRoutes(new CatalogueService({ db })), { prefix: "/v1/catalog" });
    return app;
  }

  it("GET /variants/lookup (barcode / SKU scan)", async () => {
    const app = await build();
    const res = await app.inject({ url: "/v1/catalog/variants/lookup?code=8901234567890" });
    expect(res.statusCode, res.body).toBe(200);
    const json = res.json();
    // Equality also catches fields the schema doesn't document (zod strips unknown keys).
    expect(variantLookupSchema.parse(json)).toEqual(json);
    expect(json).toMatchObject({ name: "Saree – Red", rate: 95143, price: 99_900 });
    await app.close();
  });

  it("GET /variants/search", async () => {
    const app = await build();
    const res = await app.inject({ url: "/v1/catalog/variants/search?q=saree&limit=24" });
    expect(res.statusCode, res.body).toBe(200);
    const json = res.json();
    expect(variantSearchResultSchema.parse(json)).toEqual(json);
    expect(json.total).toBe(1);
    await app.close();
  });

  it("documented routes keep their feature config", async () => {
    const seen = new Map<string, RouteOptions>();
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRoute", (r) => {
      seen.set(`${r.method} ${r.url}`, r);
    });
    await app.register(catalogueRoutes({} as CatalogueService), { prefix: "/v1/catalog" });
    expect(seen.get("GET /v1/catalog/products")!.config).toMatchObject({ feature: "catalogue" });
    expect(seen.get("GET /v1/catalog/products")!.config?.schema?.query).toBeTruthy();
    expect(seen.get("POST /v1/catalog/products/:id/variants")!.config).toMatchObject({ feature: "catalogue.variants" });
    expect(seen.get("PATCH /v1/catalog/variants/:id")!.config?.schema?.body).toBeTruthy();
    expect(seen.get("DELETE /v1/catalog/products/:id")!.config?.schema?.response).toBeTruthy();
    await app.close();
  });
});
