/**
 * Branch books (docs/accounting.md): the accounting ports read the branch of every document that has one — bills,
 * payments (the bill's branch), expenses, purchase bills and debit notes (the branch of their stock location), supplier
 * payments (the bill's branch), stock adjustments (the movement's location) — and split the stock value by branch so the
 * parts add up to the whole. Runs only with `ACCOUNTING_TEST_DATABASE_URL` set (a development Postgres with the
 * migrations applied); it copies the tables into a throw-away schema and drops it afterwards.
 */
import { randomUUID } from "node:crypto";
import { createDb, sql, type Db } from "@rbms/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountingBranches, accountingSources, accountingStock } from "./kit-accounting";

const URL_ = process.env.ACCOUNTING_TEST_DATABASE_URL;
const SCHEMA = `acct_kit_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = [
  "branches",
  "invoices",
  "invoice_payments",
  "expense_categories",
  "expenses",
  "suppliers",
  "purchases",
  "purchase_payments",
  "purchase_orders",
  "goods_receipts",
  "debit_notes",
  "stock_items",
  "stock_movements",
];
const T = randomUUID();
const L1 = randomUUID();
const L2 = randomUUID();
const L3 = randomUUID(); // a location no branch sells from
const B1 = randomUUID();
const B2 = randomUUID();

describe.skipIf(!URL_)("accounting ports read the branch of each document (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  const ids = { inv: randomUUID(), inv0: randomUUID(), pay: randomUUID(), cat: randomUUID(), exp: randomUUID(), pur: randomUUID(), pur0: randomUUID(), sp: randomUUID(), dn: randomUUID(), item: randomUUID(), adj: randomUUID() };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    const totals = sql`'{"subtotal":100000,"discount":0,"taxable":100000,"cgst":9000,"sgst":9000,"igst":0,"roundOff":0}'::jsonb`;
    await db.execute(sql`insert into branches (id, tenant_id, name, code, invoice_prefix, stock_location_id, is_default) values
      (${B1}, ${T}, 'Main road', 'MAIN', 'M', ${L1}, true), (${B2}, ${T}, 'Bus stand', 'BUS', 'B', ${L2}, false)`);
    await db.execute(sql`insert into invoices (id, tenant_id, branch_id, number, status, customer, date, place_of_supply, lines, totals, total) values
      (${ids.inv}, ${T}, ${B2}, 'B-1', 'issued', '{"name":"Meena"}'::jsonb, '2026-10-01', '33', '[]'::jsonb, ${totals}, 118000),
      (${ids.inv0}, ${T}, null, 'X-1', 'issued', '{"name":"Ravi"}'::jsonb, '2026-10-01', '33', '[]'::jsonb, ${totals}, 118000)`);
    await db.execute(sql`insert into invoice_payments (id, tenant_id, invoice_id, amount, method, date) values (${ids.pay}, ${T}, ${ids.inv}, 50000, 'cash', '2026-10-01')`);
    await db.execute(sql`insert into expense_categories (id, tenant_id, name) values (${ids.cat}, ${T}, 'Rent')`);
    await db.execute(sql`insert into expenses (id, tenant_id, branch_id, date, category_id, amount, status, payment_method) values (${ids.exp}, ${T}, ${B1}, '2026-10-02', ${ids.cat}, 20000, 'recorded', 'cash')`);
    // One purchase whose goods went into branch 2's location; one with no stock movement (no branch).
    await db.execute(sql`insert into purchases (id, tenant_id, supplier, bill_number, date, place_of_supply, lines, totals, total) values
      (${ids.pur}, ${T}, '{"name":"Kumar"}'::jsonb, 'S-1', '2026-10-03', '33', '[]'::jsonb, ${totals}, 118000),
      (${ids.pur0}, ${T}, '{"name":"Kumar"}'::jsonb, 'S-2', '2026-10-03', '33', '[]'::jsonb, ${totals}, 118000)`);
    await db.execute(sql`insert into stock_movements (tenant_id, location_id, item_id, delta, qty_after, reason, ref_type, ref_id, unit_cost) values
      (${T}, ${L2}, ${ids.item}, 10, 10, 'purchase', 'purchase', ${ids.pur}, 1000)`);
    await db.execute(sql`insert into purchase_payments (id, tenant_id, purchase_id, group_id, amount, mode, date) values (${ids.sp}, ${T}, ${ids.pur}, ${randomUUID()}, 118000, 'bank', '2026-10-04')`);
    await db.execute(sql`insert into debit_notes (id, tenant_id, number, purchase_id, supplier_name, date, lines, totals, total, location_id) values
      (${ids.dn}, ${T}, 'DN-1', ${ids.pur}, 'Kumar', '2026-10-05', '[]'::jsonb, ${totals}, 11800, ${L2})`);
    // Stock: an adjustment at branch 1; stock held at all three locations.
    await db.execute(sql`insert into stock_movements (id, tenant_id, location_id, item_id, delta, qty_after, reason, unit_cost) values (${ids.adj}, ${T}, ${L1}, ${ids.item}, 2, 2, 'adjustment', 500)`);
    await db.execute(sql`insert into stock_items (tenant_id, location_id, item_id, qty, avg_cost, track) values
      (${T}, ${L1}, ${ids.item}, 2, 500, true), (${T}, ${L2}, ${ids.item}, 10, 1000, true), (${T}, ${L3}, ${ids.item}, 3, 700, true)`);
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close?.();
  });

  const src = () => accountingSources({ db, invoices: null as never, inventory: { costing: { history: async () => [] } } as never, sellerState: async () => "33", isEnabled: async () => true });

  it("bills, payments and expenses carry their own branch; a bill with none stays unassigned", async () => {
    const s = src();
    const inv = await s.invoices(T);
    expect(inv.find((i) => i.id === ids.inv)?.branchId).toBe(B2);
    expect(inv.find((i) => i.id === ids.inv0)?.branchId).toBeNull();
    expect((await s.invoicePayments(T)).find((p) => p.id === ids.pay)?.branchId).toBe(B2);
    expect((await s.expenses(T)).find((e) => e.id === ids.exp)?.branchId).toBe(B1);
  });

  it("purchases, their payments and debit notes take the branch of the stock location", async () => {
    const s = src();
    const pur = await s.purchases(T);
    expect(pur.find((p) => p.id === ids.pur)?.branchId).toBe(B2);
    expect(pur.find((p) => p.id === ids.pur0)?.branchId).toBeNull();
    expect((await s.supplierPayments(T)).find((p) => p.id === ids.sp)?.branchId).toBe(B2);
    expect((await s.debitNotes(T)).find((d) => d.id === ids.dn)?.branchId).toBe(B2);
    expect((await s.stockAdjustments!(T)).find((a) => a.id === ids.adj)).toMatchObject({ branchId: B1, value: 1_000 });
  });

  it("the stock value split by branch adds up to the whole value", async () => {
    const stock = accountingStock({ db, isEnabled: async () => true, sellerState: async () => "33" });
    const today = new Date().toISOString().slice(0, 10);
    const whole = await stock.value(T, today);
    const split = await stock.valueByBranch!(T, today);
    expect(whole).toBe(2 * 500 + 10 * 1000 + 3 * 700);
    expect(split).toEqual(new Map<string | null, number>([[B1, 1_000], [B2, 10_000], [null, 2_100]]));
    expect([...split!.values()].reduce((a, b) => a + b, 0)).toBe(whole);
  });

  it("lists the branches, the default first", async () => {
    expect((await accountingBranches(db).list(T)).map((b) => b.code)).toEqual(["MAIN", "BUS"]);
  });
});
