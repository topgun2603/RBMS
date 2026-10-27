/**
 * Quotations against Postgres: numbering per FY and branch, GST totals (intra- and inter-state), settings defaults,
 * revisions, derived expiry, accepting through the public link, conversion into a bill (draft or issued with the
 * advance) and an order, and the promise that a quotation never touches stock, sales, GST returns or the credit book.
 * Runs only with `INVOICES_TEST_DATABASE_URL` set; it copies the tables into a throw-away schema and drops it afterwards.
 */
import { randomUUID } from "node:crypto";
import { emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { gstinCheckChar } from "@srirealtime/gst";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { QuotationsService, type QuotationInput, type QuotationOrdersPort } from "./quotations";
import { quotationsRoutes } from "./quotations-routes";
import { InvoicesService } from "./service";

const URL_ = process.env.INVOICES_TEST_DATABASE_URL;
const SCHEMA = `quotations_${Math.random().toString(36).slice(2, 10)}`;
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
];
const tenant = { id: randomUUID(), slug: "sri", planId: "pro", appId: "BL" };
const user = { id: randomUUID(), sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };
const GSTIN_KA = `29AAACR5055K1Z${gstinCheckChar("29AAACR5055K1Z")}`; // Karnataka buyer (inter-state for a Tamil Nadu seller)

describe.skipIf(!URL_)("quotations (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let invoices: InvoicesService;
  let svc: QuotationsService;
  let app: FastifyInstance;
  let clock = new Date("2026-10-14T06:00:00Z"); // 14 Oct 2026, FY 26-27
  const stock = { applySale: vi.fn(async () => null), reverseSale: vi.fn(async () => null) };
  const sent: { channel: string; to: string; template: string; vars: Record<string, string> }[] = [];
  const audit: string[] = [];
  const orderPort: QuotationOrdersPort & { made: unknown[]; advances: unknown[] } = {
    made: [],
    advances: [],
    async createFromQuotation(_t, q) {
      this.made.push(q.number);
      return { id: randomUUID(), number: "ORD-1001" };
    },
    async recordAdvance(_t, _id, a) {
      this.advances.push(a);
    },
  };
  let settings: Record<string, unknown> = { prefix: "QT", validityDays: 15, terms: "Prices valid for the period shown." };

  const line = { description: "Cement 50 kg", qty: 10, rate: 40_000, gstRate: 28 as const, hsn: "2523", unit: "bag" };
  const walkIn = { name: "Ravi Traders", phone: "9876543210" };
  const make = (over: Partial<QuotationInput> = {}) => svc.create(tenant, { customer: walkIn, lines: [line], ...over }, { userId: user.id });
  const send = async (id: string) => (await svc.share(tenant.id, id, user.id)).token;

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 8 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    invoices = new InvoicesService({
      db,
      seller: { get: async () => ({ legalName: "Thari Hardware", gstin: "33AAACR5055K1ZE", stateCode: "33", address: "1 Car St", city: "Madurai", terms: "Invoice terms" }) },
      branding: { get: async () => ({ appName: "Thari", logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com",
      stock,
      now: () => clock,
    });
    svc = new QuotationsService({
      db,
      invoices,
      settings: { get: async () => settings },
      branding: { get: async () => ({ appName: "Thari", logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com",
      notifier: {
        send: async (m) => {
          sent.push(m);
          return { logId: `log-${sent.length}` };
        },
      },
      orders: orderPort,
      audit: { record: async (e) => void audit.push(e.action) },
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
    await app.register(quotationsRoutes(svc), { prefix: "/v1/quotations" });
  });
  afterEach(() => {
    clock = new Date("2026-10-14T06:00:00Z");
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  describe("numbering and totals", () => {
    it("numbers QT/<FY>/<seq> per tenant, from the shop's prefix, and keeps FYs apart", async () => {
      const a = await make();
      const b = await make();
      expect(a.number).toBe("QT/26-27/0001");
      expect(b.number).toBe("QT/26-27/0002");
      expect(a).toMatchObject({ rev: 1, latest: true, status: "draft", displayStatus: "draft" });
      // A quotation dated in the next FY starts that FY's series.
      clock = new Date("2027-04-02T06:00:00Z");
      const c = await make();
      expect(c.number).toBe("QT/27-28/0001");
      clock = new Date("2026-10-14T06:00:00Z");
    });

    it("gives each branch its own series", async () => {
      const branch = randomUUID();
      const x = await svc.create(tenant, { customer: walkIn, lines: [line] }, { branchId: branch });
      const y = await svc.create(tenant, { customer: walkIn, lines: [line] }, { branchId: branch });
      expect(x.number).toBe("QT/26-27/0001");
      expect(y.number).toBe("QT/26-27/0002");
      expect(x.branchId).toBe(branch);
    });

    it("uses the invoice GST maths: CGST + SGST within the state, IGST across states, round-off to the rupee", async () => {
      const intra = await make({ lines: [{ ...line, qty: 3, rate: 33_333, discount: 1_000 }] });
      expect(intra.interState).toBe(false);
      expect(intra.totals.igst).toBe(0);
      expect(intra.totals.cgst).toBe(intra.totals.sgst);
      expect(intra.total).toBe(intra.totals.taxable + intra.totals.cgst + intra.totals.sgst + intra.totals.roundOff);
      expect(intra.total % 100).toBe(0);

      const inter = await make({ customer: { name: "Bengaluru Builders", gstin: GSTIN_KA }, lines: [line] });
      expect(inter.customer.stateCode).toBe("29");
      expect(inter.placeOfSupply).toBe("29");
      expect(inter.interState).toBe(true);
      expect(inter.totals.cgst).toBe(0);
      expect(inter.totals.igst).toBe(112_000);
      expect(inter.total).toBe(512_000);
      expect(inter.amountInWords).toMatch(/Rupees/i);
    });

    it("defaults validity (15 days) and terms from the shop settings; a typed value wins", async () => {
      const q = await make();
      expect(q.validUntil).toBe("2026-10-29");
      expect(q.terms).toBe("Prices valid for the period shown.");
      const custom = await make({ validUntil: "2026-11-30", terms: "50% advance", deliveryText: "2 weeks", advancePercent: 50 });
      expect(custom).toMatchObject({ validUntil: "2026-11-30", terms: "50% advance", deliveryText: "2 weeks", advancePercent: 50, advanceAmount: custom.total / 2 });
      settings = { ...settings, validityDays: 30 };
      expect((await make()).validUntil).toBe("2026-11-13");
      settings = { ...settings, validityDays: 15 };
      expect((await make({ terms: null })).terms).toBeNull();
    });

    it("needs a customer and a sane validity", async () => {
      await expect(svc.create(tenant, { lines: [line] })).rejects.toThrow(/customer/i);
      await expect(make({ validUntil: "2026-10-01" })).rejects.toThrow(/before/i);
      await expect(svc.create(tenant, { customer: walkIn, lines: [] })).rejects.toThrow(ZodError);
    });

    it("uses a saved customer's details", async () => {
      const cust = await invoices.createCustomer(tenant.id, { name: "Kumar Furniture", phone: "9000000001", gstin: GSTIN_KA });
      const q = await svc.create(tenant, { customerId: cust.id, lines: [line] });
      expect(q).toMatchObject({ customerId: cust.id, interState: true });
      expect(q.customer.name).toBe("Kumar Furniture");
    });
  });

  describe("editing and revisions", () => {
    it("edits a draft in place but refuses to edit one that was sent", async () => {
      const q = await make();
      const edited = await svc.update(tenant, q.id, { lines: [{ ...line, qty: 20 }], notes: "Deliver to site" });
      expect(edited.total).toBeGreaterThan(q.total);
      expect(edited.notes).toBe("Deliver to site");
      await send(q.id);
      await expect(svc.update(tenant, q.id, { notes: "x" })).rejects.toMatchObject({ code: "quotation_locked" });
    });

    it("revises: same number, rev 2, the old revision kept as history, only the latest active", async () => {
      const q = await make();
      await send(q.id);
      const r2 = await svc.revise(tenant, q.id, { lines: [{ ...line, qty: 5 }] }, user.id);
      expect(r2).toMatchObject({ number: q.number, rev: 2, latest: true, status: "draft", groupId: q.groupId });
      expect(r2.total).toBeLessThan(q.total);
      expect(r2.revisions.map((r) => [r.rev, r.latest])).toEqual([
        [1, false],
        [2, true],
      ]);
      const old = await svc.get(tenant.id, q.id);
      expect(old.latest).toBe(false);
      expect(old.canConvert).toBe(false);
      expect(old.canEdit).toBe(false);
      // The list shows the latest revision only (unless asked for all).
      const list = await svc.list(tenant.id, { q: q.number });
      expect(list.items.map((i) => [i.number, i.rev])).toEqual([[q.number, 2]]);
      expect((await svc.list(tenant.id, { q: q.number, allRevisions: "true" })).total).toBe(2);
      // A draft is edited, not revised; an old revision can't be revised again.
      await expect(svc.revise(tenant, r2.id)).rejects.toMatchObject({ code: "quotation_locked" });
      await expect(svc.revise(tenant, q.id)).rejects.toMatchObject({ code: "quotation_locked" });
      // The timeline joins every revision.
      expect(r2.events.map((e) => e.type)).toEqual(["created", "sent", "revised"]);
    });

    it("an acceptance does not carry over to the new revision", async () => {
      const q = await make();
      const token = await send(q.id);
      await svc.respond(token, { decision: "accept", name: "Ravi" });
      const r2 = await svc.revise(tenant, q.id, { notes: "price change" });
      expect(r2).toMatchObject({ status: "draft", respondedBy: null });
      // The old link now points the customer at the newer revision, which they can't answer while it is a draft.
      const stale = await svc.getPublic(token);
      expect(stale.quotation).toMatchObject({ canRespond: false, latestToken: null });
      await expect(svc.respond(token, { decision: "accept", name: "Ravi" })).rejects.toMatchObject({ code: "quotation_revised" });
      const newToken = await send(r2.id);
      expect((await svc.getPublic(token)).quotation.latestToken).toBe(newToken);
    });
  });

  describe("sharing, expiry and the customer's answer", () => {
    it("sharing a draft marks it sent and gives a stable public link", async () => {
      const q = await make();
      const a = await svc.share(tenant.id, q.id, user.id);
      const b = await svc.share(tenant.id, q.id, user.id);
      expect(a.url).toBe(`https://bill.example.com/q/${a.token}`);
      expect(b.token).toBe(a.token);
      expect(a.quotation.status).toBe("sent");
      expect(a.quotation.events.filter((e) => e.type === "sent")).toHaveLength(1);
    });

    it("hides drafts and unknown tokens from the public page", async () => {
      await expect(svc.getPublic("x".repeat(22))).rejects.toMatchObject({ status: 404 });
      await expect(svc.getPublic("bad")).rejects.toMatchObject({ status: 404 });
    });

    it("the public view has no internal fields and logs the first view", async () => {
      const q = await make();
      const token = await send(q.id);
      const v = await svc.getPublic(token);
      expect(v.quotation).toMatchObject({ number: q.number, canRespond: true, status: "sent", displayStatus: "sent", total: q.total });
      expect(v.quotation).not.toHaveProperty("id");
      expect(v.quotation.seller).not.toHaveProperty("invoicePrefix");
      expect(v.quotation.seller).not.toHaveProperty("reminderDays");
      expect(v.branding.appName).toBe("Thari");
      await svc.getPublic(token);
      expect((await svc.get(tenant.id, q.id)).events.filter((e) => e.type === "viewed")).toHaveLength(1);
    });

    it("accepting records who and when, is final, and is audited", async () => {
      const q = await make();
      const token = await send(q.id);
      const res = await svc.respond(token, { decision: "accept", name: "  Ravi Kumar ", note: "Please deliver Monday" });
      expect(res.quotation).toMatchObject({ status: "accepted", respondedBy: "Ravi Kumar", responseNote: "Please deliver Monday", canRespond: false });
      expect(res.quotation.respondedAt).toBeInstanceOf(Date);
      await expect(svc.respond(token, { decision: "decline", name: "Ravi" })).rejects.toMatchObject({ code: "quotation_answered", status: 409 });
      await expect(svc.respond(token, { decision: "accept", name: "" })).rejects.toThrow(ZodError);
      expect(audit).toContain("quotations.accept");
      const staff = await svc.get(tenant.id, q.id);
      expect(staff.events.map((e) => e.type)).toEqual(["created", "sent", "accepted"]);
      expect(staff.events.find((e) => e.type === "accepted")).toMatchObject({ by: "Ravi Kumar", note: "Please deliver Monday" });
    });

    it("declining is recorded the same way", async () => {
      const q = await make();
      const res = await svc.respond(await send(q.id), { decision: "decline", name: "Ravi", note: "Too costly" });
      expect(res.quotation).toMatchObject({ status: "declined", responseNote: "Too costly" });
      expect(audit).toContain("quotations.decline");
    });

    it("expires after valid-until: derived, filterable, and can't be accepted any more", async () => {
      const q = await make({ validUntil: "2026-10-16" });
      const token = await send(q.id);
      expect((await svc.get(tenant.id, q.id)).daysLeft).toBe(2);
      clock = new Date("2026-10-16T18:00:00Z"); // 16 Oct 23:30 IST: last day, still valid
      expect((await svc.get(tenant.id, q.id)).displayStatus).toBe("sent");
      clock = new Date("2026-10-17T06:00:00Z");
      const expired = await svc.get(tenant.id, q.id);
      expect(expired).toMatchObject({ status: "sent", displayStatus: "expired", daysLeft: -1, canConvert: true });
      const ids = (s: string) => svc.list(tenant.id, { status: s }).then((l) => l.items.map((i) => i.id));
      expect(await ids("expired")).toContain(q.id);
      expect(await ids("sent")).not.toContain(q.id);
      expect((await svc.getPublic(token)).quotation).toMatchObject({ displayStatus: "expired", canRespond: false });
      await expect(svc.respond(token, { decision: "accept", name: "Ravi" })).rejects.toMatchObject({ code: "quotation_expired" });
      // Revising an expired quotation is allowed (new dates).
      const r2 = await svc.revise(tenant, q.id);
      expect(r2.validUntil).toBe("2026-11-01");
      clock = new Date("2026-10-14T06:00:00Z");
    });

    it("filters by status, customer, date and search text", async () => {
      const cust = await invoices.createCustomer(tenant.id, { name: "Zed Engineering", phone: "9111111111" });
      const q = await svc.create(tenant, { customerId: cust.id, lines: [line], date: "2026-10-13" });
      await send(q.id);
      expect((await svc.list(tenant.id, { customerId: cust.id })).items.map((i) => i.id)).toEqual([q.id]);
      expect((await svc.list(tenant.id, { q: "zed eng" })).total).toBe(1);
      expect((await svc.list(tenant.id, { q: "9111111111" })).total).toBe(1);
      expect((await svc.list(tenant.id, { from: "2026-10-13", to: "2026-10-13", q: "Zed" })).total).toBe(1);
      expect((await svc.list(tenant.id, { from: "2026-10-14", q: "Zed" })).total).toBe(0);
      expect((await svc.list(tenant.id, { status: "sent,accepted", customerId: cust.id })).total).toBe(1);
      expect((await svc.list(tenant.id, { status: "declined", customerId: cust.id })).total).toBe(0);
    });
  });

  describe("sending", () => {
    it("sends on WhatsApp, SMS and email with the public link and marks the quotation sent", async () => {
      const cust = await invoices.createCustomer(tenant.id, { name: "Mail Customer", phone: "9222222222", email: "buyer@example.com" });
      const q = await svc.create(tenant, { customerId: cust.id, lines: [line] });
      const r = await svc.send(tenant.id, q.id, {}, user.id);
      expect(r.quotation.status).toBe("sent");
      expect(sent.at(-1)).toMatchObject({ channel: "whatsapp", to: "+919222222222", template: "quotation.sent" });
      expect(sent.at(-1)!.vars).toMatchObject({ number: q.number, link: r.url, validUntil: "29 Oct 2026", customer: "Mail Customer" });
      await svc.send(tenant.id, q.id, { channel: "sms" });
      expect(sent.at(-1)!.vars.amount).toMatch(/^Rs\./);
      await svc.send(tenant.id, q.id, { channel: "email" });
      expect(sent.at(-1)).toMatchObject({ channel: "email", to: "buyer@example.com" });
      const after = await svc.get(tenant.id, q.id);
      expect(after.events.filter((e) => e.type === "sent")).toHaveLength(3);
      await expect(svc.send(tenant.id, (await make()).id, { channel: "email" })).rejects.toThrow(/email/i);
      await expect(svc.send(tenant.id, q.id, { to: "12" })).rejects.toThrow(/mobile/i);
    });
  });

  describe("conversion", () => {
    it("Make bill creates a draft bill from the latest revision, links back and marks the quotation converted", async () => {
      const q = await make({ notes: "Site: Anna Nagar", advancePercent: 25 });
      await send(q.id);
      const r2 = await svc.revise(tenant, q.id, { lines: [{ ...line, qty: 4 }] });
      const res = await svc.convert(tenant, r2.id, { to: "invoice" }, { userId: user.id });
      expect(res.invoice).toMatchObject({ status: "draft", customer: { name: "Ravi Traders" } });
      expect(res.invoice!.lines).toHaveLength(1);
      expect(res.invoice!.lines[0]).toMatchObject({ qty: 4, rate: 40_000, gstRate: 28, hsn: "2523" });
      expect(res.invoice!.total).toBe(r2.total);
      expect(res.invoice!.notes).toContain(`Against quotation ${q.number} (rev 2)`);
      expect(res.invoice!.notes).toContain("Site: Anna Nagar");
      expect(res.quotation).toMatchObject({ status: "converted", converted: { kind: "invoice", id: res.invoice!.id, missing: false }, canConvert: false });
      expect((await svc.forTarget(tenant.id, res.invoice!.id))).toMatchObject({ number: q.number, advanceAmount: r2.advanceAmount, kind: "invoice" });
      // Not twice; the old revision can't be billed either.
      await expect(svc.convert(tenant, r2.id)).rejects.toMatchObject({ code: "quotation_locked" });
      await expect(svc.convert(tenant, q.id)).rejects.toMatchObject({ code: "quotation_locked" });
      // The bill is an ordinary draft: delete it and the quotation can be converted again.
      await invoices.deleteDraft(tenant.id, res.invoice!.id);
      const again = await svc.get(tenant.id, r2.id);
      expect(again).toMatchObject({ canConvert: true, converted: { missing: true } });
      const second = await svc.convert(tenant, r2.id);
      expect(second.invoice!.id).not.toBe(res.invoice!.id);
    });

    it("Make bill with an advance issues the bill and records the advance as a payment", async () => {
      const q = await make({ advancePercent: 40 });
      await expect(svc.convert(tenant, q.id, { recordAdvance: true })).rejects.toThrow(/Issue the bill/);
      const res = await svc.convert(tenant, q.id, { issue: true, recordAdvance: true, advanceMethod: "upi", advanceReference: "UPI-123" });
      expect(res.invoice).toMatchObject({ status: "partially_paid", paid: q.advanceAmount });
      expect(res.invoice!.number).toMatch(/^INV\//);
      expect(res.advanceRecorded).toBe(q.advanceAmount);
      expect(res.invoice!.payments[0]).toMatchObject({ method: "upi", reference: "UPI-123", amount: q.advanceAmount });
      await expect(svc.convert(tenant, (await make()).id, { recordAdvance: true, issue: true })).rejects.toThrow(/no advance/);
    });

    it("converts a declined or expired quotation too, but not a cancelled one", async () => {
      const declined = await make();
      await svc.respond(await send(declined.id), { decision: "decline", name: "Ravi" });
      const res = await svc.convert(tenant, declined.id);
      expect(res.quotation).toMatchObject({ status: "converted", respondedAt: null });
      const cancelled = await make();
      await svc.cancel(tenant.id, cancelled.id, "Customer went elsewhere", user.id);
      await expect(svc.convert(tenant, cancelled.id)).rejects.toMatchObject({ code: "quotation_locked" });
    });

    it("Make order uses the orders port and records the advance on the order", async () => {
      const q = await make({ advancePercent: 30 });
      const res = await svc.convert(tenant, q.id, { to: "order", recordAdvance: true, advanceMethod: "cash" });
      expect(res.order).toEqual({ id: expect.any(String), number: "ORD-1001" });
      expect(orderPort.made).toContain(q.number);
      expect(orderPort.advances.at(-1)).toMatchObject({ amount: q.advanceAmount, method: "cash" });
      expect(res.quotation).toMatchObject({ status: "converted", converted: { kind: "order", number: "ORD-1001" } });
      expect(res.advanceRecorded).toBe(q.advanceAmount);
    });

    it("Make order is refused when the shop has no orders", async () => {
      const noOrders = new QuotationsService({
        db,
        invoices,
        settings: { get: async () => settings },
        branding: { get: async () => ({ appName: null, logoUrl: null, css: "" }) },
        publicBaseUrl: "https://bill.example.com",
        now: () => clock,
      });
      const q = await make();
      await expect(noOrders.convert(tenant, q.id, { to: "order" })).rejects.toMatchObject({ code: "orders_unavailable" });
      await expect(noOrders.send(tenant.id, q.id)).rejects.toMatchObject({ code: "not_configured" });
      expect((await noOrders.get(tenant.id, q.id)).status).toBe("draft");
    });

    it("duplicates into a fresh draft with its own number", async () => {
      const q = await make({ notes: "n", deliveryText: "1 week" });
      const d = await svc.duplicate(tenant, q.id);
      expect(d.number).not.toBe(q.number);
      expect(d).toMatchObject({ status: "draft", rev: 1, notes: "n", deliveryText: "1 week", total: q.total });
    });

    it("cancels with a reason; a cancelled quotation can't be shared or revised", async () => {
      const q = await make();
      await send(q.id);
      const c = await svc.cancel(tenant.id, q.id, "Not needed", user.id);
      expect(c).toMatchObject({ status: "cancelled", cancelReason: "Not needed", canCancel: false, canRevise: false });
      await expect(svc.share(tenant.id, q.id)).rejects.toMatchObject({ code: "quotation_locked" });
      await expect(svc.revise(tenant, q.id)).rejects.toMatchObject({ code: "quotation_locked" });
      await expect(svc.cancel(tenant.id, q.id)).rejects.toMatchObject({ code: "quotation_locked" });
      expect((await svc.getPublic((await db.execute(sql`select share_token from quotations where id = ${q.id}`))[0]!.share_token as string)).quotation.canRespond).toBe(false);
    });
  });

  describe("no effect on stock, sales, GST returns or the credit book", () => {
    it("does nothing outside quotations until a bill is issued", async () => {
      const fresh = randomUUID();
      const t2 = { ...tenant, id: fresh };
      const cust = await invoices.createCustomer(fresh, { name: "Credit Customer", phone: "9333333333", gstin: GSTIN_KA });
      const itemLine = { ...line, itemId: randomUUID() };
      stock.applySale.mockClear();
      const q = await svc.create(t2, { customerId: cust.id, lines: [itemLine], advancePercent: 50 }, { userId: user.id });
      await svc.respond((await svc.share(fresh, q.id)).token, { decision: "accept", name: "Credit Customer" });
      await svc.revise(t2, q.id, { notes: "again" });
      expect(stock.applySale).not.toHaveBeenCalled();

      const range = { from: "2026-04-01", to: "2027-03-31" };
      expect((await invoices.list(fresh, {})).total).toBe(0);
      expect((await invoices.salesRegister(fresh, range)).items).toHaveLength(0);
      const gst = await invoices.gstSummary(fresh, range);
      expect(gst.totals).toMatchObject({ taxable: 0, cgst: 0, sgst: 0, igst: 0 });
      expect((await invoices.getCustomer(fresh, cust.id)).outstanding).toBe(0);
      const summary = await invoices.summary(fresh);
      expect(summary.month.invoiced).toBe(0);
      expect(summary.outstanding).toBe(0);

      // The bill made from it is what counts, once issued.
      const latest = (await svc.list(fresh, {})).items[0]!;
      const res = await svc.convert(t2, latest.id, { issue: true });
      expect(stock.applySale).toHaveBeenCalledTimes(1);
      expect((await invoices.salesRegister(fresh, range)).items).toHaveLength(1);
      expect((await invoices.getCustomer(fresh, cust.id)).outstanding).toBe(res.invoice!.total);
    });
  });

  describe("summary figures", () => {
    it("reports open value, accepted this month and the conversion rate for a shop", async () => {
      const t3 = { ...tenant, id: randomUUID() };
      const mk = (over: Partial<QuotationInput> = {}) => svc.create(t3, { customer: walkIn, lines: [line], ...over });
      const a = await mk(); // sent, valid
      const b = await mk(); // accepted
      const c = await mk(); // converted
      const d = await mk({ validUntil: "2026-10-15" }); // sent, expiring soon
      await mk(); // draft
      const e = await mk(); // declined
      for (const q of [a, b, c, d, e]) await svc.share(t3.id, q.id);
      await svc.respond((await svc.share(t3.id, b.id)).token, { decision: "accept", name: "B" });
      await svc.respond((await svc.share(t3.id, c.id)).token, { decision: "accept", name: "C" });
      await svc.respond((await svc.share(t3.id, e.id)).token, { decision: "decline", name: "E" });
      await svc.convert(t3, c.id);
      const s = await svc.summary(t3.id);
      expect(s.awaiting).toEqual({ count: 2, value: a.total + d.total });
      expect(s.toConvert).toEqual({ count: 1, value: b.total });
      expect(s.open.count).toBe(3);
      expect(s.expiringSoon).toBe(1);
      expect(s.drafts).toBe(1);
      expect(s.acceptedThisMonth.count).toBe(2); // b (accepted) and c (accepted, then converted)
      expect(s.convertedThisMonth.count).toBe(1);
      expect(s.sentLast90).toBe(5);
      expect(s.conversionRate).toBe(20);
    });
  });

  describe("routes", () => {
    const staff = { authorization: "Bearer t" };
    const body = { customer: walkIn, lines: [line] };

    it("needs a signed-in staff member everywhere except the public page", async () => {
      expect((await app.inject({ method: "GET", url: "/v1/quotations" })).statusCode).toBeGreaterThanOrEqual(400);
      expect((await app.inject({ method: "POST", url: "/v1/quotations", payload: body })).statusCode).toBeGreaterThanOrEqual(400);
      const created = await app.inject({ method: "POST", url: "/v1/quotations", headers: staff, payload: body });
      expect(created.statusCode).toBe(200);
      const q = created.json();
      expect(q.number).toMatch(/^QT\//);
      expect((await app.inject({ method: "GET", url: `/v1/quotations/${q.id}`, headers: staff })).json().id).toBe(q.id);
    });

    it("customers accept on the public page without signing in", async () => {
      const q = (await app.inject({ method: "POST", url: "/v1/quotations", headers: staff, payload: body })).json();
      const shared = (await app.inject({ method: "POST", url: `/v1/quotations/${q.id}/share`, headers: staff })).json();
      const view = await app.inject({ method: "GET", url: `/v1/quotations/public/${shared.token}` });
      expect(view.statusCode).toBe(200);
      expect(view.json().quotation).toMatchObject({ number: q.number, canRespond: true });
      const bad = await app.inject({ method: "POST", url: `/v1/quotations/public/${shared.token}/respond`, payload: { decision: "accept" } });
      expect(bad.statusCode).toBe(400);
      const ok = await app.inject({ method: "POST", url: `/v1/quotations/public/${shared.token}/respond`, payload: { decision: "accept", name: "Priya", note: "Go ahead" } });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().quotation).toMatchObject({ status: "accepted", respondedBy: "Priya" });
      const twice = await app.inject({ method: "POST", url: `/v1/quotations/public/${shared.token}/respond`, payload: { decision: "decline", name: "Priya" } });
      expect(twice.statusCode).toBe(409);
      expect(twice.json().code).toBe("quotation_answered");
      const detail = (await app.inject({ method: "GET", url: `/v1/quotations/${q.id}`, headers: staff })).json();
      expect(detail).toMatchObject({ status: "accepted", respondedBy: "Priya", canConvert: true });
    });

    it("lists, summarises, revises, converts and cancels over HTTP", async () => {
      const q = (await app.inject({ method: "POST", url: "/v1/quotations", headers: staff, payload: { ...body, customer: { name: "Http Customer" } } })).json();
      const list = (await app.inject({ method: "GET", url: "/v1/quotations?q=http%20customer&status=draft", headers: staff })).json();
      expect(list.items.map((i: { id: string }) => i.id)).toEqual([q.id]);
      expect((await app.inject({ method: "GET", url: "/v1/quotations/summary", headers: staff })).json()).toHaveProperty("conversionRate");
      await app.inject({ method: "POST", url: `/v1/quotations/${q.id}/share`, headers: staff });
      const rev = await app.inject({ method: "POST", url: `/v1/quotations/${q.id}/revise`, headers: staff, payload: { notes: "r2" } });
      expect(rev.json()).toMatchObject({ rev: 2, notes: "r2" });
      const conv = await app.inject({ method: "POST", url: `/v1/quotations/${rev.json().id}/convert`, headers: staff, payload: {} });
      expect(conv.json()).toMatchObject({ invoice: { status: "draft" }, quotation: { status: "converted" } });
      const linked = (await app.inject({ method: "GET", url: `/v1/quotations/linked?targetId=${conv.json().invoice.id}`, headers: staff })).json();
      expect(linked.quotation).toMatchObject({ number: q.number });
      const cancelled = await app.inject({ method: "POST", url: `/v1/quotations/${rev.json().id}/cancel`, headers: staff, payload: {} });
      expect(cancelled.statusCode).toBe(409);
    });
  });
});
