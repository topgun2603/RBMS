import { emptyContext, notFound, type RequestContext } from "@rbms/core";
import { createDb } from "@rbms/db";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { CSV_BOM } from "./csv";
import { createInventory } from "./index";
import { inventoryRoutes } from "./routes";
import {
  adjustInputSchema,
  buildStockRow,
  InventoryService,
  mergeTaxBreakup,
  purchaseInputSchema,
  purchaseLineSchema,
  purchaseReportQuerySchema,
  saleInputSchema,
  stockPatchSchema,
  stockQuerySchema,
  stockTotals,
  supplierInputSchema,
  upsertStockStatement,
  type InventoryService as Service,
} from "./service";

// Never connects: only used to render SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const ITEM = "aaaaaaaa-0000-4000-8000-000000000001";
const item = { id: ITEM, name: "Cotton saree", hsn: "5208", unit: "pcs", rate: 50000, gstRate: 5 };

describe("validation", () => {
  it("purchase lines keep itemId and strip empties", () => {
    const l = purchaseLineSchema.parse({ itemId: ITEM, description: " Saree ", qty: 2.5, rate: 12000, gstRate: 5, hsn: "", unit: "m" });
    expect(l).toEqual({ itemId: ITEM, description: "Saree", qty: 2.5, rate: 12000, gstRate: 5, unit: "m" });
    expect(purchaseLineSchema.parse({ itemId: "", description: "x", qty: 1, rate: 1, gstRate: 0 })).not.toHaveProperty("itemId");
  });
  it("rejects bad purchase lines", () => {
    const ok = { description: "x", qty: 1, rate: 100, gstRate: 5 };
    expect(() => purchaseLineSchema.parse({ ...ok, qty: 1.0005 })).toThrow(ZodError);
    expect(() => purchaseLineSchema.parse({ ...ok, qty: 0 })).toThrow(ZodError);
    expect(() => purchaseLineSchema.parse({ ...ok, gstRate: 7 })).toThrow(ZodError);
    expect(() => purchaseLineSchema.parse({ ...ok, rate: 10.5 })).toThrow(ZodError);
    expect(() => purchaseLineSchema.parse({ ...ok, discount: 101 })).toThrow(ZodError);
    expect(() => purchaseLineSchema.parse({ ...ok, itemId: "nope" })).toThrow(ZodError);
  });
  it("validates purchases: bill number, date, lines, supplier GSTIN", () => {
    const line = { description: "x", qty: 1, rate: 100, gstRate: 0 };
    const p = purchaseInputSchema.parse({ billNumber: " B-1 ", date: "2026-10-14", lines: [line], supplier: { name: "Ravi", gstin: "33aaacr5055k1ze" } });
    expect(p).toMatchObject({ billNumber: "B-1", paid: false, supplier: { gstin: "33AAACR5055K1ZE" } });
    expect(() => purchaseInputSchema.parse({ billNumber: "B", date: "2026-10-14", lines: [line], supplier: { name: "R", gstin: "33AAACR5055K1Z8" } })).toThrow(ZodError);
    expect(() => purchaseInputSchema.parse({ billNumber: "", date: "2026-10-14", lines: [line] })).toThrow(ZodError);
    expect(() => purchaseInputSchema.parse({ billNumber: "B", date: "2026-02-30", lines: [line] })).toThrow(ZodError);
    expect(() => purchaseInputSchema.parse({ billNumber: "B", date: "2026-10-14", lines: [] })).toThrow(ZodError);
  });
  it("validates suppliers", () => {
    expect(supplierInputSchema.parse({ name: "Kumar Traders", stateCode: 7, email: "" })).toMatchObject({ stateCode: "07", email: null });
    expect(() => supplierInputSchema.parse({ name: "K", stateCode: "99" })).toThrow(ZodError);
    expect(() => supplierInputSchema.parse({ name: " " })).toThrow(ZodError);
  });
  it("validates adjustments", () => {
    expect(adjustInputSchema.parse({ mode: "add", qty: 2.5, unitCost: 1000, note: "" })).toEqual({ mode: "add", qty: 2.5, unitCost: 1000, note: null });
    expect(adjustInputSchema.parse({ mode: "set", qty: 0 }).qty).toBe(0);
    expect(() => adjustInputSchema.parse({ mode: "add", qty: 0 })).toThrow(ZodError);
    expect(() => adjustInputSchema.parse({ mode: "remove", qty: -1 })).toThrow(ZodError);
    expect(() => adjustInputSchema.parse({ mode: "set", qty: -1 })).toThrow(ZodError);
    expect(() => adjustInputSchema.parse({ mode: "zap", qty: 1 })).toThrow(ZodError);
    expect(() => adjustInputSchema.parse({ mode: "add", qty: 1.2345 })).toThrow(ZodError);
  });
  it("validates stock queries and patches", () => {
    expect(stockQuerySchema.parse({}).filter).toBe("all");
    expect(() => stockQuerySchema.parse({ filter: "gone" })).toThrow(ZodError);
    expect(stockPatchSchema.parse({ reorderLevel: "5" })).toEqual({ reorderLevel: 5 });
    expect(() => stockPatchSchema.parse({ reorderLevel: -1 })).toThrow(ZodError);
  });
  it("validates sales and report ranges", () => {
    expect(() => saleInputSchema.parse({ refId: "x", lines: [{ itemId: ITEM, qty: 0 }] })).toThrow(ZodError);
    expect(() => saleInputSchema.parse({ refId: "", lines: [] })).toThrow(ZodError);
    expect(() => purchaseReportQuerySchema.parse({ from: "2026-10-31", to: "2026-10-01" })).toThrow(ZodError);
    expect(() => purchaseReportQuerySchema.parse({ from: "2026-10-01" })).toThrow(ZodError);
    expect(purchaseReportQuerySchema.parse({ from: "2026-10-01", to: "2026-10-31" }).format).toBe("json");
  });
});

describe("upsertStockStatement", () => {
  it("adds the delta atomically and returns the new qty", () => {
    const { sql, params } = upsertStockStatement(db, { tenantId: "t1", itemId: ITEM, deltaMilli: -2500 }).toSQL();
    expect(sql).toContain('insert into "stock_items"');
    // Multi-location: one row per (tenant, location, item).
    expect(sql).toContain('on conflict ("tenant_id","location_id","item_id") do update set');
    expect(sql).toMatch(/"qty" = "stock_items"\."qty" \+ \$\d+::numeric/);
    expect(sql).toContain('returning "id", "qty", "avg_cost", "track"');
    expect(params).toContain("-2.500");
    expect(params).toContain("t1");
  });
});

describe("stock rows", () => {
  it("items without a stock row show qty 0, tracked, out", () => {
    expect(buildStockRow(item, null)).toEqual({
      itemId: ITEM,
      name: "Cotton saree",
      unit: "pcs",
      hsn: "5208",
      qty: 0,
      reorderLevel: 0,
      track: true,
      avgCost: null,
      value: 0,
      status: "out",
      updatedAt: null,
    });
  });
  it("computes value and status from numeric strings", () => {
    const updatedAt = new Date();
    const row = buildStockRow(item, { qty: "4.500", reorderLevel: "5.000", track: true, avgCost: 10000, updatedAt });
    expect(row).toMatchObject({ qty: 4.5, reorderLevel: 5, value: 45000, status: "low", updatedAt });
    expect(buildStockRow(item, { qty: "-2.000", reorderLevel: "0", track: true, avgCost: 100, updatedAt }).status).toBe("out");
    const untracked = buildStockRow(item, { qty: "0.000", reorderLevel: "0", track: false, avgCost: 100, updatedAt });
    expect(untracked).toMatchObject({ status: "ok", value: 0, track: false });
  });
  it("totals cover tracked rows only", () => {
    const now = new Date();
    const rows = [
      buildStockRow(item, { qty: "10", reorderLevel: "0", track: true, avgCost: 100, updatedAt: now }),
      buildStockRow(item, { qty: "1", reorderLevel: "2", track: true, avgCost: 100, updatedAt: now }),
      buildStockRow(item, null),
      buildStockRow(item, { qty: "-1", reorderLevel: "0", track: false, avgCost: 100, updatedAt: now }),
    ];
    expect(stockTotals(rows)).toEqual({ stockValue: 1100, lowCount: 1, outCount: 1 });
  });
  it("merges tax breakups by rate", () => {
    expect(
      mergeTaxBreakup([
        [{ gstRate: 5, taxable: 100, cgst: 3, sgst: 3, igst: 0 }],
        [
          { gstRate: 18, taxable: 200, cgst: 0, sgst: 0, igst: 36 },
          { gstRate: 5, taxable: 50, cgst: 1, sgst: 1, igst: 0 },
        ],
      ]),
    ).toEqual([
      { gstRate: 5, taxable: 150, cgst: 4, sgst: 4, igst: 0 },
      { gstRate: 18, taxable: 200, cgst: 0, sgst: 0, igst: 36 },
    ]);
  });
});

describe("applySale", () => {
  it("does not open a transaction when no line has a positive qty", async () => {
    const transaction = vi.fn();
    const service = new InventoryService({
      db: { transaction } as never,
      catalog: { getItems: vi.fn(), listItems: vi.fn() },
      sellerState: { stateCode: vi.fn() },
    });
    expect(await service.applySale("t1", { refId: "inv-1", lines: [] })).toEqual({ applied: false, items: 0 });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("backfillLocations", () => {
  it("reports the rows it moved (the first heal of a tenant is the counted one)", async () => {
    const main = { id: "loc-main", tenantId: "t1", name: "Main", code: "MAIN", isDefault: true, active: true };
    const db = {
      execute: vi.fn(async () => [{ tenant_id: "t1" }]),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [main] }) }) }),
    };
    const service = new InventoryService({ db: db as never, catalog: { getItems: vi.fn(), listItems: vi.fn() }, sellerState: { stateCode: vi.fn() } });
    // Like the database: the legacy rows move once, later heals find nothing.
    const heal = vi
      .spyOn(service as unknown as { healTenant: () => Promise<unknown> }, "healTenant")
      .mockResolvedValueOnce({ stockItems: 2, movements: 14, skipped: 0 })
      .mockResolvedValue({ stockItems: 0, movements: 0, skipped: 0 });
    expect(await service.backfillLocations()).toEqual({ tenants: 1, stockItems: 2, movements: 14, skipped: 0 });
    expect(heal).toHaveBeenCalledTimes(1);
  });
});

describe("createInventory", () => {
  it("builds the module", () => {
    const { module, service } = createInventory({
      db,
      catalog: { getItems: async () => [], listItems: async () => [] },
      sellerState: { stateCode: async () => "33" },
    });
    expect(module.id).toBe("inventory");
    expect(Object.keys(module.tables ?? {})).toEqual([
      "stockItems",
      "stockMovements",
      "suppliers",
      "purchases",
      "stockLocations",
      "stockTransfers",
      "stockReservations",
      "purchasePayments",
      "purchaseOrders",
      "goodsReceipts",
      "debitNotes",
      "purchaseDocSeries",
      "stockBatches",
      "stockBatchLevels",
      "stockBatchMovements",
      "stockBatchItems",
      "stockBatchSettings",
      "stockAudits",
      "stockAuditLines",
      "stockAuditEntries",
      "stockValuationSettings",
      "stockCostLayers",
      "stockCostDraws",
      "landedCostVouchers",
    ]);
    expect(service).toBeInstanceOf(InventoryService);
  });
});

describe("routes", () => {
  const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });
  const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "BL" };
  const staffUser = { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };
  const stockRow = buildStockRow(item, { qty: "2.500", reorderLevel: "0", track: true, avgCost: 10000, updatedAt: new Date() });

  async function build(reqCtx: RequestContext) {
    const service = {
      today: vi.fn(() => "2026-10-14"),
      listStock: vi.fn(async () => ({ items: [], total: 0, totals: { stockValue: 0, lowCount: 0, outCount: 0 } })),
      adjust: vi.fn(async () => stockRow),
      getSupplier: vi.fn(async () => {
        throw notFound("Supplier");
      }),
      stockReport: vi.fn(async () => ({ items: [stockRow], total: 1, totals: { stockValue: 25000, lowCount: 0, outCount: 0 } })),
      purchaseReport: vi.fn(async () => ({
        rows: [
          {
            id: "p1",
            billNumber: "B/1",
            date: "2026-10-02",
            supplierId: null,
            supplierName: "Kumar, Sons",
            supplierGstin: null,
            taxable: 10000,
            cgst: 250,
            sgst: 250,
            igst: 0,
            total: 10500,
            paid: false,
            status: "recorded",
            createdAt: new Date(),
          },
        ],
        itc: { taxable: 10000, cgst: 250, sgst: 250, igst: 0, total: 500 },
        byRate: [],
      })),
    } as unknown as Service;
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = reqCtx;
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: true });
    });
    await app.register(inventoryRoutes(service), { prefix: "/v1/inventory" });
    return { app, service };
  }

  it("requires a signed-in staff member of the tenant", async () => {
    expect((await (await build(ctx({ tenant }))).app.inject({ url: "/v1/inventory/stock" })).statusCode).toBe(401);
    const member = { ...staffUser, tenantRoles: ["member"] };
    expect((await (await build(ctx({ tenant, user: member }))).app.inject({ url: "/v1/inventory/stock" })).statusCode).toBe(403);
    // Super-admins pass the role check but still need a tenant.
    const superAdmin = { ...staffUser, tenantRoles: [], platformRoles: ["superadmin"] };
    expect((await (await build(ctx({ user: superAdmin }))).app.inject({ url: "/v1/inventory/stock" })).statusCode).toBe(403);

    const { app, service } = await build(ctx({ tenant, user: staffUser }));
    const res = await app.inject({ url: "/v1/inventory/stock?filter=low&q=saree" });
    expect(res.statusCode).toBe(200);
    expect(service.listStock).toHaveBeenCalledWith(tenant.id, { filter: "low", q: "saree" });
  });

  it("passes tenant, item and user to adjust", async () => {
    const { app, service } = await build(ctx({ tenant, user: staffUser }));
    const res = await app.inject({ method: "POST", url: `/v1/inventory/stock/${ITEM}/adjust`, payload: { mode: "add", qty: 2.5 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ itemId: ITEM, qty: 2.5, status: "ok" });
    expect(service.adjust).toHaveBeenCalledWith(tenant.id, ITEM, { mode: "add", qty: 2.5 }, "u1");
  });

  it("rejects non-uuid ids and maps service errors", async () => {
    const { app } = await build(ctx({ tenant, user: staffUser }));
    expect((await app.inject({ method: "POST", url: "/v1/inventory/stock/nope/adjust", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ url: `/v1/inventory/suppliers/${ITEM}` })).statusCode).toBe(404);
  });

  it("serves the stock report as JSON or CSV", async () => {
    const { app } = await build(ctx({ tenant, user: staffUser }));
    const json = await app.inject({ url: "/v1/inventory/reports/stock" });
    expect(json.json()).toMatchObject({ total: 1 });
    const res = await app.inject({ url: "/v1/inventory/reports/stock?format=csv" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="stock-2026-10-14-2026-10-14.csv"');
    expect(res.body.startsWith(CSV_BOM)).toBe(true);
    expect(res.body).toContain("Item,HSN,Unit,Qty,Reorder level,Avg cost (Rs),Value (Rs),Status\r\n");
    expect(res.body).toContain("Cotton saree,5208,pcs,2.5,0,100.00,250.00,ok\r\n");
  });

  it("serves the purchase report CSV for a date range", async () => {
    const { app, service } = await build(ctx({ tenant, user: staffUser }));
    expect((await app.inject({ url: "/v1/inventory/reports/purchases" })).statusCode).toBe(400);
    const res = await app.inject({ url: "/v1/inventory/reports/purchases?from=2026-10-01&to=2026-10-31&format=csv" });
    expect(res.statusCode).toBe(200);
    expect(service.purchaseReport).toHaveBeenCalledWith(tenant.id, { from: "2026-10-01", to: "2026-10-31" });
    expect(res.headers["content-disposition"]).toBe('attachment; filename="purchases-2026-10-01-2026-10-31.csv"');
    expect(res.body).toContain('2026-10-02,B/1,"Kumar, Sons",,100.00,2.50,2.50,0.00,105.00,no\r\n');
  });
});
