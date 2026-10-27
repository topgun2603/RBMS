import { describe, expect, it } from "vitest";
import { addProduct, cartTotals, setQty, toLineInput, type CartProduct } from "./cart";
import { fromPosItem } from "./catalog-sync";
import { buildCatalogIndex } from "./catalog-sync";
import { resolveScan } from "./scan";
import { inUnit, listsFor, repriceLines, setLineUnit, type PricingCache } from "./units";
import type { PosItem } from "./terminal-types";

const soapItem: PosItem = {
  itemId: "soap",
  productId: "p1",
  name: "Soap",
  variantTitle: "",
  sku: "SOAP",
  barcodes: ["8901"],
  categoryId: null,
  price: 5000,
  mrp: null,
  taxInclusive: false,
  gstRate: 18,
  hsn: "3401",
  unit: "pcs",
  soldBy: "unit",
  plu: null,
  image: null,
  stock: null,
  active: true,
  updatedAt: "2026-10-27T00:00:00.000Z",
  units: [{ unit: "box", factor: 12, barcode: "BOX8901", price: 57000, ownPrice: 57000, mrp: null }],
};
const soap: CartProduct = fromPosItem(soapItem);

const cache: PricingCache = {
  lists: [
    { id: "wh", name: "Wholesale", adjustPct: null, validFrom: null, validTo: null, active: true, entries: [{ itemId: "soap", unit: null, minQty: 0, price: 4600 }] },
    { id: "bulk", name: "Bulk", adjustPct: null, validFrom: null, validTo: null, active: true, entries: [{ itemId: "soap", unit: null, minQty: 10, price: 4800 }] },
  ],
  defaultListId: "bulk",
  groups: [{ id: "g", name: "Dealers", priceListId: "wh" }],
  customers: [{ customerId: "c1", groupId: "g", priceListId: null }],
  at: 0,
};
const D = "2026-10-27";

describe("alternate units at the counter", () => {
  it("sells a box at the box price and sends the factor for stock", () => {
    const box = inUnit(soap, "box");
    expect(box).toMatchObject({ unit: "box", price: 57000, baseUnit: "pcs", basePrice: 5000 });
    const { lines } = addProduct([], box, 2);
    const input = toLineInput(lines[0]!);
    expect(input).toMatchObject({ unit: "box", qty: 2, rate: 57000, unitFactor: 12, baseUnit: "pcs" });
    expect(cartTotals(lines, { sellerState: "33", placeOfSupply: "33" }).taxable).toBe(114000);
  });

  it("keeps pieces and boxes of one item on separate lines", () => {
    let r = addProduct([], soap, 1);
    r = addProduct(r.lines, inUnit(soap, "box"), 1);
    expect(r.lines.map((l) => l.unit)).toEqual(["pcs", "box"]);
    expect(toLineInput(r.lines[0]!).unitFactor).toBeUndefined();
  });

  it("changes a line's unit: list price follows, a hand-set price is scaled", () => {
    const { lines, key } = addProduct([], soap, 3);
    expect(setLineUnit(lines, key, "box")[0]).toMatchObject({ unit: "box", price: 57000, listPrice: 57000, qty: 3 });
    const manual = lines.map((l) => ({ ...l, price: 4500 }));
    expect(setLineUnit(manual, key, "box")[0]).toMatchObject({ unit: "box", price: 54000, listPrice: 57000 });
    expect(setLineUnit(setLineUnit(lines, key, "box"), key, "pcs")[0]).toMatchObject({ unit: "pcs", price: 5000 });
  });

  it("finds a box by its barcode in the offline cache", async () => {
    const index = buildCatalogIndex([soapItem]);
    const hit = await resolveScan("BOX8901", { cache: index, tickets: false, getTicket: async () => { throw new Error("no"); }, server: async () => null });
    expect(hit).toMatchObject({ kind: "item", soldBy: "unit", product: { unit: "box", price: 57000 } });
  });
});

describe("price lists at the counter (offline)", () => {
  it("picks the group's list for the customer, then the default list", () => {
    expect(listsFor(cache, { customerId: "c1" }).map((l) => l.id)).toEqual(["wh", "bulk"]);
    expect(listsFor(cache, { customerId: null }).map((l) => l.id)).toEqual(["bulk"]);
    expect(listsFor(cache, { customerId: "c1", chosen: "none" })).toEqual([]);
    expect(listsFor(null, { customerId: "c1" })).toEqual([]);
  });

  it("reprices automatic lines, keeps hand-set prices, and follows slabs as qty changes", () => {
    const { lines, key } = addProduct([], soap, 2);
    const walkIn = listsFor(cache, { customerId: null });
    expect(repriceLines(lines, walkIn, D)).toBe(lines); // 2 pcs: no slab, unchanged array
    const ten = repriceLines(setQty(lines, key, 10), walkIn, D);
    expect(ten[0]).toMatchObject({ price: 4800, listPrice: 4800 });
    expect(repriceLines(setQty(ten, key, 2), walkIn, D)[0]).toMatchObject({ price: 5000 });
    const dealer = repriceLines(lines, listsFor(cache, { customerId: "c1" }), D);
    expect(dealer[0]!.price).toBe(4600);
    // A box for the dealer: 12 × the per-piece wholesale price.
    const box = repriceLines(setLineUnit(lines, key, "box"), listsFor(cache, { customerId: "c1" }), D);
    expect(box[0]).toMatchObject({ unit: "box", price: 55200 });
    const manual = lines.map((l) => ({ ...l, price: 4900 }));
    expect(repriceLines(manual, listsFor(cache, { customerId: "c1" }), D)[0]!.price).toBe(4900);
  });
});
