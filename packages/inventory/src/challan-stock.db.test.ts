/**
 * Database test of delivery challan stock (docs/sales-documents.md): goods out once, returns back once per key at the
 * location they left from (and into the batches they came from), a cancel bringing back only what is still out, and a
 * stock hold (reservation) never changing the quantity or its value. Runs only with `INVENTORY_TEST_DATABASE_URL` set;
 * the tables are copied into a throw-away schema which is dropped afterwards.
 *   PowerShell: $env:INVENTORY_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run src/challan-stock.db.test.ts
 */
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogItem, ItemCatalogPort } from "./ports";
import { InventoryService } from "./service";

const URL_ = process.env.INVENTORY_TEST_DATABASE_URL;
const SCHEMA = `challan_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = [
  "stock_locations",
  "stock_items",
  "stock_movements",
  "stock_transfers",
  "stock_reservations",
  "stock_batches",
  "stock_batch_levels",
  "stock_batch_movements",
  "stock_batch_items",
  "stock_batch_settings",
];
const T = "22222222-2222-4222-8222-222222222222";
const ITEMS: CatalogItem[] = [
  { id: "bbbbbbbb-0000-4000-8000-000000000001", name: "Cement 50 kg", hsn: "2523", unit: "bag", rate: 40000, gstRate: 28, categoryId: null, categoryName: null, barcode: null, sku: null },
  { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Syrup 100 ml", hsn: "3004", unit: "pcs", rate: 9000, gstRate: 12, categoryId: null, categoryName: null, barcode: null, sku: null },
];
const [CEMENT, SYRUP] = ITEMS.map((i) => i.id) as [string, string];
const CH1 = "cccccccc-0000-4000-8000-000000000001";
const CH2 = "cccccccc-0000-4000-8000-000000000002";

describe.skipIf(!URL_)("delivery challan stock against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let s: InventoryService;
  let main: string;

  const rows = <R>(r: unknown) => ((r as { rows?: R[] }).rows ?? (r as R[]));
  const level = async (itemId: string) => {
    const r = rows<{ qty: string; reserved: string; avg_cost: number | null }>(
      await db.execute(sql`select qty, reserved, avg_cost from stock_items where tenant_id = ${T} and item_id = ${itemId} and location_id = ${main}`),
    );
    return { qty: Number(r[0]?.qty ?? 0), reserved: Number(r[0]?.reserved ?? 0), avgCost: r[0]?.avg_cost ?? null };
  };
  const batchLevels = async (itemId: string) =>
    rows<{ batch_no: string; qty: string }>(
      await db.execute(
        sql`select b.batch_no, l.qty from stock_batch_levels l join stock_batches b on b.id = l.batch_id where l.tenant_id = ${T} and l.item_id = ${itemId} order by b.batch_no`,
      ),
    ).map((r) => [r.batch_no, Number(r.qty)]);

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    const catalog: ItemCatalogPort = {
      getItems: async (_t, ids) => ITEMS.filter((i) => ids.includes(i.id)),
      listItems: async () => ITEMS,
    };
    s = new InventoryService({ db, catalog, sellerState: { stateCode: async () => "33" } });
    main = (await s.ensureDefaultLocation(T)).id;
    await s.adjust(T, CEMENT, { mode: "add", qty: 50, unitCost: 30000 });
    await s.batches.receive(T, { itemId: SYRUP, batchNo: "S-A", expiry: "12/2099", qty: 6, cost: 5000 });
    await s.batches.receive(T, { itemId: SYRUP, batchNo: "S-B", expiry: "12/2098", qty: 4, cost: 5000 });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("takes goods out once, brings returns back once per key, never more than went out", async () => {
    const before = await level(CEMENT);
    expect(before.qty).toBe(50);
    expect(await s.applyChallan(T, { challanId: CH1, step: "out", refNumber: "DC/26-27/0001", lines: [{ itemId: CEMENT, qty: 10 }] })).toEqual({ applied: true, items: 1 });
    // A retried "out" does nothing.
    expect((await s.applyChallan(T, { challanId: CH1, step: "out", lines: [{ itemId: CEMENT, qty: 10 }] })).applied).toBe(false);
    expect((await level(CEMENT)).qty).toBe(40);

    await s.applyChallan(T, { challanId: CH1, step: "return", key: "r1", lines: [{ itemId: CEMENT, qty: 3 }] });
    // The same return twice is applied once.
    expect((await s.applyChallan(T, { challanId: CH1, step: "return", key: "r1", lines: [{ itemId: CEMENT, qty: 3 }] })).applied).toBe(false);
    expect((await level(CEMENT)).qty).toBe(43);
    // More back than is still out is capped.
    await s.applyChallan(T, { challanId: CH1, step: "return", key: "r2", lines: [{ itemId: CEMENT, qty: 99 }] });
    expect((await level(CEMENT)).qty).toBe(50);
    // Nothing is out any more: a cancel moves nothing.
    expect((await s.applyChallan(T, { challanId: CH1, step: "cancel", lines: [] })).applied).toBe(false);
    const moves = rows<{ reason: string; delta: string }>(
      await db.execute(sql`select reason, delta from stock_movements where tenant_id = ${T} and ref_type = 'challan' and ref_id = ${CH1} order by created_at`),
    ).map((m) => [m.reason, Number(m.delta)]);
    expect(moves).toEqual([
      ["challan_out", -10],
      ["challan_return", 3],
      ["challan_return", 7],
    ]);
    // Moving goods out and back never changes the average cost.
    expect((await level(CEMENT)).avgCost).toBe(before.avgCost);
  });

  it("takes batch-tracked goods from batches and a cancel puts back only what is still out, into those batches", async () => {
    expect(await batchLevels(SYRUP)).toEqual([
      ["S-A", 6],
      ["S-B", 4],
    ]);
    await s.applyChallan(T, { challanId: CH2, step: "out", lines: [{ itemId: SYRUP, qty: 7 }] });
    // First expiry first out: all of S-B, then 3 of S-A.
    expect(await batchLevels(SYRUP)).toEqual([
      ["S-A", 3],
      ["S-B", 0],
    ]);
    await s.applyChallan(T, { challanId: CH2, step: "return", key: "back-1", lines: [{ itemId: SYRUP, qty: 2 }] });
    expect((await level(SYRUP)).qty).toBe(5);
    await s.applyChallan(T, { challanId: CH2, step: "cancel", lines: [] });
    expect((await level(SYRUP)).qty).toBe(10);
    expect(await batchLevels(SYRUP)).toEqual([
      ["S-A", 6],
      ["S-B", 4],
    ]);
    // After a cancel nothing moves any more.
    expect((await s.applyChallan(T, { challanId: CH2, step: "return", key: "late", lines: [{ itemId: SYRUP, qty: 1 }] })).applied).toBe(false);
  });

  it("a sale order hold reserves without changing the quantity or its value", async () => {
    const before = await level(CEMENT);
    await s.reserve(T, { refType: "sale_order", refId: "so-1", lines: [{ itemId: CEMENT, qty: 12 }] });
    const held = await level(CEMENT);
    expect(held).toMatchObject({ qty: before.qty, reserved: 12, avgCost: before.avgCost });
    // Shrinking the hold after a delivery: release, then hold what is left.
    await s.release(T, "sale_order", "so-1");
    await s.reserve(T, { refType: "sale_order", refId: "so-1", lines: [{ itemId: CEMENT, qty: 5 }] }, { allowBackorder: true });
    expect((await level(CEMENT)).reserved).toBe(5);
    await s.release(T, "sale_order", "so-1");
    expect((await level(CEMENT)).reserved).toBe(0);
  });
});
