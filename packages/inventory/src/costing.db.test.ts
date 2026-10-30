/**
 * Database test of stock valuation (docs/valuation-reports.md): the weighted average is unchanged by the costing, FIFO
 * layers follow purchases, sales, returns, transfers and write-offs, landed charges on a purchase and a later landed-cost
 * voucher, and the method switch rules. Runs only with `INVENTORY_TEST_DATABASE_URL` set; the tables are copied into a
 * throw-away schema which is dropped afterwards.
 *   PowerShell: $env:INVENTORY_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run src/costing.db.test.ts
 */
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CatalogItem, ItemCatalogPort } from "./ports";
import { InventoryService } from "./service";

const URL_ = process.env.INVENTORY_TEST_DATABASE_URL;
const SCHEMA = `costing_it_${Math.random().toString(36).slice(2, 10)}`;
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
  "suppliers",
  "purchases",
  "purchase_payments",
  "purchase_doc_series",
  "debit_notes",
  "goods_receipts",
  "purchase_orders",
  "stock_valuation_settings",
  "stock_cost_layers",
  "stock_cost_draws",
  "landed_cost_vouchers",
];
const T = "33333333-3333-4333-8333-333333333333";
const ITEMS: CatalogItem[] = [
  { id: "dddddddd-0000-4000-8000-000000000001", name: "Rice 25 kg", hsn: "1006", unit: "bag", rate: 150000, gstRate: 5, weightGrams: 25_000 },
  { id: "dddddddd-0000-4000-8000-000000000002", name: "Oil 1 l", hsn: "1512", unit: "pcs", rate: 20000, gstRate: 5, weightGrams: 1_000 },
];
const [RICE, OIL] = ITEMS.map((i) => i.id) as [string, string];

describe.skipIf(!URL_)("stock valuation against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let s: InventoryService;
  let main: string;
  let wh: string;
  const rows = <R>(r: unknown) => ((r as { rows?: R[] }).rows ?? (r as R[]));
  const avg = async (itemId: string, loc = main) =>
    rows<{ avg_cost: number | null; qty: string }>(await db.execute(sql`select avg_cost, qty from stock_items where tenant_id = ${T} and item_id = ${itemId} and location_id = ${loc}`))[0];
  const lastCost = async (reason: string, itemId: string) =>
    rows<{ cost_avg: string; cost_fifo: string }>(await db.execute(sql`select cost_avg, cost_fifo from stock_movements where tenant_id = ${T} and item_id = ${itemId} and reason = ${reason} order by created_at desc limit 1`)).map((r) => ({ avg: Number(r.cost_avg), fifo: Number(r.cost_fifo) }))[0];

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    const catalog: ItemCatalogPort = { getItems: async (_t, ids) => ITEMS.filter((i) => ids.includes(i.id)), listItems: async () => ITEMS };
    s = new InventoryService({ db, catalog, sellerState: { stateCode: async () => "33" } });
    main = (await s.ensureDefaultLocation(T)).id;
    wh = (await s.createLocation(T, { name: "Godown", code: "WH", type: "warehouse" })).id;
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("keeps the weighted average exactly as before and records FIFO layers next to it", async () => {
    // A new shop starts with its layers built.
    await s.createPurchase(T, { billNumber: "S-1", date: "2026-10-01", supplier: { name: "Mill", stateCode: "33" }, lines: [{ itemId: RICE, description: "Rice", qty: 10, rate: 100000, gstRate: 5 }] });
    await s.createPurchase(T, { billNumber: "S-2", date: "2026-10-02", supplier: { name: "Mill", stateCode: "33" }, lines: [{ itemId: RICE, description: "Rice", qty: 10, rate: 120000, gstRate: 5 }] });
    expect((await avg(RICE))!.avg_cost).toBe(110000);
    await s.applySale(T, { refId: "INV-1", lines: [{ itemId: RICE, qty: 12 }] });
    // Average: 12 x 1,100 = 13,200 rupees; FIFO: 10 x 1,000 + 2 x 1,200 = 12,400 rupees.
    expect(await lastCost("sale", RICE)).toEqual({ avg: -1_320_000, fifo: -1_240_000 });
    expect((await avg(RICE))!.avg_cost).toBe(110000);
    // A return of 2 comes back at the sale's cost; the average does not move (as before).
    await s.applyReturn(T, { refId: "CN-1", saleRefId: "INV-1", lines: [{ itemId: RICE, qty: 2 }] });
    expect(await lastCost("sale_return", RICE)).toEqual({ avg: 220_000, fifo: 206_667 });
    expect((await avg(RICE))!.avg_cost).toBe(110000);
    // Transfer 3 to the godown: the oldest layer left (the 8 at 1,200) goes, and arrives at that cost.
    await s.createTransfer(T, { fromLocationId: main, toLocationId: wh, lines: [{ itemId: RICE, qty: 3 }] });
    expect(await lastCost("transfer_out", RICE)).toEqual({ avg: -330_000, fifo: -360_000 });
    expect(await lastCost("transfer_in", RICE)).toEqual({ avg: 330_000, fifo: 360_000 });
    // A write-off (stock removed by hand) takes the next oldest.
    await s.adjust(T, RICE, { mode: "remove", qty: 1 });
    expect((await lastCost("adjustment", RICE))!.fifo).toBe(-120_000);
    expect(await s.costing.layerCheck(T)).toEqual([]);

    const v = await s.costing.valuation(T, {});
    // Main: 10 - 12 + 10 + 2 - 3 - 1 = 6 bags: 4 @ 1,200 + 2 returned @ 1,033.33; godown: 3 @ 1,200.
    const at = (loc: string) => v.rows.find((r) => r.locationId === loc)!;
    expect(at(main).qty).toBe(6);
    expect(at(main).fifoValue).toBe(480_000 + 206_667);
    expect(at(main).avgValue).toBe(660_000);
    expect(at(wh).fifoValue).toBe(360_000);
    expect(v.method).toBe("average");
    expect(v.totals.value).toBe(v.totals.avgValue);
  });

  it("spreads landed charges by basis on a purchase; claimable GST is input credit, the rest is cost", async () => {
    const p = await s.createPurchase(T, {
      billNumber: "S-3",
      date: "2026-10-05",
      supplier: { name: "Agency", stateCode: "33" },
      lines: [
        { itemId: OIL, description: "Oil", qty: 100, rate: 15000, gstRate: 5 },
        { itemId: RICE, description: "Rice", qty: 2, rate: 100000, gstRate: 5 },
      ],
      charges: [
        // 150 kg in all: oil 100 kg, rice 50 kg.
        { kind: "freight", amount: 30000, gstRate: 5, claimable: true, basis: "weight" },
        { kind: "loading", amount: 10000, gstRate: 18, claimable: false, basis: "qty" },
      ],
    });
    // Claimable freight GST (5% of 300) is in the bill's GST; loading with its GST (118) is outside it.
    expect(p.totals.taxable).toBe(1_500_000 + 200_000 + 30_000);
    expect(p.totals.cgst + p.totals.sgst).toBe(Math.round(1_700_000 * 0.05) + 1_500);
    expect(p.total).toBe(p.totals.total + 11_800);
    expect(p.charges.map((c) => [c.kind, c.gst, c.claimable])).toEqual([
      ["freight", 1500, true],
      ["loading", 1800, false],
    ]);
    // Oil: 15,000 + freight 20,000 (by weight) + loading 11,800 x 100/102 = 11,569 -> 1,546,569 / 100.
    const oil = rows<{ unit_cost: number }>(await db.execute(sql`select unit_cost from stock_movements where tenant_id = ${T} and ref_id = ${p.id} and item_id = ${OIL}`))[0]!;
    expect(oil.unit_cost).toBe(Math.round((1_500_000 + 20_000 + 11_569) / 100));
  });

  it("re-costs remaining stock with a later landed-cost voucher; the part sold goes to cost of goods", async () => {
    const p = await s.createPurchase(T, { billNumber: "S-4", date: "2026-10-06", supplier: { name: "Agency", stateCode: "33" }, lines: [{ itemId: OIL, description: "Oil", qty: 50, rate: 10000, gstRate: 5 }] });
    // Sell 125: the 100 of S-3 and 25 of S-4 (FIFO); 25 of S-4 left.
    await s.applySale(T, { refId: "INV-2", lines: [{ itemId: OIL, qty: 125 }] });
    const before = await s.costing.valuation(T, { locationId: main });
    const avgBefore = (await avg(OIL))!.avg_cost!;
    const v = await s.costing.createVoucher(T, { purchaseId: p.id, date: "2026-10-07", kind: "freight", amount: 10000, gstRate: 5, claimable: true, billNumber: "LR-9", supplierName: "Lorry" });
    expect(v.toStock).toBe(5000);
    expect(v.toSold).toBe(5000);
    const after = await s.costing.valuation(T, { locationId: main });
    const oilRow = (r: typeof before) => r.rows.find((x) => x.itemId === OIL)!;
    expect(oilRow(after).fifoValue - oilRow(before).fifoValue).toBe(5000);
    // The average carries the same increase on the 25 held.
    expect((await avg(OIL))!.avg_cost).toBe(avgBefore + 200);
    // The charge bill is a purchase of the transporter with no stock lines (claimable GST as input credit).
    const bill = await s.getPurchase(T, v.chargePurchaseId!);
    expect(bill.lines[0]!.itemId).toBeUndefined();
    expect(bill.totals.cgst + bill.totals.sgst).toBe(500);
    expect(await s.costing.soldLanded(T, "2026-10-01", "2026-10-31")).toEqual([{ date: "2026-10-07", itemId: OIL, value: 5000, number: v.number }]);
    // Nothing moved since: it can be cancelled, which takes the cost back and cancels the bill.
    const c = await s.costing.cancelVoucher(T, v.id);
    expect(c.status).toBe("cancelled");
    expect(oilRow(await s.costing.valuation(T, { locationId: main })).fifoValue).toBe(oilRow(before).fifoValue);
    expect((await s.getPurchase(T, v.chargePurchaseId!)).status).toBe("cancelled");
    expect(await s.costing.layerCheck(T)).toEqual([]);
  });

  it("debit notes and purchase cancels take back their own purchase's layers", async () => {
    const p = await s.createPurchase(T, { billNumber: "S-5", date: "2026-10-08", supplier: { name: "Mill", stateCode: "33" }, lines: [{ itemId: RICE, description: "Rice", qty: 5, rate: 90000, gstRate: 5 }] });
    await s.cancelPurchase(T, p.id);
    expect((await lastCost("purchase_cancel", RICE))!.fifo).toBe(-450_000);
    expect(await s.costing.layerCheck(T)).toEqual([]);
  });

  it("switches method only from an unlocked financial year start", async () => {
    await expect(s.costing.setMethod(T, { method: "fifo", from: "2026-10-01" }, null, null)).rejects.toThrow(/1 April/);
    await expect(s.costing.setMethod(T, { method: "fifo", from: "2026-04-01" }, null, "2026-06-30")).rejects.toThrow(/locked/);
    const set = await s.costing.setMethod(T, { method: "fifo", from: "2026-04-01" }, null, null);
    expect(set.method).toBe("fifo");
    const v = await s.costing.valuation(T, {});
    expect(v.method).toBe("fifo");
    expect(v.totals.value).toBe(v.totals.fifoValue);
    expect(await s.costing.bookValue(T, s.today(), async () => -1)).toBe(v.totals.fifoValue);
    // Split by location (the books' per-branch stock), the parts add up to the same value.
    const byLocation = await s.costing.bookValueByLocation(T, s.today(), async () => new Map());
    expect([...byLocation.values()].reduce((a, b) => a + b, 0)).toBe(v.totals.fifoValue);
    // Back to average from the next year (the history keeps both).
    const back = await s.costing.setMethod(T, { method: "average", from: "2027-04-01" }, null, null);
    expect(back.history.map((h) => [h.method, h.from])).toEqual([
      ["fifo", "2026-04-01"],
      ["average", "2027-04-01"],
    ]);
  });
});
