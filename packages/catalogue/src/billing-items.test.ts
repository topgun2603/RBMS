import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { catalogProducts, catalogVariants } from "./schema";
import { CatalogueService, variantStockSql, type BillingItemListQuery, type StockSqlPort } from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const CAT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const svc = new CatalogueService({ db });
const port: StockSqlPort = {
  variantLevels: (tenantId, variantId) => sql`select sum(qty) as qty, sum(reorder_level) as reorder, bool_and(track) as track from stock_items where tenant_id = ${tenantId} and item_id = ${variantId}`,
};
const stock = variantStockSql(port, T);

const render = (q: Partial<BillingItemListQuery>, withStock = true, without?: "category" | "gstRate" | "stock") =>
  db
    .select({ id: catalogVariants.id })
    .from(catalogVariants)
    .innerJoin(catalogProducts, sql`true`)
    .where(svc.billingItemConditions(T, { limit: 25, offset: 0, ...q }, withStock ? stock : null, without))
    .orderBy(...svc.billingItemSort(withStock ? stock : null).orderBy(q.sort))
    .toSQL();

describe("billing item list (catalogue facade)", () => {
  it("lists billing-channel items, hides archived ones unless asking for inactive", () => {
    const all = render({});
    expect(all.sql).toContain('"catalog_products"."status" <> $');
    expect(all.params).toEqual(expect.arrayContaining([T, "archived", "billing"]));
    expect(render({ active: true }).params).toContain("active");
    expect(render({ active: false }).params).not.toContain("archived");
  });

  it("filters by category, GST rate and stock status and searches name, HSN, SKU and barcode", () => {
    const q = render({ q: "silk", category: [CAT], gstRate: [5, 12], stock: ["low", "out"] });
    expect(q.sql).toContain('"catalog_products"."category_id" in ($');
    expect(q.sql).toContain('"catalog_products"."gst_rate" in ($');
    expect(q.sql).toContain('"catalog_variants"."barcode" ilike');
    expect(q.sql).toContain("then 'low' else 'in' end");
    expect(q.params).toEqual(expect.arrayContaining([CAT, 5, 12, "low", "out", "%silk%"]));
  });

  it("leaves a filter out for its own facet counts", () => {
    expect(render({ category: [CAT], stock: ["low"] }, true, "category").params).not.toContain(CAT);
    expect(render({ category: [CAT], stock: ["low"] }, true, "stock").params).not.toContain("low");
  });

  it("ignores the stock filter when the shop has no stock", () => {
    expect(render({ stock: ["out"] }, false).params).not.toContain("out");
  });

  it("sorts by name (default), GST-exclusive price, stock and GST rate", () => {
    expect(render({}).sql).toContain('order by (lower("catalog_products"."name"), "catalog_variants"."position") asc nulls last, "catalog_variants"."id" asc');
    expect(render({ sort: "-price" }).sql).toContain('when "catalog_products"."tax_inclusive" then round(');
    expect(render({ sort: "stock" }).sql).toMatch(/order by \(select coalesce\(sl\.qty, 0\) from \(select sum\(qty\)/);
    expect(render({ sort: "-gstRate" }).sql).toContain('order by "catalog_products"."gst_rate" desc nulls last');
    expect(() => render({ sort: "sku" })).toThrow(AppError);
  });

  it("untracked anywhere = untracked; no rows = out", () => {
    const s = db.select({ s: stock.status }).from(catalogVariants).toSQL().sql;
    expect(s).toContain("when sl.track = false then 'untracked' when coalesce(sl.qty, 0) <= 0 then 'out'");
  });
});
