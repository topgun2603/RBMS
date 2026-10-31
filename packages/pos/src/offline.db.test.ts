/**
 * Offline billing against Postgres (routes + service): reserved number blocks, the idempotent bill sync (replays, parallel
 * retries, failures and retries), the conflict flags, voided bills and releasing unused numbers. The invoices and
 * catalogue modules are in-memory fakes (the real numbering is tested in packages/invoices offline-numbers.db.test.ts).
 * Runs only with `POS_TEST_DATABASE_URL` set; it works in a throw-away schema and drops it afterwards.
 *   PowerShell: $env:POS_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; pnpm test
 */
import { randomUUID } from "node:crypto";
import { AppError, emptyContext, permissionsAllow, requirePermission, type TenantRef } from "@rbms/core";
import { createDb, type Db } from "@rbms/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createPos, type Pos } from "./index";
import type { PosBillInfo, PosInvoicesPort, PosItem } from "./ports";
import type { OfflineFlag } from "./schema";

const URL_ = process.env.POS_TEST_DATABASE_URL;
const SCHEMA = `pos_off_${Math.random().toString(36).slice(2, 10)}`;
const S = `"${SCHEMA}"`;
const DDL = `
create table ${S}.pos_number_blocks (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, device_id text not null,
  terminal_id uuid, branch_id uuid, fy text not null, prefix text not null, from_seq integer not null, to_seq integer not null,
  status text not null default 'open', voided jsonb not null default '[]'::jsonb, reserved_by uuid, closed_by uuid,
  closed_at timestamptz, close_note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint pos_number_blocks_range_chk check (to_seq >= from_seq));
create table ${S}.pos_offline_bills (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, client_id uuid not null,
  device_id text not null, user_id uuid, status text not null default 'processing', attempts integer not null default 1,
  claimed_at timestamptz not null default now(), payload jsonb not null, billed_at timestamptz not null, block_id uuid, seq integer,
  provisional_number text, invoice_id uuid, number text, flags jsonb not null default '[]'::jsonb, error jsonb, reviewed_at timestamptz,
  reviewed_by uuid, review_note text, synced_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index on ${S}.pos_offline_bills (tenant_id, client_id);
create unique index on ${S}.pos_offline_bills (block_id, seq) where block_id is not null;
`;

const T1: TenantRef = { id: randomUUID(), slug: "kumar", planId: "starter", appId: "BL" };
const CASHIER = randomUUID();
const MANAGER = randomUUID();
const CASHIER2 = randomUUID();
const PERMS: Record<string, string[]> = { [CASHIER]: ["invoices.create"], [CASHIER2]: ["invoices.create"], [MANAGER]: ["invoices.*", "pos.*"] };
const FY = "26-27";
const BILL_DATE = "2026-10-24";

describe.skipIf(!URL_)("offline billing against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let pos: Pos;
  let clock = new Date("2026-10-24T09:00:00Z").getTime();

  // ---- fake invoices: one global series, a unique (fy, seq) like the real unique index
  let nextSeq = 100;
  const bills = new Map<string, PosBillInfo & { fy: string; seq: number; lines: Record<string, unknown>[]; customerId?: string; tillSessionId?: string }>();
  const takenSeq = new Set<string>();
  let issueCalls = 0;
  let failIssue: AppError | null = null;
  let failPayOnce = false;
  let missingCustomers = new Set<string>();
  let paymentCalls: { method: string; amount: number }[][] = [];

  const invoices: PosInvoicesPort = {
    reserveBlock: async (_t, q, inTx) =>
      db.transaction(async (tx) => {
        const fromSeq = nextSeq;
        nextSeq += q.count;
        const block = { branchId: q.branchId, fy: FY, prefix: "SK", fromSeq, toSeq: fromSeq + q.count - 1 };
        await inTx(tx, block);
        return block;
      }),
    issue: async (_t, input) => {
      issueCalls++;
      if (failIssue) throw failIssue;
      const seq = input.preset?.seq ?? nextSeq++;
      const key = `${FY}:${seq}`;
      if (takenSeq.has(key)) throw Object.assign(new Error("duplicate key"), { code: "23505", constraint_name: "invoices_tenant_branch_fy_seq_uq" });
      takenSeq.add(key);
      const flags: OfflineFlag[] = [];
      if (input.customerId && missingCustomers.has(input.customerId)) flags.push({ code: "customer_missing", detail: { customerId: input.customerId } });
      const total = input.lines.reduce((s, l) => s + Math.round(Number(l.rate) * Number(l.qty) * (1 + Number(l.gstRate) / 100)), 0);
      const id = randomUUID();
      const number = `${input.preset?.prefix ?? "SK"}-${FY}/${String(seq).padStart(4, "0")}`;
      bills.set(id, { invoiceId: id, number, total, paid: 0, balance: total, fy: FY, seq, lines: input.lines });
      return { invoiceId: id, number, fy: FY, seq, total, paid: 0, balance: total, flags };
    },
    pay: async (_t, id, input) => {
      if (failPayOnce) {
        failPayOnce = false;
        throw new Error("payment store down");
      }
      paymentCalls.push(input.payments.map((p) => ({ method: p.method, amount: p.amount })));
      const b = bills.get(id)!;
      for (const p of input.payments) (b.paid += p.amount), (b.balance -= p.amount);
      return { paid: b.paid, balance: b.balance, flags: [] };
    },
    get: async (_t, id) => {
      const b = bills.get(id);
      return b ? { invoiceId: b.invoiceId, number: b.number, total: b.total, paid: b.paid, balance: b.balance } : null;
    },
    findBySeq: async (_t, q) => {
      const b = [...bills.values()].find((x) => x.fy === q.fy && x.seq === q.seq);
      return b ? { invoiceId: b.invoiceId, number: b.number, total: b.total, paid: b.paid, balance: b.balance } : null;
    },
  };

  // ---- fake catalogue
  const catalog = new Map<string, PosItem>();
  const item = (over: Partial<PosItem> = {}): PosItem => {
    const it: PosItem = {
      itemId: randomUUID(), productId: null, name: "Tea", variantTitle: "", sku: null, barcodes: [], categoryId: null, price: 10_000, mrp: null,
      taxInclusive: false, gstRate: 5, hsn: null, unit: "pcs", soldBy: "unit", plu: null, image: null, stock: null, active: true, updatedAt: new Date(clock), ...over,
    };
    catalog.set(it.itemId, it);
    return it;
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 8 }));
    await db.execute(sql.raw(`create schema ${S}`));
    await db.execute(sql.raw(DDL));
    pos = createPos({
      db,
      now: () => new Date(clock),
      config: { pinKey: "k", apiOrigin: "http://api.test" },
      sessions: { create: async () => ({ token: "", sessionId: "", expiresAt: new Date() }), revokeTerminal: async () => 0, revokeOne: async () => false },
      members: { list: async () => [], rolesFor: async () => [], permissionsFor: async () => [], users: async () => [] },
      tenants: { ref: async () => T1, shop: async () => null },
      features: { isEnabled: async () => true, enabled: async () => [] },
      catalog: {
        rows: async () => [],
        categories: async () => [],
        items: async (_t, ids) => ids.map((i) => catalog.get(i)).filter((x): x is PosItem => !!x),
      },
      invoices,
    });
    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = emptyContext();
      req.ctx.tenant = T1;
      const uid = req.headers["x-user"] as string | undefined;
      if (uid) {
        const perms = PERMS[uid] ?? [];
        req.ctx.user = { id: uid, sessionId: "s", platformRoles: [], tenantRoles: ["staff"], permissions: perms };
      }
    });
    app.addHook("preHandler", async (req) => {
      const cfg = req.routeOptions.config as { permission?: string };
      if (cfg.permission) requirePermission(req.ctx, cfg.permission);
    });
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
      if (err instanceof ZodError) return reply.code(400).send({ error: { code: "invalid_input", details: err.issues } });
      return reply.code(500).send({ error: { code: "internal", message: String(err) } });
    });
    await app.register(async (r) => pos.module.routes!(r), { prefix: "/v1/pos" });
    await app.ready();
    void permissionsAllow;
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema if exists ${S} cascade`));
    await close?.();
  });

  const call = (method: "GET" | "POST", url: string, user: string | null, body?: unknown) =>
    app.inject({ method, url: `/v1/pos/offline${url}`, payload: body as object | undefined, headers: user ? { "x-user": user } : {} });

  const reserve = async (deviceId: string, count = 20, user = CASHIER) => {
    const r = await call("POST", "/blocks", user, { deviceId, count });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { id: string; fromSeq: number; toSeq: number; fy: string; prefix: string };
  };
  const line = (it?: PosItem, over: Record<string, unknown> = {}) => ({
    description: it?.name ?? "Tea",
    qty: 2,
    rate: 10_000,
    gstRate: 5,
    ...(it ? { itemId: it.itemId } : {}),
    ...over,
  });
  const mk = (deviceId: string, over: Record<string, unknown> = {}) => ({
    clientId: randomUUID(),
    deviceId,
    billedAt: new Date(clock - 60_000).toISOString(),
    date: BILL_DATE,
    lines: [line()],
    payments: [{ method: "cash", amount: 21_000 }],
    ...over,
  });
  const sync = async (bills: unknown[], user = CASHIER) => {
    const r = await call("POST", "/sync", user, { bills });
    expect(r.statusCode, r.body).toBe(200);
    return r.json().results as { clientId: string; status: string; duplicate: boolean; number: string | null; invoiceId: string | null; flags: OfflineFlag[]; error?: { code: string; retryable: boolean }; paid: number | null; balance: number | null }[];
  };

  it("reserves disjoint blocks for two devices asking together, and limits open blocks per device", async () => {
    const [a, b] = await Promise.all([reserve("dev-aaaaaaaa", 20), reserve("dev-bbbbbbbb", 20, CASHIER2)]);
    const [lo, hi] = [a, b].sort((x, y) => x.fromSeq - y.fromSeq);
    expect(hi!.fromSeq).toBe(lo!.toSeq + 1);
    expect(a.toSeq - a.fromSeq).toBe(19);
    await reserve("dev-aaaaaaaa", 10);
    await reserve("dev-aaaaaaaa", 10);
    const over = await call("POST", "/blocks", CASHIER, { deviceId: "dev-aaaaaaaa", count: 10 });
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe("block_limit");
  });

  it("needs invoices.create to reserve and sync, and pos.devices to list", async () => {
    expect((await call("POST", "/blocks", null, { deviceId: "dev-zzzzzzzz" })).statusCode).toBe(401);
    expect((await call("GET", "/blocks", CASHIER)).statusCode).toBe(403);
    const list = await call("GET", "/blocks?status=open", MANAGER);
    expect(list.statusCode).toBe(200);
    expect(list.json().items.length).toBeGreaterThanOrEqual(2);
  });

  it("syncs a bill with its reserved number, records payments, and answers a replay with the first result", async () => {
    const dev = "dev-sync0001";
    const block = await reserve(dev, 10);
    const bill = mk(dev, { number: { blockId: block.id, seq: block.fromSeq } });
    const before = issueCalls;
    const [first] = await sync([bill]);
    expect(first).toMatchObject({ status: "synced", duplicate: false, paid: 21_000, balance: 0 });
    expect(first!.number).toBe(`SK-${FY}/${String(block.fromSeq).padStart(4, "0")}`);
    const [again] = await sync([bill]);
    expect(again).toMatchObject({ status: "synced", duplicate: true, invoiceId: first!.invoiceId, number: first!.number });
    expect(issueCalls - before).toBe(1);
  });

  it("three parallel retries of the same key make one invoice", async () => {
    const dev = "dev-parallel";
    const block = await reserve(dev, 10);
    const bill = mk(dev, { number: { blockId: block.id, seq: block.fromSeq + 1 } });
    const before = issueCalls;
    const rs = await Promise.all([sync([bill]), sync([bill]), sync([bill])]);
    expect(issueCalls - before).toBe(1);
    const statuses = rs.map((r) => r[0]!.status);
    expect(statuses.filter((s) => s === "synced")).toHaveLength(3 - statuses.filter((s) => s === "in_progress").length);
    expect(new Set(rs.map((r) => r[0]!.invoiceId).filter(Boolean)).size).toBe(1);
    // After the dust settles the key answers synced.
    expect((await sync([bill]))[0]).toMatchObject({ status: "synced", duplicate: true });
  });

  it("gives a bill a fresh number when its reserved one can't be used, and says so", async () => {
    const dev = "dev-conflict";
    const block = await reserve(dev, 10);
    const seq = block.fromSeq + 2;
    const [a] = await sync([mk(dev, { number: { blockId: block.id, seq } })]);
    // Another bill claiming the same number: a different key, same seq.
    const [b] = await sync([mk(dev, { number: { blockId: block.id, seq } })]);
    expect(a!.flags.map((f) => f.code)).not.toContain("number_reassigned");
    expect(b!.status).toBe("synced");
    expect(b!.number).not.toBe(a!.number);
    expect(b!.flags).toContainEqual(expect.objectContaining({ code: "number_reassigned", detail: expect.objectContaining({ reason: "seq_taken" }) }));
    // A number from another device's block, outside the range, and an unknown block.
    const other = await reserve("dev-other001", 10, CASHIER2);
    const [c] = await sync([mk(dev, { number: { blockId: other.id, seq: other.fromSeq } })]);
    expect(c!.flags[0]).toMatchObject({ code: "number_reassigned", detail: { reason: "wrong_device" } });
    const [d] = await sync([mk(dev, { number: { blockId: block.id, seq: block.toSeq + 5 } })]);
    expect(d!.flags[0]).toMatchObject({ code: "number_reassigned", detail: { reason: "out_of_range" } });
    const [e] = await sync([mk(dev, { number: { blockId: randomUUID(), seq: 1 } })]);
    expect(e!.flags[0]).toMatchObject({ code: "number_reassigned", detail: { reason: "unknown_block" } });
  });

  it("bills without any reserved number get a legal number at sync (the provisional one is only a label)", async () => {
    const [r] = await sync([mk("dev-prov0001", { provisionalNumber: "OFF-0001-0001" })]);
    expect(r).toMatchObject({ status: "synced" });
    expect(r!.number).toMatch(/^SK-/);
    expect(r!.number).not.toContain("OFF");
  });

  it("keeps the offline price as sold and flags a changed price or tax, a deleted item and negative stock", async () => {
    const dev = "dev-flags001";
    const moved = item({ price: 12_000 });
    const taxed = item({ gstRate: 18 });
    const gone = randomUUID();
    const low = item({ stock: { qty: -3, status: "out" } });
    const [r] = await sync([
      mk(dev, {
        lines: [line(moved), line(taxed), { description: "Old thing", qty: 1, rate: 5_000, gstRate: 5, itemId: gone }, line(low)],
        snapshots: [
          { itemId: moved.itemId, price: 10_000, gstRate: 5 },
          { itemId: taxed.itemId, price: 10_000, gstRate: 5 },
          { itemId: low.itemId, price: 10_000, gstRate: 5 },
        ],
        payments: [],
      }),
    ]);
    expect(r!.status).toBe("synced");
    const codes = r!.flags.map((f) => `${f.code}@${f.line ?? "-"}`);
    expect(codes).toEqual(expect.arrayContaining(["price_changed@0", "tax_changed@1", "item_missing@2", "stock_negative@3"]));
    const bill = bills.get(r!.invoiceId!)!;
    // Sold at the offline rate; the deleted item posts as a free-text line.
    expect(bill.lines[0]!.rate).toBe(10_000);
    expect(bill.lines[2]).not.toHaveProperty("itemId");
    expect(bill.lines[2]!.description).toBe("Old thing");
  });

  it("flags a missing customer (walk-in) and a bill synced a day late", async () => {
    const ghost = randomUUID();
    missingCustomers.add(ghost);
    const [r] = await sync([mk("dev-cust0001", { customerId: ghost, customer: { name: "Meena", phone: "9876543210" }, billedAt: new Date(clock - 26 * 3_600_000).toISOString() })]);
    expect(r!.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["customer_missing", "late_sync"]));
    missingCustomers = new Set();
  });

  it("a refused bill is failed with a reason and retried later without a second invoice", async () => {
    const dev = "dev-retry001";
    const block = await reserve(dev, 10);
    const bill = mk(dev, { number: { blockId: block.id, seq: block.fromSeq } });
    failIssue = new AppError(402, "plan_limit", "Your plan's invoice limit has been reached");
    const [bad] = await sync([bill]);
    expect(bad).toMatchObject({ status: "failed", error: { code: "plan_limit", retryable: true } });
    failIssue = null;
    const before = issueCalls;
    const [ok] = await sync([bill]);
    expect(ok).toMatchObject({ status: "synced", duplicate: false });
    expect(ok!.number).toBe(`SK-${FY}/${String(block.fromSeq).padStart(4, "0")}`);
    expect(issueCalls - before).toBe(1);
    expect(bills.size).toBeGreaterThan(0);
  });

  it("resumes after a crash between the invoice and its payments without billing twice or double-recording money", async () => {
    const dev = "dev-resume01";
    const block = await reserve(dev, 10);
    const bill = mk(dev, { number: { blockId: block.id, seq: block.fromSeq }, payments: [{ method: "upi", amount: 10_000 }, { method: "cash", amount: 11_000 }] });
    failPayOnce = true;
    const before = issueCalls;
    const [bad] = await sync([bill]);
    expect(bad).toMatchObject({ status: "failed", error: { code: "sync_error", retryable: true } });
    expect(issueCalls - before).toBe(1);
    paymentCalls = [];
    const [ok] = await sync([bill]);
    expect(ok).toMatchObject({ status: "synced", paid: 21_000, balance: 0 });
    expect(issueCalls - before).toBe(1);
    expect(paymentCalls).toEqual([[{ method: "upi", amount: 10_000 }, { method: "cash", amount: 11_000 }]]);
    // A third replay records nothing.
    paymentCalls = [];
    await sync([bill]);
    expect(paymentCalls).toEqual([]);
  });

  it("a bill voided at the counter voids its number and makes no invoice", async () => {
    const dev = "dev-voided01";
    const block = await reserve(dev, 5);
    const before = issueCalls;
    const [v] = await sync([mk(dev, { number: { blockId: block.id, seq: block.fromSeq + 1 }, voided: { reason: "customer left" } })]);
    expect(v).toMatchObject({ status: "voided", invoiceId: null });
    expect(issueCalls).toBe(before);
    const [row] = (await call("GET", `/blocks?deviceId=${dev}`, MANAGER)).json().items;
    expect(row.voided).toEqual([expect.objectContaining({ seq: block.fromSeq + 1, reason: "bill_voided" })]);
  });

  it("closing a block releases only the unused numbers, with the reason; later bills of that block get new numbers", async () => {
    const dev = "dev-close0001";
    const block = await reserve(dev, 5);
    await sync([mk(dev, { number: { blockId: block.id, seq: block.fromSeq } })]);
    await sync([mk(dev, { number: { blockId: block.id, seq: block.fromSeq + 1 }, voided: { reason: "mistake" } })]);
    const closed = await call("POST", `/blocks/${block.id}/close`, CASHIER, {});
    expect(closed.statusCode, closed.body).toBe(200);
    const body = closed.json() as { block: { status: string; voided: { seq: number; reason: string }[] }; released: number[] };
    expect(body.released).toEqual([block.fromSeq + 2, block.fromSeq + 3, block.fromSeq + 4]);
    expect(body.block.status).toBe("closed");
    expect(body.block.voided.map((v) => `${v.seq}:${v.reason}`)).toEqual([`${block.fromSeq + 1}:bill_voided`, ...body.released.map((s) => `${s}:unused`)]);
    // Closing again is a no-op; a late bill that still carries a released number is re-numbered, not lost.
    expect((await call("POST", `/blocks/${block.id}/close`, CASHIER, {})).json().released).toEqual([]);
    const [late] = await sync([mk(dev, { number: { blockId: block.id, seq: block.fromSeq + 3 } })]);
    expect(late).toMatchObject({ status: "synced" });
    expect(late!.flags[0]).toMatchObject({ code: "number_reassigned", detail: { reason: "block_closed" } });
  });

  it("refuses to close a block with a failed bill, and a lost device needs a manager", async () => {
    const dev = "dev-pending01";
    const block = await reserve(dev, 5);
    failIssue = new AppError(503, "not_ready", "Try later");
    await sync([mk(dev, { number: { blockId: block.id, seq: block.fromSeq } })]);
    failIssue = null;
    const pending = await call("POST", `/blocks/${block.id}/close`, CASHIER, {});
    expect(pending.statusCode).toBe(409);
    expect(pending.json().error.code).toBe("block_has_pending");
    const lost = await call("POST", `/blocks/${block.id}/close`, CASHIER, { reason: "lost_device" });
    expect(lost.statusCode).toBe(403);
    // Another cashier can't close it; a manager can once the bill is fixed.
    expect((await call("POST", `/blocks/${block.id}/close`, CASHIER2, {})).statusCode).toBe(403);
  });

  it("lists bills for review and records who looked at the flags", async () => {
    const flagged = await call("GET", "/bills?flagged=true", MANAGER);
    expect(flagged.statusCode).toBe(200);
    const first = flagged.json().items[0];
    expect(first.flags.length).toBeGreaterThan(0);
    expect((await call("POST", `/bills/${first.clientId}/review`, MANAGER, { note: "checked stock" })).json()).toEqual({ ok: true });
    const after = (await call("GET", "/bills?flagged=true", MANAGER)).json();
    expect(after.items.find((i: { clientId: string }) => i.clientId === first.clientId)).toBeUndefined();
    expect((await call("GET", "/bills", CASHIER)).statusCode).toBe(403);
  });

  it("reports a malformed bill in the batch without stopping the others", async () => {
    const dev = "dev-batch0001";
    const rs = await sync([{ clientId: randomUUID(), lines: [] }, mk(dev), { nonsense: true }]);
    expect(rs.map((r) => r.status)).toEqual(["failed", "synced", "failed"]);
    expect(rs[0]!.error).toMatchObject({ code: "invalid_bill", retryable: false });
    const big = await call("POST", "/sync", CASHIER, { bills: Array.from({ length: 26 }, () => mk(dev)) });
    expect(big.statusCode).toBe(400);
  });
});
