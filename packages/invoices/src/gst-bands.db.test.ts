/**
 * Price-band GST (apparel / footwear: 5% up to ₹2,500 taxable per piece, 18% above) through the invoices API against
 * Postgres: a bill with mixed-band lines (exclusive, tax-inclusive, a discount that crosses the threshold), the stored
 * effective rates, the GST summary (rate-wise and HSN-wise), a loyalty-style bill discount re-banding a line, and a
 * credit note crediting at the original line's rate. Runs only with `INVOICES_TEST_DATABASE_URL` set; it copies the
 * invoices tables into a throw-away schema and drops it afterwards.
 */
import { emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { APPAREL_FOOTWEAR_GST_RULE as RULE, computeInvoice, exclusiveOf, todayIST } from "@srirealtime/gst";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { applyBillDiscount } from "./logic";
import { invoiceSchema, invoicesRoutes } from "./routes";
import { InvoicesService } from "./service";

const URL_ = process.env.INVOICES_TEST_DATABASE_URL;
const SCHEMA = `invoices_gst_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["billing_customers", "billing_items", "invoices", "invoice_payments", "invoice_series", "credit_notes", "credit_note_series", "till_sessions", "invoice_messages", "invoice_reminders", "customer_receipts"];
const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "BL" };
const user = { id: "22222222-2222-4222-8222-222222222222", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };

describe.skipIf(!URL_)("price-band GST on bills (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  const today = todayIST(new Date());

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    const service = new InvoicesService({
      db,
      seller: { get: async () => ({ legalName: "Thari Weaves", gstin: "33AAACR5055K1ZE", stateCode: "33", address: "1 Car St", city: "Madurai" }) },
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

  it("bands each line on its own taxable value and reports by the effective rate", async () => {
    const lines = [
      // ₹2,500.00 exclusive: 5%.
      { description: "Cotton kurta", hsn: "6211", qty: 2, unit: "pcs", rate: 250_000, gstRate: 18, gstRule: RULE },
      // ₹2,500.01: 18%.
      { description: "Linen shirt", hsn: "6205", qty: 1, unit: "pcs", rate: 250_001, gstRate: 5, gstRule: RULE },
      // ₹3,000 less ₹600 on the bill → ₹2,400: 5%.
      { description: "Silk kurta", hsn: "6211", qty: 1, unit: "pcs", rate: 300_000, discount: 60_000, gstRate: 18, gstRule: RULE },
      // Tax-inclusive ₹3,499 (MRP): 18% taken out.
      { description: "Leather sandals", hsn: "6403", qty: 1, unit: "pair", rate: exclusiveOf(349_900, 18, true), gstRate: 18, gstRule: RULE, inclusiveTotal: 349_900 },
      // No rule: untouched.
      { description: "Gift box", hsn: "4819", qty: 1, unit: "pcs", rate: 10_000, gstRate: 12 },
    ];
    const res = await app.inject({ method: "POST", url: "/v1/invoices", payload: { customer: { name: "Walk-in" }, date: today, lines, issue: true } });
    expect(res.statusCode, res.body).toBe(200);
    const bill = invoiceSchema.parse(res.json());
    expect(bill.lines.map((l) => l.gstRate)).toEqual([5, 18, 5, 18, 12]);
    expect(bill.lines[0]).toMatchObject({ taxable: 500_000, cgst: 12_500, sgst: 12_500, gstRule: RULE });
    expect(bill.lines[3]).toMatchObject({ taxable: 296_525, total: 349_900 });
    expect(bill.totals.taxBreakup.map((r) => [r.gstRate, r.taxable])).toEqual([
      [5, 740_000],
      [12, 10_000],
      [18, 250_001 + 296_525],
    ]);

    // GST summary: rate-wise and HSN-wise (HSN 6211 at 5% only; 6205 and 6403 at 18%).
    const s = (await app.inject({ method: "GET", url: `/v1/invoices/reports/gst-summary?from=${today}&to=${today}` })).json();
    expect(s.byRate.map((r: { gstRate: number; taxable: number }) => [r.gstRate, r.taxable])).toEqual([
      [5, 740_000],
      [12, 10_000],
      [18, 546_526],
    ]);
    expect(s.hsn.map((h: { hsn: string; rate: number; taxable: number }) => [h.hsn, h.rate, h.taxable])).toEqual(
      expect.arrayContaining([
        ["6211", 5, 740_000],
        ["6205", 18, 250_001],
        ["6403", 18, 296_525],
      ]),
    );

    // Credit note for the sandals: credited at the bill's 18%, whatever the price would band at today.
    const cn = await app.inject({
      method: "POST",
      url: `/v1/invoices/${bill.id}/credit-notes`,
      payload: { reason: "return", refundMode: "cash", lines: [{ line: 3, qty: 1 }] },
    });
    expect(cn.statusCode, cn.body).toBe(200);
    expect(cn.json().creditNote.lines[0]).toMatchObject({ gstRate: 18, taxable: 296_525 });
  });

  it("rejects a malformed rule", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/invoices",
      payload: { customer: { name: "Walk-in" }, date: today, lines: [{ description: "x", qty: 1, rate: 100, gstRate: 5, gstRule: { kind: "price-band", threshold: 250_000, below: 18, above: 5 } }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("price-band GST and bill discounts", () => {
  it("a bill discount that takes a piece under the threshold re-bands it", () => {
    // ₹3,000 + 18% = ₹3,540 charged; ₹1,000 off the bill → ₹2,540 charged ≤ ₹2,625: now 5%.
    const t = applyBillDiscount([{ description: "Kurta", qty: 1, rate: 300_000, gstRate: 18, gstRule: RULE, amount: 300_000, discount: 0, taxable: 300_000, cgst: 27_000, sgst: 27_000, igst: 0, total: 354_000 }], 100_000);
    expect(t[0]).toMatchObject({ inclusiveTotal: 254_000, gstRule: RULE });
    const after = computeInvoice(t, { sellerState: "33", placeOfSupply: "33" });
    expect(after.lines[0]).toMatchObject({ gstRate: 5, taxable: 241_905, total: 254_000 });
  });
});
