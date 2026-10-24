import { AppError } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { purchases, suppliers } from "./schema";
import {
  buildStockLevelRow,
  InventoryService,
  parseStockSort,
  PURCHASE_SORT,
  purchaseListQuerySchema,
  sortStockRows,
  stockListStatus,
  stockQuerySchema,
  supplierListQuerySchema,
} from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const noCatalog = { getItems: async () => [], listItems: async () => [] };
const svc = new InventoryService({ db, catalog: noCatalog, sellerState: { stateCode: async () => "33" } });

describe("purchase list", () => {
  const where = (q: Record<string, unknown>, withStatus = true) =>
    db.select().from(purchases).where(svc.purchaseListConditions(T, purchaseListQuerySchema.parse(q), withStatus)).toSQL();

  it("keeps the 50 / 200 limits and takes comma lists", () => {
    expect(purchaseListQuerySchema.parse({}).limit).toBe(50);
    expect(() => purchaseListQuerySchema.parse({ limit: "201" })).toThrow(ZodError);
    const p = purchaseListQuerySchema.parse({ status: "unpaid,cancelled", supplierId: `${S1},${S2}` });
    expect(p.status).toEqual(["unpaid", "cancelled"]);
    expect(p.supplierId).toEqual([S1, S2]);
    expect(purchaseListQuerySchema.parse({ supplierId: S1 }).supplierId).toEqual([S1]);
    expect(() => purchaseListQuerySchema.parse({ status: "open" })).toThrow(ZodError);
    expect(() => purchaseListQuerySchema.parse({ from: "2026-10-02", to: "2026-10-01" })).toThrow(ZodError);
  });

  it("filters status (paid/unpaid/cancelled), suppliers and dates and searches number, supplier and GSTIN", () => {
    const q = where({ status: "unpaid", supplierId: S1, from: "2026-10-01", to: "2026-10-31", q: "kumar" });
    expect(q.sql).toContain("when \"purchases\".\"paid\" then 'paid' else 'unpaid' end) in ($");
    expect(q.sql).toContain('"purchases"."supplier_id" in ($');
    expect(q.sql).toContain(`"purchases"."supplier"->>'gstin' ilike`);
    expect(q.params).toEqual(expect.arrayContaining([T, "unpaid", S1, "2026-10-01", "2026-10-31", "%kumar%"]));
    expect(where({ status: "paid" }, false).params).not.toContain("paid");
  });

  it("sorts by date (default), number, supplier, total and balance", () => {
    const render = (s?: string) => db.select().from(purchases).orderBy(...PURCHASE_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "purchases"."date" desc nulls last, "purchases"."created_at" desc, "purchases"."id" desc');
    expect(render("supplier")).toContain(`order by lower("purchases"."supplier"->>'name') asc`);
    expect(render("-balance")).toContain("\"purchases\".\"amount_paid\" else 0 end) desc");
    expect(() => render("paid")).toThrow(AppError);
    expect(PURCHASE_SORT.keys).toEqual(["date", "number", "supplier", "total", "balance", "due"]);
  });
});

describe("supplier list", () => {
  it("keeps the picker limits and sorts by name, balance and last purchase", () => {
    expect(supplierListQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    expect(supplierListQuerySchema.parse({}).limit).toBe(50);
    const due = svc.payableSubquery(T);
    const render = (s?: string) => db.select({ id: suppliers.id }).from(suppliers).leftJoin(due, undefined).orderBy(...svc.supplierSort(due).orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by lower("suppliers"."name") asc nulls last, "suppliers"."id" asc');
    expect(render("-balance")).toContain('coalesce("payable", 0) + "suppliers"."opening_balance"');
    expect(render("-lastPurchase")).toContain('order by "last_purchase" desc nulls last');
    expect(render("-lastPurchase")).toContain('"amount_paid"');
    expect(() => render("phone")).toThrow(AppError);
  });
});

describe("stock list", () => {
  const item = (id: string, name: string, categoryId: string | null = null) => ({ id, name, hsn: null, unit: "pcs", rate: 100, gstRate: 5, categoryId, categoryName: categoryId ? "Sarees" : null });
  const I1 = "10000000-0000-4000-8000-000000000001";
  const I2 = "10000000-0000-4000-8000-000000000002";
  const I3 = "10000000-0000-4000-8000-000000000003";
  const row = (itemId: string, qty: string, reorderLevel = "0", track = true) => ({
    id: itemId,
    tenantId: T,
    locationId: null,
    itemId,
    qty,
    reserved: "0",
    reorderLevel,
    track,
    avgCost: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  /** A db whose every awaited select returns these stock rows. */
  function fakeDb(rows: unknown[]): Db {
    const chain: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
          return () => chain;
        },
      },
    );
    return chain as Db;
  }

  const service = new InventoryService({
    db: fakeDb([row(I1, "10"), row(I2, "2", "5"), row(I3, "0")]),
    catalog: { getItems: async () => [], listItems: async () => [item(I1, "Cotton"), item(I2, "Silk", CAT), item(I3, "Linen", CAT)] },
    sellerState: { stateCode: async () => "33" },
  });

  it("returns every item without a limit (as before) and keeps filter=low", async () => {
    expect(stockQuerySchema.parse({}).limit).toBe(1000);
    const all = await service.listStock(T);
    expect(all.items.map((r) => r.name)).toEqual(["Cotton", "Linen", "Silk"]);
    const low = await service.listStock(T, { filter: "low" });
    expect(low.items.map((r) => r.name)).toEqual(["Silk"]);
  });

  it("filters status and category, pages and counts facets under the other filters", async () => {
    const r = await service.listStock(T, { status: "low,out", category: CAT, sort: "-qty", limit: 1, offset: 0 });
    expect(r.total).toBe(2);
    expect(r.items.map((x) => x.name)).toEqual(["Silk"]);
    expect(r.facets?.status).toEqual({ low: 1, out: 1 });
    expect(r.facets?.category).toEqual({ [CAT]: 2 });
    expect(r.categories).toEqual([{ id: CAT, name: "Sarees" }]);
    const none = await service.listStock(T, { category: "none" });
    expect(none.items.map((x) => x.name)).toEqual(["Cotton"]);
    expect(none.facets?.category).toEqual({ none: 1, [CAT]: 2 });
    await expect(service.listStock(T, { sort: "price" })).rejects.toThrow(AppError);
  });

  it("sorts by name, quantity, value and reorder level", () => {
    const rows = [
      buildStockLevelRow(item(I1, "b"), [row(I1, "3")], { locationId: null }),
      buildStockLevelRow(item(I2, "a"), [row(I2, "7", "9")], { locationId: null }),
    ];
    expect(sortStockRows(rows, parseStockSort(undefined)).map((r) => r.name)).toEqual(["a", "b"]);
    expect(sortStockRows(rows, parseStockSort("qty")).map((r) => r.name)).toEqual(["b", "a"]);
    expect(sortStockRows(rows, parseStockSort("-reorderLevel")).map((r) => r.name)).toEqual(["a", "b"]);
    expect(stockListStatus({ track: false, status: "low" })).toBe("untracked");
    expect(stockListStatus({ track: true, status: "ok" })).toBe("in");
    expect(() => stockQuerySchema.parse({ status: "full" })).toThrow(ZodError);
  });
});
