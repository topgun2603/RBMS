/**
 * Z reports, pay-in / pay-out categories, cashier handover and the manager PIN for a cash difference, against Postgres.
 * Runs only with `INVOICES_TEST_DATABASE_URL` set; it copies the invoices tables into a throw-away schema and drops it
 * afterwards.
 */
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@srirealtime/db";
import { todayIST } from "@srirealtime/gst";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvoicesService } from "./service";
import type { TillApprovalPort } from "./till";

const URL_ = process.env.INVOICES_TEST_DATABASE_URL;
const SCHEMA = `invoices_till_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["billing_customers", "billing_items", "invoices", "invoice_payments", "invoice_series", "credit_notes", "credit_note_series", "till_sessions", "invoice_messages", "invoice_reminders", "customer_receipts"];
const tenant = { id: randomUUID(), slug: "sri", planId: "pro", appId: "BL" };
const manager = { userId: randomUUID(), name: "Manager Raja" };

describe.skipIf(!URL_)("till Z report, handover and approval (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let service: InvoicesService;
  const today = todayIST(new Date());
  const cashier = { id: randomUUID(), name: "Meena" };
  const approvals: TillApprovalPort & { asked: string[] } = {
    asked: [],
    varianceLimit: async () => 5_000,
    approve: async (_t, pin) => {
      approvals.asked.push(pin);
      return pin === "4321" ? manager : null;
    },
  };

  /** A paid bill of ₹1,050 (₹1,000 + 5% GST) at the session. */
  const sell = async (tillSessionId: string, opts: { discount?: number; method?: "cash" | "upi"; cancel?: boolean } = {}) => {
    const inv = await service.create(
      tenant,
      { customer: { name: "Walk-in" }, date: today, lines: [{ description: "Tea", qty: 1, rate: 100_000, gstRate: 5, ...(opts.discount ? { discount: opts.discount } : {}) }], issue: true, tillSessionId },
      {},
    );
    // A bill cancelled before anything was paid is a void.
    if (opts.cancel) {
      await service.cancel(tenant.id, inv.id, "mistake");
      return { inv };
    }
    const paid = await service.addPayment(tenant.id, inv.id, { amount: inv.total, method: opts.method ?? "cash", date: today, tillSessionId }, cashier.id);
    return { inv, paid };
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 8 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    service = new InvoicesService({
      db,
      seller: { get: async () => ({ legalName: "Thari Weaves", gstin: "33AAACR5055K1ZE", stateCode: "33", address: "1 Car St", city: "Madurai" }) },
      branding: { get: async () => ({ appName: null, logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com",
      notifier: { send: async () => ({ logId: "log-1" }) },
      tillApprovals: approvals,
    });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  const open = (register: string, openingCash = 100_000) => service.till.open(tenant.id, { register, openingCash }, { actor: cashier });

  it("numbers the Z reports per register, never twice, and a closed session cannot be closed or touched again", async () => {
    const a1 = await open("Counter A");
    const b1 = await open("Counter B");
    const z1 = await service.till.close(tenant.id, a1.id, { countedCash: 100_000 }, cashier);
    expect(z1.session.zNumber).toBe(1);
    const a2 = await open("Counter A");
    const z2 = await service.till.close(tenant.id, a2.id, { countedCash: 100_000 }, cashier);
    expect(z2.session.zNumber).toBe(2);
    const zb = await service.till.close(tenant.id, b1.id, { countedCash: 100_000 }, cashier);
    expect(zb.session.zNumber).toBe(1);
    // Cannot be re-opened, closed again or have cash moved.
    await expect(service.till.close(tenant.id, a1.id, { countedCash: 100_000 }, cashier)).rejects.toMatchObject({ code: "till_closed" });
    await expect(service.till.cash(tenant.id, a1.id, { amount: 100, reason: "x", category: "other" }, cashier)).rejects.toMatchObject({ code: "till_closed" });
    await expect(service.till.handover(tenant.id, a1.id, { toName: "Kumar", countedCash: 100_000 }, cashier)).rejects.toMatchObject({ code: "till_closed" });
  });

  it("gives different Z numbers when the same register closes on two devices at once", async () => {
    // Two sessions of one register cannot be open together, so close one, open the next and race the closes of two registers.
    const first = await open("Counter R");
    await service.till.close(tenant.id, first.id, { countedCash: 100_000 }, cashier);
    const next = await open("Counter R");
    const other = await open("Counter Q");
    const [zr, zq] = await Promise.all([
      service.till.close(tenant.id, next.id, { countedCash: 100_000 }, cashier),
      service.till.close(tenant.id, other.id, { countedCash: 100_000 }, cashier),
    ]);
    expect(zr.session.zNumber).toBe(2);
    expect(zq.session.zNumber).toBe(1);
  });

  it("freezes sales, discounts, voids, tax by rate, bill range and pay-in / pay-out by category into the Z report", async () => {
    const s = await open("Counter Z");
    await sell(s.id);
    await sell(s.id, { discount: 10_000, method: "upi" });
    await sell(s.id, { cancel: true });
    await service.till.cash(tenant.id, s.id, { amount: -5_000, category: "petty_expense", reason: "tea" }, cashier);
    await service.till.cash(tenant.id, s.id, { amount: -20_000, category: "owner_drawing", reason: "" }, cashier);
    await service.till.cash(tenant.id, s.id, { amount: 10_000, category: "change_float", reason: "coins" }, cashier);
    const x = await service.till.report(tenant.id, s.id);
    const expected = 100_000 + 105_000 - 5_000 - 20_000 + 10_000;
    expect(x.report.cash.expected).toBe(expected);
    const z = await service.till.close(tenant.id, s.id, { countedCash: expected }, cashier);
    const r = z.report;
    expect(r.bills.count).toBe(2);
    expect(r.voids).toEqual({ count: 1, total: 105_000 });
    expect(r.discounts).toEqual({ total: 10_000, bills: 1 });
    expect(r.taxByRate).toHaveLength(1);
    expect(r.taxByRate![0]).toMatchObject({ gstRate: 5, taxable: 190_000 });
    expect(r.billRange?.from).toBeTruthy();
    expect(r.billRange?.to).toBeTruthy();
    expect(r.cashByCategory).toEqual([
      { category: "owner_drawing", cashIn: 0, cashOut: 20_000, count: 1 },
      { category: "change_float", cashIn: 10_000, cashOut: 0, count: 1 },
      { category: "petty_expense", cashIn: 0, cashOut: 5_000, count: 1 },
    ]);
    expect(z.session.difference).toBe(0);
    // The frozen report is what a later read returns.
    const again = await service.till.report(tenant.id, s.id);
    expect(again.report).toEqual(r);
  });

  it("wants a reason for any difference and a manager PIN beyond the limit", async () => {
    const s = await open("Counter D");
    await expect(service.till.close(tenant.id, s.id, { countedCash: 99_000 }, cashier)).rejects.toMatchObject({ code: "till_reason_required" });
    // ₹10 short is within the ₹50 limit: a reason is enough.
    const ok = await service.till.close(tenant.id, s.id, { countedCash: 99_000, reason: "extra change" }, cashier);
    expect(ok.session).toMatchObject({ difference: -1_000, differenceReason: "extra change", closeApprovedByName: null });

    const big = await open("Counter D");
    // ₹200 short is beyond it.
    await expect(service.till.close(tenant.id, big.id, { countedCash: 80_000, reason: "unknown" }, cashier)).rejects.toMatchObject({ code: "till_approval_required", details: { difference: -20_000, limit: 5_000 } });
    await expect(service.till.close(tenant.id, big.id, { countedCash: 80_000, reason: "unknown" }, cashier, { pin: "0000" })).rejects.toMatchObject({ code: "till_approval_invalid" });
    const done = await service.till.close(tenant.id, big.id, { countedCash: 80_000, reason: "unknown" }, cashier, { pin: "4321" });
    expect(done.session).toMatchObject({ difference: -20_000, closeApprovedByName: "Manager Raja" });
  });

  it("lets an owner or admin close a large difference without a PIN", async () => {
    const s = await open("Counter O");
    const done = await service.till.close(tenant.id, s.id, { countedCash: 50_000, reason: "bank deposit not entered" }, cashier, { selfApprove: true });
    expect(done.session.difference).toBe(-50_000);
    expect(done.session.closeApprovedByName).toBeNull();
  });

  it("hands the drawer to the next cashier without closing the day, and the difference stays with the first", async () => {
    const s = await open("Counter H");
    await sell(s.id);
    const expected = 100_000 + 105_000;
    // Meena counts ₹30 short (within the limit) and says why.
    await expect(service.till.handover(tenant.id, s.id, { toName: "Kumar", countedCash: expected - 3_000 }, cashier)).rejects.toMatchObject({ code: "till_reason_required" });
    const h = await service.till.handover(tenant.id, s.id, { toName: "Kumar", countedCash: expected - 3_000, reason: "coins short" }, cashier);
    expect(h.session.status).toBe("open");
    expect(h.session.cashierName).toBe("Kumar");
    expect(h.session.handovers).toHaveLength(1);
    expect(h.session.handovers[0]).toMatchObject({ fromName: "Meena", toName: "Kumar", expected, counted: expected - 3_000, difference: -3_000, note: "coins short" });
    // The next leg starts from the count: Kumar's drawer is expected to hold what Meena counted.
    expect(h.report.cash.expected).toBe(expected - 3_000);
    const kumar = { id: randomUUID(), name: "Kumar" };
    const z = await service.till.close(tenant.id, s.id, { countedCash: expected - 3_000 }, kumar);
    expect(z.session.difference).toBe(0);
    expect(z.session.closedByName).toBe("Kumar");
    expect(z.session.openedByName).toBe("Meena");
    expect(z.report.cash.handoverAdjust).toBe(-3_000);
    expect(z.session.handovers).toHaveLength(1);
  });

  it("a large handover difference needs the manager PIN too", async () => {
    const s = await open("Counter P");
    await expect(service.till.handover(tenant.id, s.id, { toName: "Kumar", countedCash: 60_000, reason: "short" }, cashier)).rejects.toMatchObject({ code: "till_approval_required" });
    const h = await service.till.handover(tenant.id, s.id, { toName: "Kumar", countedCash: 60_000, reason: "short" }, cashier, { pin: "4321" });
    expect(h.session.handovers[0]).toMatchObject({ difference: -40_000, approvedByName: "Manager Raja" });
  });
});
