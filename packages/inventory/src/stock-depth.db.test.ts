/**
 * Database test of "stock depth": batches and expiry, physical stock audits and transfers with in-transit. Runs only
 * with `INVENTORY_TEST_DATABASE_URL` set (a development Postgres with the inventory tables migrated); the tables are
 * copied into a throw-away schema which is dropped afterwards. Items come from a fake catalogue.
 *   PowerShell: $env:INVENTORY_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run src/stock-depth.db.test.ts
 */
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays } from "./batch-logic";
import type { CatalogItem, ItemCatalogPort } from "./ports";
import { InventoryService } from "./service";

const URL_ = process.env.INVENTORY_TEST_DATABASE_URL;
const SCHEMA = `stockdepth_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = [
  "stock_locations",
  "stock_items",
  "stock_movements",
  "stock_transfers",
  "stock_reservations",
  "suppliers",
  "purchases",
  "purchase_orders",
  "goods_receipts",
  "debit_notes",
  "purchase_payments",
  "purchase_doc_series",
  "stock_batches",
  "stock_batch_levels",
  "stock_batch_movements",
  "stock_batch_items",
  "stock_batch_settings",
  "stock_audits",
  "stock_audit_lines",
  "stock_audit_entries",
];
const T = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const CAT = "44444444-4444-4444-8444-444444444444";
const ITEMS: CatalogItem[] = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Biscuits 100g", hsn: "1905", unit: "pcs", rate: 1000, gstRate: 18, categoryId: CAT, categoryName: "Snacks", barcode: "8901000000011", sku: "BIS-100" },
  { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "Face cream", hsn: "3304", unit: "pcs", rate: 25000, gstRate: 18, categoryId: null, categoryName: null, barcode: "8901000000028", sku: "FC-1" },
  { id: "aaaaaaaa-0000-4000-8000-000000000003", name: "Plain item", hsn: null, unit: "pcs", rate: 500, gstRate: 5, categoryId: null, categoryName: null, barcode: "8901000000035", sku: null },
];
const [BIS, CREAM, PLAIN] = ITEMS.map((i) => i.id) as [string, string, string];
const day = (n: number) => addDays(new Date().toISOString().slice(0, 10), n);

describe.skipIf(!URL_)("stock depth against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let s: InventoryService;
  let main: string;
  let wh: string;
  const events: { type: string; data: unknown }[] = [];

  const qtyAt = async (itemId: string, loc: string) => {
    const r = await db.execute<{ qty: string }>(sql`select qty from stock_items where tenant_id = ${T} and item_id = ${itemId} and location_id = ${loc}`);
    const rows = (r as unknown as { rows?: { qty: string }[] }).rows ?? (r as unknown as { qty: string }[]);
    return Number(rows[0]?.qty ?? 0);
  };
  const batchQty = async (batchId: string, loc: string) => {
    const r = await db.execute<{ qty: string }>(sql`select qty from stock_batch_levels where tenant_id = ${T} and batch_id = ${batchId} and location_id = ${loc}`);
    const rows = (r as unknown as { rows?: { qty: string }[] }).rows ?? (r as unknown as { qty: string }[]);
    return Number(rows[0]?.qty ?? 0);
  };
  const batchId = async (itemId: string, no: string) => {
    const page = await s.batches.listBatches(T, { itemId, all: "true", limit: 50 } as never);
    const hit = page.items.find((b) => b.batchNo === no);
    if (!hit) throw new Error(`batch ${no} not found`);
    return hit.id;
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    const catalog: ItemCatalogPort = {
      getItems: async (_t, ids) => ITEMS.filter((i) => ids.includes(i.id)),
      listItems: async (_t, q) => ITEMS.filter((i) => !q || i.name.toLowerCase().includes(q.toLowerCase()) || i.barcode === q || (i.sku ?? "").toLowerCase() === q.toLowerCase()),
    };
    s = new InventoryService({
      db,
      catalog,
      sellerState: { stateCode: async () => "33" },
      events: { emit: async (_t, type, data) => void events.push({ type, data }) },
    });
    main = (await s.ensureDefaultLocation(T)).id;
    wh = (await s.createLocation(T, { name: "Warehouse", code: "WH1" })).id;
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  // ---------------------------------------------------------------- batches

  it("receives batches, picks first-expiry-first-out and keeps the stock totals", async () => {
    await s.batches.receive(T, { itemId: BIS, batchNo: "B-OLD", expiry: day(20), mfgDate: day(-300), qty: 10, mrp: 1200, cost: 700, opening: true });
    await s.batches.receive(T, { itemId: BIS, batchNo: "B-NEW", expiry: "12/2099", qty: 5, mrp: 1250, cost: 750 });
    await s.batches.receive(T, { itemId: BIS, batchNo: "B-GONE", expiry: day(-3), qty: 2, cost: 650 });
    expect(await qtyAt(BIS, main)).toBe(17);
    const pick = await s.batches.pick(T, { itemId: BIS, qty: 12 });
    expect(pick.tracked).toBe(true);
    expect(pick.batches.map((b) => b.batchNo)).toEqual(["B-GONE", "B-OLD", "B-NEW"]);
    // expired stock is not suggested; the soonest unexpired goes first
    expect(pick.suggestion.map((x) => [x.batchId, x.qty])).toEqual([
      [await batchId(BIS, "B-OLD"), 10],
      [await batchId(BIS, "B-NEW"), 2],
    ]);
    expect(pick.batches.find((b) => b.batchNo === "B-OLD")?.suggestedDiscount).toBe(20);
    const summary = await s.batches.expirySummary(T);
    expect(summary.expired).toMatchObject({ batches: 1, qty: 2 });
    expect(summary.expiring.batches).toBe(1);
    const list = await s.batches.listBatches(T, { status: "expired" } as never);
    expect(list.items.map((b) => b.batchNo)).toEqual(["B-GONE"]);
    const report = await s.batches.report(T, {});
    expect(report.totals.batches).toBe(3);
    expect(report.totals.value).toBe(10 * 700 + 5 * 750 + 2 * 650);
  });

  it("sells the chosen batch first, then FEFO, and a cancelled bill puts every batch back", async () => {
    const oldId = await batchId(BIS, "B-OLD");
    const newId = await batchId(BIS, "B-NEW");
    await s.applySale(T, { refId: "inv-1", refNumber: "INV/1", lines: [{ itemId: BIS, qty: 4, batchId: newId }] });
    expect(await batchQty(newId, main)).toBe(1);
    expect(await batchQty(oldId, main)).toBe(10);
    expect(await qtyAt(BIS, main)).toBe(13);
    // a line without a batch: the oldest unexpired first; the chosen batch ran short (1 left) so the rest comes FEFO
    await s.applySale(T, { refId: "inv-2", refNumber: "INV/2", lines: [{ itemId: BIS, qty: 12, batchId: newId }] });
    expect(await batchQty(newId, main)).toBe(0);
    expect(await batchQty(oldId, main)).toBe(0);
    // 12 = 1 (chosen) + 10 (B-OLD) + 1 from the expired batch as a last resort
    expect(await batchQty(await batchId(BIS, "B-GONE"), main)).toBe(1);
    expect(await qtyAt(BIS, main)).toBe(1);
    await s.reverseSale(T, "inv-2");
    expect(await batchQty(newId, main)).toBe(1);
    expect(await batchQty(oldId, main)).toBe(10);
    expect(await batchQty(await batchId(BIS, "B-GONE"), main)).toBe(2);
    const alloc = await s.batches.allocations(T, "invoice", "inv-1");
    expect(alloc.map((a) => [a.batchNo, a.qty])).toEqual([["B-NEW", 4]]);
    // idempotent
    await s.reverseSale(T, "inv-2");
    expect(await batchQty(oldId, main)).toBe(10);
  });

  it("a sales return goes back to the batch the bill took it from", async () => {
    const newId = await batchId(BIS, "B-NEW");
    await s.applyReturn(T, { refId: "cn-1", saleRefId: "inv-1", refNumber: "CN/1", lines: [{ itemId: BIS, qty: 3 }] });
    expect(await batchQty(newId, main)).toBe(4);
    await s.reverseReturn(T, "cn-1");
    expect(await batchQty(newId, main)).toBe(1);
    // a return of more than the bill took from batches: the rest goes back unbatched
    await s.applyReturn(T, { refId: "cn-2", saleRefId: "inv-1", lines: [{ itemId: BIS, qty: 6 }] });
    expect(await batchQty(newId, main)).toBe(5);
    // 4 went back to the batch, 2 are unbatched
    expect(await qtyAt(BIS, main)).toBe(19);
  });

  it("manual adjustments by batch, assigning unbatched stock and write-offs", async () => {
    const oldId = await batchId(BIS, "B-OLD");
    await s.batches.adjust(T, oldId, { mode: "remove", qty: 2, reason: "damaged", note: "wet" });
    expect(await batchQty(oldId, main)).toBe(8);
    await expect(s.batches.adjust(T, oldId, { mode: "remove", qty: 99 })).rejects.toThrow(/Only 8/);
    await s.batches.adjust(T, oldId, { mode: "set", qty: 9, reason: "adjustment" });
    expect(await batchQty(oldId, main)).toBe(9);
    // item without batches: plain stock, then part of it assigned to a batch
    await s.adjust(T, CREAM, { mode: "add", qty: 6, unitCost: 9000 });
    await s.batches.receive(T, { itemId: CREAM, batchNo: "C-1", expiry: day(200), qty: 4, mode: "assign" });
    expect(await qtyAt(CREAM, main)).toBe(6);
    await expect(s.batches.receive(T, { itemId: CREAM, batchNo: "C-2", qty: 5, mode: "assign" })).rejects.toThrow(/Only 2/);
    // an adjustment without a batch takes the batch first (FEFO), not the unbatched part
    await s.adjust(T, CREAM, { mode: "remove", qty: 1 });
    expect(await batchQty(await batchId(CREAM, "C-1"), main)).toBe(3);
    // a plain item is never affected
    await s.adjust(T, PLAIN, { mode: "add", qty: 3 });
    await s.adjust(T, PLAIN, { mode: "remove", qty: 1 });
    expect(await qtyAt(PLAIN, main)).toBe(2);
  });

  it("tracking switch, settings and the expired-stock rule", async () => {
    expect((await s.batches.trackingFor(T, [BIS, PLAIN])).map((x) => x.tracked)).toEqual([true, false]);
    await s.batches.setItemTracking(T, PLAIN, true);
    expect((await s.batches.trackedOf(T, [PLAIN])).has(PLAIN)).toBe(true);
    await s.batches.setItemTracking(T, PLAIN, false);
    expect((await s.batches.trackedOf(T, [PLAIN])).has(PLAIN)).toBe(false);
    expect(await s.batches.checkSale(T, [{ itemId: BIS, qty: 1, batchId: await batchId(BIS, "B-GONE") }])).toEqual({ ok: true });
    await s.batches.saveSettings(T, { expiredPolicy: "block", alertDays: 45 });
    const blocked = await s.batches.checkSale(T, [{ itemId: BIS, qty: 1, batchId: await batchId(BIS, "B-GONE"), description: "Biscuits" }]);
    expect(blocked.ok).toBe(false);
    expect(await s.batches.checkSale(T, [{ itemId: BIS, qty: 1, batchId: await batchId(BIS, "B-OLD") }])).toEqual({ ok: true });
    await s.batches.saveSettings(T, { expiredPolicy: "warn" });
  });

  it("purchase bills and goods receipts bring batches in and take them out when cancelled", async () => {
    const bill = await s.createPurchase(T, {
      billNumber: "SUP-1",
      date: day(0),
      supplier: { name: "Sri Traders" },
      lines: [
        { itemId: PLAIN, description: "Plain item", qty: 10, rate: 400, gstRate: 5, batchNo: "P-1", expiry: day(400) },
        { itemId: PLAIN, description: "Plain item", qty: 5, rate: 410, gstRate: 5, batchNo: "P-2", expiry: day(500) },
      ],
    } as never);
    const p1 = await batchId(PLAIN, "P-1");
    expect(await batchQty(p1, main)).toBe(10);
    expect(await qtyAt(PLAIN, main)).toBe(17);
    await s.cancelPurchase(T, bill.id);
    expect(await batchQty(p1, main)).toBe(0);
    expect(await qtyAt(PLAIN, main)).toBe(2);

    const sup = await s.createSupplier(T, { name: "Sri Traders" });
    const po = await s.purchasing.createPurchaseOrder(T, {
      supplierId: sup.id,
      date: day(0),
      lines: [{ itemId: CREAM, description: "Face cream", qty: 20, rate: 8000, gstRate: 18 }],
    } as never);
    const rec = await s.purchasing.receive(T, po.id, {
      lines: [{ lineIndex: 0, qty: 12, batches: [{ batchNo: "G-1", expiry: day(300), qty: 7 }, { batchNo: "G-2", expiry: day(250), qty: 5 }] }],
    });
    const g1 = await batchId(CREAM, "G-1");
    expect(await batchQty(g1, main)).toBe(7);
    expect(await qtyAt(CREAM, main)).toBe(5 + 12);
    await expect(
      s.purchasing.receive(T, po.id, { lines: [{ lineIndex: 0, qty: 2, batches: [{ batchNo: "G-3", qty: 3 }] }] }),
    ).rejects.toThrow(/add up to more/);
    await s.purchasing.cancelGoodsReceipt(T, rec.grn.id, {});
    expect(await batchQty(g1, main)).toBe(0);
    expect(await qtyAt(CREAM, main)).toBe(5);
  });

  // ---------------------------------------------------------------- audit

  it("counts with several counters, reviews, approves and posts audit adjustments", async () => {
    const audit = await s.audits.create(T, { locationId: main, title: "Shelf check" });
    expect(audit.status).toBe("draft");
    expect(audit.number).toMatch(/^SA\//);
    const lines = await s.audits.lines(T, audit.id, { limit: 500 });
    const bisLines = lines.items.filter((l) => l.itemId === BIS);
    expect(bisLines.some((l) => l.batchNo === "B-OLD")).toBe(true);
    await expect(s.audits.count(T, audit.id, { entries: [{ code: "x" }] })).rejects.toThrow(/Start counting/);
    await s.audits.start(T, audit.id);
    // two people scan the same batch line: their counts add up
    const oldLine = bisLines.find((l) => l.batchNo === "B-OLD")!;
    await s.audits.count(T, audit.id, { counter: "Ravi", entries: [{ lineId: oldLine.id, qty: 4 }] });
    const merged = await s.audits.count(T, audit.id, { counter: "Meena", entries: [{ lineId: oldLine.id, qty: 3 }, { code: "nope-123" }] });
    expect(merged.unknown).toEqual(["nope-123"]);
    expect(merged.results[0]?.counted).toBe(7);
    // set replaces one counter's own count
    const again = await s.audits.count(T, audit.id, { counter: "Meena", entries: [{ lineId: oldLine.id, qty: 5, mode: "set" }] });
    expect(again.results[0]?.counted).toBe(9);
    // a scanned barcode lands on the item's line; plain item scanned by barcode (not in the first screen of lines)
    const plain = await s.audits.count(T, audit.id, { counter: "Ravi", entries: [{ code: "8901000000035", qty: 1 }, { code: "8901000000035", qty: 1 }] });
    expect(plain.results.at(-1)?.counted).toBe(2);
    // an item that had no stock at the freeze and is found on the shelf gets a new line
    // Ravi recounts: his own count is replaced (2 + Meena's 5 = 7 against 9 in the system)
    const recount = await s.audits.count(T, audit.id, { counter: "Ravi", entries: [{ lineId: oldLine.id, qty: 2, mode: "set" }, { code: "8901000000035", qty: 1, mode: "set" }] });
    expect(recount.results[0]?.counted).toBe(7);
    const sub = await s.audits.submit(T, audit.id);
    expect(sub.status).toBe("review");
    const v = await s.audits.variance(T, audit.id);
    const oldVar = v.items.find((l) => l.batchNo === "B-OLD")!;
    expect(oldVar).toMatchObject({ systemQty: 9, countedQty: 7, variance: -2 });
    expect(oldVar.value).toBe(-2 * 700);
    expect(v.totals.shortageValue).toBeGreaterThanOrEqual(1400);
    await expect(s.audits.approve(T, audit.id, {})).rejects.toThrow(/need a reason/);
    expect((await s.audits.bulkReason(T, audit.id, { reason: "damaged" })).updated).toBeGreaterThan(0);
    const before = await qtyAt(BIS, main);
    const done = await s.audits.approve(T, audit.id, {});
    expect(done.status).toBe("approved");
    expect(done.totals.varianceLines).toBeGreaterThan(0);
    expect(await batchQty(await batchId(BIS, "B-OLD"), main)).toBe(7);
    expect(await qtyAt(BIS, main)).toBe(before - 2);
    const moves = await s.movements(T, BIS, { limit: 5 });
    expect(moves.items[0]).toMatchObject({ reason: "audit", refType: "audit" });
    await expect(s.audits.approve(T, audit.id, {})).rejects.toThrow(/already approved/);
    const csv = await s.audits.csv(T, audit.id, "variance");
    expect(csv.body).toContain("B-OLD");
  });

  // ---------------------------------------------------------------- transfers

  it("sends, holds in transit, receives in parts with damage and closes; batches follow", async () => {
    const oldId = await batchId(BIS, "B-OLD"); // 7 at main
    await s.adjust(T, PLAIN, { mode: "add", qty: 4 });
    const note = await s.transfers.create(T, { fromLocationId: main, toLocationId: wh, lines: [{ itemId: BIS, qty: 5 }, { itemId: PLAIN, qty: 2 }], transport: "TN 38 AB 1234" });
    expect(note.status).toBe("draft");
    expect(note.number).toMatch(/^TR\//);
    const before = await qtyAt(BIS, main);
    const sent = await s.transfers.send(T, note.id);
    expect(sent.status).toBe("in_transit");
    expect(await qtyAt(BIS, main)).toBe(before - 5);
    expect(await qtyAt(BIS, wh)).toBe(0);
    expect(await batchQty(oldId, main)).toBe(2);
    expect(events.some((e) => e.type === "stock.transfer_sent")).toBe(true);
    const sentBatches = sent.lines.find((l) => l.itemId === BIS)!.batches!;
    expect(sentBatches.map((b) => [b.batchNo, b.qty])).toEqual([["B-OLD", 5]]);
    let transit = await s.transfers.inTransit(T);
    expect(transit.items.map((r) => [r.itemName, r.qty])).toEqual(expect.arrayContaining([["Biscuits 100g", 5], ["Plain item", 2]]));
    expect(transit.totals.value).toBeGreaterThan(0);
    await expect(s.transfers.receive(T, note.id, { lines: [{ itemId: BIS, received: 9 }] })).rejects.toThrow(/More than/);
    const part = await s.transfers.receive(T, note.id, { lines: [{ itemId: BIS, received: 3, damaged: 1 }, { itemId: PLAIN, received: 2 }] });
    expect(part.status).toBe("partially_received");
    expect(await qtyAt(BIS, wh)).toBe(3);
    expect(await batchQty(oldId, wh)).toBe(3);
    transit = await s.transfers.inTransit(T);
    expect(transit.items.find((r) => r.itemName === "Biscuits 100g")?.qty).toBe(1);
    expect(transit.items.find((r) => r.itemName === "Plain item")).toBeUndefined();
    await expect(s.transfers.cancel(T, note.id, "x")).rejects.toThrow(/Part of this transfer/);
    const closed = await s.transfers.receive(T, note.id, { closeShort: true, lines: [], note: "1 packet missing" });
    expect(closed.status).toBe("closed");
    const line = closed.lines.find((l) => l.itemId === BIS)!;
    expect([line.received, line.damaged, line.short]).toEqual([3, 1, 1]);
    expect((await s.transfers.inTransit(T)).items.filter((r) => r.transferId === note.id)).toEqual([]);
    await expect(s.transfers.send(T, note.id)).rejects.toThrow();
  });

  it("a cancelled in-transit note puts the goods back; a short source refuses; the instant API still works", async () => {
    const oldId = await batchId(BIS, "B-OLD");
    const start = await qtyAt(BIS, main);
    const startBatch = await batchQty(oldId, main);
    const n = await s.transfers.create(T, { fromLocationId: main, toLocationId: wh, lines: [{ itemId: BIS, qty: 2, batchId: oldId }], send: true });
    expect(n.status).toBe("in_transit");
    expect(await qtyAt(BIS, main)).toBe(start - 2);
    const cancelled = await s.transfers.cancel(T, n.id, "wrong branch");
    expect(cancelled.status).toBe("cancelled");
    expect(await qtyAt(BIS, main)).toBe(start);
    expect(await batchQty(oldId, main)).toBe(startBatch);
    expect((await s.transfers.inTransit(T)).items.filter((r) => r.transferId === n.id)).toEqual([]);

    await expect(s.createTransfer(T, { fromLocationId: main, toLocationId: wh, lines: [{ itemId: BIS, qty: 9999 }] })).rejects.toMatchObject({ status: 409 });
    const instant = await s.createTransfer(T, { fromLocationId: main, toLocationId: wh, lines: [{ itemId: BIS, qty: 1 }], note: "quick" });
    expect(instant).toMatchObject({ status: "closed", note: "quick" });
    expect(instant.number).toMatch(/^TR\//);
    expect(await qtyAt(BIS, main)).toBe(start - 1);
    expect(await qtyAt(BIS, wh)).toBe(3 + 1);
    const listed = await s.listTransfers(T, {});
    expect(listed.items.length).toBeGreaterThan(2);
    const moves = await s.movements(T, BIS, { limit: 4, locationId: wh });
    expect(moves.items[0]?.reason).toBe("transfer_in");
  });

  it("keeps shops apart and the batch totals consistent", async () => {
    const other = await s.batches.listBatches(OTHER_TENANT, { all: "true" } as never);
    expect(other.total).toBe(0);
    expect((await s.audits.list(OTHER_TENANT, {})).total).toBe(0);
    const r = await db.execute<{ bad: string }>(
      sql`select count(*)::text as bad from (select l.item_id, l.location_id, sum(l.qty) b from stock_batch_levels l where l.tenant_id = ${T} group by 1, 2) x
          join stock_items i on i.item_id = x.item_id and i.location_id = x.location_id and i.tenant_id = ${T} where x.b > i.qty`,
    );
    const rows = (r as unknown as { rows?: { bad: string }[] }).rows ?? (r as unknown as { bad: string }[]);
    expect(Number(rows[0]?.bad)).toBe(0);
  });
});
