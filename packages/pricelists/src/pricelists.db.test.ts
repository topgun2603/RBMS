/**
 * Price lists against Postgres (docs/price-lists-units.md): lists, slabs, customer groups and links, resolution and the
 * POS cache. Runs only with `PRICELISTS_TEST_DATABASE_URL` set; it copies the tables into a throw-away schema and drops
 * it afterwards.
 */
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PriceListsService, type PricingItemRecord } from "./service";

const URL_ = process.env.PRICELISTS_TEST_DATABASE_URL;
const SCHEMA = `pricelists_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["price_lists", "price_list_items", "customer_groups", "customer_pricing"];
const tenant = randomUUID();
const SOAP = randomUUID();
const CUSTOMER = randomUUID();
const items: PricingItemRecord[] = [
  { id: SOAP, name: "Soap", sku: "SOAP", unit: "pcs", price: 5000, taxInclusive: false, gstRate: 18, units: [{ unit: "box", factor: 12, ownPrice: null }] },
];

describe.skipIf(!URL_)("price lists (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: PriceListsService;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    svc = new PriceListsService({
      db,
      today: () => "2026-10-27",
      items: { items: async (_t, ids) => items.filter((i) => ids.includes(i.id)) },
      customers: { names: async (_t, ids) => ids.filter((id) => id === CUSTOMER).map((id) => ({ id, name: "Murugan Stores", phone: null })) },
    });
  });

  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("creates lists with prices and slabs, and prices a customer's bill through their group", async () => {
    const wh = await svc.createList(tenant, { name: "Wholesale" });
    await expect(svc.createList(tenant, { name: "wholesale" })).rejects.toMatchObject({ status: 409 });
    const detail = await svc.setEntries(tenant, wh.id, {
      items: [
        { itemId: SOAP, price: 4600 },
        { itemId: SOAP, minQty: 10, price: 4400 },
        { itemId: SOAP, unit: "BOX", minQty: 5, price: 50000 },
      ],
    });
    expect(detail.entries.map((e) => [e.unit, e.minQty, e.price])).toEqual([
      [null, 0, 4600],
      [null, 10, 4400],
      ["box", 5, 50000],
    ]);
    await expect(svc.setEntries(tenant, wh.id, { items: [{ itemId: SOAP, unit: "crate", price: 1 }] })).rejects.toMatchObject({ status: 400 });

    const bulk = await svc.createList(tenant, { name: "Bulk", isDefault: true });
    await svc.setEntries(tenant, bulk.id, { items: [{ itemId: SOAP, minQty: 24, price: 4800 }] });
    const dealers = await svc.createGroup(tenant, { name: "Dealers", priceListId: wh.id });
    const link = await svc.setCustomerPricing(tenant, CUSTOMER, { groupId: dealers.id });
    expect(link).toMatchObject({ groupName: "Dealers", effectiveListName: "Wholesale" });
    await expect(svc.setCustomerPricing(tenant, randomUUID(), { groupId: dealers.id })).rejects.toMatchObject({ status: 404 });

    const r = await svc.resolve(tenant, {
      customerId: CUSTOMER,
      lines: [
        { itemId: SOAP, qty: 3 },
        { itemId: SOAP, qty: 12 },
        { itemId: SOAP, unit: "box", qty: 5 },
        { itemId: randomUUID(), qty: 1 },
      ],
    });
    expect(r.list?.name).toBe("Wholesale");
    expect(r.defaultList?.name).toBe("Bulk");
    expect(r.lines.map((l) => [l.price, l.source])).toEqual([
      [4600, "list"],
      [4400, "slab"],
      [50000, "slab"],
    ]);

    // Walk-in: only the default list's slab (24+ pieces = 2 boxes).
    const walkIn = await svc.resolve(tenant, { lines: [{ itemId: SOAP, qty: 3 }, { itemId: SOAP, unit: "box", qty: 2 }] });
    expect(walkIn.lines.map((l) => [l.price, l.listName])).toEqual([
      [5000, null],
      [57600, "Bulk"],
    ]);
    // Item prices picked on the bill: no list at all.
    expect((await svc.resolve(tenant, { customerId: CUSTOMER, priceListId: "none", lines: [{ itemId: SOAP, qty: 30 }] })).lines[0]!.price).toBe(5000);

    // Only one default list.
    await svc.updateList(tenant, wh.id, { isDefault: true });
    const lists = (await svc.lists(tenant)).items;
    expect(lists.filter((l) => l.isDefault).map((l) => l.name)).toEqual(["Wholesale"]);
    expect(lists.find((l) => l.name === "Wholesale")).toMatchObject({ entryCount: 3, groupCount: 1 });

    const cache = await svc.cache(tenant);
    expect(cache.lists).toHaveLength(2);
    expect(cache.customers).toEqual([{ customerId: CUSTOMER, groupId: dealers.id, priceListId: null }]);
    expect((await svc.groupCustomers(tenant, dealers.id)).items).toEqual([{ id: CUSTOMER, name: "Murugan Stores", phone: null }]);

    // Imports upsert single prices.
    expect(await svc.upsertEntries(tenant, wh.id, [{ itemId: SOAP, unit: null, minQty: 10, price: 4300 }])).toBe(1);
    expect((await svc.getList(tenant, wh.id)).entries.find((e) => e.minQty === 10)?.price).toBe(4300);

    // Deleting the list: the group falls back to item prices.
    await svc.deleteList(tenant, wh.id);
    expect((await svc.customerPricing(tenant, CUSTOMER)).effectiveListId).toBeNull();
  });
});
