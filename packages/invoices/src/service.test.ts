import { emptyContext, paymentRequired, type RequestContext } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createInvoices } from "./index";
import { invoicesRoutes } from "./routes";
import {
  allocateSeqStatement,
  customerInputSchema,
  InvoicesService as Service,
  invoiceInputSchema,
  ledgerQuerySchema,
  lineInputSchema,
  onlinePaymentSchema,
  paymentInputSchema,
  receiptInputSchema,
  reportRangeSchema,
  sendInputSchema,
  topQuerySchema,
  type InvoicesService,
} from "./service";

// Never connects: only used to render SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

describe("validation", () => {
  it("accepts a fractional-quantity line and strips empties", () => {
    const l = lineInputSchema.parse({ description: " Saree ", qty: 2.5, rate: 12050, gstRate: 5, hsn: "", unit: "m" });
    expect(l).toEqual({ description: "Saree", qty: 2.5, rate: 12050, gstRate: 5, unit: "m" });
  });
  it("rejects discounts above the amount, 4-decimal quantities and odd GST rates", () => {
    expect(() => lineInputSchema.parse({ description: "x", qty: 1, rate: 100, discount: 101, gstRate: 5 })).toThrow(ZodError);
    expect(() => lineInputSchema.parse({ description: "x", qty: 1.0005, rate: 100, gstRate: 5 })).toThrow(ZodError);
    expect(() => lineInputSchema.parse({ description: "x", qty: 1, rate: 100, gstRate: 7 })).toThrow(ZodError);
    expect(() => lineInputSchema.parse({ description: "x", qty: 1, rate: 10.5, gstRate: 5 })).toThrow(ZodError);
  });
  it("validates customers (GSTIN checksum, state code)", () => {
    const c = customerInputSchema.parse({ name: "Ravi", gstin: "33aaacr5055k1ze", stateCode: 33, email: "" });
    expect(c).toMatchObject({ gstin: "33AAACR5055K1ZE", stateCode: "33", email: null });
    expect(() => customerInputSchema.parse({ name: "Ravi", gstin: "33AAACR5055K1Z8" })).toThrow(ZodError);
    expect(() => customerInputSchema.parse({ name: "Ravi", stateCode: "99" })).toThrow(ZodError);
  });
  it("requires 1–200 lines and real dates", () => {
    const line = { description: "x", qty: 1, rate: 100, gstRate: 0 };
    expect(() => invoiceInputSchema.parse({ date: "2026-10-14", lines: [] })).toThrow(ZodError);
    expect(() => invoiceInputSchema.parse({ date: "2026-02-30", lines: [line] })).toThrow(ZodError);
    expect(() => invoiceInputSchema.parse({ date: "2026-10-14", lines: Array(201).fill(line) })).toThrow(ZodError);
    expect(invoiceInputSchema.parse({ date: "2026-10-14", lines: [line], placeOfSupply: "7" }).placeOfSupply).toBe("07");
  });
  it("validates payments", () => {
    expect(() => paymentInputSchema.parse({ amount: 0, method: "cash", date: "2026-10-14" })).toThrow(ZodError);
    expect(() => paymentInputSchema.parse({ amount: 100, method: "barter", date: "2026-10-14" })).toThrow(ZodError);
    expect(paymentInputSchema.parse({ amount: 100, method: "upi", date: "2026-10-14" }).method).toBe("upi");
  });
});

describe("v2 validation", () => {
  const itemId = "4b0c2a4e-8f0e-4c1a-9d5e-0f6a1b2c3d4e";
  it("keeps a line's saved item id and rejects non-uuids", () => {
    expect(lineInputSchema.parse({ description: "Saree", qty: 1, rate: 100, gstRate: 5, itemId }).itemId).toBe(itemId);
    expect("itemId" in lineInputSchema.parse({ description: "Saree", qty: 1, rate: 100, gstRate: 5, itemId: "" })).toBe(false);
    expect(() => lineInputSchema.parse({ description: "x", qty: 1, rate: 100, gstRate: 5, itemId: "item-1" })).toThrow(ZodError);
  });
  it("accepts signed opening balances and nullable credit limits", () => {
    expect(customerInputSchema.parse({ name: "Ravi", openingBalance: -50_000, creditLimit: "" })).toMatchObject({
      openingBalance: -50_000,
      creditLimit: null,
    });
    expect(() => customerInputSchema.parse({ name: "Ravi", creditLimit: -1 })).toThrow(ZodError);
    expect(() => customerInputSchema.parse({ name: "Ravi", openingBalance: 10.5 })).toThrow(ZodError);
  });
  it("validates receipts, sends and online payments", () => {
    expect(receiptInputSchema.parse({ amount: 500, method: "cash", date: "2026-10-14", note: "" })).toMatchObject({ note: null });
    expect(() => receiptInputSchema.parse({ amount: 0, method: "cash", date: "2026-10-14" })).toThrow(ZodError);
    expect(sendInputSchema.parse({}).channel).toBe("whatsapp");
    expect(() => sendInputSchema.parse({ channel: "email" })).toThrow(ZodError);
    const op = onlinePaymentSchema.parse({
      tenantId: itemId,
      invoiceId: itemId,
      amount: 100,
      method: "wallet",
      providerPaymentId: "pay_1",
      paidAt: "2026-10-14T05:00:00Z",
    });
    expect(op.paidAt).toBeInstanceOf(Date);
  });
  it("validates report periods", () => {
    expect(reportRangeSchema.parse({ from: "2026-04-01", to: "2027-03-31" })).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(() => reportRangeSchema.parse({ from: "2026-04-01" })).toThrow(ZodError);
    expect(() => reportRangeSchema.parse({ from: "2026-04-02", to: "2026-04-01" })).toThrow(ZodError);
    expect(() => reportRangeSchema.parse({ from: "2025-01-01", to: "2026-04-01" })).toThrow(ZodError);
    expect(topQuerySchema.parse({ from: "2026-04-01", to: "2026-04-30", limit: "5" }).limit).toBe(5);
    expect(() => ledgerQuerySchema.parse({ from: "2026-04-02", to: "2026-04-01" })).toThrow(ZodError);
  });
});

describe("customerQuery", () => {
  const svc = new Service({
    db,
    seller: { get: async () => ({}) },
    branding: { get: async () => ({ appName: null, logoUrl: null, css: "" }) },
    publicBaseUrl: "https://bill.example.com",
    now: () => new Date("2026-10-14T06:00:00Z"),
  });
  it("computes balances with grouped subqueries (no N+1)", () => {
    const cq = svc.customerQuery("t1");
    const { sql, params } = cq.rows().where(cq.base).toSQL();
    expect(sql.match(/group by/g)).toHaveLength(3);
    expect(sql).toContain('left join (select "invoices"."customer_id"');
    expect(sql).toContain('"cq_advance"');
    expect(sql).toContain('greatest("cq_last_invoice", "cq_last_payment", "cq_last_receipt")');
    expect(sql).toContain('group by "customer_receipts"."customer_id") "agg_rcp" on "agg_rcp"."customer_id" = "billing_customers"."id"');
    expect(sql).toContain('"invoice_payments"."receipt_id" is null');
    expect(params).toContain("t1");
    expect(params).toContain("2026-10-14");
  });
  it("narrows every subquery to one customer when asked", () => {
    const cq = svc.customerQuery("t1", "c1");
    const { params } = cq.rows().where(cq.base).toSQL();
    expect(params.filter((p) => p === "c1").length).toBe(4);
  });
  it("totals receivables and advances over the same balance", () => {
    const cq = svc.customerQuery("t1");
    const { sql } = cq.totals().where(cq.base).toSQL();
    expect(sql).toContain('sum(greatest(("billing_customers"."opening_balance"');
    expect(sql).toContain("count(*) filter (where");
  });
});

describe("allocateSeqStatement", () => {
  it("upserts and increments the series atomically", () => {
    const { sql, params } = allocateSeqStatement(db, { tenantId: "t1", fy: "26-27", prefix: "INV" }).toSQL();
    expect(sql).toContain('insert into "invoice_series"');
    expect(sql).toContain('on conflict ("tenant_id","fy") do update set');
    expect(sql).toContain('"next_seq" = "invoice_series"."next_seq" + 1');
    expect(sql).toContain('returning "next_seq"');
    expect(params).toContain("t1");
    expect(params).toContain("26-27");
  });
});

describe("routes", () => {
  const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });
  const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "BL" };
  const staffUser = { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };

  async function build(reqCtx: RequestContext, gate?: (feature: string | string[]) => void) {
    const service = {
      list: vi.fn(async () => ({ items: [], total: 0 })),
      getPublic: vi.fn(async () => ({ invoice: { id: "x" }, branding: { appName: null, logoUrl: null, css: "" } })),
      getPublicStatement: vi.fn(async () => ({ customer: { name: "Ravi" } })),
      creditBook: vi.fn(async () => ({ items: [], total: 0, totals: { receivable: 0, advance: 0, customersWithDues: 0 } })),
      summary: vi.fn(async () => ({ ok: 1 })),
      get: vi.fn(async () => ({ id: "inv" })),
      salesRegister: vi.fn(async () => ({
        items: [
          {
            id: "i1",
            number: "INV/26-27/0001",
            date: "2026-10-01",
            customer: "Ravi, Sons",
            gstin: null,
            placeOfSupply: "33",
            taxable: 10000,
            cgst: 250,
            sgst: 250,
            igst: 0,
            total: 10500,
            paid: 0,
            status: "issued",
          },
        ],
        totals: {},
      })),
      gstSummary: vi.fn(async () => ({ b2b: [], b2cl: [], b2cs: [], hsn: [], byRate: [], gstr3b: {}, totals: {} })),
      salesTrend: vi.fn(async () => ({ items: [{ date: "2026-10-14", invoiced: 1, collected: 0, count: 1 }] })),
      sendInvoice: vi.fn(async () => ({ logId: "log1", url: "https://x/i/t" })),
      remindCustomer: vi.fn(async () => ({ logId: "log2", url: "https://x/s/t" })),
      addReceipt: vi.fn(async () => ({ receipt: {}, allocations: [], advance: 0 })),
      ledger: vi.fn(async () => ({
        customer: {},
        openingBalance: 0,
        entries: [{ date: "2026-10-01", type: "opening", refId: null, number: null, description: "Opening balance", debit: 0, credit: 0, balance: 0 }],
        closingBalance: 0,
      })),
    } as unknown as InvoicesService;
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = reqCtx;
    });
    // Stands in for the API host's feature preHandler.
    app.addHook("preHandler", async (req) => {
      const feature = req.routeOptions.config.feature;
      if (gate && feature && req.ctx.tenant) gate(feature);
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: true });
    });
    await app.register(invoicesRoutes(service), { prefix: "/v1/invoices" });
    return { app, service };
  }

  it("serves the public route without auth", async () => {
    const { app, service } = await build(ctx({}));
    const res = await app.inject({ method: "GET", url: "/v1/invoices/public/abcdefghijklmnopqrstuv" });
    expect(res.statusCode).toBe(200);
    expect(service.getPublic).toHaveBeenCalledWith("abcdefghijklmnopqrstuv", null);
  });

  it("requires a signed-in staff member of the tenant", async () => {
    expect((await (await build(ctx({ tenant }))).app.inject({ url: "/v1/invoices" })).statusCode).toBe(401);
    const member = { ...staffUser, tenantRoles: ["member"] };
    expect((await (await build(ctx({ tenant, user: member }))).app.inject({ url: "/v1/invoices" })).statusCode).toBe(403);
    const { app } = await build(ctx({ tenant, user: staffUser }));
    const res = await app.inject({ url: "/v1/invoices/summary" });
    expect(res.statusCode).toBe(200);
  });

  it("declares each route's feature in its config", async () => {
    const seen: (string | string[])[] = [];
    const { app, service } = await build(ctx({ tenant, user: staffUser }), (f) => {
      seen.push(f);
      if (f === "invoices.credit-book") throw paymentRequired("Credit book is not included in your plan", { feature: f, reason: "plan" });
    });
    const id = "22222222-2222-4222-8222-222222222222";
    const cases: [string, string, string][] = [
      ["GET", "/v1/invoices", "invoices"],
      ["GET", "/v1/invoices/summary", "invoices"],
      ["GET", "/v1/invoices/items", "invoices"],
      ["POST", `/v1/invoices/${id}/send`, "invoices.whatsapp"],
      ["POST", `/v1/invoices/customers/${id}/remind`, "invoices.whatsapp"],
      ["GET", "/v1/invoices/credit-book", "invoices.credit-book"],
      ["GET", `/v1/invoices/customers/${id}/ledger`, "invoices.credit-book"],
      ["POST", `/v1/invoices/customers/${id}/receipts`, "invoices.credit-book"],
      ["POST", `/v1/invoices/customers/${id}/statement/share`, "invoices.credit-book"],
      ["GET", "/v1/invoices/reports/sales-register?from=2026-10-01&to=2026-10-31", "invoices.reports"],
      ["GET", "/v1/invoices/reports/gst-summary?from=2026-10-01&to=2026-10-31", "invoices.gst-reports"],
      ["GET", "/v1/invoices/public/abcdefghijklmnopqrstuv", "invoices"],
      ["GET", "/v1/invoices/public/statement/abcdefghijklmnopqrstuv", "invoices.credit-book"],
    ];
    for (const [method, url, feature] of cases) {
      seen.length = 0;
      await app.inject({ method: method as "GET", url, payload: method === "POST" ? {} : undefined });
      expect([url, seen]).toEqual([url, [feature]]);
    }
    expect(service.creditBook).not.toHaveBeenCalled();
    expect((await app.inject({ url: "/v1/invoices/credit-book" })).statusCode).toBe(402);
  });

  it("serves the public statement without auth", async () => {
    const { app, service } = await build(ctx({}));
    const res = await app.inject({ url: "/v1/invoices/public/statement/abcdefghijklmnopqrstuv" });
    expect(res.statusCode).toBe(200);
    expect(service.getPublicStatement).toHaveBeenCalledWith("abcdefghijklmnopqrstuv", null);
    expect(service.getPublic).not.toHaveBeenCalled();
  });

  it("routes reports before /:id and returns CSV on request", async () => {
    const { app, service } = await build(ctx({ tenant, user: staffUser }));
    const json = await app.inject({ url: "/v1/invoices/reports/sales-register?from=2026-10-01&to=2026-10-31" });
    expect(json.statusCode).toBe(200);
    expect(service.get).not.toHaveBeenCalled();
    expect(service.salesRegister).toHaveBeenCalledWith(tenant.id, { from: "2026-10-01", to: "2026-10-31" });

    const csv = await app.inject({ url: "/v1/invoices/reports/sales-register?from=2026-10-01&to=2026-10-31&format=csv" });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(csv.headers["content-disposition"]).toBe('attachment; filename="sales-register-2026-10-01-2026-10-31.csv"');
    expect(csv.body.startsWith("﻿Date,Invoice,Customer")).toBe(true);
    expect(csv.body).toContain('2026-10-01,INV/26-27/0001,"Ravi, Sons",,33,100.00,2.50,2.50,0.00,105.00,0.00,issued\r\n');

    const gst = await app.inject({ url: "/v1/invoices/reports/gst-summary?from=2026-10-01&to=2026-10-31&format=csv&section=b2b" });
    expect(gst.headers["content-disposition"]).toContain("gst-b2b-2026-10-01-2026-10-31.csv");
    expect((await app.inject({ url: "/v1/invoices/reports/gst-summary?format=csv&section=nope" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/v1/invoices/reports/sales-trend?format=xml" })).statusCode).toBe(400);
    const trend = await app.inject({ url: "/v1/invoices/reports/sales-trend?days=1&format=csv" });
    expect(trend.headers["content-disposition"]).toContain("sales-trend-2026-10-14-2026-10-14.csv");
  });

  it("wires sending, reminders, receipts and the ledger", async () => {
    const { app, service } = await build(ctx({ tenant, user: staffUser }));
    const id = "22222222-2222-4222-8222-222222222222";
    const send = await app.inject({ method: "POST", url: `/v1/invoices/${id}/send`, payload: { channel: "sms" } });
    expect(send.json()).toEqual({ logId: "log1", url: "https://x/i/t" });
    expect(service.sendInvoice).toHaveBeenCalledWith(tenant.id, id, { channel: "sms" });
    await app.inject({ method: "POST", url: `/v1/invoices/customers/${id}/remind` });
    expect(service.remindCustomer).toHaveBeenCalledWith(tenant.id, id, {});
    await app.inject({ method: "POST", url: `/v1/invoices/customers/${id}/receipts`, payload: { amount: 100 } });
    expect(service.addReceipt).toHaveBeenCalledWith(tenant.id, id, { amount: 100 }, "u1");
    const ledger = await app.inject({ url: `/v1/invoices/customers/${id}/ledger?format=csv` });
    expect(ledger.headers["content-disposition"]).toBe('attachment; filename="ledger-2026-10-01-2026-10-01.csv"');
  });

  it("rejects non-uuid ids", async () => {
    const { app } = await build(ctx({ tenant, user: staffUser }));
    expect((await app.inject({ url: "/v1/invoices/not-a-uuid" })).statusCode).toBe(404);
    // Only hex/hyphen ids of UUID length reach the handler (zod then validates the exact format).
    expect((await app.inject({ url: "/v1/invoices/zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/v1/invoices/11111111-1111-1111-1111-11111111111g" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/v1/invoices/------------------------------------" })).statusCode).toBe(400);
  });

  it("the old /khata path is gone", async () => {
    const { app } = await build(ctx({}));
    expect((await app.inject({ url: "/v1/invoices/khata" })).statusCode).toBe(404);
    expect((await app.inject({ url: "/v1/invoices/credit-book" })).statusCode).toBe(401);
  });
});

describe("createInvoices", () => {
  it("returns the service and the module with its tables", () => {
    const { service, module } = createInvoices({
      db,
      seller: { get: async () => ({}) },
      branding: { get: async () => ({ appName: null, logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com/",
    });
    expect(module.id).toBe("invoices");
    expect(Object.keys(module.tables ?? {}).sort()).toEqual(
      [
        "billingCustomers",
        "billingItems",
        "customerReceipts",
        "invoiceMessages",
        "invoicePayments",
        "invoiceReminders",
        "invoiceSeries",
        "invoices",
      ].sort(),
    );
    expect(service).toBeDefined();
    expect(module.features?.map((f) => f.key)).toEqual([
      "invoices",
      "invoices.whatsapp",
      "invoices.reminders",
      "invoices.credit-book",
      "invoices.reports",
      "invoices.gst-reports",
    ]);
  });
});
