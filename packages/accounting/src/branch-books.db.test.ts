/**
 * Branch books against Postgres: the sync stamps each line with its document's branch, history posted before branch
 * books is left as it is (no re-posting), cancellations and reversals stay in the branch of what they undo, and the
 * reports filtered by branch add up to the unfiltered ones. Runs only with `ACCOUNTING_TEST_DATABASE_URL` (a development
 * Postgres with the migrations applied, 0057 included); it copies the tables into a throw-away schema and drops it.
 */
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExpenseSrc, InvoicePaymentSrc, InvoiceSrc, PurchaseSrc, SourcesPort, StockAdjustmentSrc } from "./ports";
import { AccountingService } from "./service";

const URL_ = process.env.ACCOUNTING_TEST_DATABASE_URL;
const SCHEMA = `acct_br_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["acct_accounts", "acct_entries", "acct_lines", "acct_settings", "acct_lock_log"];
const T = "22222222-2222-4222-8222-222222222222";
const B1 = "b1b1b1b1-0000-4000-8000-000000000001";
const B2 = "b2b2b2b2-0000-4000-8000-000000000002";
const RANGE = { from: "2026-04-01", to: "2026-10-31" };

const invoice = (id: string, over: Partial<InvoiceSrc> = {}): InvoiceSrc => ({
  id,
  number: `INV-${id}`,
  date: "2026-09-15",
  status: "issued",
  imported: false,
  customerId: null,
  customerName: "Walk-in",
  subtotal: 100_000,
  discount: 0,
  taxable: 100_000,
  cgst: 9_000,
  sgst: 9_000,
  igst: 0,
  roundOff: 0,
  total: 118_000,
  cancelledOn: null,
  ...over,
});
const payment = (id: string, invoiceId: string, over: Partial<InvoicePaymentSrc> = {}): InvoicePaymentSrc => ({
  id,
  invoiceId,
  invoiceNumber: `INV-${invoiceId}`,
  customerId: null,
  customerName: "Walk-in",
  imported: false,
  date: "2026-09-16",
  amount: 50_000,
  method: "cash",
  receiptId: null,
  ...over,
});
const expense = (id: string, over: Partial<ExpenseSrc> = {}): ExpenseSrc => ({
  id,
  date: "2026-09-20",
  status: "recorded",
  categoryId: "cat-rent",
  categoryName: "Rent",
  amount: 20_000,
  gstAmount: 0,
  itc: 0,
  vendorName: null,
  vendorGstin: null,
  paymentMethod: "cash",
  cancelledOn: null,
  ...over,
});
const purchase = (id: string, over: Partial<PurchaseSrc> = {}): PurchaseSrc => ({
  id,
  billNumber: `S-${id}`,
  date: "2026-09-10",
  status: "recorded",
  imported: false,
  supplierId: "33333333-3333-4333-8333-333333333333",
  supplierName: "Kumar Traders",
  cgst: 4_500,
  sgst: 4_500,
  igst: 0,
  roundOff: 0,
  total: 59_000,
  cancelledOn: null,
  ...over,
});

describe.skipIf(!URL_)("branch books against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: AccountingService;
  let invoices: InvoiceSrc[] = [];
  let payments: InvoicePaymentSrc[] = [];
  let expenses: ExpenseSrc[] = [];
  let purchases: PurchaseSrc[] = [];
  let adjustments: StockAdjustmentSrc[] = [];
  const now = new Date("2026-10-20T06:00:00Z");
  const stockSplit = new Map<string | null, number>([
    [B1, 30_000],
    [B2, 12_345],
    [null, 2_000],
  ]);

  const sources: SourcesPort = {
    invoices: async () => invoices,
    invoicePayments: async () => payments,
    receipts: async () => [{ id: "r1", customerId: "44444444-4444-4444-8444-444444444444", customerName: "Meena", date: "2026-09-25", amount: 7_000, method: "upi", reference: null }],
    creditNotes: async () => [],
    purchases: async () => purchases,
    supplierPayments: async () => [],
    debitNotes: async () => [],
    expenses: async () => expenses,
    tills: async () => [],
    stockAdjustments: async () => adjustments,
    openingBalances: async () => ({ customers: [], suppliers: [] }),
    shopStateCode: async () => "33",
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 6 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    svc = new AccountingService({
      db,
      sources,
      now: () => now,
      stock: { value: async () => [...stockSplit.values()].reduce((a, b) => a + b, 0), valueByBranch: async () => new Map(stockSplit) },
      branches: {
        list: async () => [
          { id: B1, name: "Main road", code: "MAIN", active: true },
          { id: B2, name: "Bus stand", code: "BUS", active: true },
        ],
      },
    });
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close();
  });

  const linesOf = async (sourceType: string, sourceId: string) =>
    (await db.execute(
      sql`select e.status, e.source_version as version, l.branch_id as "branchId", l.debit, l.credit from acct_entries e join acct_lines l on l.entry_id = e.id where e.tenant_id = ${T} and e.source_type = ${sourceType} and e.source_id = ${sourceId}`,
    )) as unknown as { status: string; version: number; branchId: string | null; debit: number; credit: number }[];

  it("history posted before branch books stays branch-less and is not re-posted once documents carry a branch", async () => {
    invoices = [invoice("old")];
    purchases = [purchase("pold")];
    expenses = [expense("eold")];
    const first = await svc.backfill(T, {});
    expect(first.errors).toEqual([]);
    // Documents now carry branches (the old ones too), and new documents arrive in both branches.
    invoices = [invoice("old", { branchId: B1 }), invoice("c", { branchId: B1, date: "2026-10-02" }), invoice("d", { branchId: B2, date: "2026-10-03", total: 59_000, taxable: 50_000, subtotal: 50_000, cgst: 4_500, sgst: 4_500 })];
    payments = [payment("pc", "c", { branchId: B1, date: "2026-10-02" })];
    purchases = [purchase("pold", { branchId: B2 }), purchase("pb2", { branchId: B2, date: "2026-10-04" })];
    expenses = [expense("eold", { branchId: B1 }), expense("e2", { branchId: B2, date: "2026-10-05" })];
    adjustments = [{ id: "m1", date: "2026-10-06", reason: "adjustment", value: -1_500, itemName: null, branchId: B1 }];
    const r = await svc.sync(T);
    expect(r.errors).toEqual([]);
    expect(r.reversed).toBe(0);
    expect(r.byType.invoice).toMatchObject({ posted: 2, unchanged: 1 });
    expect((await linesOf("invoice", "old")).every((l) => l.branchId === null && l.version === 1)).toBe(true);
    expect((await linesOf("invoice", "c")).every((l) => l.branchId === B1)).toBe(true);
    expect((await linesOf("invoice", "d")).every((l) => l.branchId === B2)).toBe(true);
    expect((await linesOf("invoice_payment", "pc")).every((l) => l.branchId === B1)).toBe(true);
    expect((await linesOf("purchase", "pb2")).every((l) => l.branchId === B2)).toBe(true);
    expect((await linesOf("expense", "e2")).every((l) => l.branchId === B2)).toBe(true);
    expect((await linesOf("stock_adjustment", "m1")).every((l) => l.branchId === B1)).toBe(true);
    expect((await linesOf("customer_receipt", "r1")).every((l) => l.branchId === null)).toBe(true);
    expect((await svc.sync(T)).posted).toBe(0);
  });

  it("a cancellation follows the branch of the entry it cancels, so the pair nets to zero there", async () => {
    invoices = invoices.map((i) => (i.id === "old" || i.id === "c" ? { ...i, status: "cancelled" as const, cancelledOn: "2026-10-10" } : i));
    purchases = purchases.map((p) => (p.id === "pold" ? { ...p, status: "cancelled" as const, cancelledOn: "2026-10-10" } : p));
    const r = await svc.sync(T);
    expect(r.byType.invoice_cancel?.posted).toBe(2);
    // The old bill was posted with no branch; its cancellation is too, though the bill now says branch 1.
    expect((await linesOf("invoice_cancel", "old")).every((l) => l.branchId === null)).toBe(true);
    expect((await linesOf("purchase_cancel", "pold")).every((l) => l.branchId === null)).toBe(true);
    expect((await linesOf("invoice_cancel", "c")).every((l) => l.branchId === B1)).toBe(true);
    for (const [type, id] of [["invoice", "old"], ["invoice", "c"], ["purchase", "pold"]] as const) {
      const all = [...(await linesOf(type, id)), ...(await linesOf(`${type}_cancel`, id))];
      expect(all.reduce((t, l) => t + l.debit - l.credit, 0)).toBe(0);
      expect(new Set(all.map((l) => l.branchId)).size).toBe(1);
    }
  });

  it("a changed document is reversed and re-posted in its branch", async () => {
    expenses = expenses.map((e) => (e.id === "e2" ? { ...e, amount: 25_000 } : e));
    const r = await svc.sync(T);
    expect(r).toMatchObject({ posted: 1, reversed: 1 });
    const v = await linesOf("expense", "e2");
    expect(v.map((l) => l.version).sort()).toEqual([1, 1, 2, 2]);
    expect(v.every((l) => l.branchId === B2)).toBe(true);
    const rev = (await db.execute(
      sql`select l.branch_id as "branchId" from acct_entries e join acct_lines l on l.entry_id = e.id where e.tenant_id = ${T} and e.voucher_type = 'reversal' and e.origin = 'auto'`,
    )) as unknown as { branchId: string | null }[];
    expect(rev.length).toBeGreaterThan(0);
    expect(rev.every((l) => l.branchId === B2)).toBe(true);
  });

  it("every entry balances, and so do the lines of each branch", async () => {
    const bad = (await db.execute(
      sql`select e.id from acct_entries e join acct_lines l on l.entry_id = e.id where e.tenant_id = ${T} group by e.id, e.total having sum(l.debit) <> sum(l.credit) or sum(l.debit) <> e.total`,
    )) as unknown as unknown[];
    expect(bad).toHaveLength(0);
    const byBranch = (await db.execute(
      sql`select branch_id, sum(debit)::bigint - sum(credit)::bigint as net from acct_lines where tenant_id = ${T} group by branch_id`,
    )) as unknown as { net: string }[];
    expect(byBranch.length).toBe(3);
    for (const b of byBranch) expect(Number(b.net)).toBe(0);
  });

  it("trial balance, ledger and day book by branch add up to the unfiltered reports", async () => {
    const parts = [B1, B2, "none"];
    const whole = await svc.trialBalance(T, RANGE);
    const tbs = await Promise.all(parts.map((b) => svc.trialBalance(T, { ...RANGE, branchId: b })));
    expect(whole.balanced).toBe(true);
    for (const tb of tbs) expect(tb.balanced).toBe(true);
    expect(tbs.reduce((t, tb) => t + tb.totals.debit, 0)).toBe(whole.totals.debit);
    expect(tbs.reduce((t, tb) => t + tb.totals.credit, 0)).toBe(whole.totals.credit);
    for (const r of whole.rows) {
      const sum = tbs.reduce((t, tb) => {
        const x = tb.rows.find((y) => y.accountId === r.accountId);
        return t + (x ? x.closingDr - x.closingCr : 0);
      }, 0);
      expect(sum).toBe(r.closingDr - r.closingCr);
    }

    const cash = (await svc.listAccounts(T)).find((a) => a.key === "cash")!;
    const ledger = await svc.accountLedger(T, { accountId: cash.id, ...RANGE });
    const ledgers = await Promise.all(parts.map((b) => svc.accountLedger(T, { accountId: cash.id, ...RANGE, branchId: b })));
    expect(ledgers.reduce((t, l) => t + l.closingBalance, 0)).toBe(ledger.closingBalance);
    expect(ledgers.reduce((t, l) => t + l.openingBalance, 0)).toBe(ledger.openingBalance);
    expect(ledgers.reduce((t, l) => t + l.rows.length, 0)).toBe(ledger.rows.length);

    // Each automatic entry is in one branch, so the day books of the branches split the whole day book.
    const book = await svc.listEntries(T, { ...RANGE, limit: 200 });
    const books = await Promise.all(parts.map((b) => svc.listEntries(T, { ...RANGE, limit: 200, branchId: b })));
    expect(books.reduce((t, b) => t + b.total, 0)).toBe(book.total);
    expect(books.reduce((t, b) => t + b.totals.debit, 0)).toBe(book.totals.debit);
    expect(books[0]!.items.every((e) => e.lines.every((l) => l.branchId === B1))).toBe(true);
    await expect(svc.trialBalance(T, { ...RANGE, branchId: "main" })).rejects.toBeTruthy();
  });

  it("the per-branch profit and loss adds up to the consolidated one to the paisa", async () => {
    const r = await svc.profitLossByBranch(T, RANGE);
    expect(r.columns.map((c) => c.branch.name)).toEqual(["Main road", "Bus stand", "Head office / unassigned"]);
    expect(r.check).toMatchObject({ ok: true, difference: 0 });
    expect(r.consolidated.netProfit).not.toBe(0);
    const sum = (f: (pl: (typeof r.columns)[number]["pl"]) => number) => r.columns.reduce((t, c) => t + f(c.pl), 0);
    for (const key of ["sales", "cogs", "otherIncome", "expenses"] as const) {
      expect(sum((pl) => pl.sections.find((s) => s.key === key)!.total)).toBe(r.consolidated.sections.find((s) => s.key === key)!.total);
    }
    expect(sum((pl) => pl.stock.closing)).toBe(r.consolidated.stock.closing);
    expect(r.columns[0]!.pl.stock.closing).toBe(30_000);
    // The filtered profit and loss is the same column.
    expect((await svc.profitLoss(T, { ...RANGE, branchId: B2 })).netProfit).toBe(r.columns[1]!.pl.netProfit);
    const table = await svc.reportTable(T, "profit-loss-branches", RANGE);
    expect(table.columns.at(-1)!.label).toBe("Whole shop");
    expect(table.rows.at(-1)!.cells.total).toBe(r.consolidated.netProfit);
  });
});
