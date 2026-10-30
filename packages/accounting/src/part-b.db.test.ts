/**
 * Database test of accounting Part B: statement import (idempotent), matching (suggested, cheque, grouped with a
 * difference), entries from statement lines, the reconciliation statement and its confirmation, the cheque register,
 * TDS with Payables settlement, challans and quarterly data, fixed assets and depreciation, and the year-end close.
 * Runs only with `ACCOUNTING_TEST_DATABASE_URL` (a development Postgres with migrations 0032 and 0044 applied); it
 * copies the accounting tables into a throw-away schema and drops it afterwards.
 *   PowerShell: $env:ACCOUNTING_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run --maxWorkers=2
 */
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAccounting } from "./index";
import type { InvoicePaymentSrc, InvoiceSrc, PurchaseSrc, SourcesPort, SupplierPaymentSrc } from "./ports";

const URL_ = process.env.ACCOUNTING_TEST_DATABASE_URL;
const SCHEMA = `acct_pb_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = [
  "acct_accounts",
  "acct_entries",
  "acct_lines",
  "acct_settings",
  "acct_lock_log",
  "acct_bank_statements",
  "acct_bank_lines",
  "acct_bank_matches",
  "acct_bank_recons",
  "acct_cheques",
  "acct_tds_settings",
  "acct_party_tax",
  "acct_tds_entries",
  "acct_tds_challans",
  "acct_fixed_assets",
  "acct_depreciation",
  "acct_year_closes",
];
const T = "22222222-2222-4222-8222-222222222222";
const SUP = "33333333-3333-4333-8333-333333333333";
const U = "44444444-4444-4444-8444-444444444444";
const enc = (s: string) => new TextEncoder().encode(s);

const invoice = (id: string, date: string, total: number): InvoiceSrc => ({
  id,
  number: `INV-${id}`,
  date,
  status: "paid",
  imported: false,
  customerId: null,
  customerName: "Walk-in",
  subtotal: total,
  discount: 0,
  taxable: total,
  cgst: 0,
  sgst: 0,
  igst: 0,
  roundOff: 0,
  total,
  cancelledOn: null,
});
const pay = (id: string, invoiceId: string, date: string, amount: number, method: InvoicePaymentSrc["method"]): InvoicePaymentSrc => ({ id, invoiceId, invoiceNumber: `INV-${invoiceId}`, customerId: null, customerName: "Walk-in", imported: false, date, amount, method, receiptId: null });

describe.skipIf(!URL_)("accounting Part B against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let acc: ReturnType<typeof createAccounting>;
  const now = new Date("2026-10-20T06:00:00Z");
  const invoices: InvoiceSrc[] = [invoice("a", "2026-10-01", 118_000), invoice("b", "2026-10-02", 20_000), invoice("c", "2026-10-02", 30_000), invoice("old", "2026-03-15", 500_000)];
  const payments: InvoicePaymentSrc[] = [
    pay("p1", "a", "2026-10-01", 118_000, "upi"),
    pay("p2", "b", "2026-10-02", 20_000, "card"),
    pay("p3", "c", "2026-10-02", 30_000, "card"),
    pay("p4", "old", "2026-03-15", 500_000, "bank"),
  ];
  const purchases: PurchaseSrc[] = [
    { id: "55555555-5555-4555-8555-555555555555", billNumber: "KT-9", date: "2026-10-03", status: "recorded", imported: false, supplierId: SUP, supplierName: "Kumar Traders", cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: 5_000_000, cancelledOn: null },
  ];
  const supplierPayments: SupplierPaymentSrc[] = [
    { id: "sp1", supplierId: SUP, supplierName: "Kumar Traders", purchaseBill: "KT-9", purchaseImported: false, kind: "payment", amount: 2_000_000, mode: "cheque", date: "2026-10-04", reversedOn: null },
  ];
  const settlements: { tdsId: string; amount: number; purchaseId: string | null; undone?: string }[] = [];

  const sources: SourcesPort = {
    invoices: async () => invoices,
    invoicePayments: async () => payments,
    receipts: async () => [],
    creditNotes: async () => [],
    purchases: async () => purchases,
    supplierPayments: async () => supplierPayments,
    debitNotes: async () => [],
    expenses: async () => [],
    tills: async () => [],
    openingBalances: async () => ({ customers: [], suppliers: [] }),
    shopStateCode: async () => "33",
    parties: async (_t, type, q) => (type === "supplier" ? [{ id: SUP, name: "Kumar Traders", gstin: "33ABCFK1234F1Z5", phone: null }] : []).filter((p) => !q?.ids?.length || q.ids.includes(p.id)),
    settleSupplierTds: async (_t, p) => {
      settlements.push({ tdsId: p.tdsId, amount: p.amount, purchaseId: p.purchaseId });
      return `payment:${p.tdsId}`;
    },
    unsettleSupplierTds: async (_t, id, reason) => {
      const s = settlements.find((x) => `payment:${x.tdsId}` === id);
      if (s) s.undone = reason;
    },
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 6 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    acc = createAccounting({
      db,
      sources,
      now: () => now,
      reconcile: {
        customerBalances: async () => [],
        // Payables after the payment and the TDS settled on the bill.
        supplierBalances: async () => {
          const due = 5_000_000 - 2_000_000 - settlements.filter((s) => !s.undone).reduce((t, s) => t + s.amount, 0);
          return due ? [{ id: SUP, name: "Kumar Traders", balance: due }] : [];
        },
        salesGst: async () => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0 }),
        purchaseItc: async () => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0 }),
      },
    });
    await acc.service.backfill(T, {});
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close();
  });

  let bankId: string;
  const STATEMENT = [
    "HDFC BANK Ltd.,,,,,,",
    "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
    // Opening balance in the bank = what the books hold before October: Rs 5,000 from the March payment.
    "01/10/26,UPI-WALKIN-627412345678,627412345678,01/10/26,,1180.00,6180.00",
    "03/10/26,CARD SETTLEMENT 02OCT,CS1002,03/10/26,,490.00,6670.00",
    "07/10/26,SMS CHARGES,,07/10/26,17.70,,6652.30",
    "08/10/26,CLG CHQ PAID KUMAR TRADERS,000456789,08/10/26,20000.00,,-13347.70",
    "10/10/26,INT.PD:01-07-2026 TO 30-09-2026,,10/10/26,,312.00,-13035.70",
  ].join("\n");

  it("imports a statement, and importing it again adds nothing", async () => {
    const accounts = await acc.bank.accounts(T);
    bankId = accounts.items[0]!.id;
    const preview = await acc.bank.preview(T, bankId, enc(STATEMENT), { fileName: "hdfc.csv" });
    expect(preview).toMatchObject({ layout: "hdfc", counts: { lines: 5, new: 5, duplicates: 0 } });
    const first = await acc.bank.import(T, bankId, enc(STATEMENT), { fileName: "hdfc.csv" }, U);
    expect(first).toMatchObject({ lines: 5, added: 5, duplicates: 0 });
    const again = await acc.bank.import(T, bankId, enc(STATEMENT), { fileName: "hdfc.csv" }, U);
    expect(again).toMatchObject({ added: 0, duplicates: 5 });
    expect((await acc.bank.preview(T, bankId, enc(STATEMENT))).counts).toMatchObject({ new: 0, duplicates: 5 });
    expect((await acc.bank.statements(T, bankId)).items).toHaveLength(2);
  });

  it("suggests matches: UPI one-to-one, two card payments for one settlement less the fee", async () => {
    const ws = await acc.bank.workspace(T, { accountId: bankId });
    expect(ws.bankLines).toHaveLength(5);
    const upi = ws.suggestions.find((s) => s.bankIds.includes(ws.bankLines[0]!.id));
    // Same day, the only line with this amount, but no shared words: suggested at 85 (bulk accept at 85+ in the screen).
    expect(upi?.confidence).toBe(85);
    const r = await acc.bank.autoMatch(T, { accountId: bankId, minConfidence: 85 }, U);
    expect(r.matched).toBeGreaterThanOrEqual(1);
    // The card settlement is Rs 490 for Rs 500 of card payments: match with the Rs 10 fee to Bank charges.
    const ws2 = await acc.bank.workspace(T, { accountId: bankId });
    const settle = ws2.bankLines.find((b) => b.reference === "CS1002")!;
    const cards = ws2.bookLines.filter((b) => b.amount === 20_000 || b.amount === 30_000).map((b) => b.id);
    expect(cards).toHaveLength(2);
    await expect(acc.bank.match(T, { accountId: bankId, bankLineIds: [settle.id], bookLineIds: cards }, U)).rejects.toThrow(/don't agree/);
    const charges = (await acc.service.listAccounts(T)).find((a) => a.key === "bank_charges")!;
    const m = await acc.bank.match(T, { accountId: bankId, bankLineIds: [settle.id], bookLineIds: cards, differenceAccountId: charges.id, note: "Card fee" }, U);
    expect(m.differenceEntryId).toBeTruthy();
    // Unmatching reverses the difference entry; match again.
    await acc.bank.unmatch(T, m.groupId, { userId: U });
    const diff = await acc.service.getEntry(T, m.differenceEntryId!);
    expect(diff.status).toBe("reversed");
    await acc.bank.match(T, { accountId: bankId, bankLineIds: [settle.id], bookLineIds: cards, differenceAccountId: charges.id }, U);
  });

  it("a cheque in the register matches its clearing by number, weeks later, and is marked cleared", async () => {
    const book = (await acc.bank.bookLines(T, bankId, { onlyOpen: true })).find((b) => b.amount === -2_000_000)!;
    const chq = await acc.bank.createCheque(T, { direction: "issued", accountId: bankId, chequeNo: "456789", chequeDate: "2026-10-04", amount: 2_000_000, partyName: "Kumar Traders", acctLineId: book.id }, U);
    const ws = await acc.bank.workspace(T, { accountId: bankId });
    const s = ws.suggestions.find((x) => x.bookIds.includes(book.id))!;
    expect(s.reasons).toContain("Cheque 456789 agrees");
    await acc.bank.match(T, { accountId: bankId, bankLineIds: s.bankIds, bookLineIds: s.bookIds }, U);
    const list = await acc.bank.cheques(T, {});
    expect(list.items.find((c) => c.id === chq.id)).toMatchObject({ status: "cleared", clearedOn: "2026-10-08" });
  });

  it("entries from statement lines (charges, interest) are posted, matched, and left alone by the document sync", async () => {
    const ws = await acc.bank.workspace(T, { accountId: bankId });
    const sms = ws.bankLines.find((b) => b.narration === "SMS CHARGES")!;
    const int = ws.bankLines.find((b) => b.narration.startsWith("INT.PD"))!;
    const e1 = await acc.bank.createEntry(T, sms.id, { preset: "bank_charges" }, U);
    await acc.bank.createEntry(T, int.id, { preset: "interest_received" }, U);
    const entry = await acc.service.getEntry(T, e1.entryId);
    expect(entry).toMatchObject({ sourceType: "bank_entry", origin: "auto", total: 1_770, kindLabel: "From the bank statement" });
    const sync = await acc.service.sync(T);
    expect(sync.reversed).toBe(0);
    expect((await acc.service.getEntry(T, e1.entryId)).status).toBe("posted");
    expect((await acc.bank.workspace(T, { accountId: bankId })).bankLines).toHaveLength(0);
  });

  it("the reconciliation statement agrees with the bank, is confirmed, and freezes the matches", async () => {
    const st = await acc.bank.reconciliation(T, { accountId: bankId, asOf: "2026-10-19" });
    expect(st.statementBalance).toBe(-1_303_570);
    expect(st.bookBalance).toBe(-1_303_570);
    expect(st.difference).toBe(0);
    const table = await acc.service.reportTable(T, "bank-reconciliation", { accountId: bankId, asOf: "2026-10-19" });
    expect(table.rows.at(-1)!.cells.amount).toBe(0);
    const c = await acc.bank.confirm(T, { accountId: bankId, asOf: "2026-10-19", note: null }, U);
    expect(c).toMatchObject({ confirmed: true, suggestLock: "2026-10-19" });
    const groups = await acc.bank.matchedGroups(T, bankId);
    expect(groups.items.every((g) => g.reconciled)).toBe(true);
    await expect(acc.bank.unmatch(T, groups.items[0]!.groupId)).rejects.toThrow(/confirmed reconciliation/);
    await acc.bank.reopen(T, { accountId: bankId, after: "2026-10-01", reason: "test" });
    expect((await acc.bank.matchedGroups(T, bankId)).items.some((g) => g.reconciled)).toBe(false);
  });

  it("an uncleared cheque shows in the statement on an earlier date", async () => {
    const st = await acc.bank.reconciliation(T, { accountId: bankId, asOf: "2026-10-05" });
    expect(st.notInBankPayments.map((l) => l.amount)).toContain(-2_000_000);
    expect(st.difference).toBe(0);
  });

  it("TDS on a supplier bill: Dr Creditors / Cr TDS payable, settled in Payables, deposited by challan, in the quarterly data", async () => {
    await acc.tds.updateSettings(T, { enabled: true, tan: "CHEA12345B" });
    const party = await acc.tds.setParty(T, "supplier", SUP, { defaultSection: "194C" });
    expect(party).toMatchObject({ effectivePan: "ABCFK1234F", deducteeType: "firm" });
    const c = await acc.tds.compute(T, { section: "194C", partyType: "supplier", partyId: SUP, base: 5_000_000, date: "2026-10-05", sourceType: "purchase", sourceId: purchases[0]!.id });
    expect(c).toMatchObject({ applies: true, rate: 200, amount: 100_000 });
    const cand = await acc.tds.candidates(T, {});
    expect(cand.items.map((i) => i.billNumber)).toEqual(["KT-9"]);
    const e = await acc.tds.createEntry(T, { kind: "tds", section: "194C", date: "2026-10-05", partyType: "supplier", partyId: SUP, base: 5_000_000, rate: 200, amount: 100_000, sourceType: "purchase", sourceId: purchases[0]!.id }, U);
    expect(settlements).toHaveLength(1);
    await expect(acc.tds.createEntry(T, { kind: "tds", section: "194C", date: "2026-10-05", partyType: "supplier", partyId: SUP, base: 5_000_000, rate: 200, amount: 100_000, sourceType: "purchase", sourceId: purchases[0]!.id }, U)).rejects.toThrow(/already recorded/);
    const entry = await acc.service.getEntry(T, e.entryId!);
    expect(entry.lines.map((l) => [l.accountName, l.debit, l.credit, l.partyId])).toEqual([
      ["Suppliers (sundry creditors)", 100_000, 0, SUP],
      ["TDS payable", 0, 100_000, null],
    ]);
    const checks = await acc.service.reconcile(T, {});
    expect(checks.checks.find((x) => x.key === "payables")).toMatchObject({ ok: true });
    expect((await acc.tds.payable(T, {})).items[0]).toMatchObject({ month: "2026-10", deducted: 100_000, balance: 100_000, dueDate: "2026-11-07", status: "due" });
    const ch = await acc.tds.createChallan(T, { kind: "tds", period: "2026-10", bsrCode: "0510308", challanNo: "00042", date: "2026-10-18", tax: 100_000, interest: 0, fee: 0, paidFromAccountId: bankId }, U);
    expect(ch).toMatchObject({ allocated: 100_000, entries: 1, unallocated: 0 });
    expect((await acc.tds.payable(T, {})).items[0]).toMatchObject({ balance: 0, status: "paid" });
    expect((await acc.tds.payable(T, {})).ledgerBalance.tds).toBe(0);
    const q = await acc.tds.quarterly(T, { quarter: "2026-27-Q3", kind: "tds" });
    expect(q.deductees).toHaveLength(1);
    expect(q.deductees[0]).toMatchObject({ section: "194C", pan: "ABCFK1234F", amount: 100_000, bsrCode: "0510308", challanNo: "00042", deposited: true });
    const cert = await acc.service.reportTable(T, "tds-certificate", { partyId: SUP, quarter: "2026-27-Q3" });
    expect(cert.title).toMatch(/certificate summary/);
    expect(cert.notes!.join(" ")).toMatch(/NOT Form 16A/);
    await expect(acc.tds.cancelEntry(T, e.id, { reason: "x" }, U)).rejects.toThrow(/Cancel the challan first/);
    await acc.tds.cancelChallan(T, ch.id, { reason: "wrong BSR" }, U);
    await acc.tds.cancelEntry(T, e.id, { reason: "entered twice" }, U);
    expect(settlements[0]!.undone).toMatch(/entered twice/);
    expect((await acc.tds.payable(T, {})).ledgerBalance.tds).toBe(0);
  });

  it("fixed asset: bought from the bank, depreciation posted once per day, sold with a gain", async () => {
    const accounts = await acc.service.listAccounts(T);
    const furniture = accounts.find((a) => a.code === "1500")!;
    const a = await acc.assets.create(T, { name: "Billing counter", assetAccountId: furniture.id, purchaseDate: "2026-04-01", cost: 12_000_000, method: "slm", lifeMonths: 60, record: "purchase", paidFromAccountId: bankId }, U);
    expect(a.purchaseEntryId).toBeTruthy();
    const run = await acc.assets.run(T, { upTo: "2026-09-30" }, U);
    expect(run.total).toBe(Math.round((2_400_000 * 183) / 365 / 100) * 100);
    const again = await acc.assets.run(T, { upTo: "2026-09-30" }, U);
    expect(again).toMatchObject({ posted: false, total: 0 });
    const sold = await acc.assets.dispose(T, a.id, { date: "2026-10-16", saleAmount: 11_500_000, receivedInAccountId: bankId }, U);
    expect(sold.status).toBe("disposed");
    const bal = await acc.service.listAccounts(T, { balances: true, asOf: "2026-10-19" });
    expect(bal.find((x) => x.key === "accumulated_depreciation")!.balance).toBe(0);
    expect(bal.find((x) => x.id === furniture.id)!.balance).toBe(0);
    const tb = await acc.service.trialBalance(T, { from: "2026-04-01", to: "2026-10-19" });
    expect(tb.balanced).toBe(true);
  });

  it("year-end close: profit to retained earnings, P&L still shows the year, lock moved; re-open reverses it", async () => {
    const pre = await acc.yearEnd.preview(T, { fy: "2025-26" });
    expect(pre.netProfit).toBe(500_000);
    expect(pre.blocking).toEqual([]);
    const closed = await acc.yearEnd.close(T, { fy: "2025-26", note: "Audited" }, U);
    expect(closed.closed).toMatchObject({ fy: "2025-26", netProfit: 500_000 });
    expect((await acc.service.getSettings(T)).lockedThrough).toBe("2026-03-31");
    const pnl = await acc.service.profitLoss(T, { from: "2025-04-01", to: "2026-03-31" });
    expect(pnl.netProfit).toBe(500_000);
    const bs = await acc.service.balanceSheet(T, { asOf: "2026-03-31" });
    expect(bs.balanced).toBe(true);
    expect(bs.profitToDate).toBe(0);
    const re = bs.equity.flatMap((g) => g.lines).find((l) => l.name.startsWith("Retained earnings"));
    expect(re?.amount).toBe(500_000);
    const tb = await acc.service.trialBalance(T, { from: "2026-04-01", to: "2026-10-19" });
    expect(tb.balanced).toBe(true);
    const sales = tb.rows.find((r) => r.code === "4000")!;
    expect(sales.openingCr).toBe(0);
    await expect(acc.yearEnd.close(T, { fy: "2025-26" }, U)).rejects.toThrow(/already closed/);
    const reopened = await acc.yearEnd.reopen(T, { fy: "2025-26", reason: "Missed a bill" }, U);
    expect(reopened.closed).toBeNull();
    expect((await acc.service.getSettings(T)).lockedThrough).toBe("2025-03-31");
    expect((await acc.service.balanceSheet(T, { asOf: "2026-03-31" })).profitToDate).toBe(500_000);
  });
});
