import { describe, expect, it, vi } from "vitest";
import type { CatalogItem, CatalogueService } from "@srirealtime/catalogue";
import type { PriceListsService } from "@srirealtime/pricelists";
import { lineUnitsAndPrices, PRICED_LINE_ROUTES, UNIT_LINE_ROUTES, withLinePricing } from "./kit-pricing";

const ID = "11111111-1111-4111-8111-111111111111";
const soap: CatalogItem = {
  id: ID,
  productId: "p",
  name: "Soap",
  sku: "SOAP",
  barcode: null,
  hsn: "3401",
  unit: "pcs",
  rate: 5000,
  price: 5000,
  taxInclusive: false,
  gstRate: 18,
  image: null,
  createdAt: new Date(),
  units: [{ unit: "box", factor: 12, barcode: null, ownPrice: 57000, price: 57000, rate: 57000, mrp: null }],
};
const catalogue = { getItems: vi.fn(async () => [soap]) } as unknown as CatalogueService;

const make = (enabled: boolean, resolve = vi.fn()) =>
  lineUnitsAndPrices({ catalogue: () => catalogue, priceLists: { resolve } as unknown as PriceListsService, isEnabled: async () => enabled });

describe("lineUnitsAndPrices (docs/price-lists-units.md)", () => {
  it("sets the server's unit factor and drops a client's own", async () => {
    const prep = make(false);
    const out = (await prep("t", [
      { itemId: ID, description: "Soap", qty: 2, unit: "BOX", rate: 57000, gstRate: 18, unitFactor: 100 },
      { itemId: ID, description: "Soap", qty: 2, unit: "pcs", rate: 5000, gstRate: 18, unitFactor: 100, baseUnit: "x" },
      { description: "Free text", qty: 1, rate: 100, gstRate: 0, unitFactor: 5 },
    ])) as Record<string, unknown>[];
    expect(out[0]).toMatchObject({ unit: "box", unitFactor: 12, baseUnit: "pcs", rate: 57000 });
    expect(out[1]!.unitFactor).toBeUndefined();
    expect(out[1]!.baseUnit).toBeUndefined();
    expect(out[2]!.unitFactor).toBeUndefined();
  });

  it("prices lines without a rate at the item / unit price when the shop has no price lists", async () => {
    const out = (await make(false)("t", [{ itemId: ID, qty: 3, unit: "box" }])) as Record<string, unknown>[];
    expect(out[0]).toMatchObject({ rate: 57000, description: "Soap", hsn: "3401", gstRate: 18, unit: "box", unitFactor: 12 });
  });

  it("asks the price lists with the customer and list, and keeps explicit rates", async () => {
    const resolve = vi.fn(async () => ({ list: null, defaultList: null, lines: [{ itemId: ID, unit: "pcs", unitFactor: 1, price: 4400, rate: 4400, gstRate: 18, basePrice: 5000, source: "slab", listId: "l", listName: "W", minQty: 10, qty: 10 }] }));
    const out = (await make(true, resolve)("t", [{ itemId: ID, qty: 10 }, { itemId: ID, qty: 1, rate: 4999, description: "Soap", gstRate: 18 }], { customerId: ID, date: "2026-10-27" })) as Record<string, unknown>[];
    expect(resolve).toHaveBeenCalledWith("t", { customerId: ID, priceListId: null, date: "2026-10-27", lines: [{ itemId: ID, unit: null, qty: 10 }] });
    expect(out[0]).toMatchObject({ rate: 4400, unit: "pcs" });
    expect(out[1]).toMatchObject({ rate: 4999 });
  });

  it("only checks units on purchases", async () => {
    const out = (await make(true)("t", [{ itemId: ID, qty: 1, unit: "box" }], { unitsOnly: true })) as Record<string, unknown>[];
    expect(out[0]).toMatchObject({ unitFactor: 12 });
    expect(out[0]!.rate).toBeUndefined();
  });

  it("puts the line guard first on every document route", async () => {
    const order: string[] = [];
    const rules = withLinePricing({ "POST /v1/invoices/": async () => void order.push("discount") }, () => async () => {
      order.push("pricing");
      return [];
    });
    for (const k of [...PRICED_LINE_ROUTES, ...UNIT_LINE_ROUTES]) expect(rules[k]).toBeTypeOf("function");
    await rules["POST /v1/invoices/"]!({ ctx: { tenant: { id: "t" } }, body: { lines: [] } } as never);
    expect(order).toEqual(["pricing", "discount"]);
  });
});
