/**
 * Database test of the restaurant service: tables and areas, running orders with their numbering, kitchen tickets per
 * station, splitting and billing (through a fake billing port), the kitchen display, QR ordering, online / delivery-
 * platform orders, recipes, and that one shop never sees another's data. Runs only with `DINING_TEST_DATABASE_URL`
 * set (a development Postgres with the dining tables migrated); it copies them into a throw-away schema and drops it
 * afterwards. Menu items come from a fake menu source. The clock is fixed: 2026-11-05 15:30 in India.
 *   PowerShell: $env:DINING_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { AppError, emptyContext, type RequestContext, type TenantRef } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import type { BillingPort, BillResult, MenuSourcePort } from "./ports";
import { RecipeService } from "./recipes";
import { diningRoutes } from "./routes";
import { DiningService } from "./service";

const URL_ = process.env.DINING_TEST_DATABASE_URL;
const SCHEMA = `dining_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["dining_areas", "dining_tables", "dining_menu_items", "dining_orders", "dining_order_items", "dining_kots", "dining_ingredients", "dining_recipes", "dining_recipe_lines"];
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const tenantA: TenantRef = { id: A, slug: "a", planId: "pro", appId: "BL" };
const PANEER = "aaaaaaaa-0000-4000-8000-000000000001"; // 180.00, station kitchen
const LASSI = "aaaaaaaa-0000-4000-8000-000000000002"; // 60.00, station bar
const NAAN = "aaaaaaaa-0000-4000-8000-000000000003"; // 45.00, kitchen
const MENU = [
  { id: PANEER, name: "Paneer Butter Masala", rate: 18000, gstRate: 5, hsn: "9963", unit: "pcs" },
  { id: LASSI, name: "Sweet Lassi", rate: 6000, gstRate: 5, hsn: "9963", unit: "pcs" },
  { id: NAAN, name: "Butter Naan", rate: 4500, gstRate: 5, hsn: "9963", unit: "pcs" },
];
const GHOST = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const byName = <T extends { name: string }>(rows: T[]) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AppError ? `${e.status}:${e.code}` : e instanceof ZodError ? "zod" : String(e);
  }
  return "ok";
};

describe.skipIf(!URL_)("dining service against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: DiningService;
  let recipes: RecipeService;
  let clock = new Date("2026-11-05T10:00:00Z");
  const bills: { lines: { description: string; qty: number; rate: number }[]; notes: string | null; customer: unknown }[] = [];
  let failBillAt: number | null = null;
  const events: string[] = [];

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    const menu: MenuSourcePort = {
      items: async (_t, ids) => MENU.filter((m) => ids.includes(m.id)),
      list: async () => MENU.map((m) => ({ id: m.id, name: m.name, rate: m.rate, gstRate: m.gstRate, categoryId: null, image: null })),
    };
    const billing: BillingPort = {
      createBill: async (_t, input) => {
        if (failBillAt === bills.length) throw new Error("invoices down");
        bills.push({ lines: input.lines, notes: input.notes, customer: input.customer });
        return { id: `00000000-0000-4000-8000-00000000000${bills.length}`, number: `INV-${bills.length}`, total: 0 } satisfies BillResult;
      },
    };
    svc = new DiningService({ db, menu, billing, now: () => clock, events: { changed: (_t, e) => void events.push(e.kind) } });
    recipes = new RecipeService(db);
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  const table = (name: string, t = A) => svc.createTable(t, { name });

  it("areas and tables: unique names per shop, unknown area refused, QR rotation, other shops see nothing", async () => {
    const ground = await svc.createArea(A, { name: "Ground floor", sort: 1 });
    expect(await code(svc.createArea(A, { name: "Ground floor" }))).toBe("409:conflict");
    // The same name in another shop is fine.
    await svc.createArea(B, { name: "Ground floor" });
    expect(await code(svc.createArea(A, { name: "  " }))).toBe("zod");

    const t1 = await svc.createTable(A, { name: "T1", areaId: ground.id, seats: 6 });
    expect(t1).toMatchObject({ name: "T1", seats: 6, areaId: ground.id, active: true });
    expect(await code(svc.createTable(A, { name: "T1" }))).toBe("409:conflict");
    expect(await code(svc.createTable(A, { name: "T9", areaId: GHOST }))).toBe("400:bad_request");
    // Shop B can't use shop A's area, rename A's area or touch A's table.
    expect(await code(svc.createTable(B, { name: "X", areaId: ground.id }))).toBe("400:bad_request");
    expect(await code(svc.updateArea(B, ground.id, { name: "Hijack" }))).toBe("404:not_found");
    expect(await code(svc.updateTable(B, t1.id, { seats: 1 }))).toBe("404:not_found");
    expect(await code(svc.deleteTable(B, t1.id))).toBe("404:not_found");
    expect((await svc.tables(B)).map((t) => t.name)).toEqual([]);

    expect((await svc.updateArea(A, ground.id, { name: "Hall" })).name).toBe("Hall");
    expect(await code(svc.updateArea(A, GHOST, { name: "Z" }))).toBe("404:not_found");
    await svc.createArea(A, { name: "Terrace" });
    expect(await code(svc.updateArea(A, ground.id, { name: "Terrace" }))).toBe("409:conflict");

    const off = await svc.updateTable(A, t1.id, { active: false });
    expect(off.active).toBe(false);
    expect((await svc.tables(A)).length).toBe(0);
    expect((await svc.tables(A, { includeInactive: true })).length).toBe(1);
    await svc.updateTable(A, t1.id, { active: true });
    const t2 = await table("T2");
    expect(await code(svc.updateTable(A, t2.id, { name: "T1" }))).toBe("409:conflict");

    // A rotated QR code kills the printed one.
    const old = t1.qrToken;
    const rotated = await svc.rotateQr(A, t1.id);
    expect(rotated.qrToken).not.toBe(old);
    expect(await svc.tableByToken(old)).toBeNull();
    expect((await svc.tableByToken(rotated.qrToken))?.id).toBe(t1.id);
    expect(await svc.tableByToken("short")).toBeNull();
    expect(await svc.tableByToken("not valid token!!")).toBeNull();

    // Deleting an area keeps its tables, now without an area.
    await svc.deleteArea(A, ground.id);
    expect((await svc.tables(A, { includeInactive: true })).find((t) => t.id === t1.id)?.areaId).toBeNull();
    expect(await code(svc.deleteArea(A, ground.id))).toBe("404:not_found");
    expect((await svc.areas(B)).map((a) => a.name)).toEqual(["Ground floor"]);
  });

  it("a table with an open order can't be deleted or switched on to a second order", async () => {
    const t = await table("Busy1");
    const o = await svc.open(A, { tableId: t.id, guests: 2 }, null);
    expect(await code(svc.deleteTable(A, t.id))).toBe("409:conflict");
    const again = await svc.open(A, { tableId: t.id }, null).catch((e) => e);
    expect(again).toMatchObject({ status: 409, code: "table_busy", details: { orderId: o.id } });
    await svc.cancel(A, o.id, { reason: "walked out" });
    await svc.deleteTable(A, t.id);
    expect((await svc.tables(A)).some((x) => x.id === t.id)).toBe(false);
  });

  it("opens orders: dine-in needs a table, numbers restart each day, items are priced from the menu", async () => {
    expect(await code(svc.open(A, { type: "dine_in" }, null))).toBe("zod");
    const t = await table("Num1");
    const off = await table("Off1");
    await svc.updateTable(A, off.id, { active: false });
    expect(await code(svc.open(A, { tableId: off.id }, null))).toBe("400:bad_request");
    expect(await code(svc.open(A, { tableId: GHOST }, null))).toBe("404:not_found");
    expect(await code(svc.open(B, { tableId: t.id }, null))).toBe("404:not_found");

    // 2 x 180.00 + 1 x 60.00 = 420.00; an item the menu doesn't know is refused.
    const o1 = await svc.open(A, { tableId: t.id, items: [{ itemId: PANEER, qty: 2, note: "less spicy" }, { itemId: LASSI, qty: 1 }] }, null);
    expect(o1.amount).toBe(42000);
    expect(o1.pendingCount).toBe(2);
    expect(o1.tableName).toBe("Num1");
    // (Lines added in one go share a timestamp, so compare them by name.)
    expect(byName(o1.items).map((i) => [i.name, i.rate, i.amount, i.station])).toEqual([
      ["Paneer Butter Masala", 18000, 36000, "kitchen"],
      ["Sweet Lassi", 6000, 6000, "kitchen"],
    ]);
    expect(await code(svc.open(A, { type: "takeaway", items: [{ itemId: GHOST, qty: 1 }] }, null))).toBe("400:bad_request");
    // A free-text line needs a name and a rate.
    expect(await code(svc.open(A, { type: "takeaway", items: [{ qty: 1 }] }, null))).toBe("zod");
    const free = await svc.open(A, { type: "takeaway", items: [{ name: "Water bottle", rate: 2000, qty: 3 }] }, null);
    expect(free.amount).toBe(6000);
    expect(free.items[0]).toMatchObject({ itemId: null, gstRate: 5 });
    expect(free.number).toBe(o1.number + 1);

    // Tomorrow's first order is number 1 again.
    clock = new Date("2026-11-06T10:00:00Z");
    const next = await svc.open(A, { type: "takeaway" }, null);
    expect(next.number).toBe(1);
    expect(next.businessDate).toBe("2026-11-06");
    clock = new Date("2026-11-05T10:00:00Z");
    // 00:30 IST on the 6th is still 18:30 UTC on the 5th: the business date follows India.
    clock = new Date("2026-11-05T19:00:00Z");
    expect((await svc.open(A, { type: "takeaway" }, null)).businessDate).toBe("2026-11-06");
    clock = new Date("2026-11-05T10:00:00Z");
  });

  it("sold-out items are refused at the counter but a delivery platform's accepted order still goes through", async () => {
    await svc.saveMenuItem(A, NAAN, { available: false });
    expect(await code(svc.open(A, { type: "takeaway", items: [{ itemId: NAAN, qty: 1 }] }, null))).toBe("409:sold_out");
    const ext = await svc.openExternal(A, {
      ref: "agg:soldout-1", type: "delivery", platform: "zomato", customerName: null, customerPhone: null, note: null, dueAt: null, taxByOperator: false, send: false,
      lines: [{ itemId: NAAN, name: "Butter Naan", qty: 2, rate: 4500, note: null }],
    });
    expect(ext.amount).toBe(9000);
    expect((await svc.soldOutItems(A, [NAAN, PANEER])).has(NAAN)).toBe(true);
    expect([...(await svc.soldOutItems(B, [NAAN]))]).toEqual([]);
    expect((await svc.soldOutItems(A, [])).size).toBe(0);
    // The QR menu shows it as unavailable.
    const menu = await svc.publicMenu(A);
    expect(menu.find((m) => m.id === NAAN)?.available).toBe(false);
    expect(menu.find((m) => m.id === PANEER)).toMatchObject({ available: true, veg: null });
    await svc.saveMenuItem(A, NAAN, { available: true, veg: true });
    expect((await svc.publicMenu(A)).find((m) => m.id === NAAN)).toMatchObject({ available: true, veg: true });
  });

  it("menu settings: stations list starts with kitchen, upsert keeps earlier fields, filters by ids and shop", async () => {
    expect((await svc.stations(B))).toEqual(["kitchen"]);
    await svc.saveMenuItem(A, LASSI, { station: "bar", veg: true });
    await svc.saveMenuItem(A, PANEER, { station: "tandoor" });
    expect(await svc.stations(A)).toEqual(["kitchen", "bar", "tandoor"]);
    // A second save with only `veg` must not reset the station.
    const lassi = await svc.saveMenuItem(A, LASSI, { veg: false });
    expect(lassi).toMatchObject({ station: "bar", veg: false, available: true });
    expect(await code(svc.saveMenuItem(A, LASSI, { station: "" }))).toBe("zod");
    expect((await svc.menuItems(A, [LASSI])).map((m) => m.itemId)).toEqual([LASSI]);
    expect(await svc.menuItems(A, [])).toEqual([]);
    expect(await svc.menuItems(B)).toEqual([]);
    // Put the paneer back on the main kitchen for later tests.
    await svc.saveMenuItem(A, PANEER, { station: "kitchen" });
  });

  it("sends one kitchen ticket per station and numbers them within the day", async () => {
    const t = await table("Kot1");
    const o = await svc.open(A, { tableId: t.id, items: [{ itemId: PANEER, qty: 1 }, { itemId: LASSI, qty: 2 }, { itemId: NAAN, qty: 3 }] }, null);
    const { kots, order } = await svc.sendKot(A, o.id);
    expect(kots.map((k) => k.station).sort()).toEqual(["bar", "kitchen"]);
    const kitchen = kots.find((k) => k.station === "kitchen")!;
    const bar = kots.find((k) => k.station === "bar")!;
    expect([bar.number, kitchen.number].sort()).toEqual([Math.min(bar.number, kitchen.number), Math.min(bar.number, kitchen.number) + 1]);
    expect(order.items.every((i) => i.status === "sent" && i.kotId)).toBe(true);
    expect(byName(order.items.filter((i) => i.kotId === kitchen.id)).map((i) => i.name)).toEqual(["Butter Naan", "Paneer Butter Masala"]);
    // Nothing left to send.
    expect((await svc.sendKot(A, o.id)).kots).toEqual([]);
    expect(await code(svc.sendKot(B, o.id))).toBe("404:not_found");
    expect(events).toContain("kot");
    await svc.cancel(A, o.id, { reason: "test over" });
  });

  it("edits lines: pending ones change freely, sent ones need a reason and void their ticket", async () => {
    const t = await table("Line1");
    const o = await svc.open(A, { tableId: t.id, items: [{ itemId: PANEER, qty: 1 }] }, null);
    const [line] = o.items;
    const upd = await svc.updateLine(A, o.id, line!.id, { qty: 2.5, note: "extra gravy" });
    expect(upd.items[0]).toMatchObject({ qty: 2.5, note: "extra gravy", amount: 45000 });
    expect(upd.amount).toBe(45000);
    expect(await code(svc.updateLine(A, o.id, line!.id, { qty: 0 }))).toBe("zod");
    expect(await code(svc.updateLine(A, o.id, GHOST, { qty: 1 }))).toBe("404:not_found");
    expect(await code(svc.updateLine(B, o.id, line!.id, { qty: 1 }))).toBe("404:not_found");

    // Pending line removal deletes it.
    const added = await svc.addItems(A, o.id, [{ itemId: NAAN, qty: 1 }]);
    const naan = added.items.find((i) => i.name === "Butter Naan")!;
    expect((await svc.removeLine(A, o.id, naan.id)).items.map((i) => i.name)).toEqual(["Paneer Butter Masala"]);

    await svc.sendKot(A, o.id);
    expect(await code(svc.updateLine(A, o.id, line!.id, { qty: 1 }))).toBe("409:line_sent");
    expect(await code(svc.removeLine(A, o.id, line!.id))).toBe("409:line_sent");
    expect(await code(svc.removeLine(A, o.id, line!.id, {}, { allowSent: true }))).toBe("zod");
    expect(await code(svc.removeLine(A, o.id, line!.id, { reason: "x" }, { allowSent: true }))).toBe("zod");

    // A second ticket's line is voided but the ticket stays alive until all its lines are gone.
    const more = await svc.addItems(A, o.id, [{ itemId: NAAN, qty: 1 }, { itemId: NAAN, qty: 2 }], { sendKot: true });
    const naans = more.items.filter((i) => i.name === "Butter Naan");
    const n1 = naans.find((i) => i.qty === 1)!;
    const n2 = naans.find((i) => i.qty === 2)!;
    const kotId = n1.kotId!;
    let v = await svc.removeLine(A, o.id, n1.id, { reason: "guest changed mind" }, { allowSent: true });
    expect(v.kots.find((k) => k.id === kotId)).toMatchObject({ hasVoids: true, status: "new" });
    expect(v.items.find((i) => i.id === n1.id)).toMatchObject({ status: "cancelled", cancelReason: "guest changed mind", amount: 0 });
    // Cancelling again does nothing; the order total leaves the voided line out: 2.5 x 180 = 450, plus the 2 naans at 45 = 90.
    v = await svc.removeLine(A, o.id, n1.id, { reason: "again" }, { allowSent: true });
    expect(v.amount).toBe(45000 + 9000);
    v = await svc.removeLine(A, o.id, n2.id, { reason: "gone" }, { allowSent: true });
    expect(v.kots.find((k) => k.id === kotId)?.status).toBe("cancelled");
    await svc.cancel(A, o.id, { reason: "done" });
  });

  it("merging joined tables moves lines and guests onto one order and cancels the other", async () => {
    const [ta, tb] = [await table("Mrg1"), await table("Mrg2")];
    const a = await svc.open(A, { tableId: ta.id, guests: 3, items: [{ itemId: PANEER, qty: 1 }] }, null);
    const b = await svc.open(A, { tableId: tb.id, guests: 2, items: [{ itemId: LASSI, qty: 2 }] }, null);
    expect(await code(svc.merge(A, a.id, a.id))).toBe("400:bad_request");
    expect(await code(svc.merge(B, a.id, b.id))).toBe("404:not_found");
    const merged = await svc.merge(A, a.id, b.id);
    expect(merged.guests).toBe(5);
    expect(merged.amount).toBe(18000 + 12000);
    const src = await svc.get(A, b.id);
    expect(src).toMatchObject({ status: "cancelled", note: `Merged into #${a.number}`, items: [] });
    // The freed table can take a new order; the closed source can't be merged again.
    expect(await code(svc.merge(A, a.id, b.id))).toBe("409:order_closed");
    await svc.open(A, { tableId: tb.id }, null);
    await svc.cancel(A, a.id, { reason: "no" });
  });

  it("moves an order to another table only when that table is free", async () => {
    const [t1, t2, t3] = [await table("Mv1"), await table("Mv2"), await table("Mv3")];
    const o = await svc.open(A, { tableId: t1.id, guests: 2 }, null);
    const other = await svc.open(A, { tableId: t2.id }, null);
    expect(await code(svc.update(A, o.id, { tableId: t2.id }))).toBe("409:table_busy");
    const moved = await svc.update(A, o.id, { tableId: t3.id, guests: 4, note: "birthday", customerName: "Meena" });
    expect(moved).toMatchObject({ tableId: t3.id, guests: 4, note: "birthday", customerName: "Meena", tableName: "Mv3" });
    // Clearing the table of a dine-in order is ignored.
    expect((await svc.update(A, o.id, { tableId: null })).tableId).toBe(t3.id);
    expect(await code(svc.update(B, o.id, { note: "x" }))).toBe("404:not_found");
    await svc.cancel(A, other.id, { reason: "no" });
    await svc.cancel(A, o.id, { reason: "no" });
    expect(await code(svc.update(A, o.id, { note: "late" }))).toBe("409:order_closed");
    expect(await code(svc.addItems(A, o.id, [{ itemId: NAAN, qty: 1 }]))).toBe("409:order_closed");
  });

  it("cancelling an order cancels its lines and live tickets and keeps the reason", async () => {
    const t = await table("Can1");
    const o = await svc.open(A, { tableId: t.id, note: "window seat", items: [{ itemId: PANEER, qty: 1 }, { itemId: LASSI, qty: 1 }] }, null);
    await svc.sendKot(A, o.id);
    expect(await code(svc.cancel(A, o.id, { reason: "x" }))).toBe("zod");
    const c = await svc.cancel(A, o.id, { reason: "Guests left" });
    expect(c.status).toBe("cancelled");
    expect(c.note).toBe("window seat · Guests left");
    expect(c.amount).toBe(0);
    expect(c.items.every((i) => i.status === "cancelled" && i.cancelReason === "Guests left")).toBe(true);
    expect(c.kots.every((k) => k.status === "cancelled" && k.hasVoids)).toBe(true);
    expect(c.closedAt).not.toBeNull();
    expect(await code(svc.cancel(A, o.id, { reason: "again" }))).toBe("409:order_closed");
    expect(await code(svc.cancel(B, o.id, { reason: "peek" }))).toBe("404:not_found");
  });

  it("bills a whole order: unsent lines go to the kitchen, same items merge, the table is freed", async () => {
    bills.length = 0;
    const t = await table("Bill1");
    const o = await svc.open(A, { tableId: t.id, customerName: "Ravi", customerPhone: "9876543210", items: [{ itemId: PANEER, qty: 1, note: "no onion" }, { itemId: NAAN, qty: 2 }] }, null);
    await svc.addItems(A, o.id, [{ itemId: NAAN, qty: 1 }, { itemId: PANEER, qty: 1, note: "no onion" }, { itemId: PANEER, qty: 1 }]);
    const r = await svc.bill(tenantA, o.id, {});
    expect(r.bills).toHaveLength(1);
    expect(bills).toHaveLength(1);
    // Paneer "no onion" 1+1, plain paneer 1, naan 2+1: three bill lines.
    expect([...bills[0]!.lines].sort((a, b) => a.description.localeCompare(b.description))).toEqual([
      { description: "Butter Naan", itemId: NAAN, qty: 3, rate: 4500, gstRate: 5, hsn: "9963", unit: "pcs" },
      { description: "Paneer Butter Masala", itemId: PANEER, qty: 1, rate: 18000, gstRate: 5, hsn: "9963", unit: "pcs" },
      { description: "Paneer Butter Masala (no onion)", itemId: PANEER, qty: 2, rate: 18000, gstRate: 5, hsn: "9963", unit: "pcs" },
    ]);
    expect(bills[0]!.notes).toBe(`Order #${o.number} · Table Bill1`);
    // The order's saved customer is used when none is given.
    expect(bills[0]!.customer).toEqual({ name: "Ravi", phone: "9876543210" });
    expect(r.order.status).toBe("billed");
    expect(r.order.invoiceIds).toEqual([r.bills[0]!.id]);
    expect(r.order.items.every((i) => i.status === "sent")).toBe(true);
    expect(r.order.kots.length).toBeGreaterThan(0);
    expect(await code(svc.bill(tenantA, o.id, {}))).toBe("409:order_closed");
    // The table is free again.
    await svc.open(A, { tableId: t.id }, null);
  });

  it("splits a bill by lines; lines not listed go on a last bill; bad splits are refused", async () => {
    bills.length = 0;
    const t = await table("Split1");
    const o = await svc.open(A, { tableId: t.id, items: [{ itemId: PANEER, qty: 1 }, { itemId: LASSI, qty: 1 }, { itemId: NAAN, qty: 2 }] }, null);
    const [lassi, naan, paneer] = [o.items.find((i) => i.name === "Sweet Lassi")!, o.items.find((i) => i.name === "Butter Naan")!, o.items.find((i) => i.name === "Paneer Butter Masala")!];
    expect(await code(svc.bill(tenantA, o.id, { splits: [[paneer!.id], [GHOST]] }))).toBe("400:bad_request");
    expect(await code(svc.bill(tenantA, o.id, { splits: [[paneer!.id], [paneer!.id]] }))).toBe("400:bad_request");
    // Refused splits must leave the order open and untouched.
    expect((await svc.get(A, o.id)).status).toBe("open");
    const r = await svc.bill(tenantA, o.id, { splits: [[naan!.id], [], [paneer!.id]], customer: { name: "Office" } });
    expect(r.bills).toHaveLength(3);
    expect(bills.map((b) => b.lines.map((l) => l.description))).toEqual([["Butter Naan"], ["Paneer Butter Masala"], ["Sweet Lassi"]]);
    expect(bills.map((b) => b.lines.reduce((s, l) => s + l.qty * l.rate, 0))).toEqual([9000, 18000, 6000]);
    expect(bills[0]!.customer).toMatchObject({ name: "Office" });
    expect(r.order.invoiceIds).toHaveLength(3);
    void lassi;
  });

  it("refuses to bill an empty order, a platform-taxed order, or when billing is not wired", async () => {
    const empty = await svc.open(A, { type: "takeaway" }, null);
    expect(await code(svc.bill(tenantA, empty.id, {}))).toBe("400:bad_request");
    const cancelledLines = await svc.open(A, { type: "takeaway", items: [{ itemId: PANEER, qty: 1 }] }, null);
    await svc.removeLine(A, cancelledLines.id, cancelledLines.items[0]!.id);
    expect(await code(svc.bill(tenantA, cancelledLines.id, {}))).toBe("400:bad_request");
    expect(await code(svc.bill({ ...tenantA, id: B }, empty.id, {}))).toBe("404:not_found");

    const swiggy = await svc.openExternal(A, {
      ref: "agg:tax-1", type: "delivery", platform: "swiggy", customerName: "Anu", customerPhone: null, note: null, dueAt: null, taxByOperator: true, send: false,
      lines: [{ itemId: null, name: "Thali", qty: 1, rate: 15000, note: null }],
    });
    expect(await code(svc.bill(tenantA, swiggy.id, {}))).toBe("409:tax_by_operator");
    // Settling it closes it with no bill, and unsent lines reach the kitchen first.
    const settled = await svc.settleWithoutBill(A, swiggy.id);
    expect(settled.status).toBe("billed");
    expect(settled.invoiceIds).toEqual([]);
    expect(settled.kots).toHaveLength(1);
    expect((await svc.settleWithoutBill(A, swiggy.id)).kots).toHaveLength(1);

    const bare = new DiningService({ db, now: () => clock });
    expect(await code(bare.bill(tenantA, empty.id, {}))).toBe("501:billing_unavailable");
  });

  it("when billing fails the order reopens, or keeps the bills already made", async () => {
    bills.length = 0;
    const t = await table("Fail1");
    const o = await svc.open(A, { tableId: t.id, items: [{ itemId: PANEER, qty: 1 }, { itemId: LASSI, qty: 1 }] }, null);
    const [p, l] = o.items;
    failBillAt = 0;
    expect(await code(svc.bill(tenantA, o.id, { splits: [[p!.id], [l!.id]] }))).toContain("invoices down");
    expect(await svc.get(A, o.id)).toMatchObject({ status: "open", invoiceIds: [], closedAt: null });
    // Second of two bills fails: the first stays recorded so staff only retry the rest.
    failBillAt = 1;
    bills.length = 0;
    expect(await code(svc.bill(tenantA, o.id, { splits: [[p!.id], [l!.id]] }))).toContain("invoices down");
    const after = await svc.get(A, o.id);
    expect(after.status).toBe("billed");
    expect(after.invoiceIds).toHaveLength(1);
    failBillAt = null;
  });

  it("the kitchen display shows live tickets, filters by station and walks a ticket through its steps", async () => {
    const t = await table("Kd1");
    const o = await svc.open(A, { tableId: t.id, guests: 2, note: "allergy: nuts", items: [{ itemId: PANEER, qty: 2, note: "mild" }, { itemId: LASSI, qty: 1 }] }, null, "staff");
    const { kots } = await svc.sendKot(A, o.id);
    const kitchenKot = kots.find((k) => k.station === "kitchen")!;
    const barKot = kots.find((k) => k.station === "bar")!;

    const all = await svc.kitchen(A);
    const mine = all.tickets.filter((x) => x.orderId === o.id);
    expect(mine).toHaveLength(2);
    expect(mine.find((x) => x.id === kitchenKot.id)).toMatchObject({
      orderNumber: o.number, tableName: "Kd1", orderNote: "allergy: nuts", orderType: "dine_in", orderSource: "staff", platform: null,
      items: [{ name: "Paneer Butter Masala", qty: 2, note: "mild", status: "sent", cancelReason: null }],
    });
    expect(all.stations).toEqual(expect.arrayContaining(["kitchen", "bar"]));
    const barOnly = await svc.kitchen(A, { station: "bar" });
    expect(barOnly.tickets.every((x) => x.station === "bar")).toBe(true);
    expect(barOnly.tickets.some((x) => x.id === barKot.id)).toBe(true);
    // Another shop's display is empty.
    expect((await svc.kitchen(B)).tickets).toEqual([]);

    expect(await code(svc.moveKot(A, kitchenKot.id, { status: "bogus" }))).toBe("zod");
    expect(await code(svc.moveKot(B, kitchenKot.id, { status: "preparing" }))).toBe("404:not_found");
    const prep = await svc.moveKot(A, kitchenKot.id, { status: "preparing" });
    expect(prep.startedAt).toEqual(clock);
    // Same status again is a no-op, not an error.
    expect((await svc.moveKot(A, kitchenKot.id, { status: "preparing" })).status).toBe("preparing");
    clock = new Date("2026-11-05T10:12:00Z");
    const ready = await svc.moveKot(A, kitchenKot.id, { status: "ready" });
    expect(ready.readyAt).toEqual(clock);
    expect(ready.startedAt).toEqual(prep.startedAt);
    // Back one step clears the ready stamp; the first start time is kept.
    const back = await svc.moveKot(A, kitchenKot.id, { status: "preparing" });
    expect(back).toMatchObject({ status: "preparing", readyAt: null });
    expect(back.startedAt).toEqual(prep.startedAt);
    await svc.moveKot(A, kitchenKot.id, { status: "ready" });
    clock = new Date("2026-11-05T10:20:00Z");
    const served = await svc.moveKot(A, kitchenKot.id, { status: "served" });
    expect(served.servedAt).toEqual(clock);
    // Served tickets leave the display unless "recent" asks for them.
    expect((await svc.kitchen(A)).tickets.some((x) => x.id === kitchenKot.id)).toBe(false);
    clock = new Date("2026-11-05T10:25:00Z");
    expect((await svc.kitchen(A, { recent: 10 })).tickets.some((x) => x.id === kitchenKot.id)).toBe(true);
    clock = new Date("2026-11-05T10:40:00Z");
    expect((await svc.kitchen(A, { recent: 10 })).tickets.some((x) => x.id === kitchenKot.id)).toBe(false);
    expect(await code(svc.kitchen(A, { recent: 500 }))).toBe("zod");
    // Served can only go back to ready; a cancelled ticket goes nowhere.
    expect(await code(svc.moveKot(A, kitchenKot.id, { status: "new" }))).toBe("409:kot_move");
    await svc.cancel(A, o.id, { reason: "no" });
    expect(await code(svc.moveKot(A, barKot.id, { status: "preparing" }))).toBe("409:kot_move");
    expect(await svc.orderOfKot(A, barKot.id)).toBe(o.id);
    expect(await svc.orderOfKot(B, barKot.id)).toBeNull();
    clock = new Date("2026-11-05T10:00:00Z");
  });

  it("floor view shows each table's open order, kitchen state and the open takeaways", async () => {
    // A clean shop so the numbers are exact.
    const C = "33333333-3333-4333-8333-333333333333";
    const t = await svc.createTable(C, { name: "F1", seats: 2 });
    await svc.createTable(C, { name: "F2" });
    const o = await svc.open(C, { tableId: t.id, guests: 2, items: [{ name: "Tea", rate: 1500, qty: 2 }, { name: "Vada", rate: 2500, qty: 1 }] }, null);
    await svc.sendKot(C, o.id);
    await svc.addItems(C, o.id, [{ name: "Coffee", rate: 2000, qty: 1 }]);
    await svc.open(C, { type: "takeaway", customerName: "Counter" }, null);
    const f = await svc.floor(C);
    expect(f.tables.map((x) => x.name)).toEqual(["F1", "F2"]);
    expect(f.tables[0]!.order).toMatchObject({ id: o.id, guests: 2, amount: 3000 + 2500 + 2000, activeKots: 1, readyKots: 0 });
    expect(f.tables[1]!.order).toBeNull();
    expect(f.orders).toHaveLength(1);
    expect(f.orders[0]).toMatchObject({ customerName: "Counter", amount: 0 });

    const open = await svc.listOrders(C);
    expect(open.total).toBe(2);
    expect((await svc.listOrders(C, { type: "takeaway" })).items.map((x) => x.customerName)).toEqual(["Counter"]);
    await svc.cancel(C, o.id, { reason: "no" });
    const cancelled = await svc.listOrders(C, { status: "cancelled" });
    expect(cancelled.items.map((x) => [x.id, x.tableName])).toEqual([[o.id, "F1"]]);
    expect((await svc.listOrders(A, { status: "cancelled", limit: "1" })).items).toHaveLength(1);
    expect(await code(svc.listOrders(C, { status: "weird" }))).toBe("zod");
    // Shop A sees none of C's orders.
    expect((await svc.listOrders(A, { status: "cancelled" })).items.some((x) => x.id === o.id)).toBe(false);
  });

  it("QR ordering: rates come from the menu, a second scan joins the same order, and bad tokens fail", async () => {
    const t = await table("Qr1");
    expect(await code(svc.placeFromQr("nosuchtoken123", { items: [{ itemId: PANEER, qty: 1 }] }))).toBe("404:not_found");
    expect(await code(svc.placeFromQr(t.qrToken, { items: [] }))).toBe("zod");
    // The guest can't set a price: unknown keys are refused.
    expect(await code(svc.placeFromQr(t.qrToken, { items: [{ itemId: PANEER, qty: 1, rate: 1 }] }))).toBe("zod");
    expect(await code(svc.placeFromQr(t.qrToken, { items: [{ itemId: PANEER, qty: 51 }] }))).toBe("zod");
    expect(await code(svc.placeFromQr(t.qrToken, { items: [{ itemId: PANEER, qty: 1.5 }] }))).toBe("zod");

    const first = await svc.placeFromQr(t.qrToken, { name: "Guest A", items: [{ itemId: PANEER, qty: 2 }, { itemId: LASSI, qty: 1, note: "cold" }] });
    expect(first.tenantId).toBe(A);
    expect(first.order).toMatchObject({ source: "qr", customerName: "Guest A", amount: 36000 + 6000, pendingCount: 0 });
    expect(first.kots.map((k) => k.station).sort()).toEqual(["bar", "kitchen"]);
    const second = await svc.placeFromQr(t.qrToken, { items: [{ itemId: NAAN, qty: 1 }] });
    expect(second.order.id).toBe(first.order.id);
    expect(second.order.amount).toBe(42000 + 4500);
    expect(second.kots).toHaveLength(1);

    // A switched-off table no longer takes orders.
    await svc.cancel(A, first.order.id, { reason: "no" });
    await svc.updateTable(A, t.id, { active: false });
    expect(await code(svc.placeFromQr(t.qrToken, { items: [{ itemId: PANEER, qty: 1 }] }))).toBe("404:not_found");
  });

  it("online store orders reach the kitchen once, can be cancelled, and close when billed elsewhere", async () => {
    const e = { ref: "web-1001", number: "W-1001", customerName: "Karthik", customerPhone: "9000000001", delivery: true, lines: [{ itemId: null, name: "Biryani", qty: 2, rate: 25000, gstRate: 5 }] };
    await svc.fromOnlineOrder(A, e);
    await svc.fromOnlineOrder(A, e); // delivered twice by the store: still one order
    await svc.fromOnlineOrder(A, { ...e, ref: "web-empty", lines: [] });
    const open = (await svc.listOrders(A)).items.filter((o) => o.externalRef === "web-1001");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ type: "delivery", source: "online", note: "Online order W-1001", amount: 50000 });
    const full = await svc.get(A, open[0]!.id);
    expect(full.kots).toHaveLength(1);
    expect((await svc.listOrders(A)).items.some((o) => o.externalRef === "web-empty")).toBe(false);

    await svc.onlineOrderCancelled(B, "web-1001"); // another shop can't cancel it
    expect((await svc.get(A, open[0]!.id)).status).toBe("open");
    await svc.onlineOrderCancelled(A, "web-1001");
    expect(await svc.get(A, open[0]!.id)).toMatchObject({ status: "cancelled", note: "Online order W-1001 · Online order cancelled" });

    await svc.fromOnlineOrder(A, { ...e, ref: "web-1002", number: null, delivery: false });
    await svc.onlineOrderClosed(A, "web-1002");
    const closed = (await svc.listOrders(A, { status: "billed" })).items.find((o) => o.externalRef === "web-1002");
    expect(closed).toMatchObject({ type: "takeaway", note: "Online order", closedAt: clock });
    // Errors inside never reach the store: an unknown table-less bad line is logged, not thrown.
    await expect(svc.fromOnlineOrder(A, { ...e, ref: "web-bad", lines: [{ itemId: GHOST, name: "", qty: 1, rate: 100, gstRate: 5 }] })).resolves.toBeUndefined();
  });

  it("delivery-platform orders wait until accepted, keep their due time, and are not duplicated", async () => {
    const input = {
      ref: "agg:z-1", type: "delivery" as const, platform: "zomato", customerName: "N".repeat(200), customerPhone: null, note: null,
      dueAt: new Date("2026-11-05T11:00:00Z"), taxByOperator: false, send: false,
      lines: [{ itemId: null, name: "Combo", qty: 1, rate: 19999.6, gstRate: 12, note: "x".repeat(300) }],
    };
    const o = await svc.openExternal(A, input);
    expect(o).toMatchObject({ source: "aggregator", platform: "zomato", pendingCount: 1, amount: 20000, taxByOperator: false });
    expect(o.customerName).toHaveLength(120);
    expect(o.items[0]).toMatchObject({ gstRate: 12 });
    expect(o.items[0]!.note).toHaveLength(200);
    expect(o.dueAt).toEqual(new Date("2026-11-05T11:00:00Z"));
    // Not yet on the kitchen display.
    expect((await svc.kitchen(A)).tickets.some((t) => t.orderId === o.id)).toBe(false);
    const dup = await svc.openExternal(A, { ...input, send: true });
    expect(dup.id).toBe(o.id);
    expect(dup.kots).toHaveLength(0);
    // Accepting with a 20 minute prep moves the due time and sends it.
    await svc.setDue(A, o.id, new Date("2026-11-05T10:20:00Z"));
    await svc.sendKot(A, o.id);
    const ticket = (await svc.kitchen(A)).tickets.find((t) => t.orderId === o.id);
    expect(ticket).toMatchObject({ platform: "zomato", orderSource: "aggregator" });
    expect(ticket!.dueAt).toEqual(new Date("2026-11-05T10:20:00Z"));
    await svc.setDue(A, o.id, null);
    expect((await svc.get(A, o.id)).dueAt).toBeNull();
  });

  it("recipes: ingredients are unique ignoring case, units follow the line unit, used ones can't be deleted", async () => {
    const rice = await recipes.saveIngredient(A, null, { name: "Basmati Rice", unit: "kg", price: 11000 });
    const again = await recipes.saveIngredient(A, null, { name: "basmati rice", price: 12000 });
    expect(again.id).toBe(rice.id);
    expect(again.price).toBe(12000);
    expect(await code(recipes.saveIngredient(A, null, { name: "Bad", price: -1 }))).toBe("zod");
    expect(await code(recipes.saveIngredient(A, GHOST, { name: "Nope" }))).toBe("404:not_found");
    // Another shop has its own "Basmati Rice".
    const other = await recipes.saveIngredient(B, null, { name: "Basmati Rice", price: 5 });
    expect(other.id).not.toBe(rice.id);

    // New ingredients named in a recipe are created unpriced, in the unit family of the line.
    const r = await recipes.save(A, PANEER, {
      note: "one portion",
      lines: [{ ingredientId: rice.id, qty: 0.1, unit: "kg" }, { name: "Fresh Cream", qty: 30, unit: "ml" }, { name: "Paneer", qty: 100, unit: "g" }, { name: "Egg", qty: 2, unit: "pcs" }],
    });
    expect(r.lines.map((l) => [l.name, l.qty, l.unit, l.ingredient.unit, l.ingredient.price])).toEqual([
      ["basmati rice", 0.1, "kg", "kg", 12000],
      ["Fresh Cream", 30, "ml", "l", null],
      ["Paneer", 100, "g", "kg", null],
      ["Egg", 2, "pcs", "pcs", null],
    ]);
    expect(r).toMatchObject({ itemId: PANEER, note: "one portion", source: "manual" });
    // Saving again replaces the lines.
    const r2 = await recipes.save(A, PANEER, { lines: [{ name: "fresh cream", qty: 1, unit: "tbsp" }], source: "ai" });
    expect(r2.lines.map((l) => l.name)).toEqual(["Fresh Cream"]);
    expect(r2).toMatchObject({ source: "ai", note: null });
    expect((await recipes.ingredients(A)).filter((i) => i.name.toLowerCase() === "fresh cream")).toHaveLength(1);

    expect(await code(recipes.save(A, LASSI, { lines: [{ ingredientId: GHOST, qty: 1, unit: "g" }] }))).toBe("400:bad_request");
    expect(await code(recipes.save(A, LASSI, { lines: [{ qty: 1, unit: "g" }] }))).toBe("zod");
    // Shop B's ingredient can't go into shop A's recipe.
    expect(await code(recipes.save(A, LASSI, { lines: [{ ingredientId: other.id, qty: 1, unit: "g" }] }))).toBe("400:bad_request");
    expect(await recipes.get(B, PANEER)).toBeNull();
    expect(await recipes.all(B)).toEqual([]);

    const cream = (await recipes.ingredients(A)).find((i) => i.name === "Fresh Cream")!;
    expect(await code(recipes.deleteIngredient(A, cream.id))).toBe("400:bad_request");
    await recipes.remove(A, PANEER);
    await recipes.remove(A, PANEER); // already gone: fine
    expect(await recipes.get(A, PANEER)).toBeNull();
    await recipes.deleteIngredient(A, cream.id);
    expect((await recipes.ingredients(A)).some((i) => i.id === cream.id)).toBe(false);
  });

  describe("routes", () => {
    let app: FastifyInstance;
    const ctxFor = (roles: string[], tenant: TenantRef | null) => ({ ...emptyContext(), tenant, user: { id: "22222222-2222-4222-8222-222222222222", sessionId: "s", platformRoles: [], tenantRoles: roles } }) as RequestContext;
    let current: RequestContext;
    beforeAll(async () => {
      app = Fastify();
      app.decorateRequest("ctx", null as never);
      app.addHook("onRequest", async (req) => {
        req.ctx = current;
      });
      app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
        reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
      });
      await app.register(diningRoutes(svc), { prefix: "/v1/dining" });
    });
    afterAll(() => app?.close());

    it("staff open an order with ?send=1; customers without a staff role are refused; guests only reach their own shop's tables", async () => {
      current = ctxFor(["staff"], tenantA);
      const t = await table("Rt1");
      const res = await app.inject({ method: "POST", url: "/v1/dining/orders?send=1", payload: { tableId: t.id, items: [{ itemId: PANEER, qty: 1 }] } });
      expect(res.statusCode).toBe(200);
      const order = res.json();
      expect(order).toMatchObject({ amount: 18000, pendingCount: 0 });
      expect((await app.inject({ method: "GET", url: `/v1/dining/orders/${order.id}` })).json().kots).toHaveLength(1);
      expect((await app.inject({ method: "GET", url: "/v1/dining/orders/not-a-uuid" })).statusCode).toBe(404);
      expect((await app.inject({ method: "DELETE", url: `/v1/dining/orders/${order.id}/items/${order.items[0].id}` })).statusCode).toBe(409);
      const cancel = await app.inject({ method: "POST", url: `/v1/dining/orders/${order.id}/items/${order.items[0].id}/cancel`, payload: { reason: "oops" } });
      expect(cancel.json().amount).toBe(0);

      current = ctxFor(["customer"], tenantA);
      expect((await app.inject({ method: "GET", url: "/v1/dining/floor" })).statusCode).toBe(403);

      // The QR code of shop A's table, scanned on shop B's host, is not found.
      current = ctxFor([], { ...tenantA, id: B });
      expect((await app.inject({ method: "GET", url: `/v1/dining/public/tables/${t.qrToken}` })).statusCode).toBe(404);
      current = ctxFor([], tenantA);
      expect((await app.inject({ method: "GET", url: `/v1/dining/public/tables/${t.qrToken}` })).json()).toMatchObject({ id: t.id, name: "Rt1" });
      const placed = await app.inject({ method: "POST", url: `/v1/dining/public/tables/${t.qrToken}/orders`, payload: { items: [{ itemId: LASSI, qty: 2 }] } });
      expect(placed.statusCode).toBe(200);
      expect(placed.json().items.map((i: { name: string }) => i.name)).toEqual(["Sweet Lassi"]);
      expect((await app.inject({ method: "GET", url: "/v1/dining/public/menu" })).json().items).toHaveLength(3);
      await svc.cancel(A, order.id, { reason: "cleanup" });
    });
  });
});
