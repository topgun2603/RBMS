/**
 * Debit notes to customers against Postgres (docs/expenses-debit-notes.md): own series, GST by line, the credit book
 * (balance, ledger, receipts settle the note after the open bills, deleting the receipt gives it back), cancel rules,
 * the bill can't be cancelled under a note, and the GST summary (CDNR type D). Runs only with
 * `INVOICES_TEST_DATABASE_URL` set; it copies the tables into a throw-away schema and drops it afterwards.
 */
import { randomUUID } from "node:crypto";
import { AppError } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { gstinCheckChar } from "@srirealtime/gst";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InvoicesService } from "./service";

const URL_ = process.env.INVOICES_TEST_DATABASE_URL;
const SCHEMA = `debitnotes_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = [
  "billing_customers",
  "billing_items",
  "invoices",
  "invoice_payments",
  "invoice_series",
  "credit_notes",
  "credit_note_series",
  "sales_debit_notes",
  "sales_debit_note_series",
  "sales_debit_note_allocations",
  "till_sessions",
  "invoice_messages",
  "invoice_reminders",
  "customer_receipts",
];
const newTenant = () => ({ id: randomUUID(), slug: "sri", planId: "pro", appId: "BL" });
const g = (first14: string) => first14 + gstinCheckChar(first14);
const BUYER = g("33AAGCB7383J1Z");

describe.skipIf(!URL_)("debit notes to customers (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let invoices: InvoicesService;
  let tenant = newTenant();
  let clock = new Date("2026-10-15T06:00:00Z"); // 15 Oct 2026 IST
  const events: string[] = [];

  // 10 shirts at ₹500 + 5%: ₹5,250.
  const shirt = { description: "Cotton shirt", hsn: "6205", qty: 10, unit: "pcs", rate: 50_000, gstRate: 5 as const };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 6 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    invoices = new InvoicesService({
      db,
      seller: { get: async () => ({ legalName: "Kumar Textiles", gstin: g("33AAACR5055K1Z"), stateCode: "33", address: "1 Car St", city: "Madurai" }) },
      branding: { get: async () => ({ appName: "Kumar", logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com",
      events: { debitNoteIssued: (_t, n) => void events.push(`issued ${n.number}`), debitNoteCancelled: (_t, n) => void events.push(`cancelled ${n.number}`) },
      now: () => clock,
    });
  });
  beforeEach(() => {
    tenant = newTenant();
    clock = new Date("2026-10-15T06:00:00Z");
    events.length = 0;
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close?.();
  });

  const billFor = async (customerId: string, date = "2026-10-02") => invoices.create(tenant, { customerId, date, lines: [shirt], issue: true });

  it("issues a debit note in its own series with GST by line, and the customer owes more", async () => {
    const c = await invoices.createCustomer(tenant.id, { name: "Meena Stores", phone: "9000000001", gstin: BUYER, stateCode: "33" });
    const bill = await billFor(c.id);
    expect(bill.total).toBe(525_000);
    const dn = await invoices.debitNotes.create(tenant.id, bill.id, {
      reason: "price_revision",
      note: "Rate revised from ₹500 to ₹520 as agreed",
      lines: [{ line: 0, qty: 10, rate: 2_000 }],
    });
    expect(dn).toMatchObject({ number: "DN/26-27/0001", status: "issued", invoiceNumber: bill.number, invoiceTotal: 525_000, total: 21_000, paid: 0, balance: 21_000, canCancel: true });
    expect(dn.lines[0]).toMatchObject({ line: 0, hsn: "6205", gstRate: 5, taxable: 20_000, cgst: 500, sgst: 500 });
    expect(events).toEqual(["issued DN/26-27/0001"]);
    const second = await invoices.debitNotes.create(tenant.id, bill.id, { reason: "freight", lines: [{ description: "Freight", hsn: "9965", qty: 1, rate: 10_000, gstRate: 5 }] });
    expect(second.number).toBe("DN/26-27/0002");

    // Credit book: bill + both notes; the ledger shows them as debits.
    const book = await invoices.creditBook(tenant.id, {});
    expect(book.items.find((i) => i.customer.id === c.id)?.balance).toBe(525_000 + 21_000 + 10_500);
    const ledger = await invoices.ledger(tenant.id, c.id);
    expect(ledger.entries.filter((e) => e.type === "debit_note").map((e) => [e.number, e.debit])).toEqual([
      ["DN/26-27/0001", 21_000],
      ["DN/26-27/0002", 10_500],
    ]);
    expect(ledger.closingBalance).toBe(556_500);

    // GST summary of October: the bill in B2B, the notes in CDNR as type D, totals up by the notes.
    const s = await invoices.gstSummary(tenant.id, { from: "2026-10-01", to: "2026-10-31" });
    expect(s.cdnr.map((r) => [r.noteNumber, r.noteType, r.taxable])).toEqual([
      ["DN/26-27/0001", "D", 20_000],
      ["DN/26-27/0002", "D", 10_000],
    ]);
    expect(s.totals).toMatchObject({ debitNotes: 2, taxable: 530_000, cgst: 13_250, sgst: 13_250 });
  });

  it("a receipt pays the open bills first, then the debit notes; deleting it gives the note's balance back", async () => {
    const c = await invoices.createCustomer(tenant.id, { name: "Ravi", phone: "9000000002" });
    const bill = await billFor(c.id);
    const dn = await invoices.debitNotes.create(tenant.id, bill.id, { reason: "short_billed", lines: [{ line: 0, qty: 2, rate: 50_000 }] });
    expect(dn.total).toBe(105_000);
    // Receivables ageing counts the note's open balance with the bill's.
    const age = await invoices.ageing(tenant.id, {});
    expect(age.buckets.reduce((t, b) => t + b.amount, 0)).toBe(525_000 + 105_000);
    const r = await invoices.addReceipt(tenant.id, c.id, { amount: 600_000, method: "upi", date: "2026-10-15" });
    expect(r.allocations).toEqual([expect.objectContaining({ invoiceId: bill.id, amount: 525_000 })]);
    // ₹750 left after the bill: ₹1,050 note gets ₹750, nothing left as advance.
    expect(r.advance).toBe(0);
    expect((await invoices.debitNotes.get(tenant.id, dn.id)).balance).toBe(30_000);
    expect((await invoices.creditBook(tenant.id, {})).items.find((i) => i.customer.id === c.id)?.balance).toBe(30_000);
    // More than everything owed: the rest is advance.
    const r2 = await invoices.addReceipt(tenant.id, c.id, { amount: 50_000, method: "cash", date: "2026-10-15" });
    expect(r2.advance).toBe(20_000);
    expect((await invoices.debitNotes.get(tenant.id, dn.id)).paid).toBe(105_000);
    // A note with money against it can't be cancelled; delete the receipt and it can.
    await expect(invoices.debitNotes.cancel(tenant.id, dn.id, "typo")).rejects.toMatchObject({ code: "debit_note_locked" });
    await invoices.deleteReceipt(tenant.id, c.id, r.receipt.id);
    await invoices.deleteReceipt(tenant.id, c.id, r2.receipt.id);
    expect((await invoices.debitNotes.get(tenant.id, dn.id)).paid).toBe(0);
    const cancelled = await invoices.debitNotes.cancel(tenant.id, dn.id, "typo");
    expect(cancelled.status).toBe("cancelled");
    expect((await invoices.creditBook(tenant.id, {})).items.find((i) => i.customer.id === c.id)?.balance).toBe(525_000);
    expect(events).toContain(`cancelled ${dn.number}`);
  });

  it("guards: bill issued, not before the bill, not in the future, cancel same day only, bill can't be cancelled under a note", async () => {
    const c = await invoices.createCustomer(tenant.id, { name: "Selvi", phone: "9000000003" });
    const draft = await invoices.create(tenant, { customerId: c.id, date: "2026-10-02", lines: [shirt] });
    const line = [{ line: 0, qty: 1, rate: 1_000 }];
    await expect(invoices.debitNotes.create(tenant.id, draft.id, { reason: "other", lines: line })).rejects.toMatchObject({ code: "debit_note_blocked" });
    const bill = await billFor(c.id);
    await expect(invoices.debitNotes.create(tenant.id, bill.id, { reason: "other", date: "2026-10-01", lines: line })).rejects.toBeInstanceOf(AppError);
    await expect(invoices.debitNotes.create(tenant.id, bill.id, { reason: "other", date: "2026-10-16", lines: line })).rejects.toBeInstanceOf(AppError);
    await expect(invoices.debitNotes.create(tenant.id, bill.id, { reason: "other", lines: [{ line: 0, qty: 1, rate: 1_000, gstRate: 18 }] })).rejects.toMatchObject({
      code: "debit_note_rate_mismatch",
    });
    const dn = await invoices.debitNotes.create(tenant.id, bill.id, { reason: "other", lines: line });
    await expect(invoices.cancel(tenant.id, bill.id, "wrong bill")).rejects.toMatchObject({ code: "invoice_has_debit_notes" });
    clock = new Date("2026-10-16T06:00:00Z");
    await expect(invoices.debitNotes.cancel(tenant.id, dn.id)).rejects.toMatchObject({ code: "debit_note_locked" });
    const list = await invoices.debitNotes.list(tenant.id, { invoiceId: bill.id });
    expect(list.items.map((i) => i.number)).toEqual([dn.number]);
    expect(list.totals).toMatchObject({ issued: 1, total: dn.total, balance: dn.total });
  });
});
