/**
 * Database test of the books engine: seeding, posting from documents (idempotent, versioned), reversal of changed or
 * removed documents, the period lock, manual vouchers and the reports. Runs only with `ACCOUNTING_TEST_DATABASE_URL`
 * (a development Postgres with migration 0032 applied); it copies the five tables into a throw-away schema and drops it.
 *   PowerShell: $env:ACCOUNTING_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run --maxWorkers=2
 */
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExpenseSrc, InvoicePaymentSrc, InvoiceSrc, PurchaseSrc, SourcesPort } from "./ports";
import { AccountingService } from "./service";

const URL_ = process.env.ACCOUNTING_TEST_DATABASE_URL;
const SCHEMA = `acct_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["acct_accounts", "acct_entries", "acct_lines", "acct_settings", "acct_lock_log"];
const T = "11111111-1111-4111-8111-111111111111";

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
const payment = (id: string, over: Partial<InvoicePaymentSrc> = {}): InvoicePaymentSrc => ({
  id,
  invoiceId: "a",
  invoiceNumber: "INV-a",
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
const purchase = (id: string): PurchaseSrc => ({ id, billNumber: "S-1", date: "2026-09-10", status: "recorded", imported: false, supplierId: "33333333-3333-4333-8333-333333333333", supplierName: "Kumar Traders", cgst: 4_500, sgst: 4_500, igst: 0, roundOff: 0, total: 59_000, cancelledOn: null });

describe.skipIf(!URL_)("accounting engine against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: AccountingService;
  let invoices: InvoiceSrc[];
  let payments: InvoicePaymentSrc[];
  let expenses: ExpenseSrc[];
  let stockValue: number | null;
  let now = new Date("2026-10-20T06:00:00Z");

  const sources: SourcesPort = {
    invoices: async () => invoices,
    invoicePayments: async () => payments,
    receipts: async () => [],
    creditNotes: async () => [],
    purchases: async () => [purchase("p1")],
    supplierPayments: async () => [],
    debitNotes: async () => [],
    expenses: async () => expenses,
    tills: async () => [],
    openingBalances: async () => ({ customers: [], suppliers: [] }),
    shopStateCode: async () => "33",
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 6 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    svc = new AccountingService({ db, sources, stock: { value: async () => stockValue }, now: () => now });
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close();
  });

  const reset = () => {
    invoices = [invoice("a"), invoice("b", { total: 59_000, taxable: 50_000, subtotal: 50_000, cgst: 4_500, sgst: 4_500 })];
    payments = [payment("pay1")];
    expenses = [expense("e1")];
    stockValue = null;
  };

  it("seeds the standard chart once, even when asked twice at the same time", async () => {
    reset();
    await Promise.all([svc.ensureInit(T), svc.ensureInit(T)]);
    const accounts = await svc.listAccounts(T);
    expect(accounts.length).toBeGreaterThanOrEqual(35);
    expect(accounts.filter((a) => a.key === "cash")).toHaveLength(1);
    expect(accounts.find((a) => a.key === "bank")?.isBank).toBe(true);
  });

  it("a dry run writes nothing; the real backfill posts every document; repeating it posts nothing", async () => {
    const dry = await svc.backfill(T, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.posted).toBe(5);
    expect((await svc.listEntries(T, {})).total).toBe(0);
    const first = await svc.backfill(T, {});
    expect(first.posted).toBe(5);
    expect(first.errors).toEqual([]);
    const again = await svc.backfill(T, {});
    expect(again).toMatchObject({ posted: 0, reversed: 0, unchanged: 5 });
    const [a, b] = await Promise.all([svc.sync(T), svc.sync(T)]);
    expect(a.posted + b.posted).toBe(0);
    const tb = await svc.trialBalance(T, { from: "2026-04-01", to: "2026-10-31" });
    expect(tb.balanced).toBe(true);
    const sales = tb.rows.find((r) => r.name === "Sales")!;
    expect(sales.closingCr).toBe(150_000);
    expect(tb.rows.find((r) => r.name === "Cash in hand")).toMatchObject({ closingDr: 30_000 /* 50,000 in - 20,000 rent */ });
  });

  it("changing a document reverses the old posting and posts the new version", async () => {
    expenses = [expense("e1", { amount: 25_000 })];
    const r = await svc.sync(T);
    expect(r).toMatchObject({ posted: 1, reversed: 1 });
    const list = await svc.listEntries(T, { sourceType: "expense", limit: 50 });
    expect(list.items.map((e) => [e.sourceVersion, e.status]).sort()).toEqual([[1, "reversed"], [2, "posted"]]);
    expect((await svc.trialBalance(T, { from: "2026-04-01", to: "2026-10-31" })).balanced).toBe(true);
    expect((await svc.sync(T)).posted).toBe(0);
  });

  it("a cancelled bill gets its cancel posting; a deleted payment is reversed", async () => {
    invoices = [invoice("a"), invoice("b", { status: "cancelled", cancelledOn: "2026-09-18", total: 59_000, taxable: 50_000, subtotal: 50_000, cgst: 4_500, sgst: 4_500 })];
    payments = [];
    const r = await svc.sync(T);
    expect(r.byType.invoice_cancel?.posted).toBe(1);
    expect(r.byType.invoice_payment?.reversed).toBe(1);
    const tb = await svc.trialBalance(T, { from: "2026-04-01", to: "2026-10-31" });
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r) => r.name === "Sales")!.closingCr).toBe(100_000);
  });

  it("the period lock refuses manual entries and moves automatic ones to the next open day", async () => {
    await svc.setLock(T, { lockedThrough: "2026-09-30", reason: "September closed" }, null);
    await expect(svc.createEntry(T, { voucherType: "journal", date: "2026-09-30", narration: "late", lines: [{ accountId: (await acct("cash")).id, debit: 100 }, { accountId: (await acct("capital")).id, credit: 100 }] }, null)).rejects.toMatchObject({ status: 409 });
    invoices = [...invoices, invoice("late", { date: "2026-09-20" })];
    const r = await svc.sync(T);
    expect(r.late).toBeGreaterThanOrEqual(1);
    const [e] = (await svc.listEntries(T, { sourceType: "invoice", q: "INV-late" })).items;
    expect(e).toMatchObject({ date: "2026-10-01", lateFor: "2026-09-20" });
    const hist = (await svc.getSettings(T)).lockHistory;
    expect(hist[0]).toMatchObject({ lockedThrough: "2026-09-30", reason: "September closed" });
    await svc.setLock(T, { lockedThrough: null, reason: "reopen" }, null);
    expect((await svc.getSettings(T)).lockedThrough).toBeNull();
  });

  it("manual vouchers: balanced journal, contra, payment; unbalanced and auto reversals are refused", async () => {
    const cash = await acct("cash");
    const bank = await acct("bank");
    const capital = await acct("capital");
    const rent = (await svc.listAccounts(T)).find((a) => a.name === "Rent")!;
    await expect(svc.createEntry(T, { voucherType: "journal", date: "2026-10-01", narration: "x", lines: [{ accountId: cash.id, debit: 100 }, { accountId: capital.id, credit: 90 }] }, null)).rejects.toMatchObject({ status: 400 });
    const jv = await svc.createEntry(T, { voucherType: "journal", date: "2026-10-01", narration: "Owner put in cash", lines: [{ accountId: cash.id, debit: 500_000 }, { accountId: capital.id, credit: 500_000 }] }, null);
    expect(jv.number).toMatch(/^JV-\d{6}$/);
    const cv = await svc.createEntry(T, { voucherType: "contra", date: "2026-10-02", narration: "Banked", simple: { accountId: cash.id, otherAccountId: bank.id, amount: 200_000 } }, null);
    expect(cv.lines.find((l) => l.accountId === bank.id)?.debit).toBe(200_000);
    await expect(svc.createEntry(T, { voucherType: "contra", date: "2026-10-02", narration: "bad", simple: { accountId: cash.id, otherAccountId: capital.id, amount: 1 } }, null)).rejects.toMatchObject({ status: 400 });
    const pv = await svc.createEntry(T, { voucherType: "payment", date: "2026-10-03", narration: "October rent", simple: { accountId: bank.id, otherAccountId: rent.id, amount: 30_000 } }, null);
    expect(pv.lines[0]).toMatchObject({ accountName: "Rent", debit: 30_000 });
    const rev = await svc.reverseEntry(T, pv.id, { reason: "Paid twice" }, null);
    expect(rev.voucherType).toBe("reversal");
    expect((await svc.getEntry(T, pv.id)).status).toBe("reversed");
    await expect(svc.reverseEntry(T, pv.id, { reason: "again" }, null)).rejects.toMatchObject({ status: 409 });
    await expect(svc.reverseEntry(T, rev.id, { reason: "undo undo" }, null)).rejects.toMatchObject({ status: 400 });
    const auto = (await svc.listEntries(T, { origin: "auto", limit: 1 })).items[0]!;
    await expect(svc.reverseEntry(T, auto.id, { reason: "no" }, null)).rejects.toMatchObject({ status: 400 });
    expect((await svc.trialBalance(T, { from: "2026-04-01", to: "2026-10-31" })).balanced).toBe(true);
  });

  it("posted lines cannot be edited or deleted in the real tables (database guard)", async () => {
    // The throw-away copy has no triggers; the guard lives in migration 0032 and is checked on the real table.
    const rows = await db.execute(sql`select count(*)::int as n from pg_trigger where tgname in ('acct_lines_immutable', 'acct_entries_immutable') and tgrelid in ('public.acct_lines'::regclass, 'public.acct_entries'::regclass)`);
    expect((rows as unknown as { n: number }[])[0]!.n).toBe(2);
  });

  it("account opening balances post once and the balance sheet balances with stock valued from inventory", async () => {
    const stock = await acct("stock");
    await svc.updateAccount(T, stock.id, { openingBalance: 40_000 });
    stockValue = 55_000;
    const bs = await svc.balanceSheet(T, { asOf: "2026-10-31" });
    expect(bs.balanced).toBe(true);
    expect(bs.stockValue).toBe(55_000);
    const opening = (await svc.listEntries(T, { sourceType: "account_opening" })).items;
    expect(opening.filter((e) => e.status === "posted")).toHaveLength(1);
    await svc.updateAccount(T, stock.id, { openingBalance: 45_000 });
    const after = (await svc.listEntries(T, { sourceType: "account_opening" })).items;
    expect(after.filter((e) => e.status === "posted")).toHaveLength(1);
    expect(after.filter((e) => e.status === "reversed")).toHaveLength(1);
    const pl = await svc.profitLoss(T, { from: "2026-09-01", to: "2026-10-31", compare: "previous" });
    expect(pl.compare).not.toBeNull();
    expect(pl.stock.closing).toBe(55_000);
  });

  it("rejects bad accounts: wrong group for the type, duplicate code, deleting a system account", async () => {
    await expect(svc.createAccount(T, { name: "X", type: "asset", group: "sales" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createAccount(T, { name: "X", type: "asset", group: "current_assets", code: "1000" })).rejects.toMatchObject({ status: 409 });
    await expect(svc.deleteAccount(T, (await acct("cash")).id)).rejects.toMatchObject({ status: 400 });
    const a = await svc.createAccount(T, { name: "Security deposit", type: "asset", group: "current_assets" });
    expect(a.code).toMatch(/^17\d\d$/);
    await svc.deleteAccount(T, a.id);
  });

  async function acct(key: string) {
    return (await svc.listAccounts(T)).find((a) => a.key === key)!;
  }
});
