import { describe, expect, it } from "vitest";
import { listApplies, pickList, resolvePrice, type PricingItem, type PricingList } from "./resolve";

const soap: PricingItem = {
  id: "soap",
  unit: "pcs",
  price: 5000, // ₹50 a piece, GST-exclusive
  taxInclusive: false,
  gstRate: 18,
  units: [
    { unit: "box", factor: 12 }, // no own price: 12 × ₹50
    { unit: "Carton", factor: 144, ownPrice: 640000 }, // ₹6,400 a carton
  ],
};

const list = (over: Partial<PricingList> = {}): PricingList => ({
  id: "wh",
  name: "Wholesale",
  adjustPct: null,
  validFrom: null,
  validTo: null,
  active: true,
  entries: [],
  ...over,
});

const D = "2026-10-27";

describe("resolvePrice", () => {
  it("is the item price without lists (existing shops unchanged)", () => {
    const r = resolvePrice({ item: soap, qty: 3, date: D, lists: [] });
    expect(r).toMatchObject({ price: 5000, rate: 5000, unit: "pcs", unitFactor: 1, source: "item", listId: null, basePrice: 5000 });
  });

  it("prices an alternate unit at factor × price, or its own price", () => {
    expect(resolvePrice({ item: soap, unit: "box", date: D, lists: [] })).toMatchObject({ price: 60000, unit: "box", unitFactor: 12, source: "item" });
    // Unit names match in any case; the unit's own price wins over the factor.
    expect(resolvePrice({ item: soap, unit: "carton", date: D, lists: [] })).toMatchObject({ price: 640000, unit: "Carton", unitFactor: 144, source: "unit" });
  });

  it("treats an unknown unit as the base unit", () => {
    expect(resolvePrice({ item: soap, unit: "crate", date: D, lists: [] })).toMatchObject({ unit: "pcs", unitFactor: 1, price: 5000 });
  });

  it("uses the list entry, and the highest slab at or under the quantity", () => {
    const wh = list({
      entries: [
        { itemId: "soap", unit: null, minQty: 0, price: 4600 },
        { itemId: "soap", unit: null, minQty: 10, price: 4400 },
        { itemId: "soap", unit: null, minQty: 50, price: 4200 },
      ],
    });
    expect(resolvePrice({ item: soap, qty: 5, date: D, lists: [wh] })).toMatchObject({ price: 4600, source: "list", listName: "Wholesale", minQty: null });
    expect(resolvePrice({ item: soap, qty: 10, date: D, lists: [wh] })).toMatchObject({ price: 4400, source: "slab", minQty: 10 });
    expect(resolvePrice({ item: soap, qty: 49.5, date: D, lists: [wh] })).toMatchObject({ price: 4400 });
    expect(resolvePrice({ item: soap, qty: 120, date: D, lists: [wh] })).toMatchObject({ price: 4200, minQty: 50 });
  });

  it("prefers an entry in the chosen unit, else scales the base entry (slab on the base quantity)", () => {
    const wh = list({
      entries: [
        { itemId: "soap", unit: null, minQty: 0, price: 4600 },
        { itemId: "soap", unit: null, minQty: 24, price: 4400 },
        { itemId: "soap", unit: "BOX", minQty: 5, price: 50000 },
      ],
    });
    // 5+ boxes: the box slab.
    expect(resolvePrice({ item: soap, unit: "box", qty: 5, date: D, lists: [wh] })).toMatchObject({ price: 50000, unit: "box", source: "slab", minQty: 5 });
    // 2 boxes: no box entry fits; 24 pieces hits the 24-piece slab → 12 × ₹44.
    expect(resolvePrice({ item: soap, unit: "box", qty: 2, date: D, lists: [wh] })).toMatchObject({ price: 52800, source: "slab", minQty: 24 });
    // 1 box = 12 pieces → 12 × ₹46.
    expect(resolvePrice({ item: soap, unit: "box", qty: 1, date: D, lists: [wh] })).toMatchObject({ price: 55200, source: "list" });
  });

  it("applies the list's % rule to items without an entry, with optional rupee rounding", () => {
    const dealer = list({ id: "d", name: "Dealer", adjustPct: -10 });
    expect(resolvePrice({ item: soap, date: D, lists: [dealer] })).toMatchObject({ price: 4500, source: "rule", listId: "d" });
    expect(resolvePrice({ item: soap, unit: "carton", date: D, lists: [dealer] })).toMatchObject({ price: 576000, source: "rule" });
    const odd = { ...soap, price: 4999 };
    expect(resolvePrice({ item: odd, date: D, lists: [list({ adjustPct: -7 })] }).price).toBe(4649);
    expect(resolvePrice({ item: odd, date: D, lists: [list({ adjustPct: -7, roundRupee: true })] }).price).toBe(4600);
    expect(resolvePrice({ item: soap, date: D, lists: [list({ adjustPct: 5 })] }).price).toBe(5250);
  });

  it("falls through to the next list (customer list, then the shop default), then the item", () => {
    const customer = list({ id: "c", name: "Hotel", entries: [{ itemId: "other", unit: null, minQty: 0, price: 1 }] });
    const def = list({ id: "def", name: "Bulk", entries: [{ itemId: "soap", unit: null, minQty: 10, price: 4700 }] });
    expect(resolvePrice({ item: soap, qty: 12, date: D, lists: [customer, def] })).toMatchObject({ price: 4700, listId: "def" });
    expect(resolvePrice({ item: soap, qty: 2, date: D, lists: [customer, def] })).toMatchObject({ price: 5000, source: "item" });
  });

  it("skips lists that are switched off or outside their dates", () => {
    const wh = list({ entries: [{ itemId: "soap", unit: null, minQty: 0, price: 4000 }] });
    expect(resolvePrice({ item: soap, date: D, lists: [{ ...wh, active: false }] }).price).toBe(5000);
    expect(resolvePrice({ item: soap, date: D, lists: [{ ...wh, validFrom: "2026-11-01" }] }).price).toBe(5000);
    expect(resolvePrice({ item: soap, date: D, lists: [{ ...wh, validTo: "2026-10-26" }] }).price).toBe(5000);
    expect(resolvePrice({ item: soap, date: D, lists: [{ ...wh, validFrom: D, validTo: D }] }).price).toBe(4000);
  });

  it("gives the GST-exclusive rate of tax-inclusive prices", () => {
    const mrp: PricingItem = { id: "oil", unit: "l", price: 21000, taxInclusive: true, gstRate: 5, units: [{ unit: "tin", factor: 15 }] };
    const r = resolvePrice({ item: mrp, unit: "tin", date: D, lists: [] });
    expect(r.price).toBe(315000);
    expect(r.rate).toBe(300000);
  });

  it("bands price-band GST on one piece, not the whole box", () => {
    const shirt: PricingItem = {
      id: "shirt",
      unit: "pcs",
      price: 120000,
      taxInclusive: false,
      gstRate: 5,
      gstRule: { kind: "price-band", threshold: 250000, below: 5, above: 18 },
      units: [{ unit: "box", factor: 6 }],
    };
    // A box of 6 at ₹7,200 is ₹1,200 a piece: still 5%.
    expect(resolvePrice({ item: shirt, unit: "box", date: D, lists: [] })).toMatchObject({ price: 720000, gstRate: 5 });
  });
});

describe("pickList / listApplies", () => {
  it("picks the bill's list, else the customer's, else the group's; 'none' drops the default too", () => {
    expect(pickList({ chosen: "x", customerListId: "c", groupListId: "g", defaultListId: "d" })).toEqual({ listId: "x", defaultListId: "d" });
    expect(pickList({ customerListId: "c", groupListId: "g", defaultListId: "d" })).toEqual({ listId: "c", defaultListId: "d" });
    expect(pickList({ groupListId: "g", defaultListId: "d" })).toEqual({ listId: "g", defaultListId: "d" });
    expect(pickList({ defaultListId: "d" })).toEqual({ listId: null, defaultListId: "d" });
    expect(pickList({ chosen: "none", customerListId: "c", defaultListId: "d" })).toEqual({ listId: null, defaultListId: null });
    expect(pickList({ chosen: "d", defaultListId: "d" })).toEqual({ listId: "d", defaultListId: null });
  });

  it("checks active and dates inclusively", () => {
    expect(listApplies({ active: true, validFrom: "2026-10-01", validTo: "2026-10-31" }, "2026-10-31")).toBe(true);
    expect(listApplies({ active: true, validFrom: "2026-10-01", validTo: null }, "2026-09-30")).toBe(false);
  });
});
