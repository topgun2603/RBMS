/**
 * Recurring expenses, drafts, suppliers and branches against Postgres (docs/expenses-debit-notes.md). Runs only with
 * `EXPENSES_TEST_DATABASE_URL` set (a development Postgres with the expenses tables migrated); it copies them into a
 * throw-away schema and drops it afterwards.
 */
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@rbms/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RecurringExpensesService } from "./recurring";
import { expenseRecurringRuns, expenses } from "./schema";
import { ExpensesService } from "./service";

const URL_ = process.env.EXPENSES_TEST_DATABASE_URL;
const SCHEMA = `expenses_rec_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["expense_categories", "expenses", "expense_recurring", "expense_recurring_runs"];
const SUPPLIER = { id: randomUUID(), name: "Kumar Estates", gstin: "33AAGCB7383J1ZF" };
const BRANCH_A = randomUUID();

describe.skipIf(!URL_)("recurring expenses, suppliers and branches (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: ExpensesService;
  let rec: RecurringExpensesService;
  let tenantId = randomUUID();
  let clock = new Date("2026-10-14T06:00:00Z"); // 14 Oct 2026 IST
  let locked: string | null = null;

  const rowsOf = (recurringId: string) =>
    db.select().from(expenseRecurringRuns).where(and(eq(expenseRecurringRuns.tenantId, tenantId), eq(expenseRecurringRuns.recurringId, recurringId))).orderBy(expenseRecurringRuns.runDate);
  const expensesOf = () => db.select().from(expenses).where(eq(expenses.tenantId, tenantId)).orderBy(expenses.date);

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 8 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    // `like` does not copy foreign keys; the run rows reference their recurring expense.
    await db.execute(sql.raw(`alter table "${SCHEMA}"."expense_recurring_runs" add foreign key (recurring_id) references "${SCHEMA}"."expense_recurring"(id) on delete cascade`));
    svc = new ExpensesService({
      db,
      now: () => clock,
      suppliers: { get: async (_t, id) => (id === SUPPLIER.id ? SUPPLIER : null) },
      branches: { list: async () => [{ id: BRANCH_A, name: "Anna Nagar" }] },
    });
    rec = new RecurringExpensesService({ db, expenses: svc, lockedThrough: async () => locked, now: () => clock });
  });
  beforeEach(() => {
    tenantId = randomUUID();
    clock = new Date("2026-10-14T06:00:00Z");
    locked = null;
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close?.();
  });

  it("makes one expense per date however many times the job runs, also at the same time", async () => {
    const rent = await rec.create(tenantId, { name: "Shop rent", amount: 2_500_000, frequency: "monthly", dayOfMonth: 5, startDate: "2026-08-01", paymentMethod: "bank" });
    // Created today (14 Oct): the first date is 5 Nov; move the clock to 5 Nov and run twice at once, then again.
    expect(rent.nextRunDate).toBe("2026-11-05");
    clock = new Date("2026-11-05T02:00:00Z");
    const [a, b] = await Promise.all([rec.runDue(), rec.runDue()]);
    await rec.runDue();
    expect(a.created + b.created).toBe(1);
    const made = await expensesOf();
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ date: "2026-11-05", amount: 2_500_000, status: "recorded", paymentMethod: "bank", recurringId: rent.id });
    expect((await rowsOf(rent.id)).map((r) => [r.runDate, r.status])).toEqual([["2026-11-05", "created"]]);
    const after = await rec.get(tenantId, rent.id);
    expect(after).toMatchObject({ count: 1, nextRunDate: "2026-12-05" });
    // "Make now" on a scheduled date that was already done is refused.
    await expect(rec.runNow(tenantId, rent.id)).rejects.toMatchObject({ status: 409 });
  });

  it("catches up only the latest missed dates, records older ones as skipped, and respects the period lock", async () => {
    const eb = await rec.create(tenantId, { name: "Electricity", amount: 400_000, frequency: "monthly", dayOfMonth: 10, startDate: "2026-10-10" });
    expect(eb.nextRunDate).toBe("2026-11-10");
    // The job did not run for five months; the books are locked up to 31 Jan.
    clock = new Date("2027-03-12T06:00:00Z");
    locked = "2027-01-31";
    // runDue scans every shop (other tests' shops too): this shop's work is one runOne.
    const r = await rec.runOne(tenantId, eb.id, clock);
    expect(r).toEqual({ skipped: 2, locked: 1, created: 2, drafts: 0 });
    expect(await rec.runOne(tenantId, eb.id, clock)).toEqual({ skipped: 0, locked: 0, created: 0, drafts: 0 });
    expect((await rowsOf(eb.id)).map((x) => [x.runDate, x.status])).toEqual([
      ["2026-11-10", "skipped"],
      ["2026-12-10", "skipped"],
      ["2027-01-10", "locked"],
      ["2027-02-10", "created"],
      ["2027-03-10", "created"],
    ]);
    expect((await expensesOf()).map((e) => e.date)).toEqual(["2027-02-10", "2027-03-10"]);
  });

  it("ask each time: a draft to fill (not in totals), recorded with its amount; mode draft keeps the amount", async () => {
    const sub = await rec.create(tenantId, { name: "Billing software", amount: null, frequency: "weekly", weekday: 1, startDate: "2026-10-14", gstRate: 18 });
    expect(sub.askEachTime).toBe(true);
    const fixed = await rec.create(tenantId, { name: "Cleaning", amount: 150_000, mode: "draft", frequency: "weekly", weekday: 1, startDate: "2026-10-14" });
    clock = new Date("2026-10-19T06:00:00Z"); // Monday
    expect(await rec.runOne(tenantId, sub.id, clock)).toMatchObject({ drafts: 1, created: 0 });
    expect(await rec.runOne(tenantId, fixed.id, clock)).toMatchObject({ drafts: 1, created: 0 });
    const drafts = await expensesOf();
    expect(drafts.map((e) => [e.status, e.amount])).toEqual(expect.arrayContaining([["draft", 0], ["draft", 150_000]]));
    // Drafts are left out of the list (by default), totals and the summary.
    const list = await svc.list(tenantId, { from: "2026-10-01", to: "2026-10-31" });
    expect(list.items).toHaveLength(0);
    expect((await svc.list(tenantId, { status: "draft" })).totals.amount).toBe(0);
    expect((await rec.summary(tenantId)).drafts).toBe(2);
    const empty = drafts.find((e) => e.amount === 0)!;
    await expect(svc.record(tenantId, empty.id)).rejects.toMatchObject({ status: 400 });
    const done = await svc.record(tenantId, empty.id, { amount: 118_000 });
    expect(done).toMatchObject({ status: "recorded", amount: 118_000, gstAmount: 18_000 });
    expect((await svc.summary(tenantId, { from: "2026-10-01", to: "2026-10-31" })).total).toBe(118_000);
    expect(fixed.mode).toBe("draft");
  });

  it("pause, skip and resume move the next date without making expenses", async () => {
    const r = await rec.create(tenantId, { name: "Internet", amount: 99_900, frequency: "monthly", dayOfMonth: 20, startDate: "2026-10-01" });
    expect(r.nextRunDate).toBe("2026-10-20");
    const skipped = await rec.skipNext(tenantId, r.id);
    expect(skipped.nextRunDate).toBe("2026-11-20");
    await rec.pause(tenantId, r.id);
    clock = new Date("2026-12-25T06:00:00Z");
    expect(await rec.runOne(tenantId, r.id, clock)).toEqual({ skipped: 0, locked: 0, created: 0, drafts: 0 });
    const resumed = await rec.resume(tenantId, r.id);
    expect(resumed).toMatchObject({ status: "active", nextRunDate: "2027-01-20" });
    expect(await expensesOf()).toHaveLength(0);
    expect((await rowsOf(r.id)).map((x) => [x.runDate, x.status, x.trigger])).toEqual([["2026-10-20", "skipped", "user"]]);
    await expect(rec.remove(tenantId, r.id)).resolves.toBeUndefined();
  });

  it("credit expenses need a supplier and fill the vendor from it; branch defaults to the user's branch; report by branch", async () => {
    await expect(svc.create(tenantId, { amount: 10_000, paymentMethod: "credit" }, null)).rejects.toMatchObject({ status: 400 });
    const onCredit = await svc.create(tenantId, { amount: 118_000, gstRate: 18, paymentMethod: "credit", supplierId: SUPPLIER.id, reference: "RENT-OCT", dueDate: "2026-10-20" }, null, { branchId: BRANCH_A });
    expect(onCredit).toMatchObject({ vendorName: "Kumar Estates", vendorGstin: SUPPLIER.gstin, branchId: BRANCH_A, itc: 18_000, balance: 118_000, dueDate: "2026-10-20" });
    const shopWide = await svc.create(tenantId, { amount: 50_000, paymentMethod: "cash", branchId: null, dueDate: "2026-10-30" }, null, { branchId: BRANCH_A });
    expect(shopWide).toMatchObject({ branchId: null, dueDate: null, balance: 0 });
    // Paid through Payables (the inventory port writes amount_paid): edits and cancel are guarded.
    await db.update(expenses).set({ amountPaid: 50_000 }).where(eq(expenses.id, onCredit.id));
    await expect(svc.update(tenantId, onCredit.id, { amount: 40_000 })).rejects.toMatchObject({ status: 400 });
    await expect(svc.update(tenantId, onCredit.id, { paymentMethod: "cash" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.cancel(tenantId, onCredit.id)).rejects.toMatchObject({ status: 400 });
    expect((await svc.get(tenantId, onCredit.id)).balance).toBe(68_000);
    // Filters and the report.
    expect((await svc.list(tenantId, { branchId: BRANCH_A })).items.map((e) => e.id)).toEqual([onCredit.id]);
    expect((await svc.list(tenantId, { shopWide: "true" })).items.map((e) => e.id)).toEqual([shopWide.id]);
    expect((await svc.list(tenantId, { unpaid: "true" })).items.map((e) => e.id)).toEqual([onCredit.id]);
    const byBranch = await svc.report(tenantId, { from: "2026-10-01", to: "2026-10-31", groupBy: "branch" });
    expect(byBranch.rows.map((r) => [r.key, r.label, r.total, r.net, r.unpaid])).toEqual([
      [BRANCH_A, "Anna Nagar", 118_000, 100_000, 68_000],
      ["", "", 50_000, 50_000, 0],
    ]);
    expect(byBranch.totals).toMatchObject({ count: 2, total: 168_000, itc: 18_000 });
    const bySupplier = await svc.report(tenantId, { from: "2026-10-01", to: "2026-10-31", groupBy: "supplier" });
    expect(bySupplier.rows.map((r) => [r.key, r.label])).toEqual([
      [SUPPLIER.id, "Kumar Estates"],
      ["", ""],
    ]);
  });
});
