/**
 * Recurring invoices, export / foreign-currency bills and the GSTIN lookup against Postgres
 * (docs/recurring-export-gstin.md). Runs only with `INVOICES_TEST_DATABASE_URL` set; it copies the tables into a
 * throw-away schema and drops it afterwards. Nothing is sent: the notifier is a fake that records messages.
 */
import { randomUUID } from "node:crypto";
import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { gstinCheckChar } from "@srirealtime/gst";
import { and, eq, sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { fakeGstinProvider, GstinLookupService } from "./gstin-lookup";
import { RecurringService } from "./recurring";
import { recurringRoutes } from "./recurring-routes";
import { invoices as invoicesTable } from "./schema";
import { recurringProfiles, recurringRuns } from "./schema-recurring";
import { InvoicesService } from "./service";

const URL_ = process.env.INVOICES_TEST_DATABASE_URL;
const SCHEMA = `recurring_${Math.random().toString(36).slice(2, 10)}`;
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
  "recurring_profiles",
  "recurring_runs",
  "gstin_lookups",
  "gstin_lookup_log",
];
const user = { id: randomUUID(), sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };
const newTenant = () => ({ id: randomUUID(), slug: "sri", planId: "pro", appId: "BL" });
const g = (first14: string) => first14 + gstinCheckChar(first14);
const SEZ_GSTIN = g("33AABCS9999K1Z");

describe.skipIf(!URL_)("recurring invoices, export bills, GSTIN lookup (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let invoices: InvoicesService;
  let recurring: RecurringService;
  let app: FastifyInstance;
  let tenant = newTenant();
  let clock = new Date("2026-10-14T06:00:00Z"); // 14 Oct 2026 IST
  let locked: string | null = null;
  let quotaLeft = Infinity;
  let lut = true;
  const sent: { template: string; to: string; channel: string }[] = [];

  const amc = { description: "Annual maintenance (monthly)", hsn: "998719", qty: 1, unit: "job", rate: 150_000, gstRate: 18 as const };
  const customer = () => invoices.createCustomer(tenant.id, { name: "Meena Stores", phone: "9000000001" });
  const runs = (profileId: string) =>
    db.select().from(recurringRuns).where(and(eq(recurringRuns.tenantId, tenant.id), eq(recurringRuns.profileId, profileId))).orderBy(recurringRuns.runDate);
  const billsOf = () => db.select().from(invoicesTable).where(eq(invoicesTable.tenantId, tenant.id)).orderBy(invoicesTable.date);

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 8 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    invoices = new InvoicesService({
      db,
      seller: {
        get: async () => ({
          legalName: "Thari Exports",
          gstin: "33AAACR5055K1ZE",
          stateCode: "33",
          address: "1 Car St",
          city: "Madurai",
          ...(lut ? { lutNumber: "AD330326000123X", lutDate: "2026-04-01" } : {}),
        }),
      },
      branding: { get: async () => ({ appName: "Thari", logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com",
      entitlements: {
        consume: async () => {
          if (quotaLeft <= 0) throw new AppError(402, "plan_limit", "Your plan's bills for this month are used up");
          quotaLeft -= 1;
          return 1;
        },
      },
      notifier: {
        send: async (m) => {
          sent.push({ template: m.template, to: m.to, channel: m.channel });
          return { logId: `log-${sent.length}` };
        },
      },
      now: () => clock,
    });
    recurring = new RecurringService({
      db,
      invoices,
      tenant: async (id) => (id === tenant.id ? tenant : null),
      lockedThrough: async () => locked,
      now: () => clock,
    });
    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant, user: user as never } as RequestContext;
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number; code?: string; message: string }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message, code: err.code });
    });
    await app.register(recurringRoutes(recurring), { prefix: "/v1/recurring" });
  });
  beforeEach(() => {
    tenant = newTenant();
    clock = new Date("2026-10-14T06:00:00Z");
    locked = null;
    quotaLeft = Infinity;
    lut = true;
    sent.length = 0;
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close?.();
  });

  // ---------------------------------------------------------------- recurring

  describe("recurring invoices", () => {
    it("bills month-end dates on the month's last day", async () => {
      const c = await customer();
      const p = await recurring.create(tenant, { customerId: c.id, lines: [amc], frequency: "monthly", dayOfMonth: 31, startDate: "2026-01-31" });
      expect(p.nextRunDate).toBe("2026-10-31");
      expect(p.upcoming).toEqual(["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"]);
      expect(p.name).toBe("Monthly – Meena Stores");
    });

    it("makes one bill per date however many times the job runs, also at the same time", async () => {
      const c = await customer();
      const p = await recurring.create(tenant, { customerId: c.id, lines: [amc], frequency: "monthly", startDate: "2026-10-14", issueMode: "issue", sendChannel: "whatsapp" });
      expect(p.nextRunDate).toBe("2026-10-14");
      await Promise.all([recurring.runDue(clock), recurring.runDue(clock), recurring.runProfile(tenant.id, p.id, clock)]);
      await recurring.runDue(clock);
      const bills = await billsOf();
      expect(bills).toHaveLength(1);
      expect(bills[0]).toMatchObject({ status: "issued", date: "2026-10-14", number: "INV/26-27/0001", total: 177_000 });
      const [run] = await runs(p.id);
      expect(run).toMatchObject({ status: "created", invoiceId: bills[0]!.id, runDate: "2026-10-14", sentLogId: "log-1" });
      expect(sent).toEqual([{ template: "invoice.issued", to: "+919000000001", channel: "whatsapp" }]);
      const after = await recurring.get(tenant.id, p.id);
      expect(after).toMatchObject({ count: 1, nextRunDate: "2026-11-14", status: "active" });
      expect(bills[0]!.recurringRunId).toBe(run!.id);
    });

    it("catches up only the latest missed dates (cap 3) and records the older ones as skipped", async () => {
      const c = await customer();
      const p = await recurring.create(tenant, { customerId: c.id, lines: [amc], frequency: "monthly", dayOfMonth: 5, startDate: "2026-04-05" });
      // The scheduler was down since April: next date still 5 May.
      await db.update(recurringProfiles).set({ nextRunDate: "2026-05-05" }).where(eq(recurringProfiles.id, p.id));
      const r = await recurring.runDue(clock);
      expect(r).toMatchObject({ created: 3, skipped: 3 });
      const all = await runs(p.id);
      expect(all.map((x) => [x.runDate, x.status])).toEqual([
        ["2026-05-05", "skipped"],
        ["2026-06-05", "skipped"],
        ["2026-07-05", "skipped"],
        ["2026-08-05", "created"],
        ["2026-09-05", "created"],
        ["2026-10-05", "created"],
      ]);
      expect((await billsOf()).map((b) => [b.date, b.status])).toEqual([
        ["2026-08-05", "draft"],
        ["2026-09-05", "draft"],
        ["2026-10-05", "draft"],
      ]);
      expect((await recurring.get(tenant.id, p.id)).nextRunDate).toBe("2026-11-05");
    });

    it("respects the period lock: no bill dated in locked books", async () => {
      const c = await customer();
      const p = await recurring.create(tenant, { customerId: c.id, lines: [amc], frequency: "weekly", startDate: "2026-10-14" });
      locked = "2026-10-31";
      await recurring.runDue(clock);
      expect(await billsOf()).toHaveLength(0);
      expect((await runs(p.id))[0]).toMatchObject({ status: "locked", error: "The books are locked up to 2026-10-31" });
    });

    it("fails on the plan limit, keeps the date, and makes the bill on a later run once allowed", async () => {
      const c = await customer();
      const p = await recurring.create(tenant, { customerId: c.id, lines: [amc], frequency: "monthly", startDate: "2026-10-14", issueMode: "issue" });
      quotaLeft = 0;
      await recurring.runDue(clock);
      expect((await runs(p.id))[0]).toMatchObject({ status: "failed", attempts: 1 });
      expect((await recurring.get(tenant.id, p.id)).lastError).toContain("used up");
      quotaLeft = 5;
      clock = new Date("2026-10-14T09:00:00Z");
      await recurring.runDue(clock);
      expect((await runs(p.id))[0]).toMatchObject({ status: "created", attempts: 2 });
      expect(await billsOf()).toHaveLength(1);
    });

    it("pauses, skips the next date, resumes from today, and ends after the number of bills", async () => {
      const c = await customer();
      const p = await recurring.create(tenant, { customerId: c.id, lines: [amc], frequency: "weekly", weekday: 3, startDate: "2026-10-14", maxCount: 2 });
      expect(p.nextRunDate).toBe("2026-10-14"); // a Wednesday
      const skipped = await recurring.skipNext(tenant.id, p.id);
      expect(skipped.nextRunDate).toBe("2026-10-21");
      expect(skipped.runs[0]).toMatchObject({ runDate: "2026-10-14", status: "skipped", trigger: "user" });
      await recurring.pause(tenant.id, p.id);
      clock = new Date("2026-10-29T06:00:00Z");
      expect((await recurring.runDue(clock)).created).toBe(0);
      const resumed = await recurring.resume(tenant.id, p.id);
      expect(resumed.nextRunDate).toBe("2026-11-04"); // dates missed while paused are not billed
      clock = new Date("2026-11-04T06:00:00Z");
      await recurring.runDue(clock);
      clock = new Date("2026-11-11T06:00:00Z");
      await recurring.runDue(clock);
      const done = await recurring.get(tenant.id, p.id);
      expect(done).toMatchObject({ count: 2, status: "ended", nextRunDate: null });
      clock = new Date("2026-11-18T06:00:00Z");
      await recurring.runDue(clock);
      expect(await billsOf()).toHaveLength(2);
    });

    it("bills now once per day and answers over HTTP", async () => {
      const c = await customer();
      const created = await app.inject({
        method: "POST",
        url: "/v1/recurring/",
        payload: { customerId: c.id, lines: [amc], frequency: "quarterly", startDate: "2026-11-01", issueMode: "issue" },
      });
      expect(created.statusCode).toBe(200);
      const id = created.json().id as string;
      const now1 = await app.inject({ method: "POST", url: `/v1/recurring/${id}/run` });
      expect(now1.json().run).toMatchObject({ status: "created", invoiceNumber: "INV/26-27/0001" });
      const now2 = await app.inject({ method: "POST", url: `/v1/recurring/${id}/run` });
      expect(now2.statusCode).toBe(409);
      const list = await app.inject({ method: "GET", url: "/v1/recurring/?status=active" });
      expect(list.json()).toMatchObject({ total: 1, facets: { status: { active: 1 } } });
      const bad = await app.inject({ method: "POST", url: "/v1/recurring/", payload: { customerId: c.id, lines: [amc], frequency: "monthly", startDate: "2026-11-01", endDate: "2026-10-01" } });
      expect(bad.statusCode).toBe(400);
    });
  });

  // ---------------------------------------------------------------- export bills

  describe("export and foreign-currency bills", () => {
    const saree = { description: "Handloom silk saree", hsn: "50072010", qty: 10, unit: "pcs", rate: 0, gstRate: 5 as const };
    const usd = { currency: "USD", exchangeRate: 83.25, lines: [{ rate: 10_000 }] };
    const buyer = () => invoices.createCustomer(tenant.id, { name: "Madison Imports LLC", country: "us", address: "120 Broadway, New York" });

    it("a buyer abroad gets place of supply 96", async () => {
      const c = await buyer();
      expect(c).toMatchObject({ country: "US", stateCode: "96", gstin: null });
    });

    it("issues an export under LUT in USD: no tax, rupees from the typed rate, LUT frozen, both currencies stored", async () => {
      const c = await buyer();
      const draft = await invoices.create(tenant, {
        customerId: c.id,
        date: "2026-10-14",
        lines: [saree],
        supplyType: "export_wopay",
        foreign: usd,
        exportDetails: { shippingBillNo: "7654321", shippingBillDate: "2026-10-16", portCode: "inmaa1" },
      });
      expect(draft).toMatchObject({ placeOfSupply: "96", interState: true, total: 83_250_00, currency: "USD", exchangeRate: 83.25 });
      expect(draft.lines[0]).toMatchObject({ rate: 8_325_00, gstRate: 0, igst: 0 });
      expect(draft.foreign).toMatchObject({ currency: "USD", taxable: 100_000, tax: 0, total: 100_000 });
      lut = false;
      await expect(invoices.issue(tenant, draft.id)).rejects.toMatchObject({ code: "lut_missing" });
      lut = true;
      const bill = await invoices.issue(tenant, draft.id);
      expect(bill.exportDetails).toEqual({ shippingBillNo: "7654321", shippingBillDate: "2026-10-16", portCode: "INMAA1", lutNumber: "AD330326000123X", lutDate: "2026-04-01" });
      expect(bill.customer).toMatchObject({ stateCode: "96", country: "US" });
    });

    it("charges IGST on an export with payment, and on an SEZ supply inside Tamil Nadu", async () => {
      const c = await buyer();
      const wpay = await invoices.create(tenant, { customerId: c.id, date: "2026-10-14", lines: [saree], supplyType: "export_wpay", foreign: usd, issue: true });
      expect(wpay.totals).toMatchObject({ taxable: 83_250_00, igst: 4_162_50, cgst: 0 });
      expect(wpay.foreign).toMatchObject({ tax: 5_000, total: 105_000 });
      const sez = await invoices.createCustomer(tenant.id, { name: "MEPZ SEZ unit", gstin: SEZ_GSTIN });
      const bill = await invoices.create(tenant, { customerId: sez.id, date: "2026-10-14", lines: [{ ...saree, rate: 8_325_00 }], supplyType: "sez_wpay", issue: true });
      expect(bill).toMatchObject({ placeOfSupply: "33", interState: true });
      expect(bill.totals).toMatchObject({ igst: 4_162_50, cgst: 0, sgst: 0 });
      const walkIn = await invoices.create(tenant, { customer: { name: "No GSTIN" }, date: "2026-10-14", lines: [saree], supplyType: "sez_wopay" }).catch((e) => e);
      expect(walkIn).toBeInstanceOf(AppError);
    });

    it("records a USD receipt at the bank's rate: settled at the bill's rate, the gain kept on the payment", async () => {
      const c = await buyer();
      const bill = await invoices.create(tenant, { customerId: c.id, date: "2026-10-14", lines: [saree], supplyType: "export_wopay", foreign: usd, issue: true });
      const half = await invoices.addForeignPayment(tenant.id, bill.id, { amount: 50_000, realisedRate: "84.10", method: "bank", date: "2026-10-14" });
      expect(half.payments[0]).toMatchObject({ amount: 41_625_00, foreign: { currency: "USD", amount: 50_000, rate: 84.1, forexDiff: 425_00 } });
      expect(half.status).toBe("partially_paid");
      const rest = await invoices.addForeignPayment(tenant.id, bill.id, { amount: 50_000, realisedRate: 82.9, date: "2026-10-14" });
      expect(rest.status).toBe("paid");
      expect(rest.payments[1]).toMatchObject({ amount: 41_625_00, foreign: { forexDiff: -175_00 } });
      await expect(invoices.addForeignPayment(tenant.id, bill.id, { amount: 1, realisedRate: 83, date: "2026-10-14" })).rejects.toBeInstanceOf(AppError);
    });
  });

  // ---------------------------------------------------------------- GSTIN lookup

  describe("GSTIN lookup", () => {
    const known = g("33AAACR5055K2Z");
    const cancelled = g("29AAFCB9012M1Z");
    const details = (status: "active" | "cancelled") => ({
      legalName: "Raja Traders Private Limited",
      tradeName: "Raja Traders",
      address: "12, Big Bazaar Street, Madurai, 625001",
      pincode: "625001",
      stateCode: null,
      status,
      registrationType: "Regular",
      constitution: "Private Limited Company",
      registeredOn: "2018-07-01",
      cancelledOn: status === "cancelled" ? "2025-03-31" : null,
    });

    it("without a provider answers the offline part and says so", async () => {
      const svc = new GstinLookupService({ db, now: () => clock });
      const r = await svc.lookup(tenant.id, known.toLowerCase());
      expect(r).toMatchObject({ valid: true, stateCode: "33", stateName: "Tamil Nadu", pan: "AAACR5055K", panHolder: "company" });
      expect(r.online).toMatchObject({ available: false, reason: "not_configured", details: null });
      const typo = await svc.lookup(tenant.id, known.slice(0, 14) + (known[14] === "A" ? "B" : "A"));
      expect(typo).toMatchObject({ valid: false, problem: "checksum", expectedCheck: known[14] });
    });

    it("asks the provider once, caches 30 days, rate-limits per shop and reports cancelled GSTINs", async () => {
      const provider = fakeGstinProvider({ [known]: details("active"), [cancelled]: details("cancelled") });
      const svc = new GstinLookupService({ db, provider, config: { perHour: 2 }, now: () => clock });
      const first = await svc.lookup(tenant.id, known);
      expect(first.online).toMatchObject({ source: "provider", found: true, details: { legalName: "Raja Traders Private Limited", status: "active", stateCode: "33" } });
      const again = await svc.lookup(tenant.id, known);
      expect(again.online.source).toBe("cache");
      expect(provider.calls).toEqual([known]);
      await svc.lookup(tenant.id, cancelled);
      const unknown = g("27AAACM1234A1Z");
      const limited = await svc.lookup(tenant.id, unknown);
      expect(limited.online.reason).toBe("rate_limited");
      expect(provider.calls).toHaveLength(2);
      const st = await svc.statuses([known, cancelled, unknown]);
      expect(st[cancelled]?.status).toBe("cancelled");
      expect(st[known]?.status).toBe("active");
      expect(st[unknown]).toBeUndefined();
      // Another shop: its own limit, but the shared cache answers without a call.
      const other = await svc.lookup(randomUUID(), cancelled);
      expect(other.online).toMatchObject({ source: "cache", details: { status: "cancelled" } });
      expect(provider.calls).toHaveLength(2);
    });
  });
});
