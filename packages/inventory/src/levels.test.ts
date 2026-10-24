import { emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { INVENTORY_FEATURES } from "./features";
import {
  activeReservations,
  aggregateStock,
  checkAvailability,
  isItemTracked,
  locationCodeFrom,
  locationDeleteProblem,
  locationPatchProblem,
  netByLocationItem,
  publicStockFlags,
  reserveDecision,
  transferProblem,
} from "./levels";
import { mergeQtyLines } from "./logic";
import { INVENTORY_PERMISSIONS, INVENTORY_ROUTE_PERMISSIONS } from "./permissions";
import { inventoryRoutes } from "./routes";
import {
  adjustInputSchema,
  availabilityQuerySchema,
  buildStockLevelRow,
  buildStockRow,
  insufficientStock,
  locationInputSchema,
  locationListQuerySchema,
  reserveInputSchema,
  stockQuerySchema,
  transferInputSchema,
  upsertStockStatement,
  type InventoryService,
} from "./service";

const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "aaaaaaaa-0000-4000-8000-000000000002";
const C = "aaaaaaaa-0000-4000-8000-000000000003";
const L1 = "bbbbbbbb-0000-4000-8000-000000000001";
const L2 = "bbbbbbbb-0000-4000-8000-000000000002";
const item = { id: A, name: "Cotton saree", hsn: "5208", unit: "pcs", rate: 50000, gstRate: 5 };
const t0 = new Date("2026-10-01T00:00:00Z");
const t1 = new Date("2026-10-02T00:00:00Z");
const row = (
  p: Partial<{
    qty: string;
    reserved: string;
    reorderLevel: string;
    track: boolean;
    avgCost: number | null;
    updatedAt: Date | null;
    isDefault: boolean;
  }>,
) => ({
  qty: "0",
  reserved: "0",
  reorderLevel: "0",
  track: true,
  avgCost: null,
  updatedAt: t0,
  ...p,
});

describe("aggregateStock", () => {
  it("returns null without rows", () => {
    expect(aggregateStock([])).toBeNull();
  });
  it("sums qty, reserved, available and reorder level across locations", () => {
    const agg = aggregateStock([
      row({ qty: "10.500", reserved: "2", reorderLevel: "3", avgCost: 1000 }),
      row({ qty: "4", reserved: "0.5", reorderLevel: "1", avgCost: 2000, updatedAt: t1 }),
    ])!;
    expect(agg).toMatchObject({
      qtyMilli: 14500,
      reservedMilli: 2500,
      availableMilli: 12000,
      reorderMilli: 4000,
      track: true,
      updatedAt: t1,
    });
    // (10.5 × 1000 + 4 × 2000) / 14.5 = 1275.86… → 1276
    expect(agg.avgCost).toBe(1276);
  });
  it("is exact for a single row (legacy behaviour)", () => {
    const agg = aggregateStock([row({ qty: "0.001", avgCost: 12345 })])!;
    expect(agg.avgCost).toBe(12345);
    expect(aggregateStock([row({ qty: "-3", avgCost: 77 })])!.avgCost).toBe(77);
  });
  it("ignores negative/zero rows for the weighted cost and falls back to the default location's cost", () => {
    expect(aggregateStock([row({ qty: "-2", avgCost: 500 }), row({ qty: "2", avgCost: 900 })])!.avgCost).toBe(900);
    expect(aggregateStock([row({ qty: "0", avgCost: 500 }), row({ qty: "-1", avgCost: 900, isDefault: true })])!.avgCost).toBe(900);
    expect(aggregateStock([row({ qty: "1" }), row({ qty: "1" })])!.avgCost).toBeNull();
  });
  it("negative stock at one location reduces the total", () => {
    expect(aggregateStock([row({ qty: "5" }), row({ qty: "-2", reserved: "1" })])).toMatchObject({ qtyMilli: 3000, availableMilli: 2000 });
  });
  it("tracking is item-level: off anywhere = untracked", () => {
    expect(isItemTracked([])).toBe(true);
    expect(isItemTracked([{ track: true }, { track: false }])).toBe(false);
    expect(aggregateStock([row({ track: true }), row({ track: false })])!.track).toBe(false);
  });
});

describe("buildStockLevelRow", () => {
  it("matches the legacy StockRow for one row and adds reserved/available", () => {
    const stock = { qty: "4.500", reorderLevel: "5.000", track: true, avgCost: 10000, updatedAt: t0 };
    const level = buildStockLevelRow(item, [{ ...stock, reserved: "1.5" }], { locationId: L1 });
    expect(level).toEqual({ ...buildStockRow(item, stock), reserved: 1.5, available: 3, locationId: L1 });
  });
  it("items without rows: qty 0, tracked, out (or untracked when told so)", () => {
    expect(buildStockLevelRow(item, [], { locationId: null })).toEqual({
      ...buildStockRow(item, null),
      reserved: 0,
      available: 0,
      locationId: null,
    });
    expect(buildStockLevelRow(item, [], { locationId: L2, track: false })).toMatchObject({ track: false, status: "ok", qty: 0 });
  });
  it("aggregates value and status over locations", () => {
    const level = buildStockLevelRow(
      item,
      [row({ qty: "1", reorderLevel: "2", avgCost: 100 }), row({ qty: "2", reorderLevel: "2", avgCost: 100, reserved: "1" })],
      { locationId: null },
    );
    expect(level).toMatchObject({ qty: 3, reorderLevel: 4, status: "low", value: 300, reserved: 1, available: 2 });
  });
});

describe("checkAvailability (reserve / transfer)", () => {
  const stock = new Map([
    [A, { qtyMilli: 5000, reservedMilli: 2000 }],
    [B, { qtyMilli: 1000, reservedMilli: 0 }],
  ]);
  const lines = mergeQtyLines([
    { itemId: A, qty: 2 },
    { itemId: A, qty: 1 },
    { itemId: B, qty: 1 },
  ]);
  it("succeeds when every tracked line fits (available = qty − reserved)", () => {
    expect(checkAvailability(lines, stock, new Set())).toEqual({
      ok: true,
      lines: [
        { itemId: A, milli: 3000 },
        { itemId: B, milli: 1000 },
      ],
      skipped: [],
    });
  });
  it("is all-or-nothing and reports every short item", () => {
    const res = checkAvailability(
      mergeQtyLines([
        { itemId: A, qty: 3.5 },
        { itemId: B, qty: 1 },
        { itemId: C, qty: 1 },
      ]),
      stock,
      new Set(),
    );
    expect(res).toEqual({
      ok: false,
      items: [
        { itemId: A, available: 3, requested: 3.5 },
        { itemId: C, available: 0, requested: 1 },
      ],
    });
  });
  it("skips untracked items", () => {
    const res = checkAvailability(
      mergeQtyLines([
        { itemId: C, qty: 100 },
        { itemId: B, qty: 1 },
      ]),
      stock,
      new Set([C]),
    );
    expect(res).toEqual({ ok: true, lines: [{ itemId: B, milli: 1000 }], skipped: [C] });
  });
  it("allows backorders when asked", () => {
    const res = checkAvailability([{ itemId: C, milli: 2000 }], stock, new Set(), { allowBackorder: true });
    expect(res).toEqual({ ok: true, lines: [{ itemId: C, milli: 2000 }], skipped: [] });
  });
  it("409 insufficient_stock carries the items", () => {
    const err = insufficientStock([{ itemId: A, available: 1, requested: 2 }]);
    expect(err).toMatchObject({ status: 409, code: "insufficient_stock", details: { items: [{ itemId: A, available: 1, requested: 2 }] } });
  });
});

describe("public availability flags", () => {
  it("booleans only; low = available ≤ reorder level", () => {
    expect(publicStockFlags({ availableMilli: 5000, reorderMilli: 2000, track: true })).toEqual({ inStock: true, lowStock: false });
    expect(publicStockFlags({ availableMilli: 2000, reorderMilli: 2000, track: true })).toEqual({ inStock: true, lowStock: true });
    expect(publicStockFlags({ availableMilli: 0, reorderMilli: 2000, track: true })).toEqual({ inStock: false, lowStock: false });
    expect(publicStockFlags({ availableMilli: 1, reorderMilli: 0, track: true })).toEqual({ inStock: true, lowStock: false });
    expect(publicStockFlags({ availableMilli: -5, reorderMilli: 0, track: false })).toEqual({ inStock: true, lowStock: false });
  });
});

describe("transfers", () => {
  const active = { active: true };
  it("validates the locations", () => {
    expect(transferProblem(L1, L2, active, active)).toBeNull();
    expect(transferProblem(L1, L1, active, active)).toMatchObject({ status: 400 });
    expect(transferProblem(L1, L2, null, active)).toMatchObject({ status: 404, message: "Source location not found" });
    expect(transferProblem(L1, L2, active, null)).toMatchObject({ status: 404, message: "Destination location not found" });
    expect(transferProblem(L1, L2, active, { active: false })).toMatchObject({ status: 400 });
    // An inactive source may still be emptied.
    expect(transferProblem(L1, L2, { active: false }, active)).toBeNull();
  });
  it("validates the body", () => {
    const ok = transferInputSchema.parse({ fromLocationId: L1, toLocationId: L2, lines: [{ itemId: A, qty: "1.5" }], note: "" });
    expect(ok).toEqual({ fromLocationId: L1, toLocationId: L2, lines: [{ itemId: A, qty: 1.5 }], note: null });
    expect(() => transferInputSchema.parse({ fromLocationId: L1, toLocationId: L2, lines: [] })).toThrow(ZodError);
    expect(() => transferInputSchema.parse({ fromLocationId: L1, toLocationId: L2, lines: [{ itemId: A, qty: 0 }] })).toThrow(ZodError);
    expect(() => transferInputSchema.parse({ fromLocationId: "x", toLocationId: L2, lines: [{ itemId: A, qty: 1 }] })).toThrow(ZodError);
  });
});

describe("idempotency decisions", () => {
  it("reserve: create when nothing (or only released rows) exist, else no-op", () => {
    expect(reserveDecision([])).toBe("create");
    expect(reserveDecision([{ status: "released" }, { status: "released" }])).toBe("create");
    expect(reserveDecision([{ status: "active" }])).toBe("noop");
    expect(reserveDecision([{ status: "released" }, { status: "committed" }])).toBe("noop");
  });
  it("release/commit only act on active rows", () => {
    const rows = [
      { id: 1, status: "active" },
      { id: 2, status: "released" },
      { id: 3, status: "committed" },
    ];
    expect(activeReservations(rows).map((r) => r.id)).toEqual([1]);
    expect(activeReservations(rows.slice(1))).toEqual([]);
  });
  it("reversals net per location and item, legacy null locations count as the default", () => {
    expect(
      netByLocationItem(
        [
          { locationId: L2, itemId: A, delta: "-2" },
          { locationId: null, itemId: A, delta: "-1" },
          { locationId: L1, itemId: A, delta: "-0.5" },
          { locationId: L1, itemId: B, delta: "-1" },
          { locationId: L1, itemId: B, delta: "1" },
        ],
        L1,
      ),
    ).toEqual([
      { locationId: L1, itemId: A, milli: -1500 },
      { locationId: L2, itemId: A, milli: -2000 },
    ]);
  });
});

describe("locations", () => {
  it("guards the default location", () => {
    const def = { isDefault: true, active: true };
    const other = { isDefault: false, active: true };
    expect(locationPatchProblem(def, { active: false })).toMatch(/can't be deactivated/);
    expect(locationPatchProblem(def, { isDefault: false })).toMatch(/another location/);
    expect(locationPatchProblem(def, { name: "x" } as never)).toBeNull();
    expect(locationPatchProblem(other, { active: false })).toBeNull();
    expect(locationPatchProblem(other, { isDefault: true })).toBeNull();
    expect(locationPatchProblem({ isDefault: false, active: false }, { isDefault: true })).toMatch(/inactive/);
    expect(locationPatchProblem({ isDefault: false, active: false }, { isDefault: true, active: true })).toBeNull();
    expect(locationPatchProblem(other, { isDefault: true, active: false })).toMatch(/inactive/);
  });
  it("refuses to delete the default, stocked, reserved or used locations", () => {
    const empty = { isDefault: false, stockRows: 0, activeReservations: 0, movements: 0 };
    expect(locationDeleteProblem(empty)).toBeNull();
    expect(locationDeleteProblem({ ...empty, isDefault: true })).toMatchObject({ status: 400 });
    expect(locationDeleteProblem({ ...empty, stockRows: 1 })).toMatchObject({
      status: 409,
      message: expect.stringMatching(/still has stock/),
    });
    expect(locationDeleteProblem({ ...empty, activeReservations: 2 })).toMatchObject({ status: 409 });
    expect(locationDeleteProblem({ ...empty, movements: 3 })).toMatchObject({ status: 409, message: expect.stringMatching(/deactivate/) });
  });
  it("derives and validates codes", () => {
    expect(locationCodeFrom("Back room #2")).toBe("BACKROOM2");
    expect(locationCodeFrom("गोदाम")).toBe("LOC");
    expect(locationInputSchema.parse({ name: " Warehouse ", code: "wh-1", address: "" })).toEqual({
      name: "Warehouse",
      code: "WH-1",
      type: "store",
      address: null,
    });
    expect(() => locationInputSchema.parse({ name: "W", code: "has space" })).toThrow(ZodError);
    expect(() => locationInputSchema.parse({ name: "W", type: "van" })).toThrow(ZodError);
    expect(locationListQuerySchema.parse({ includeInactive: "false" })).toEqual({ includeInactive: false });
  });
});

describe("query and input schemas", () => {
  it("existing inputs accept an optional locationId", () => {
    expect(stockQuerySchema.parse({ locationId: L1 })).toMatchObject({ filter: "all", locationId: L1 });
    expect(stockQuerySchema.parse({ locationId: "" }).locationId).toBeUndefined();
    expect(adjustInputSchema.parse({ mode: "add", qty: 1, locationId: L2 })).toMatchObject({ locationId: L2 });
    expect(() => stockQuerySchema.parse({ locationId: "nope" })).toThrow(ZodError);
  });
  it("availability takes comma-separated or repeated item ids", () => {
    expect(availabilityQuerySchema.parse({ itemIds: `${A},${B}, ${A}` }).itemIds).toEqual([A, B]);
    expect(availabilityQuerySchema.parse({ itemIds: [A, `${B},${C}`] }).itemIds).toEqual([A, B, C]);
    expect(() => availabilityQuerySchema.parse({})).toThrow(ZodError);
    expect(() => availabilityQuerySchema.parse({ itemIds: "x" })).toThrow(ZodError);
  });
  it("reservations need a ref type, ref id and positive lines", () => {
    expect(reserveInputSchema.parse({ refType: "order", refId: "o-1", lines: [{ itemId: A, qty: 2 }] })).toMatchObject({
      refType: "order",
    });
    expect(() => reserveInputSchema.parse({ refType: "Order!", refId: "o-1", lines: [] })).toThrow(ZodError);
    expect(() => reserveInputSchema.parse({ refType: "order", refId: "", lines: [] })).toThrow(ZodError);
    expect(() => reserveInputSchema.parse({ refType: "order", refId: "o", lines: [{ itemId: A, qty: -1 }] })).toThrow(ZodError);
  });
});

describe("upsertStockStatement with reservations", () => {
  it("moves qty and reserved together, never below 0 reserved", () => {
    const { sql, params } = upsertStockStatement(db, {
      tenantId: "t1",
      locationId: L1,
      itemId: A,
      deltaMilli: -2000,
      reservedDeltaMilli: -2000,
    }).toSQL();
    expect(sql).toMatch(/"reserved" = greatest\("stock_items"\."reserved" \+ \$\d+::numeric, 0\)/);
    expect(params).toContain(L1);
    expect(params).toContain("-2.000");
  });
  it("leaves reserved alone for plain changes", () => {
    const { sql } = upsertStockStatement(db, { tenantId: "t1", locationId: L1, itemId: A, deltaMilli: 1000 }).toSQL();
    expect(sql).not.toContain("greatest");
  });
});

describe("service guards without a database", () => {
  it("applySale with no positive lines touches nothing (not even locations)", async () => {
    const select = vi.fn();
    const transaction = vi.fn();
    const { InventoryService } = await import("./service");
    const service = new InventoryService({
      db: { select, transaction } as never,
      catalog: { getItems: vi.fn(), listItems: vi.fn() },
      sellerState: { stateCode: vi.fn() },
    });
    expect(await service.applySale("t1", { refId: "inv-1", lines: [], locationId: L1 })).toEqual({ applied: false, items: 0 });
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("features and permissions", () => {
  it("declares inventory.locations", () => {
    expect(INVENTORY_FEATURES.find((f) => f.key === "inventory.locations")).toEqual({
      key: "inventory.locations",
      module: "inventory",
      label: "Multiple stock locations",
      description: expect.any(String),
      dependsOn: ["inventory"],
      shopToggle: false,
    });
  });
  it("exports permissions with labels", () => {
    expect(INVENTORY_PERMISSIONS.map((p) => p.key)).toEqual(["inventory.adjust", "inventory.transfer", "inventory.purchases", "inventory.purchases.pay"]);
    for (const p of INVENTORY_PERMISSIONS) expect(p.label.length).toBeGreaterThan(0);
    expect(new Set(Object.values(INVENTORY_ROUTE_PERMISSIONS))).toEqual(new Set(INVENTORY_PERMISSIONS.map((p) => p.key)));
  });
});

describe("routes", () => {
  const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "EC" };
  const staffUser = { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };
  const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });

  async function build(reqCtx: RequestContext) {
    const routes: { method: string; url: string; feature: unknown }[] = [];
    const service = {
      publicAvailability: vi.fn(async () => ({ items: [{ itemId: A, inStock: true, lowStock: false }], total: 1 })),
      availability: vi.fn(async () => ({ items: [{ itemId: A, available: 2, tracked: true }], total: 1 })),
      listLocations: vi.fn(async () => ({ items: [], total: 0 })),
      createTransfer: vi.fn(async () => ({ id: "t" })),
      listStock: vi.fn(async () => ({ items: [], total: 0, totals: { stockValue: 0, lowCount: 0, outCount: 0 } })),
      summary: vi.fn(async () => ({ stockValue: 0, lowCount: 0, outCount: 0, lowItems: [] })),
      deleteLocation: vi.fn(async () => undefined),
    } as unknown as InventoryService;
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = reqCtx;
    });
    app.addHook("onRoute", (r) => {
      const methods = Array.isArray(r.method) ? r.method : [r.method];
      for (const m of methods)
        if (m !== "HEAD") routes.push({ method: m, url: r.url, feature: (r.config as { feature?: unknown } | undefined)?.feature });
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: true });
    });
    await app.register(inventoryRoutes(service), { prefix: "/v1/inventory" });
    await app.ready();
    return { app, service, routes };
  }

  it("every route declares its feature", async () => {
    const { routes } = await build(ctx({}));
    const feature = (method: string, url: string) => routes.find((r) => r.method === method && r.url === `/v1/inventory${url}`)?.feature;
    for (const r of routes) expect(r.feature, `${r.method} ${r.url}`).toBeTruthy();
    for (const [m, u] of [
      ["GET", "/locations"],
      ["POST", "/locations"],
      ["GET", "/locations/:id"],
      ["PATCH", "/locations/:id"],
      ["DELETE", "/locations/:id"],
      ["GET", "/transfers"],
      ["POST", "/transfers"],
    ] as const) {
      expect(feature(m, u), `${m} ${u}`).toBe("inventory.locations");
    }
    expect(feature("GET", "/availability")).toBe("inventory");
    expect(feature("GET", "/public/availability")).toBe("inventory");
    expect(feature("GET", "/stock")).toBe("inventory");
    expect(feature("POST", "/purchases")).toBe("inventory.purchases");
  });

  it("public availability needs a tenant but no user", async () => {
    expect((await (await build(ctx({}))).app.inject({ url: `/v1/inventory/public/availability?itemIds=${A}` })).statusCode).toBe(403);
    const { app, service } = await build(ctx({ tenant }));
    const res = await app.inject({ url: `/v1/inventory/public/availability?itemIds=${A}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [{ itemId: A, inStock: true, lowStock: false }], total: 1 });
    expect(service.publicAvailability).toHaveBeenCalledWith(tenant.id, { itemIds: A });
    // Staff availability still needs a signed-in member.
    expect((await app.inject({ url: `/v1/inventory/availability?itemIds=${A}` })).statusCode).toBe(401);
  });

  it("passes locationId through existing and new staff routes", async () => {
    const { app, service } = await build(ctx({ tenant, user: staffUser }));
    expect((await app.inject({ url: `/v1/inventory/stock?locationId=${L1}` })).statusCode).toBe(200);
    expect(service.listStock).toHaveBeenCalledWith(tenant.id, { locationId: L1 });
    await app.inject({ url: `/v1/inventory/summary?locationId=${L2}` });
    expect(service.summary).toHaveBeenCalledWith(tenant.id, { locationId: L2 });
    const payload = { fromLocationId: L1, toLocationId: L2, lines: [{ itemId: A, qty: 1 }] };
    expect((await app.inject({ method: "POST", url: "/v1/inventory/transfers", payload })).statusCode).toBe(200);
    expect(service.createTransfer).toHaveBeenCalledWith(tenant.id, payload, "u1");
    expect((await app.inject({ method: "DELETE", url: `/v1/inventory/locations/${L2}` })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: "DELETE", url: "/v1/inventory/locations/nope" })).statusCode).toBe(400);
  });
});
