/**
 * Database test of the API document shapes (routes.ts): runs the stock routes the mobile app uses (stock list and
 * low-stock filter, one item, adjust add / remove / set, reorder level and tracking, movements, summary, locations)
 * against Postgres and checks every JSON answer with its response schema, so the schemas can't drift from what the
 * routes really return. Runs only with `INVENTORY_TEST_DATABASE_URL` set (a development Postgres with the inventory
 * tables migrated); it copies them into a throw-away schema and drops it afterwards. Items come from a fake catalogue.
 *   PowerShell: $env:INVENTORY_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type RouteOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError, type ZodTypeAny } from "zod";
import type { CatalogItem, ItemCatalogPort } from "./ports";
import { inventoryRoutes, stockLevelSchema, stockListSchema, stockLocationListSchema, stockMovementListSchema, stockSummarySchema } from "./routes";
import { InventoryService } from "./service";

const URL_ = process.env.INVENTORY_TEST_DATABASE_URL;
const SCHEMA = `inventory_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["stock_locations", "stock_items", "stock_movements", "stock_transfers", "stock_reservations", "suppliers", "purchases"];
const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "BL" };
const user = { id: "22222222-2222-4222-8222-222222222222", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };
const CAT = "44444444-4444-4444-8444-444444444444";
// The catalogue adapter gives every item a categoryId (null = none) and categoryName.
const ITEMS: CatalogItem[] = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Rice 1kg", hsn: "1006", unit: "kg", rate: 6000, gstRate: 5, categoryId: CAT, categoryName: "Grocery" },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "Saree – Red", hsn: "5007", unit: "pcs", rate: 95143, gstRate: 5, categoryId: null, categoryName: null },
  { id: "aaaaaaaa-0000-4000-8000-000000000003", name: "Gift wrap", hsn: null, unit: "pcs", rate: 1000, gstRate: 18, categoryId: null, categoryName: null },
];
const [RICE, SAREE, WRAP] = ITEMS.map((i) => i.id) as [string, string, string];

describe.skipIf(!URL_)("inventory API shapes against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;

  async function call<T extends ZodTypeAny>(schema: T, method: "GET" | "POST" | "PATCH", url: string, payload?: object) {
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
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    const catalog: ItemCatalogPort = {
      getItems: async (_t, ids) => ITEMS.filter((i) => ids.includes(i.id)),
      listItems: async (_t, q) => ITEMS.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase())),
    };
    const service = new InventoryService({ db, catalog, sellerState: { stateCode: async () => "33" } });
    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant, user } as RequestContext;
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
    });
    await app.register(inventoryRoutes(service), { prefix: "/v1/inventory" });
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("stock levels, adjustments, movements, summary and locations match their response schemas", async () => {
    // Receive (add with a cost), write off (remove), count (set).
    const received = await call(stockLevelSchema, "POST", `/v1/inventory/stock/${RICE}/adjust`, { mode: "add", qty: 10, unitCost: 5000, note: "Opening" });
    expect(received).toMatchObject({ qty: 10, avgCost: 5000, value: 50_000, status: "ok" });
    const writtenOff = await call(stockLevelSchema, "POST", `/v1/inventory/stock/${RICE}/adjust`, { mode: "remove", qty: 2.5, note: "Damaged" });
    expect(writtenOff.qty).toBe(7.5);
    await call(stockLevelSchema, "POST", `/v1/inventory/stock/${SAREE}/adjust`, { mode: "set", qty: 2 });
    const reorder = await call(stockLevelSchema, "PATCH", `/v1/inventory/stock/${SAREE}`, { reorderLevel: 3 });
    expect(reorder.status).toBe("low");
    const untracked = await call(stockLevelSchema, "PATCH", `/v1/inventory/stock/${WRAP}`, { track: false });
    expect(untracked.track).toBe(false);

    // Lists: everything, the low-stock list, one category, every location summed.
    const all = await call(stockListSchema, "GET", "/v1/inventory/stock");
    expect(all.total).toBe(3);
    const low = await call(stockListSchema, "GET", "/v1/inventory/stock?status=low,out&sort=qty&limit=50");
    expect(low.items.map((r) => r.itemId)).toEqual([SAREE]);
    await call(stockListSchema, "GET", `/v1/inventory/stock?category=${CAT}&q=rice`);
    const locations = await call(stockLocationListSchema, "GET", "/v1/inventory/locations");
    const main = locations.items.find((l) => l.isDefault)!;
    await call(stockListSchema, "GET", "/v1/inventory/stock?locationId=all");
    await call(stockListSchema, "GET", `/v1/inventory/stock?locationId=${main.id}&filter=low`);

    // One item, its movements, the dashboard summary.
    expect((await call(stockLevelSchema, "GET", `/v1/inventory/stock/${RICE}`)).qty).toBe(7.5);
    expect((await call(stockLevelSchema, "GET", `/v1/inventory/stock/${RICE}?locationId=${main.id}`)).locationId).toBe(main.id);
    const moves = await call(stockMovementListSchema, "GET", `/v1/inventory/stock/${RICE}/movements?limit=10`);
    expect(moves.items.map((m) => m.reason)).toEqual(["adjustment", "opening"]);
    const summary = await call(stockSummarySchema, "GET", "/v1/inventory/summary");
    expect(summary).toMatchObject({ lowCount: 1, outCount: 0 });
    expect(summary.lowItems[0]?.itemId).toBe(SAREE);
  });
});

describe("inventory API document config", () => {
  it("documented routes keep their feature config", async () => {
    const seen = new Map<string, RouteOptions>();
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRoute", (r) => {
      seen.set(`${r.method} ${r.url}`, r);
    });
    await app.register(inventoryRoutes({} as InventoryService), { prefix: "/v1/inventory" });
    const adjust = seen.get("POST /v1/inventory/stock/:itemId/adjust")!;
    expect(adjust.config).toMatchObject({ feature: "inventory" });
    expect(adjust.config?.schema?.body).toBeTruthy();
    expect(seen.get("GET /v1/inventory/locations")!.config).toMatchObject({ feature: "inventory.locations" });
    expect(seen.get("GET /v1/inventory/stock")!.config?.schema?.query).toBeTruthy();
    await app.close();
  });
});
