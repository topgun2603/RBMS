/**
 * Reserved invoice-number blocks for offline POS terminals against Postgres: two terminals asking at once get disjoint
 * blocks, online bills continue after the block, a bill issued with a reserved number takes exactly that number, and a
 * number can't be issued twice. Runs only with `INVOICES_TEST_DATABASE_URL` set; it copies the invoices tables into a
 * throw-away schema and drops it afterwards.
 */
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@srirealtime/db";
import { financialYear, todayIST } from "@srirealtime/gst";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InvoicesService } from "./service";

const URL_ = process.env.INVOICES_TEST_DATABASE_URL;
const SCHEMA = `invoices_offnum_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["billing_customers", "billing_items", "invoices", "invoice_payments", "invoice_series", "credit_notes", "credit_note_series", "sales_debit_notes", "sales_debit_note_series", "sales_debit_note_allocations", "till_sessions", "invoice_messages", "invoice_reminders", "customer_receipts"];
const tenant = { id: randomUUID(), slug: "sri", planId: "pro", appId: "BL" };

describe.skipIf(!URL_)("reserved invoice numbers (Postgres)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let service: InvoicesService;
  const today = todayIST(new Date());
  const fy = financialYear(today);
  const line = { description: "Tea", qty: 1, rate: 10_000, gstRate: 5 };
  const bill = (presetNumber?: { fy: string; prefix: string; seq: number }) =>
    service.create(tenant, { customer: { name: "Walk-in" }, date: today, lines: [line], issue: true }, presetNumber ? { presetNumber } : {});

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
    });
  });
  afterAll(async () => {
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("hands two terminals disjoint blocks, even when they ask at the same moment", async () => {
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => service.reserveSeqBlock(tenant, { count: 10 })));
    const ranges = [a!, b!, c!].map((r) => [r.fromSeq, r.toSeq] as const).sort((x, y) => x[0] - y[0]);
    expect(ranges.every(([f, t]) => t - f === 9)).toBe(true);
    expect(ranges[1]![0]).toBe(ranges[0]![1] + 1);
    expect(ranges[2]![0]).toBe(ranges[1]![1] + 1);
    expect(new Set([a!.fy, b!.fy, c!.fy])).toEqual(new Set([fy]));
  });

  it("an online bill after a reservation continues past the block", async () => {
    const block = await service.reserveSeqBlock(tenant, { count: 5 });
    const online = await bill();
    expect(online.number).toMatch(new RegExp(`/${String(block.toSeq + 1).padStart(4, "0")}$`));
  });

  it("issues a bill with exactly the reserved number, once", async () => {
    const block = await service.reserveSeqBlock(tenant, { count: 3 });
    const mid = block.fromSeq + 1;
    const issued = await bill({ fy: block.fy, prefix: block.prefix, seq: mid });
    expect(issued.number).toContain(String(mid).padStart(4, "0"));
    // Same number again: the unique index refuses (the caller's own bookkeeping is the first line of defence).
    await expect(bill({ fy: block.fy, prefix: block.prefix, seq: mid })).rejects.toThrow();
    // A reservation from another FY is refused.
    await expect(bill({ fy: "2019-20", prefix: block.prefix, seq: block.fromSeq })).rejects.toMatchObject({ code: "number_fy_mismatch" });
  });
});
