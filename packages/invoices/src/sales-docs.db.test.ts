/**
 * Proforma invoices, sale orders and delivery challans against Postgres (docs/sales-documents.md): numbering per kind,
 * branch and FY; proforma advances kept in the credit book and put on the bill; sale orders delivered and billed in parts
 * (ordered / delivered / invoiced per line); challans moving stock out and back, billed without moving stock twice; and
 * quotations turning into either. Runs only with `INVOICES_TEST_DATABASE_URL` set; it copies the tables into a throw-away
 * schema and drops it afterwards.
 */
import { randomUUID } from "node:crypto";
import { emptyContext, type RequestContext } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { QuotationsService } from "./quotations";
import { SalesDocsService } from "./sales-docs";
import { salesDocsRoutes } from "./sales-docs-routes";
import type { SalesDocStockPort } from "./sales-docs-base";
import { InvoicesService } from "./service";

const URL_ = process.env.INVOICES_TEST_DATABASE_URL;
const SCHEMA = `sales_docs_${Math.random().toString(36).slice(2, 10)}`;
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
  "quotations",
  "quotation_series",
  "sales_doc_series",
  "proforma_invoices",
  "sale_orders",
  "sale_order_invoices",
  "delivery_challans",
];
const user = { id: randomUUID(), sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };
const CEMENT = randomUUID();
const TMT = randomUUID();
const newTenant = () => ({ id: randomUUID(), slug: "sri", planId: "pro", appId: "BL" });

describe.skipIf(!URL_)("sales documents (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let invoices: InvoicesService;
  let docs: SalesDocsService;
  let quotes: QuotationsService;
  let app: FastifyInstance;
  let tenant = newTenant();
  const clock = new Date("2026-10-14T06:00:00Z"); // 14 Oct 2026, FY 26-27
  const sales: { refId: string; lines: { itemId: string; qty: number }[] }[] = [];
  const reversed: string[] = [];
  const challanMoves: Parameters<SalesDocStockPort["applyChallan"]>[1][] = [];
  const holds: { op: "reserve" | "release"; refId: string; lines?: { itemId: string; qty: number }[]; allowBackorder?: boolean }[] = [];
  let shortOfStock = false;
  const sent: { template: string; vars: Record<string, string> }[] = [];

  const cement = { description: "Cement 50 kg", hsn: "2523", qty: 10, unit: "bag", rate: 40_000, gstRate: 28 as const, itemId: CEMENT };
  const tmt = { description: "TMT bar 12 mm", hsn: "7214", qty: 4, unit: "ton", rate: 5_800_000, gstRate: 18 as const, discount: 400_000, itemId: TMT };
  const walkIn = { name: "Ravi Traders", phone: "9876543210" };
  const customer = () => invoices.createCustomer(tenant.id, { name: "Kumar Builders", phone: "9000000001" });

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 8 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    invoices = new InvoicesService({
      db,
      seller: { get: async () => ({ legalName: "Thari Hardware", gstin: "33AAACR5055K1ZE", stateCode: "33", address: "1 Car St", city: "Madurai" }) },
      branding: { get: async () => ({ appName: "Thari", logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com",
      stock: {
        applySale: async (_t, sale) => void sales.push({ refId: sale.refId, lines: sale.lines }),
        reverseSale: async (_t, refId) => void reversed.push(refId),
      },
      // The host's bill hooks (apps/api kit.ts).
      events: {
        issued: async (tenantId, inv) => void (await docs.onInvoiceIssued(tenantId, inv.id)),
        cancelled: async (tenantId, inv) => docs.onInvoiceCancelled(tenantId, inv.id, inv.number),
      },
      now: () => clock,
    });
    docs = new SalesDocsService({
      db,
      invoices,
      settings: { get: async () => ({ challanTerms: "Return unsold goods in 7 days." }) },
      branding: { get: async () => ({ appName: "Thari", logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com",
      notifier: {
        send: async (m) => {
          sent.push(m);
          return { logId: `log-${sent.length}` };
        },
      },
      stock: {
        applyChallan: async (_t, input) => void challanMoves.push(input),
        reserve: async (_t, r) => {
          if (shortOfStock && !r.allowBackorder) {
            const { AppError } = await import("@rbms/core");
            throw new AppError(409, "insufficient_stock", "Not enough stock for some items", { items: [] });
          }
          holds.push({ op: "reserve", refId: r.refId, lines: r.lines, allowBackorder: r.allowBackorder });
        },
        release: async (_t, _rt, refId) => void holds.push({ op: "release", refId }),
      },
      now: () => clock,
    });
    quotes = new QuotationsService({
      db,
      invoices,
      settings: { get: async () => ({}) },
      branding: { get: async () => ({ appName: "Thari", logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com",
      salesDocs: docs,
      now: () => clock,
    });
    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      const auth = req.headers.authorization;
      req.ctx = { ...emptyContext(), tenant, user: auth ? (user as never) : null } as RequestContext;
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number; code?: string; message: string }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message, code: err.code });
    });
    await app.register(salesDocsRoutes(docs), { prefix: "/v1/sales-docs" });
  });
  beforeEach(() => {
    tenant = newTenant();
    sales.length = 0;
    reversed.length = 0;
    challanMoves.length = 0;
    holds.length = 0;
    shortOfStock = false;
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  const salesOf = (invoiceId: string) => sales.filter((s) => s.refId === invoiceId);

  describe("numbering", () => {
    it("gives each kind its own series per branch and FY", async () => {
      const p1 = await docs.proformas.create(tenant, { customer: walkIn, lines: [cement] });
      const p2 = await docs.proformas.create(tenant, { customer: walkIn, lines: [cement] });
      const o1 = await docs.saleOrders.create(tenant, { customer: walkIn, lines: [cement] });
      const c1 = await docs.challans.create(tenant, { customer: walkIn, reason: "job_work", lines: [cement] });
      expect([p1.number, p2.number, o1.number, c1.number]).toEqual(["PI/26-27/0001", "PI/26-27/0002", "SO/26-27/0001", "DC/26-27/0001"]);
      const branch = randomUUID();
      expect((await docs.challans.create(tenant, { customer: walkIn, reason: "job_work", lines: [cement] }, { branchId: branch })).number).toBe("DC/26-27/0001");
      expect((await docs.challans.create(tenant, { customer: walkIn, reason: "job_work", lines: [cement] })).number).toBe("DC/26-27/0002");
    });

    it("refuses future dates and empty lines", async () => {
      await expect(docs.proformas.create(tenant, { customer: walkIn, lines: [cement], date: "2026-10-20" })).rejects.toThrow(/future/);
      await expect(docs.challans.create(tenant, { customer: walkIn, reason: "approval", lines: [] })).rejects.toThrow(ZodError);
    });
  });

  describe("proforma invoices", () => {
    it("computes GST like a bill, defaults validity 15 days, and is never a bill or a stock move", async () => {
      const p = await docs.proformas.create(tenant, { customer: walkIn, lines: [cement, tmt] });
      expect(p).toMatchObject({ status: "draft", validUntil: "2026-10-29", interState: false });
      expect(p.total).toBe(p.totals.taxable + p.totals.cgst + p.totals.sgst + p.totals.roundOff);
      expect(sales).toHaveLength(0);
      const [{ n }] = (await db.execute(sql`select count(*)::int as n from invoices where tenant_id = ${tenant.id}`)) as unknown as [{ n: number }];
      expect(n).toBe(0);
    });

    it("takes an advance only for a saved customer and keeps it for the proforma", async () => {
      const walk = await docs.proformas.create(tenant, { customer: walkIn, lines: [cement], issue: true });
      await expect(docs.proformas.recordAdvance(tenant.id, walk.id, { amount: 10_000 })).rejects.toThrow(/Save the customer/);

      const c = await customer();
      // An older open bill of the same customer: the advance must not be allocated to it.
      const old = await invoices.create(tenant, { customerId: c.id, date: "2026-10-01", lines: [{ ...cement, qty: 1, itemId: undefined }], issue: true });
      const p = await docs.proformas.create(tenant, { customerId: c.id, lines: [cement], advancePercent: 50 });
      expect(p.advanceAmount).toBe(Math.round(p.total / 2));
      const after = await docs.proformas.recordAdvance(tenant.id, p.id, { amount: 200_000, method: "upi" }, user.id);
      expect(after).toMatchObject({ status: "issued", advanceReceived: 200_000, advanceUnapplied: 200_000 });
      expect(after.advances[0]).toMatchObject({ against: { kind: "proforma", id: p.id, number: p.number }, advance: 200_000 });
      expect((await invoices.get(tenant.id, old.id)).paid).toBe(0);
      const listed = await docs.proformas.list(tenant.id);
      expect(listed.items.find((i) => i.id === p.id)?.advanceReceived).toBe(200_000);
      expect(listed.items.find((i) => i.id === walk.id)?.advanceReceived).toBe(0);
      expect(listed.totals.advance).toBe(200_000);
      await expect(docs.proformas.recordAdvance(tenant.id, p.id, { amount: p.total })).rejects.toThrow(/more than the document total/);
    });

    it("becomes the tax invoice with the advance on it; stock moves once, with the bill", async () => {
      const c = await customer();
      const p = await docs.proformas.create(tenant, { customerId: c.id, lines: [cement, tmt], issue: true });
      await docs.proformas.recordAdvance(tenant.id, p.id, { amount: 300_000 });
      const r = await docs.proformas.convert(tenant, p.id, { issue: true }, { userId: user.id });
      expect(r.advanceApplied).toBe(300_000);
      expect(r.invoice).toMatchObject({ status: "partially_paid", paid: 300_000, total: p.total });
      expect(r.invoice.notes).toContain(`Against proforma invoice ${p.number}`);
      expect(r.proforma).toMatchObject({ status: "converted", invoiceId: r.invoice.id, advanceUnapplied: 0 });
      expect(salesOf(r.invoice.id)).toHaveLength(1);
      await expect(docs.proformas.convert(tenant, p.id, { issue: true })).rejects.toMatchObject({ code: "proforma_locked" });
      expect((await docs.linked(tenant.id, r.invoice.id)).proforma?.id).toBe(p.id);

      // The bill is cancelled: the advance goes back to the receipt and the proforma can be billed again.
      await invoices.cancel(tenant.id, r.invoice.id, "wrong rate");
      const again = await docs.proformas.get(tenant.id, p.id);
      expect(again).toMatchObject({ invoiceMissing: true, canConvert: true, advanceUnapplied: 300_000 });
      const r2 = await docs.proformas.convert(tenant, p.id, {});
      expect(r2.invoice.status).toBe("draft");
      // A draft gets the advance when it is issued (the host's "issued" hook).
      const issued = await invoices.issue(tenant, r2.invoice.id);
      expect((await invoices.get(tenant.id, issued.id)).paid).toBe(300_000);
    });

    it("shares a link (issuing a draft) and sends it with its own template", async () => {
      const c = await customer();
      const p = await docs.proformas.create(tenant, { customerId: c.id, lines: [cement] });
      const s = await docs.proformas.share(tenant.id, p.id, user.id);
      expect(s.url).toBe(`https://bill.example.com/d/${s.token}`);
      expect(s.proforma.status).toBe("issued");
      const pub = await docs.getPublic(s.token);
      expect(pub).toMatchObject({ kind: "proforma", doc: { number: p.number, status: "issued" } });
      expect(JSON.stringify(pub)).not.toContain(c.id);
      await docs.proformas.send(tenant.id, p.id, { channel: "whatsapp" }, user.id);
      expect(sent.at(-1)).toMatchObject({ template: "proforma.sent", vars: { number: p.number, customer: "Kumar Builders" } });
      expect((await docs.docData("proforma", tenant.id, p.id))?.kind).toBe("proforma");
    });
  });

  describe("sale orders", () => {
    it("delivers and bills in parts, tracking ordered / delivered / invoiced per line, never moving stock twice", async () => {
      const c = await customer();
      const o = await docs.saleOrders.create(tenant, { customerId: c.id, lines: [cement, tmt], promisedDate: "2026-10-20", reserveStock: true }, { userId: user.id });
      const [kCement, kTmt] = o.lines.map((l) => l.key) as [string, string];
      expect(o.status).toBe("open");
      // Holding stock: the undelivered quantities.
      expect(holds.at(-1)).toMatchObject({ op: "reserve", refId: o.id, lines: [{ itemId: CEMENT, qty: 10 }, { itemId: TMT, qty: 4 }] });

      // 4 bags go on a challan: stock leaves with the challan.
      const d1 = await docs.saleOrders.deliver(tenant, o.id, { lines: [{ key: kCement, qty: 4 }] }, user.id);
      expect(d1.challan).toMatchObject({ reason: "before_invoice", saleOrderId: o.id, total: expect.any(Number) });
      expect(challanMoves.at(-1)).toMatchObject({ challanId: d1.challan.id, step: "out", lines: [{ itemId: CEMENT, qty: 4 }] });
      expect(d1.order.status).toBe("partly_delivered");
      expect(d1.order.progress.find((p) => p.key === kCement)).toMatchObject({ ordered: 10, delivered: 4, invoiced: 0, toDeliver: 6, onChallans: 4 });
      expect(holds.at(-1)).toMatchObject({ op: "reserve", lines: [{ itemId: CEMENT, qty: 6 }, { itemId: TMT, qty: 4 }], allowBackorder: true });

      // Can't deliver more than is left.
      await expect(docs.saleOrders.deliver(tenant, o.id, { lines: [{ key: kCement, qty: 7 }] })).rejects.toThrow(/Only 6 left/);

      // 1 ton billed straight from the order: that bill moves its stock.
      const b1 = await docs.saleOrders.invoice(tenant, o.id, { lines: [{ key: kTmt, qty: 1 }], issue: true }, { userId: user.id });
      expect(b1.invoice.lines).toHaveLength(1);
      expect(b1.invoice.lines[0]).toMatchObject({ qty: 1, discount: 100_000 });
      expect(salesOf(b1.invoice.id)).toEqual([{ refId: b1.invoice.id, lines: [{ itemId: TMT, qty: 1 }] }]);
      expect(b1.order.progress.find((p) => p.key === kTmt)).toMatchObject({ delivered: 1, invoiced: 1, toDeliver: 3 });

      // The delivered challan is billed: no stock moves for that bill.
      const b2 = await docs.saleOrders.invoiceChallans(tenant, o.id, { issue: true }, { userId: user.id });
      expect(salesOf(b2.invoice.id)).toHaveLength(0);
      expect(b2.invoice.notes).toContain(d1.challan.number);
      expect(b2.order.progress.find((p) => p.key === kCement)).toMatchObject({ delivered: 4, invoiced: 4, onChallans: 0 });
      expect(b2.order.bills.map((b) => b.via).sort()).toEqual(["challan", "order"]);

      // The rest: challan for everything left, then its bill.
      const d2 = await docs.saleOrders.deliver(tenant, o.id, {}, user.id);
      expect(d2.challan.lines.map((l) => [l.orderLineKey, l.qty])).toEqual([
        [kCement, 6],
        [kTmt, 3],
      ]);
      expect(d2.order.status).toBe("delivered");
      expect(holds.at(-1)).toMatchObject({ op: "release", refId: o.id });
      await expect(docs.saleOrders.invoice(tenant, o.id, {})).rejects.toMatchObject({ code: "sale_order_locked" });
      const b3 = await docs.saleOrders.invoiceChallans(tenant, o.id, {});
      expect(b3.invoice.status).toBe("draft");
      expect(b3.order.status).toBe("invoiced");
      await invoices.issue(tenant, b3.invoice.id);
      expect(salesOf(b3.invoice.id)).toHaveLength(0);
      expect(sales.flatMap((s) => s.lines)).toEqual([{ itemId: TMT, qty: 1 }]);
      expect(challanMoves.filter((m) => m.step === "out").flatMap((m) => m.lines)).toEqual([
        { itemId: CEMENT, qty: 4 },
        { itemId: CEMENT, qty: 6 },
        { itemId: TMT, qty: 3 },
      ]);

      // A cancelled bill reopens what it billed.
      await invoices.cancel(tenant.id, b1.invoice.id, "mistake");
      const reopened = await docs.saleOrders.get(tenant.id, o.id);
      expect(reopened.status).toBe("partly_delivered");
      expect(reopened.progress.find((p) => p.key === kTmt)).toMatchObject({ delivered: 3, toDeliver: 1 });
      expect((await docs.linked(tenant.id, b3.invoice.id)).saleOrders.map((s) => s.id)).toEqual([o.id]);
    });

    it("puts the order's advance on its first issued bill", async () => {
      const c = await customer();
      const o = await docs.saleOrders.create(tenant, { customerId: c.id, lines: [cement] });
      await docs.saleOrders.recordAdvance(tenant.id, o.id, { amount: 100_000, method: "cash" });
      const r = await docs.saleOrders.invoice(tenant, o.id, { issue: true });
      expect(r.advanceApplied).toBe(100_000);
      expect(r.invoice.paid).toBe(100_000);
      expect(r.order).toMatchObject({ status: "invoiced", advanceReceived: 100_000, advanceUnapplied: 0 });
      expect((await docs.saleOrders.list(tenant.id)).items[0]).toMatchObject({ id: o.id, advanceReceived: 100_000 });
    });

    it("saves nothing when the stock to hold isn't there; cancels only before anything left", async () => {
      shortOfStock = true;
      await expect(docs.saleOrders.create(tenant, { customer: walkIn, lines: [cement], reserveStock: true })).rejects.toMatchObject({ code: "insufficient_stock" });
      expect((await docs.saleOrders.list(tenant.id)).total).toBe(0);
      shortOfStock = false;
      const o = await docs.saleOrders.create(tenant, { customer: walkIn, lines: [cement] });
      const edited = await docs.saleOrders.update(tenant, o.id, { lines: [{ ...cement, qty: 12 }] });
      expect(edited.lines[0]!.key).toBe(o.lines[0]!.key);
      await docs.saleOrders.deliver(tenant, o.id, { lines: [{ key: o.lines[0]!.key, qty: 2 }] });
      await expect(docs.saleOrders.update(tenant, o.id, { lines: [cement] })).rejects.toMatchObject({ code: "sale_order_locked" });
      expect((await docs.saleOrders.update(tenant, o.id, { promisedDate: "2026-11-01" })).promisedDate).toBe("2026-11-01");
      await expect(docs.saleOrders.cancel(tenant.id, o.id)).rejects.toMatchObject({ code: "sale_order_locked" });
      const fresh = await docs.saleOrders.create(tenant, { customer: walkIn, lines: [cement] });
      expect((await docs.saleOrders.cancel(tenant.id, fresh.id, "customer changed mind")).status).toBe("cancelled");
      const list = await docs.saleOrders.list(tenant.id, { status: "partly_delivered" });
      expect(list.items.map((i) => i.id)).toEqual([o.id]);
    });
  });

  describe("delivery challans", () => {
    it("on approval: goods out, part back, the rest billed without moving stock again", async () => {
      const c = await customer();
      const ch = await docs.challans.create(
        tenant,
        { customerId: c.id, reason: "approval", lines: [cement, tmt], transport: { mode: "road", vehicleNo: "tn 59 ab 1234" }, ewbNo: "331000123456" },
        { userId: user.id },
      );
      expect(ch).toMatchObject({ status: "issued", returnBy: "2026-10-21", terms: "Return unsold goods in 7 days.", ewbNo: "331000123456", ewbSuggested: true });
      expect(ch.transport.vehicleNo).toBe("TN59AB1234");
      expect(challanMoves).toEqual([expect.objectContaining({ challanId: ch.id, step: "out", lines: [{ itemId: CEMENT, qty: 10 }, { itemId: TMT, qty: 4 }] })]);

      const kC = ch.lines[0]!.key;
      const back = await docs.challans.recordReturn(tenant.id, ch.id, { lines: [{ key: kC, qty: 3 }], note: "3 bags not needed" }, user.id);
      expect(back.status).toBe("partly_returned");
      expect(back.lines[0]).toMatchObject({ returned: 3, net: 7 });
      expect(challanMoves.at(-1)).toMatchObject({ step: "return", key: back.returns[0]!.id, lines: [{ itemId: CEMENT, qty: 3 }] });
      await expect(docs.challans.recordReturn(tenant.id, ch.id, { lines: [{ key: kC, qty: 8 }] })).rejects.toThrow(/Only 7 left/);

      const { invoice } = await docs.challans.invoice(tenant, { challanIds: [ch.id], issue: true }, { userId: user.id });
      expect(invoice.lines.map((l) => l.qty)).toEqual([7, 4]);
      expect(salesOf(invoice.id)).toHaveLength(0);
      expect((await docs.challans.get(tenant.id, ch.id)).status).toBe("invoiced");
      await expect(docs.challans.cancel(tenant.id, ch.id)).rejects.toMatchObject({ code: "challan_locked" });
      await expect(docs.challans.recordReturn(tenant.id, ch.id, {})).rejects.toMatchObject({ code: "challan_locked" });

      // Cancelling the bill: no stock comes back (the goods are with the customer); the challan can be billed again.
      await invoices.cancel(tenant.id, invoice.id, "wrong customer");
      expect(reversed).not.toContain(invoice.id);
      const reopened = await docs.challans.get(tenant.id, ch.id);
      expect(reopened).toMatchObject({ status: "partly_returned", canInvoice: true, invoiceId: null });

      // Cancelling the challan brings back what is still out.
      const cancelled = await docs.challans.cancel(tenant.id, ch.id, "deal off", user.id);
      expect(cancelled.status).toBe("cancelled");
      expect(challanMoves.at(-1)).toMatchObject({ challanId: ch.id, step: "cancel" });
    });

    it("bills several challans of one customer in one bill; job work and mixed customers are refused", async () => {
      const c = await customer();
      const a = await docs.challans.create(tenant, { customerId: c.id, reason: "before_invoice", lines: [{ ...cement, qty: 2 }] });
      const b = await docs.challans.create(tenant, { customerId: c.id, reason: "before_invoice", lines: [{ ...cement, qty: 5 }] });
      const job = await docs.challans.create(tenant, { customerId: c.id, reason: "job_work", lines: [tmt] });
      const other = await docs.challans.create(tenant, { customer: walkIn, reason: "before_invoice", lines: [cement] });
      await expect(docs.challans.invoice(tenant, { challanIds: [a.id, job.id] })).rejects.toThrow(/approval or delivered before the bill/);
      await expect(docs.challans.invoice(tenant, { challanIds: [a.id, other.id] })).rejects.toThrow(/one customer/);
      const r = await docs.challans.invoice(tenant, { challanIds: [a.id, b.id], issue: true });
      expect(r.invoice.lines.map((l) => l.qty)).toEqual([2, 5]);
      expect(r.invoice.notes).toContain(`${a.number}, ${b.number}`);
      expect(salesOf(r.invoice.id)).toHaveLength(0);
      expect((await docs.linked(tenant.id, r.invoice.id)).challans.map((x) => x.id)).toEqual([a.id, b.id]);
      const toBill = await docs.challans.list(tenant.id, { toBill: true });
      expect(toBill.items.map((x) => x.id)).toEqual([other.id]);
      // Job work comes back in full.
      const backAll = await docs.challans.recordReturn(tenant.id, job.id, {});
      expect(backAll.status).toBe("returned");
    });

    it("lists with filters and the summary counts goods out on approval", async () => {
      const c = await customer();
      await docs.challans.create(tenant, { customerId: c.id, reason: "approval", lines: [cement], returnBy: "2026-10-14" });
      await docs.challans.create(tenant, { customer: walkIn, reason: "job_work", lines: [tmt] });
      const approval = await docs.challans.list(tenant.id, { reason: "approval" });
      expect(approval.total).toBe(1);
      const s = await docs.summary(tenant.id);
      expect(s.challans.out.count).toBe(2);
      expect(s.challans.toBill.count).toBe(1);
    });
  });

  describe("from quotations", () => {
    it("a quotation becomes a proforma or a sale order and links to it", async () => {
      const q = await quotes.create(tenant, { customer: walkIn, lines: [cement], advancePercent: 25 });
      const r = await quotes.convert(tenant, q.id, { to: "proforma" }, { userId: user.id });
      expect(r.salesDoc).toMatchObject({ kind: "proforma", number: "PI/26-27/0001" });
      expect(r.quotation).toMatchObject({ status: "converted", converted: { kind: "proforma", missing: false } });
      const p = await docs.proformas.get(tenant.id, r.salesDoc!.id);
      expect(p).toMatchObject({ status: "issued", quotationId: q.id, advancePercent: 25, total: q.total });
      await docs.proformas.cancel(tenant.id, p.id);
      expect((await quotes.get(tenant.id, q.id)).canConvert).toBe(true);

      const r2 = await quotes.convert(tenant, q.id, { to: "sale_order" }, { userId: user.id });
      expect(r2.salesDoc).toMatchObject({ kind: "sale_order", number: "SO/26-27/0001" });
      expect((await docs.saleOrders.get(tenant.id, r2.salesDoc!.id)).quotationNumber).toBe(q.number);
    });
  });

  describe("routes", () => {
    const auth = { authorization: "Bearer x" };
    it("serves lists and validates input", async () => {
      const made = await app.inject({ method: "POST", url: "/v1/sales-docs/challans", headers: auth, payload: { customer: walkIn, reason: "approval", lines: [cement] } });
      expect(made.statusCode).toBe(200);
      const bad = await app.inject({ method: "POST", url: "/v1/sales-docs/challans", headers: auth, payload: { customer: walkIn, reason: "gift", lines: [cement] } });
      expect(bad.statusCode).toBe(400);
      const list = await app.inject({ method: "GET", url: "/v1/sales-docs/challans?status=issued", headers: auth });
      expect(list.json()).toMatchObject({ total: 1, facets: { status: { issued: 1 } } });
      expect((await app.inject({ method: "GET", url: "/v1/sales-docs/proformas" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/v1/sales-docs/public/nope-nope-nope-nope" })).statusCode).toBe(404);
    });
  });
});
