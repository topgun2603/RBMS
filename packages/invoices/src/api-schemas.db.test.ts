/**
 * Database test of the API document shapes (routes.ts): runs the counter-billing routes (customers, till, bills,
 * payments, share, list) and the credit book (ledger, receipts, statement link, reminder) against Postgres and checks every JSON answer with its response schema, so the schemas
 * can't drift from what the routes really return. Runs only with `INVOICES_TEST_DATABASE_URL` set (a development
 * Postgres that has the invoices tables migrated); it copies them into a throw-away schema and drops it afterwards.
 *   PowerShell: $env:INVOICES_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { todayIST } from "@srirealtime/gst";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError, type ZodTypeAny } from "zod";
import {
  billingItemListSchema,
  billingItemSchema,
  creditBookSchema,
  customerListSchema,
  customerSchema,
  dashboardSummarySchema,
  invoiceListSchema,
  invoiceSchema,
  invoicesRoutes,
  ledgerSchema,
  receiptResultSchema,
  sendResultSchema,
  shareLinkSchema,
  tillCurrentSchema,
  tillReportResponseSchema,
  tillSessionSchema,
} from "./routes";
import { InvoicesService } from "./service";

const URL_ = process.env.INVOICES_TEST_DATABASE_URL;
const SCHEMA = `invoices_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = [
  "billing_customers",
  "billing_items",
  "invoices",
  "invoice_payments",
  "invoice_series",
  "customer_receipts",
  "invoice_reminders",
  "invoice_messages",
  "credit_notes",
  "credit_note_series",
  "till_sessions",
];
const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "BL" };
const user = { id: "22222222-2222-4222-8222-222222222222", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };

describe.skipIf(!URL_)("invoices API shapes against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let service: InvoicesService;
  const today = todayIST(new Date());

  /** Sends a request and checks the 200 JSON answer against `schema`, with nothing left over (the parsed value comes back). */
  async function call<T extends ZodTypeAny>(schema: T, method: "GET" | "POST" | "PATCH", url: string, payload?: object) {
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(200);
    const json = res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(`${method} ${url}: ${parsed.error.message}`);
    // zod strips unknown keys, so equality also catches fields the schema doesn't document.
    expect(parsed.data, `${method} ${url}: undocumented fields`).toEqual(json);
    return parsed.data as ReturnType<T["parse"]>;
  }

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    service = new InvoicesService({
      db,
      seller: { get: async () => ({ legalName: "Sri Stores", gstin: "33AAACR5055K1ZE", stateCode: "33", address: "1 Car St", city: "Madurai" }) },
      branding: { get: async () => ({ appName: null, logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com",
      notifier: { send: async () => ({ logId: "log-1" }) },
    });
    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant, user } as RequestContext;
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
    });
    await app.register(invoicesRoutes(service), { prefix: "/v1/invoices" });
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("customers, till, bills, payments, share and lists match their response schemas", async () => {
    // customers
    const customer = await call(customerSchema, "POST", "/v1/invoices/customers", { name: "Ravi", phone: "9876543210", creditLimit: 500_000 });
    expect(await call(customerSchema, "GET", `/v1/invoices/customers/${customer.id}`)).toMatchObject({ id: customer.id, name: "Ravi" });

    // items (the built-in table when no catalogue is wired)
    const item = await service.createItem(tenant.id, { name: "Rice 1kg", hsn: "1006", unit: "kg", rate: 6000, gstRate: 5 });
    const items = await call(billingItemListSchema, "GET", "/v1/invoices/items?q=rice&limit=5");
    expect(items.items[0]?.id).toBe(item.id);
    // the mobile price editor's fallback when catalogue variants are off
    expect(await call(billingItemSchema, "PATCH", `/v1/invoices/items/${item.id}`, { rate: 6500 })).toMatchObject({ id: item.id, rate: 6500 });

    // till
    expect(await call(tillCurrentSchema, "GET", "/v1/invoices/till/current?register=Counter%201")).toEqual({ session: null });
    const till = await call(tillSessionSchema, "POST", "/v1/invoices/till/open", { register: "Counter 1", openingCount: { "500": 2, "100": 5 }, actorName: "Meena" });
    expect((await call(tillCurrentSchema, "GET", "/v1/invoices/till/current?register=Counter%201")).session?.id).toBe(till.id);
    const afterCash = await call(tillSessionSchema, "POST", `/v1/invoices/till/${till.id}/cash`, { amount: -2000, reason: "Tea", actorName: "Meena" });
    expect(afterCash.cashEntries).toHaveLength(1);

    // a counter bill, issued on create, paid at the till
    const line = { description: "Rice 1kg", hsn: "1006", qty: 2.5, unit: "kg", rate: 6000, gstRate: 5, itemId: item.id, discount: 100 };
    const bill = await call(invoiceSchema, "POST", "/v1/invoices", { customerId: customer.id, date: today, lines: [line], issue: true, tillSessionId: till.id });
    expect(bill.status).toBe("issued");
    const paid = await call(invoiceSchema, "POST", `/v1/invoices/${bill.id}/payments`, {
      amount: bill.total,
      method: "cash",
      date: today,
      tillSessionId: till.id,
    });
    expect(paid.status).toBe("paid");
    const link = await call(shareLinkSchema, "POST", `/v1/invoices/${bill.id}/share`);
    expect(link.url).toBe(`https://bill.example.com/i/${link.token}`);
    const got = await call(invoiceSchema, "GET", `/v1/invoices/${bill.id}`);
    expect(got.shareToken).toBe(link.token);
    expect(got.payments).toHaveLength(1);

    // a walk-in draft issued afterwards, then cancelled
    const draft = await call(invoiceSchema, "POST", "/v1/invoices", {
      customer: { name: "Walk-in", phone: "" },
      date: today,
      lines: [{ description: "Bag", qty: 1, rate: 1000, gstRate: 18 }],
    });
    expect(draft.status).toBe("draft");
    const issued = await call(invoiceSchema, "POST", `/v1/invoices/${draft.id}/issue`, {});
    expect(issued.number).not.toBeNull();
    const cancelled = await call(invoiceSchema, "POST", `/v1/invoices/${draft.id}/cancel`, { reason: "Wrong item" });
    expect(cancelled.cancelledAt).not.toBeNull();

    // lists and the dashboard
    const list = await call(invoiceListSchema, "GET", "/v1/invoices?status=paid,cancelled&limit=10");
    expect(list.total).toBe(2);
    expect(list.facets?.status).toBeTruthy();
    const customers = await call(customerListSchema, "GET", "/v1/invoices/customers?q=ravi&limit=6");
    expect(customers.items[0]).toMatchObject({ id: customer.id, totalBilled: bill.total, lastBillDate: today });
    await call(dashboardSummarySchema, "GET", "/v1/invoices/summary");

    // X report, then close the till (Z report)
    const x = await call(tillReportResponseSchema, "GET", `/v1/invoices/till/${till.id}/x`);
    expect(x.report.cash.sales).toBe(bill.total);
    const closed = await call(tillReportResponseSchema, "POST", `/v1/invoices/till/${till.id}/close`, { countedCash: x.report.cash.expected, note: "" });
    expect(closed.session.status).toBe("closed");
    expect(closed.session.summary).not.toBeNull();
  });

  it("credit book, customer update, ledger, receipts, statement link and reminder match their response schemas", async () => {
    const c = await call(customerSchema, "POST", "/v1/invoices/customers", { name: "Kavya", phone: "9876500000", openingBalance: 10_000 });
    const updated = await call(customerSchema, "PATCH", `/v1/invoices/customers/${c.id}`, { creditLimit: 1_000_000, email: "kavya@example.com" });
    expect(updated).toMatchObject({ creditLimit: 1_000_000, email: "kavya@example.com" });
    // A bill on credit, then part of it received on account.
    const bill = await call(invoiceSchema, "POST", "/v1/invoices", {
      customerId: c.id,
      date: today,
      lines: [{ description: "Rice 25kg", qty: 1, rate: 120_000, gstRate: 5 }],
      issue: true,
    });
    const book = await call(creditBookSchema, "GET", "/v1/invoices/credit-book?filter=due&limit=20");
    const row = book.items.find((r) => r.customer.id === c.id);
    expect(row?.balance).toBe(10_000 + bill.total);
    // Money can't be dated after today (IST).
    const tomorrow = todayIST(new Date(Date.now() + 86_400_000));
    const early = await app.inject({ method: "POST", url: `/v1/invoices/customers/${c.id}/receipts`, payload: { amount: 100, method: "cash", date: tomorrow } });
    expect(early.statusCode).toBe(400);
    expect(early.json().error).toBe("A payment can't be dated after today");
    const earlyPay = await app.inject({ method: "POST", url: `/v1/invoices/${bill.id}/payments`, payload: { amount: 100, method: "cash", date: tomorrow } });
    expect(earlyPay.statusCode).toBe(400);
    const receipt = await call(receiptResultSchema, "POST", `/v1/invoices/customers/${c.id}/receipts`, {
      amount: 50_000,
      method: "upi",
      date: today,
      reference: "UPI-1",
      note: "Part payment",
    });
    expect(receipt.allocations[0]).toMatchObject({ invoiceId: bill.id, number: bill.number });
    // More than is due: the rest becomes advance (an allocation-free receipt after the bill is settled).
    const over = await call(receiptResultSchema, "POST", `/v1/invoices/customers/${c.id}/receipts`, { amount: 10_000_000, method: "cash", date: today });
    expect(over.advance).toBeGreaterThan(0);
    const ledger = await call(ledgerSchema, "GET", `/v1/invoices/customers/${c.id}/ledger`);
    expect(ledger.entries.map((e) => e.type)).toEqual(expect.arrayContaining(["opening", "invoice", "receipt"]));
    await call(ledgerSchema, "GET", `/v1/invoices/customers/${c.id}/ledger?from=${today}&to=${today}`);
    await call(creditBookSchema, "GET", "/v1/invoices/credit-book?filter=advance&age=current");
    const link = await call(shareLinkSchema, "POST", `/v1/invoices/customers/${c.id}/statement/share`);
    expect(link.url).toBe(`https://bill.example.com/s/${link.token}`);
    // The reminder needs something due: a second bill.
    await call(invoiceSchema, "POST", "/v1/invoices", {
      customerId: c.id,
      date: today,
      lines: [{ description: "Oil 15L", qty: 1, rate: 20_000_000, gstRate: 5 }],
      issue: true,
    });
    const sent = await call(sendResultSchema, "POST", `/v1/invoices/customers/${c.id}/remind`, { channel: "whatsapp" });
    expect(sent).toEqual({ logId: "log-1", url: link.url });
  });
});
