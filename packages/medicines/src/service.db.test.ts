/**
 * Database test of the pharmacy service: medicine details and substitutes, batches (receive, correct, write off) with
 * their expiry order, first-expiry-first-out sales and cancellations from issued bills, prescriptions, the expiry
 * summary and the Schedule H1 register, and that one shop never sees another's batches. Runs only with
 * `MEDICINES_TEST_DATABASE_URL` set (a development Postgres with the medicines tables migrated); it copies them into a
 * throw-away schema and drops it afterwards. The clock is fixed: 2026-11-05 in India.
 *   PowerShell: $env:MEDICINES_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { AppError, emptyContext, type RequestContext } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { SoldBill, StockPort } from "./ports";
import { medicinesRoutes } from "./routes";
import { MedicinesService } from "./service";

const URL_ = process.env.MEDICINES_TEST_DATABASE_URL;
const SCHEMA = `medicines_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["medicines", "medicine_batches", "medicine_batch_movements", "medicine_prescriptions"];
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PARA = "aaaaaaaa-0000-4000-8000-000000000001"; // Paracetamol 650 mg, otc
const CROCIN = "aaaaaaaa-0000-4000-8000-000000000002"; // same composition, another brand
const TRAMA = "aaaaaaaa-0000-4000-8000-000000000003"; // Schedule H1
const GHOST = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const bill = (id: string, lines: SoldBill["lines"], number = `INV-${id.slice(-4)}`): SoldBill => ({ id, number, date: "2026-11-05", customer: { name: "Walk-in", phone: null }, lines });
const INV1 = "bbbbbbbb-0000-4000-8000-000000000001";
const INV2 = "bbbbbbbb-0000-4000-8000-000000000002";
const INV3 = "bbbbbbbb-0000-4000-8000-000000000003";
const INV4 = "bbbbbbbb-0000-4000-8000-000000000004";
const INV5 = "bbbbbbbb-0000-4000-8000-000000000005";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? `${e.status}:${e.code}` : e instanceof ZodError ? "zod" : String(e);
  }
  return "ok";
};

describe.skipIf(!URL_)("medicines service against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: MedicinesService;
  let gateOn = true;
  let stockFails = false;
  const stockCalls: string[] = [];
  const errors: string[] = [];
  const warns: string[] = [];

  const stock: StockPort = {
    add: async (t, item, qty, note) => {
      if (stockFails) throw new Error("inventory down");
      stockCalls.push(`add ${t === A ? "A" : "B"} ${item.slice(-1)} ${qty} ${note}`);
    },
    remove: async (t, item, qty, note) => {
      if (stockFails) throw new Error("inventory down");
      stockCalls.push(`remove ${t === A ? "A" : "B"} ${item.slice(-1)} ${qty} ${note}`);
    },
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    svc = new MedicinesService({
      db,
      stock,
      featureGate: { isEnabled: async () => gateOn },
      log: { info() {}, warn: (o, m) => void warns.push(m ?? ""), error: (_o, m) => void errors.push(m ?? "") },
      now: () => new Date("2026-11-05T10:00:00Z"),
    });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  const recv = (batchNo: string, expiry: string, qty: number, extra: Record<string, unknown> = {}, itemId = PARA, tenant = A) =>
    svc.receive(tenant, { itemId, itemName: "Paracetamol 650", batchNo, expiry, qty, ...extra });

  it("medicine details: schedule decides prescription and register flags, saving twice updates, shops are separate", async () => {
    const otc = await svc.saveMedicine(A, PARA, { name: "Paracetamol 650", composition: "Paracetamol 650 mg", manufacturer: "Acme", packSize: 15, rack: "A1" });
    expect(otc).toMatchObject({ schedule: "otc", packUnit: "strip", prescriptionRequired: false, inRegister: false, packSize: 15 });
    const h1 = await svc.saveMedicine(A, TRAMA, { name: "Tramadol 50", schedule: "H1" });
    expect(h1).toMatchObject({ prescriptionRequired: true, inRegister: true });
    const h = await svc.saveMedicine(A, CROCIN, { name: "Crocin 650", composition: "paracetamol 650 MG", schedule: "H" });
    expect(h).toMatchObject({ prescriptionRequired: true, inRegister: false });
    expect(await code(svc.saveMedicine(A, PARA, { name: "X", schedule: "Z" }))).toBe("zod");
    expect(await code(svc.saveMedicine(A, PARA, { name: "X", packSize: 0 }))).toBe("zod");
    expect(await code(svc.saveMedicine(A, PARA, { name: "X", surprise: 1 }))).toBe("zod");

    // Saving again changes the same row.
    const again = await svc.saveMedicine(A, PARA, { name: "Paracetamol 650 mg tabs", composition: "Paracetamol 650 mg", packSize: 10 });
    expect(again.id).toBe(otc.id);
    expect(again).toMatchObject({ name: "Paracetamol 650 mg tabs", packSize: 10, manufacturer: null, rack: null });
    expect(await svc.getMedicine(B, PARA)).toBeNull();
    expect((await svc.medicinesFor(A, [PARA, TRAMA, GHOST])).map((m) => m.itemId).sort()).toEqual([PARA, TRAMA].sort());
    expect(await svc.medicinesFor(A, [])).toEqual([]);
    expect(await svc.medicinesFor(B, [PARA])).toEqual([]);

    const list = await svc.listMedicines(A, {});
    expect(list.total).toBe(3);
    expect(list.items.map((m) => m.name)).toEqual(["Crocin 650", "Paracetamol 650 mg tabs", "Tramadol 50"]);
    const rx = await svc.listMedicines(A, { schedule: "H,H1" });
    expect(rx.items.map((m) => m.name)).toEqual(["Crocin 650", "Tramadol 50"]);
    // Facets ignore the schedule filter so the tabs keep their counts.
    expect(rx.facets.schedule).toMatchObject({ otc: 1, H: 1, H1: 1 });
    expect((await svc.listMedicines(A, { q: "CROCIN" })).items).toHaveLength(1);
    expect((await svc.listMedicines(A, { q: "acme" })).items.map((m) => m.itemId)).toEqual([]);
    expect((await svc.listMedicines(B, {})).total).toBe(0);
  });

  it("suggests substitutes with the same composition (ignoring case) and only counts unexpired stock", async () => {
    await recv("CR-1", "2027-06", 30, {}, CROCIN);
    await recv("CR-OLD", "2026-09", 8, {}, CROCIN); // expired: not usable
    const sub = await svc.substitutes(A, PARA);
    expect(sub.composition).toBe("Paracetamol 650 mg");
    expect(sub.items).toEqual([expect.objectContaining({ itemId: CROCIN, name: "Crocin 650", schedule: "H", stock: 30 })]);
    // No composition on file, or an unknown medicine, means no suggestions.
    expect(await svc.substitutes(A, TRAMA)).toEqual({ composition: null, items: [] });
    expect(await svc.substitutes(A, GHOST)).toEqual({ composition: null, items: [] });
    expect((await svc.substitutes(B, PARA)).items).toEqual([]);
  });

  it("receives batches: expiry goes to month end, a known batch number adds to it, inventory follows", async () => {
    stockCalls.length = 0;
    const b1 = await recv("PB-1", "03/2027", 20, { mrp: 3000, purchaseRate: 2000, supplier: "Sri Distributors" });
    expect(b1).toMatchObject({ batchNo: "PB-1", expiry: "2027-03-31", qty: 20, mrp: 3000, purchaseRate: 2000, status: "ok", daysLeft: 146 });
    // 2026-12 is 56 days after 5 Nov: inside the default 90-day window.
    const b2 = await recv("PB-2", "2026-12", 10, { mrp: 3000, purchaseRate: 1200 });
    expect(b2).toMatchObject({ expiry: "2026-12-31", status: "expiring", daysLeft: 56 });
    const b3 = await recv("PB-3", "2026-10", 5, { mrp: 2500 });
    expect(b3).toMatchObject({ expiry: "2026-10-31", status: "expired", daysLeft: -5 });

    // Same batch number again: quantity adds, MRP only changes when one is given, expiry follows the new label.
    const more = await recv("PB-1", "2027-04", 5, { mrp: 3200 });
    expect(more).toMatchObject({ id: b1.id, qty: 25, mrp: 3200, purchaseRate: 2000, supplier: "Sri Distributors", expiry: "2027-04-30" });
    expect(stockCalls).toEqual([
      "add A 1 20 Batch PB-1 received",
      "add A 1 10 Batch PB-2 received",
      "add A 1 5 Batch PB-3 received",
      "add A 1 5 Batch PB-1 received",
    ]);
    // The same batch number in another shop is a different batch.
    const other = await recv("PB-1", "2027-01", 3, {}, PARA, B);
    expect(other.id).not.toBe(b1.id);

    expect(await code(recv("PB-X", "next year", 1))).toBe("zod");
    expect(await code(recv("PB-X", "2027-02-30", 1))).toBe("zod");
    expect(await code(recv("PB-X", "2027-02", 0))).toBe("zod");
    expect(await code(recv("", "2027-02", 1))).toBe("zod");
    expect(await code(recv("PB-X", "2027-02", 1, { mrp: -1 }))).toBe("zod");
    const mv = await svc.movements(A, b1.id);
    expect(mv.map((m) => [m.delta, m.qtyAfter, m.reason])).toEqual([[5, 25, "receive"], [20, 20, "receive"]]);
  });

  it("an inventory failure is logged and does not undo the received batch", async () => {
    stockFails = true;
    errors.length = 0;
    const b = await recv("PB-F", "2027-05", 4);
    expect(b.qty).toBe(4);
    expect(errors).toContain("medicines: inventory add failed");
    stockFails = false;
    await svc.adjust(A, b.id, { mode: "remove", qty: 4, reason: "damaged" });
  });

  it("lists batches soonest expiry first, with status filters and facets that ignore the status filter", async () => {
    const all = await svc.listBatches(A, { itemId: PARA });
    // PB-F was emptied above (its status here follows expiry only; "empty" is a filter); expiry order is 31 Oct 2026, 31 Dec 2026, 30 Apr 2027, 31 May 2027.
    expect(all.items.map((b) => [b.batchNo, b.status])).toEqual([["PB-3", "expired"], ["PB-2", "expiring"], ["PB-1", "ok"], ["PB-F", "ok"]]);
    expect(all.facets.status).toEqual({ in_stock: 2, expiring: 1, expired: 1, empty: 1 });

    const exp = await svc.listBatches(A, { status: "expired,expiring", itemId: PARA });
    expect(exp.items.map((b) => b.batchNo)).toEqual(["PB-3", "PB-2"]);
    expect(exp.total).toBe(2);
    expect(exp.facets.status.empty).toBe(1); // facets ignore the status filter
    // A wider window turns PB-1 (30 Apr 2027, 176 days) into "expiring".
    const wide = await svc.listBatches(A, { status: "expiring", within: "200", itemId: PARA });
    expect(wide.items.map((b) => b.batchNo)).toEqual(["PB-2", "PB-1"]);
    expect((await svc.listBatches(A, { status: "empty" })).items.map((b) => b.batchNo)).toEqual(["PB-F"]);
    expect((await svc.listBatches(A, { sort: "-qty", itemId: PARA })).items[0]!.batchNo).toBe("PB-1");
    expect((await svc.listBatches(A, { q: "sri distributors" })).items.map((b) => b.batchNo)).toEqual(["PB-1"]);
    expect(await code(svc.listBatches(A, { status: "lost" }))).toBe("zod");
    // Shop B has its own single batch.
    expect((await svc.listBatches(B, {})).items.map((b) => b.batchNo)).toEqual(["PB-1"]);
  });

  it("the counter's batch choice lists stock soonest-expiry-first and suggests first-expiry-first-out", async () => {
    const pick = await svc.pick(A, PARA, 12);
    expect(pick).toMatchObject({ itemId: PARA, tracked: true, rule: "fefo", expiredPolicy: "block", short: 0 });
    expect(pick.batches.map((b) => [b.batchNo, b.status, b.daysLeft, b.qty])).toEqual([
      ["PB-3", "expired", -5, 5],
      ["PB-2", "expiring", 56, 10],
      ["PB-1", "ok", 176, 25],
    ]);
    // 12 strips: all 10 of PB-2, then 2 of PB-1. The expired batch is never suggested.
    const names = new Map(pick.batches.map((b) => [b.batchId, b.batchNo]));
    expect(pick.suggestion.map((s) => [names.get(s.batchId), s.qty])).toEqual([["PB-2", 10], ["PB-1", 2]]);
    const big = await svc.pick(A, PARA, 100);
    expect(big.short).toBe(65); // 100 - (10 + 25)
    expect(await svc.pick(A, TRAMA)).toMatchObject({ tracked: false, batches: [], suggestion: [], short: 1 });
    expect((await svc.pick(B, PARA, 1)).batches).toHaveLength(1);
    expect(await svc.trackingFor(A, [PARA, TRAMA])).toEqual([{ itemId: PARA, tracked: true }, { itemId: TRAMA, tracked: false }]);
    expect(await svc.trackingFor(A, [])).toEqual([]);
  });

  it("corrects and writes off batch stock; removing more than is there is refused", async () => {
    stockCalls.length = 0;
    const [pb3] = (await svc.listBatches(A, { q: "PB-3" })).items;
    const [pb2] = (await svc.listBatches(A, { q: "PB-2" })).items;
    expect(await code(svc.adjust(A, pb2!.id, { mode: "remove", qty: 11, reason: "damaged" }))).toBe("400:bad_request");
    expect(await code(svc.adjust(A, pb2!.id, { mode: "remove", qty: 0 }))).toBe("zod");
    // Only stock corrections can add.
    expect(await code(svc.adjust(A, pb2!.id, { mode: "add", qty: 1, reason: "damaged" }))).toBe("zod");
    expect(await code(svc.adjust(B, pb2!.id, { mode: "remove", qty: 1 }))).toBe("404:not_found");
    expect(await code(svc.adjust(A, GHOST, { mode: "remove", qty: 1 }))).toBe("404:not_found");

    // Writing off the expired batch: 5 gone, inventory down by 5.
    const wo = await svc.adjust(A, pb3!.id, { mode: "remove", qty: 5, reason: "expired", note: "shelf clear" });
    expect(wo.qty).toBe(0);
    expect(stockCalls).toEqual(["remove A 1 5 Batch PB-3: expired (shelf clear)"]);
    // "set" counts the shelf: 10 became 9 is a -1; setting the same number does nothing.
    const counted = await svc.adjust(A, pb2!.id, { mode: "set", qty: 9 });
    expect(counted.qty).toBe(9);
    expect(stockCalls.at(-1)).toBe("remove A 1 1 Batch PB-2: adjust");
    const same = await svc.adjust(A, pb2!.id, { mode: "set", qty: 9 });
    expect(same.qty).toBe(9);
    expect(stockCalls).toHaveLength(2);
    const plus = await svc.adjust(A, pb2!.id, { mode: "add", qty: 1.5 });
    expect(plus.qty).toBe(10.5);
    expect(stockCalls.at(-1)).toBe("add A 1 1.5 Batch PB-2: adjust");
    await svc.adjust(A, pb2!.id, { mode: "set", qty: 10 });
    expect((await svc.movements(A, pb2!.id)).map((m) => [m.delta, m.qtyAfter, m.reason])).toEqual([[-0.5, 10, "adjust"], [1.5, 10.5, "adjust"], [-1, 9, "adjust"], [10, 10, "receive"]]);
    expect(await code(svc.movements(B, pb2!.id))).toBe("404:not_found");
  });

  it("edits a batch's expiry, MRP and rate; other shops can't", async () => {
    const [pb1] = (await svc.listBatches(A, { q: "PB-1" })).items;
    const u = await svc.updateBatch(A, pb1!.id, { expiry: "2027-05", mrp: 3300, supplier: "New Co" });
    expect(u).toMatchObject({ expiry: "2027-05-31", mrp: 3300, supplier: "New Co", purchaseRate: 2000 });
    expect((await svc.updateBatch(A, pb1!.id, { mrp: null })).mrp).toBeNull();
    expect(await code(svc.updateBatch(A, pb1!.id, { expiry: "garbage" }))).toBe("zod");
    expect(await code(svc.updateBatch(A, pb1!.id, { qty: 999 }))).toBe("zod");
    expect(await code(svc.updateBatch(B, pb1!.id, { mrp: 1 }))).toBe("404:not_found");
    expect(await code(svc.getBatch(B, pb1!.id))).toBe("404:not_found");
    await svc.updateBatch(A, pb1!.id, { expiry: "2027-04", mrp: 3200 });
  });

  it("an issued bill takes stock first-expiry-first-out, skips expired batches, and is not applied twice", async () => {
    const before = Object.fromEntries((await svc.listBatches(A, { itemId: PARA })).items.map((b) => [b.batchNo, b.qty]));
    expect(before).toMatchObject({ "PB-1": 25, "PB-2": 10, "PB-3": 0 });
    // Two lines of the same item: 8 + 4 = 12 strips. PB-2 gives 10, PB-1 gives 2.
    const b = bill(INV1, [{ itemId: PARA, qty: 8, description: "Paracetamol" }, { itemId: PARA, qty: 4, description: "Paracetamol" }, { itemId: GHOST, qty: 1, description: "Unbatched item" }]);
    await svc.onInvoiceIssued(A, b);
    await svc.onInvoiceIssued(A, b); // retried hook: no second deduction
    const after = Object.fromEntries((await svc.listBatches(A, { itemId: PARA })).items.map((x) => [x.batchNo, x.qty]));
    expect(after).toMatchObject({ "PB-1": 23, "PB-2": 0 });
    const alloc = await svc.allocations(A, INV1);
    expect(alloc.map((a) => [a.batchNo, a.qty])).toEqual([["PB-2", 10], ["PB-1", 2]]);
    expect(await svc.allocations(B, INV1)).toEqual([]);

    // Cancelling the bill puts back exactly that; cancelling again changes nothing.
    await svc.onInvoiceCancelled(A, INV1);
    await svc.onInvoiceCancelled(A, INV1);
    const back = Object.fromEntries((await svc.listBatches(A, { itemId: PARA })).items.map((x) => [x.batchNo, x.qty]));
    expect(back).toMatchObject({ "PB-1": 25, "PB-2": 10 });
    expect(await svc.allocations(A, INV1)).toEqual([]);
  });

  it("the pharmacist's chosen batch is taken first; a shortfall still lets the sale stand", async () => {
    warns.length = 0;
    const [pb1] = (await svc.listBatches(A, { q: "PB-1", itemId: PARA })).items;
    // 4 + 2 strips, the first line's 4 chosen from PB-1: PB-1 gives 4, the other 2 come from PB-2 (soonest expiry).
    await svc.onInvoiceIssued(A, bill(INV2, [{ itemId: PARA, qty: 4, description: "Paracetamol", batchId: pb1!.id }, { itemId: PARA, qty: 2, description: "Paracetamol" }]));
    expect((await svc.allocations(A, INV2)).map((a) => [a.batchNo, a.qty]).sort()).toEqual([["PB-1", 4], ["PB-2", 2]]);
    // After the bill is cancelled, a repeated "issued" hook doesn't take the stock again.
    await svc.onInvoiceCancelled(A, INV2);
    await svc.onInvoiceIssued(A, bill(INV2, [{ itemId: PARA, qty: 6, description: "Paracetamol" }]));
    expect(await svc.allocations(A, INV2)).toEqual([]);
    // A chosen batch that isn't this item's is ignored: plain first-expiry-first-out.
    await svc.onInvoiceIssued(A, bill(INV4, [{ itemId: PARA, qty: 1, description: "Paracetamol", batchId: GHOST }]));
    expect((await svc.allocations(A, INV4)).map((a) => [a.batchNo, a.qty])).toEqual([["PB-2", 1]]);
    await svc.onInvoiceCancelled(A, INV4);
    // Short: 100 strips wanted, 35 usable. All usable stock is taken and a warning is logged.
    await svc.onInvoiceIssued(A, bill(INV3, [{ itemId: PARA, qty: 100, description: "Paracetamol" }]));
    expect(warns).toContain("medicines: batches short for a sale");
    expect((await svc.allocations(A, INV3)).reduce((s, a) => s + a.qty, 0)).toBe(35);
    expect((await svc.pick(A, PARA, 1)).batches).toEqual([]);
    await svc.onInvoiceCancelled(A, INV3);
    expect((await svc.pick(A, PARA, 1)).batches.map((b) => b.batchNo)).toEqual(["PB-2", "PB-1"]);
  });

  it("the batch hooks do nothing when the shop has the medicines feature off, and never throw", async () => {
    gateOn = false;
    await svc.onInvoiceIssued(A, bill(INV5, [{ itemId: PARA, qty: 1, description: "Paracetamol" }]));
    expect(await svc.allocations(A, INV5)).toEqual([]);
    gateOn = true;
    // A bill with only unbatched items or zero quantities has nothing to do.
    await svc.onInvoiceIssued(A, bill(INV5, [{ itemId: null, qty: 2, description: "Misc" }, { itemId: PARA, qty: 0, description: "Zero" }]));
    expect(await svc.allocations(A, INV5)).toEqual([]);
    // A broken bill (bad ids) is logged, not thrown.
    errors.length = 0;
    await expect(svc.onInvoiceIssued(A, bill("not-a-uuid", [{ itemId: PARA, qty: 1, description: "x" }]))).resolves.toBeUndefined();
    expect(errors).toContain("medicines: batch allocation failed");
    errors.length = 0;
    await expect(svc.onInvoiceCancelled(A, "not-a-uuid")).resolves.toBeUndefined();
    expect(errors).toContain("medicines: batch reversal failed");
  });

  it("prescriptions: record, search by patient, filter by date and bill, edit, delete; other shops see none", async () => {
    const rx = await svc.createPrescription(A, { patientName: "  Lakshmi ", patientAge: 54, doctorName: "Dr. Rao", doctorRegNo: "TN-12345", invoiceId: INV1, invoiceNumber: "INV-0001", rxDate: "2026-11-01" }, null);
    expect(rx).toMatchObject({ patientName: "Lakshmi", patientAge: 54, doctorRegNo: "TN-12345", rxDate: "2026-11-01", patientPhone: null });
    // No date given: today in India.
    const today = await svc.createPrescription(A, { patientName: "Mohan", doctorName: "Dr. Iyer" });
    expect(today.rxDate).toBe("2026-11-05");
    expect(await code(svc.createPrescription(A, { patientName: "", doctorName: "Dr" }))).toBe("zod");
    expect(await code(svc.createPrescription(A, { patientName: "P", doctorName: "Dr", rxDate: "2026-02-30" }))).toBe("zod");
    expect(await code(svc.createPrescription(A, { patientName: "P", doctorName: "Dr", patientAge: 200 }))).toBe("zod");

    const list = await svc.listPrescriptions(A, {});
    expect(list.total).toBe(2);
    expect((await svc.listPrescriptions(A, { q: "lakshmi" })).items.map((p) => p.patientName)).toEqual(["Lakshmi"]);
    expect((await svc.listPrescriptions(A, { q: "dr. iyer" })).items.map((p) => p.patientName)).toEqual(["Mohan"]);
    expect((await svc.listPrescriptions(A, { from: "2026-11-02" })).items.map((p) => p.patientName)).toEqual(["Mohan"]);
    expect((await svc.listPrescriptions(A, { to: "2026-11-01" })).items.map((p) => p.patientName)).toEqual(["Lakshmi"]);
    expect((await svc.listPrescriptions(A, { invoiceId: INV1 })).items.map((p) => p.id)).toEqual([rx.id]);
    expect((await svc.listPrescriptions(A, { sort: "date" })).items.map((p) => p.patientName)).toEqual(["Lakshmi", "Mohan"]);
    expect(await code(svc.listPrescriptions(A, { from: "2026-11-05", to: "2026-11-01" }))).toBe("zod");
    expect((await svc.listPrescriptions(B, {})).total).toBe(0);

    expect((await svc.getPrescription(A, rx.id)).doctorName).toBe("Dr. Rao");
    expect(await code(svc.getPrescription(B, rx.id))).toBe("404:not_found");
    const edited = await svc.updatePrescription(A, rx.id, { patientPhone: "9876543210", doctorName: "Dr. Rao S" });
    expect(edited).toMatchObject({ patientPhone: "9876543210", doctorName: "Dr. Rao S", patientName: "Lakshmi" });
    expect(await code(svc.updatePrescription(B, rx.id, { note: "x" }))).toBe("404:not_found");
    expect(await code(svc.updatePrescription(A, rx.id, { patientName: "" }))).toBe("zod");
    expect(await code(svc.deletePrescription(B, rx.id))).toBe("404:not_found");
    await svc.deletePrescription(A, today.id);
    expect(await code(svc.getPrescription(A, today.id))).toBe("404:not_found");
  });

  it("expiry summary values stock at purchase rate, or MRP when there is no rate", async () => {
    // Fresh shop so the numbers are exact: expired 5 x MRP 2500 = 12,500; expiring 10 x rate 1200 = 12,000; ok batch not counted.
    const C = "33333333-3333-4333-8333-333333333333";
    await recv("S-OLD", "2026-10", 5, { mrp: 2500 }, PARA, C);
    await recv("S-SOON", "2026-12", 10, { mrp: 3000, purchaseRate: 1200 }, PARA, C);
    await recv("S-LATER", "2027-06", 7, { mrp: 3000, purchaseRate: 1000 }, PARA, C);
    expect(await svc.expirySummary(C)).toEqual({ within: 90, expired: { batches: 1, qty: 5, value: 12500 }, expiring: { batches: 1, qty: 10, value: 12000 } });
    // A 400-day window brings the later batch in as well: 7 x 1000.
    expect((await svc.expirySummary(C, 400)).expiring).toEqual({ batches: 2, qty: 17, value: 19000 });
    // A batch written down to zero is no longer counted.
    const [old] = (await svc.listBatches(C, { q: "S-OLD" })).items;
    await svc.adjust(C, old!.id, { mode: "remove", qty: 5, reason: "expired" });
    expect((await svc.expirySummary(C)).expired).toEqual({ batches: 0, qty: 0, value: 0 });
  });

  it("the H1 register lists sales of H1 / X / narcotic medicines with their prescription, and leaves out cancelled ones", async () => {
    const D = "44444444-4444-4444-8444-444444444444";
    const h1 = (n: string, q: number) => svc.receive(D, { itemId: TRAMA, itemName: "Tramadol 50", batchNo: n, expiry: "2027-08", qty: q });
    await svc.saveMedicine(D, TRAMA, { name: "Tramadol 50", schedule: "H1", composition: "Tramadol" });
    await svc.saveMedicine(D, PARA, { name: "Paracetamol", schedule: "otc" });
    await h1("T-1", 20);
    await recv("P-1", "2027-08", 20, {}, PARA, D);
    const S1 = "cccccccc-0000-4000-8000-000000000001";
    const S2 = "cccccccc-0000-4000-8000-000000000002";
    const S3 = "cccccccc-0000-4000-8000-000000000003";
    // S1: H1 with prescription; S2: H1 without one; S3: OTC only (never in the register); plus a cancelled H1 sale.
    await svc.onInvoiceIssued(D, bill(S1, [{ itemId: TRAMA, qty: 3, description: "Tramadol" }], "INV-S1"));
    await svc.onInvoiceIssued(D, bill(S2, [{ itemId: TRAMA, qty: 2, description: "Tramadol" }], "INV-S2"));
    await svc.onInvoiceIssued(D, bill(S3, [{ itemId: PARA, qty: 5, description: "Paracetamol" }], "INV-S3"));
    const S4 = "cccccccc-0000-4000-8000-000000000004";
    await svc.onInvoiceIssued(D, bill(S4, [{ itemId: TRAMA, qty: 1, description: "Tramadol" }], "INV-S4"));
    await svc.onInvoiceCancelled(D, S4);
    await svc.createPrescription(D, { invoiceId: S1, patientName: "Anand", patientAge: 40, doctorName: "Dr. Menon", doctorRegNo: "KMC-9" });

    const reg = await svc.register(D, {});
    expect(reg.total).toBe(2);
    const bySale = new Map(reg.items.map((e) => [e.invoiceNumber, e]));
    expect([...bySale.keys()].sort()).toEqual(["INV-S1", "INV-S2"]);
    expect(bySale.get("INV-S1")).toMatchObject({ itemName: "Tramadol 50", schedule: "H1", batchNo: "T-1", expiry: "2027-08-31", qty: 3, composition: "Tramadol" });
    expect(bySale.get("INV-S1")!.prescription).toMatchObject({ patientName: "Anand", patientAge: 40, doctorName: "Dr. Menon", doctorRegNo: "KMC-9" });
    expect(bySale.get("INV-S2")!.prescription).toBeNull();

    const missing = await svc.register(D, { missingRx: "true" });
    expect(missing.items.map((e) => e.invoiceNumber)).toEqual(["INV-S2"]);
    expect((await svc.register(D, { q: "inv-s1" })).items.map((e) => e.invoiceNumber)).toEqual(["INV-S1"]);
    expect((await svc.register(D, { from: "2000-01-01", to: "2100-01-01" })).total).toBe(2);
    expect((await svc.register(D, { from: "2100-01-01" })).total).toBe(0);
    expect((await svc.register(D, { to: "2000-01-01" })).total).toBe(0);
    expect((await svc.register(D, { limit: "1" })).items).toHaveLength(1);
    expect(await code(svc.register(D, { from: "2026-12-01", to: "2026-11-01" }))).toBe("zod");
    // Another shop's register is empty.
    expect((await svc.register(A, {})).total).toBe(0);
  });

  describe("routes", () => {
    let app: FastifyInstance;
    let ctx: RequestContext;
    const staff = (roles: string[], tid = A) => ({ ...emptyContext(), tenant: { id: tid, slug: "t", planId: "pro", appId: "BL" }, user: { id: "22222222-2222-4222-8222-222222222222", sessionId: "s", platformRoles: [], tenantRoles: roles } }) as RequestContext;
    beforeAll(async () => {
      app = Fastify();
      app.decorateRequest("ctx", null as never);
      app.addHook("onRequest", async (req) => {
        req.ctx = ctx;
      });
      app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
        reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
      });
      await app.register(medicinesRoutes(svc), { prefix: "/v1/medicines" });
    });
    afterAll(() => app?.close());

    it("serves the counter's batch choice and medicine details, and refuses non-staff", async () => {
      ctx = staff(["staff"]);
      const pick = (await app.inject({ method: "GET", url: `/v1/medicines/batches/pick?itemId=${PARA}&qty=3` })).json();
      expect(pick).toMatchObject({ itemId: PARA, tracked: true, short: 0 });
      expect(pick.suggestion).toEqual([{ batchId: pick.batches[0].batchId, qty: 3 }]);
      expect((await app.inject({ method: "GET", url: `/v1/medicines/batches/pick?itemId=nope` })).statusCode).toBe(400);
      const tracking = (await app.inject({ method: "GET", url: `/v1/medicines/batches/tracking?ids=${PARA},${TRAMA}` })).json();
      expect(tracking.items).toEqual([{ itemId: PARA, tracked: true }, { itemId: TRAMA, tracked: false }]);
      expect((await app.inject({ method: "GET", url: `/v1/medicines/items?ids=${PARA}` })).json().items[0]).toMatchObject({ itemId: PARA, prescriptionRequired: false });
      expect((await app.inject({ method: "GET", url: `/v1/medicines/items/${GHOST}` })).json()).toEqual({ itemId: GHOST, details: null });
      expect((await app.inject({ method: "GET", url: "/v1/medicines/items" })).json().total).toBe(3);
      expect((await app.inject({ method: "PUT", url: `/v1/medicines/items/${GHOST}`, payload: { name: "Cetirizine", schedule: "G" } })).json()).toMatchObject({ schedule: "G", prescriptionRequired: false });
      expect((await app.inject({ method: "GET", url: `/v1/medicines/items/${PARA}/substitutes` })).json().items[0].itemId).toBe(CROCIN);
      expect((await app.inject({ method: "GET", url: "/v1/medicines/reports/expiry?within=30" })).json().within).toBe(30);
      expect((await app.inject({ method: "GET", url: "/v1/medicines/reports/expiry?within=0" })).statusCode).toBe(400);

      // Receive, adjust, movements and bill allocations over HTTP.
      const rec = (await app.inject({ method: "POST", url: "/v1/medicines/batches", payload: { itemId: TRAMA, itemName: "Tramadol 50", batchNo: "R-1", expiry: "2027-09", qty: 6 } })).json();
      expect(rec).toMatchObject({ qty: 6, expiry: "2027-09-30" });
      const adj = (await app.inject({ method: "POST", url: `/v1/medicines/batches/${rec.id}/adjust`, payload: { mode: "remove", qty: 1, reason: "damaged" } })).json();
      expect(adj.qty).toBe(5);
      expect((await app.inject({ method: "GET", url: `/v1/medicines/batches/${rec.id}/movements` })).json().items).toHaveLength(2);
      expect((await app.inject({ method: "PATCH", url: `/v1/medicines/batches/${rec.id}`, payload: { mrp: 900 } })).json().mrp).toBe(900);
      expect((await app.inject({ method: "GET", url: `/v1/medicines/batches/${rec.id}` })).json().batchNo).toBe("R-1");
      expect((await app.inject({ method: "GET", url: `/v1/medicines/sales/${INV1}/allocations` })).json()).toEqual({ items: [] });
      expect((await app.inject({ method: "GET", url: "/v1/medicines/batches?status=in_stock&q=tramadol" })).json().total).toBe(1);

      const rx = (await app.inject({ method: "POST", url: "/v1/medicines/prescriptions", payload: { patientName: "Geeta", doctorName: "Dr. Pillai" } })).json();
      expect(rx.createdBy).toBe("22222222-2222-4222-8222-222222222222");
      expect((await app.inject({ method: "GET", url: `/v1/medicines/prescriptions/${rx.id}` })).json().patientName).toBe("Geeta");
      expect((await app.inject({ method: "PATCH", url: `/v1/medicines/prescriptions/${rx.id}`, payload: { patientAge: 33 } })).json().patientAge).toBe(33);
      expect((await app.inject({ method: "GET", url: "/v1/medicines/prescriptions?q=geeta" })).json().total).toBe(1);
      expect((await app.inject({ method: "GET", url: "/v1/medicines/reports/register" })).json().total).toBe(0);
      expect((await app.inject({ method: "DELETE", url: `/v1/medicines/prescriptions/${rx.id}` })).json()).toEqual({ ok: true });

      // Another shop's staff can't read this shop's batch; a customer can't read anything.
      ctx = staff(["staff"], B);
      expect((await app.inject({ method: "GET", url: `/v1/medicines/batches/${rec.id}` })).statusCode).toBe(404);
      ctx = staff(["customer"]);
      expect((await app.inject({ method: "GET", url: "/v1/medicines/batches" })).statusCode).toBe(403);
    });
  });
});
