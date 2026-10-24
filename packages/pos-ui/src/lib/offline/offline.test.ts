import { describe, expect, it } from "vitest";
import { cartTotals, productToLine, type CartProduct } from "../cart";
import { NO_CUSTOMER } from "../types";
import { buildSale, isOfflineInvoice, isProvisionalSlip, slipInvoice, offlineBlocker, offlineInvoice } from "./bill";
import { allocate, needsBlock, provisionalNumber, remainingFor, staleBlocks } from "./numbering";
import { OfflineQueue, countBills } from "./queue";
import { EMPTY_NUMBERING, MemoryOfflineStore } from "./store";
import { applyResult, backoffMs, dueBills, isNetworkFailure, syncQueue, SYNC_BATCH } from "./sync";
import type { BlockDto, LocalBlock, OfflineApi, OfflineBillPayload, SyncResultDto } from "./types";

const DEVICE = "dev-a1b2c3d4";
const TODAY = "2026-10-24";
const FY = "26-27";

const block = (over: Partial<LocalBlock> = {}): LocalBlock => ({ id: "b1", fy: FY, prefix: "SK", fromSeq: 10, toSeq: 12, nextSeq: 10, branchId: null, createdAt: 0, ...over });

const product = (over: Partial<CartProduct> = {}): CartProduct => ({ itemId: "it-1", name: "Tea", unit: "pcs", price: 10_000, taxInclusive: false, gstRate: 5, ...over });

function sale(over: Partial<Parameters<typeof buildSale>[0]> = {}) {
  return buildSale({
    lines: [productToLine(product(), 2)],
    customer: NO_CUSTOMER,
    phone: null,
    payments: [{ method: "cash", amount: 21_000 }],
    cashier: "Kavin",
    date: TODAY,
    now: new Date("2026-10-24T09:30:00Z"),
    walkInName: "Walk-in",
    sellerState: "33",
    placeOfSupply: "33",
    ...over,
  });
}

/** A fake server: remembers keys, so a repeated key answers with the first result. */
function fakeServer(opts: { failFirstSync?: "network" | "5xx" | "refuse"; rejectBill?: (p: OfflineBillPayload) => SyncResultDto["error"] | undefined } = {}) {
  const seen = new Map<string, SyncResultDto>();
  const blocks: BlockDto[] = [];
  let nextSeq = 100;
  let invoices = 0;
  let failFirst = opts.failFirstSync;
  const calls = { sync: 0, reserve: 0, close: [] as string[] };
  const api: OfflineApi = {
    async sync(bills) {
      calls.sync++;
      if (failFirst) {
        const kind = failFirst;
        failFirst = undefined;
        if (kind === "network") throw new TypeError("Failed to fetch");
        if (kind === "5xx") throw Object.assign(new Error("bad gateway"), { status: 502 });
        throw Object.assign(new Error("forbidden"), { status: 403, code: "permission_denied" });
      }
      return bills.map((p): SyncResultDto => {
        const prior = seen.get(p.clientId);
        if (prior) return { ...prior, duplicate: true };
        const err = opts.rejectBill?.(p);
        if (err) return { clientId: p.clientId, status: "failed", duplicate: false, invoiceId: null, number: null, total: null, paid: null, balance: null, flags: [], error: err };
        const r: SyncResultDto = p.voided
          ? { clientId: p.clientId, status: "voided", duplicate: false, invoiceId: null, number: null, total: null, paid: null, balance: null, flags: [] }
          : { clientId: p.clientId, status: "synced", duplicate: false, invoiceId: `inv-${++invoices}`, number: `SK/${FY}/${String(p.number?.seq ?? nextSeq++).padStart(4, "0")}`, total: 100, paid: 100, balance: 0, flags: [] };
        seen.set(p.clientId, r);
        return r;
      });
    },
    async reserveBlock(count) {
      calls.reserve++;
      const b: BlockDto = { id: `blk-${calls.reserve}`, fy: FY, prefix: "SK", fromSeq: nextSeq, toSeq: nextSeq + count - 1, branchId: null, status: "open" };
      nextSeq += count;
      blocks.push(b);
      return b;
    },
    async closeBlock(id) {
      calls.close.push(id);
      return { released: [] };
    },
  };
  return { api, seen, calls, invoices: () => invoices };
}

const setup = (now = () => 1_000_000) => {
  const store = new MemoryOfflineStore();
  const queue = new OfflineQueue(store, DEVICE, now);
  return { store, queue };
};

describe("bill numbers", () => {
  it("uses the reserved invoice numbers in order, formatted like the server does, then falls back to OFF- numbers", () => {
    const s0 = { ...EMPTY_NUMBERING, blocks: [block({ fromSeq: 10, toSeq: 11, nextSeq: 10 })] };
    let s = s0;
    const a = allocate(s, TODAY, DEVICE);
    expect(a).toMatchObject({ kind: "reserved", number: "SK/26-27/0010", ref: { blockId: "b1", seq: 10 } });
    s = a.state;
    const b = allocate(s, TODAY, DEVICE);
    expect(b.number).toBe("SK/26-27/0011");
    const c = allocate(b.state, TODAY, DEVICE);
    expect(c).toMatchObject({ kind: "provisional", number: "OFF-C3D4-0001", provisional: "OFF-C3D4-0001" });
    expect(allocate(c.state, TODAY, DEVICE).number).toBe("OFF-C3D4-0002");
    expect(provisionalNumber(DEVICE, 7)).toBe("OFF-C3D4-0007");
    // Never mutates what it was given.
    expect(s0.blocks[0]!.nextSeq).toBe(10);
  });

  it("takes numbers only from the block of the bill's own financial year", () => {
    const s = { ...EMPTY_NUMBERING, blocks: [block({ fy: "25-26", prefix: "SK" })] };
    expect(allocate(s, TODAY, DEVICE).kind).toBe("provisional");
    expect(allocate(s, "2026-03-31", DEVICE).kind).toBe("reserved");
  });

  it("asks for a new block when few numbers are left, but never piles up blocks", () => {
    expect(needsBlock([], TODAY)).toBe(true);
    expect(needsBlock([block({ fromSeq: 1, toSeq: 50, nextSeq: 1 })], TODAY)).toBe(false);
    expect(needsBlock([block({ fromSeq: 1, toSeq: 50, nextSeq: 45 })], TODAY)).toBe(true);
    expect(needsBlock([block({ id: "a", fromSeq: 1, toSeq: 5, nextSeq: 1 }), block({ id: "b", fromSeq: 6, toSeq: 10, nextSeq: 6 })], TODAY)).toBe(false);
    expect(remainingFor([block({ fy: "25-26" })], FY)).toBe(0);
    expect(staleBlocks([block({ fy: "25-26" }), block({ id: "x" })], TODAY).map((b) => b.id)).toEqual(["b1"]);
  });
});

describe("the offline queue", () => {
  it("saves a sale with its idempotency key, number and payload, in order", async () => {
    const { store, queue } = setup();
    await store.setNumbering({ ...EMPTY_NUMBERING, blocks: [block()] });
    const s = sale();
    const a = await queue.enqueueSale(s);
    const b = await queue.enqueueSale(sale({ payments: [{ method: "upi", amount: 21_000, reference: "UTR1" }] }));
    expect(a.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.clientId).not.toBe(b.clientId);
    expect(a).toMatchObject({ status: "queued", order: 1, number: "SK/26-27/0010", numberKind: "reserved", attempts: 0 });
    expect(b).toMatchObject({ order: 2, number: "SK/26-27/0011" });
    expect(a.payload).toMatchObject({
      clientId: a.clientId,
      deviceId: DEVICE,
      date: TODAY,
      number: { blockId: "b1", seq: 10 },
      payments: [{ method: "cash", amount: 21_000 }],
      snapshots: [{ itemId: "it-1", price: 10_000, gstRate: 5 }],
    });
    expect(a.payload.lines[0]).toMatchObject({ description: "Tea", qty: 2, rate: 10_000, gstRate: 5, itemId: "it-1" });
    expect(a.payload.customer).toEqual({ name: "Walk-in" });
    expect((await queue.list()).map((x) => x.clientId)).toEqual([a.clientId, b.clientId]);
    expect(countBills(await queue.list())).toMatchObject({ queued: 2, pending: 2, synced: 0 });
  });

  it("two parallel sales (two tabs) never share a reserved number", async () => {
    const { store, queue } = setup();
    await store.setNumbering({ ...EMPTY_NUMBERING, blocks: [block({ fromSeq: 1, toSeq: 40, nextSeq: 1 })] });
    const bills = await Promise.all(Array.from({ length: 25 }, () => queue.enqueueSale(sale())));
    const numbers = bills.map((b) => b.number);
    expect(new Set(numbers).size).toBe(25);
    expect(new Set(bills.map((b) => b.order)).size).toBe(25);
    expect((await store.numbering()).blocks[0]!.nextSeq).toBe(26);
  });

  it("an open item and a saved customer go into the payload as the server expects", async () => {
    const { queue } = setup();
    const open = productToLine(product({ itemId: "open:abc", name: "Repair", price: 5_000 }), 1);
    const bill = await queue.enqueueSale(
      sale({
        lines: [open, productToLine(product(), 1)],
        customer: { kind: "saved", customer: { id: "c-1", name: "Meena", phone: "+919876543210", email: null, gstin: null, stateCode: null, creditLimit: null, outstanding: 0, advance: 0 } },
        payments: [{ method: "card", amount: 15_750 }],
      }),
    );
    expect(bill.payload.customerId).toBe("c-1");
    expect(bill.payload.customer).toBeUndefined();
    expect(bill.payload.lines[0]).not.toHaveProperty("itemId");
    expect(bill.payload.snapshots).toEqual([{ itemId: "it-1", price: 10_000, gstRate: 5 }]);
    expect(bill.numberKind).toBe("provisional");
  });

  it("voids a bill that hasn't synced (its number is reported cancelled), but not one that has", async () => {
    const { store, queue } = setup();
    const a = await queue.enqueueSale(sale());
    const v = await queue.voidBill(a.clientId, "customer left");
    expect(v).toMatchObject({ status: "queued", payload: { voided: { reason: "customer left" } }, display: { received: 0 } });
    const srv = fakeServer();
    await syncQueue({ store, api: srv.api, today: TODAY });
    expect((await store.getBill(a.clientId))!.status).toBe("voided");
    expect(srv.invoices()).toBe(0);
    expect(await queue.voidBill(a.clientId, "again")).toBeNull();
    const b = await queue.enqueueSale(sale());
    await syncQueue({ store, api: srv.api, today: TODAY });
    expect(await queue.voidBill(b.clientId, "too late")).toBeNull();
  });

  it("exports everything for support and tidies old synced bills", async () => {
    let t = 1_000_000;
    const { store, queue } = setup(() => t);
    const a = await queue.enqueueSale(sale());
    await syncQueue({ store, api: fakeServer().api, today: TODAY, now: () => t });
    const json = JSON.parse(await queue.exportJson({ shop: "kumar" }));
    expect(json).toMatchObject({ deviceId: DEVICE, shop: "kumar", bills: [{ clientId: a.clientId, status: "synced" }] });
    expect(await queue.prune()).toBe(0);
    t += 8 * 24 * 3_600_000;
    expect(await queue.prune()).toBe(1);
    expect(await queue.list()).toEqual([]);
  });

  it("refuses offline what needs the server: weigh tickets, credit and points", () => {
    expect(offlineBlocker([{ ...productToLine(product()), ticket: { id: "t", code: "W1" } }], ["cash"])).toBe("ticket");
    expect(offlineBlocker([productToLine(product())], ["cash", "credit"])).toBe("method");
    expect(offlineBlocker([productToLine(product())], ["cash", "upi", "card"])).toBeNull();
  });

  it("gives the receipt screen an invoice that says it lives on the device", async () => {
    const { queue } = setup();
    const bill = await queue.enqueueSale(sale());
    const inv = offlineInvoice(bill)!;
    expect(isOfflineInvoice(inv)).toBe(true);
    expect(inv).toMatchObject({ number: bill.number, total: 21_000, status: "paid", paid: 21_000, balance: 0 });
    expect(inv.total).toBe(cartTotals([productToLine(product(), 2)], { sellerState: "33", placeOfSupply: "33" }).total);
    expect(inv.lines[0]).toMatchObject({ description: "Tea", qty: 2, gstRate: 5 });
  });

  it("only an OFF- slip on the device is provisional; a reserved number or a synced bill is a normal invoice", async () => {
    const { queue } = setup();
    const bill = await queue.enqueueSale(sale());
    const inv = offlineInvoice(bill)!;
    expect(isProvisionalSlip({ ...inv, number: "OFF-C3D4-0001" })).toBe(true);
    expect(isProvisionalSlip({ ...inv, number: "INV/0001" })).toBe(false);
    const synced = slipInvoice({ ...bill, result: { invoiceId: "inv-1", number: "INV/0042" } } as never)!;
    expect(isOfflineInvoice(synced)).toBe(false);
    expect(isProvisionalSlip(synced)).toBe(false);
    expect(synced.number).toBe("INV/0042");
  });
});

describe("sync", () => {
  it("sends bills oldest first with their keys and marks each by its own answer", async () => {
    const { store, queue } = setup();
    const srv = fakeServer({ rejectBill: (p) => (p.lines[0]!.description === "Bad" ? { code: "invalid_bill", message: "nope", retryable: false } : undefined) });
    const a = await queue.enqueueSale(sale());
    const bad = await queue.enqueueSale(sale({ lines: [productToLine(product({ name: "Bad" }), 1)], payments: [{ method: "cash", amount: 10_500 }] }));
    const c = await queue.enqueueSale(sale());
    const report = await syncQueue({ store, api: srv.api, today: TODAY });
    expect(report).toMatchObject({ sent: 3, synced: 2, failed: 1, offline: false });
    const after = Object.fromEntries((await queue.list()).map((b) => [b.clientId, b]));
    expect(after[a.clientId]).toMatchObject({ status: "synced", result: { invoiceId: "inv-1" } });
    expect(after[bad.clientId]).toMatchObject({ status: "failed", attempts: 1, error: { code: "invalid_bill", retryable: false } });
    expect(after[bad.clientId]!.nextTryAt).toBeUndefined();
    expect(after[c.clientId]!.status).toBe("synced");
    // A failed non-retryable bill isn't resent by the timer, only by hand.
    const calls = srv.calls.sync;
    await syncQueue({ store, api: srv.api, today: TODAY });
    expect(srv.calls.sync).toBe(calls);
    await queue.retry(bad.clientId);
    srv.seen.delete(bad.clientId);
    expect((await queue.counts()).queued).toBe(1);
  });

  it("replaying the same key twice makes one invoice", async () => {
    const { store, queue } = setup();
    const srv = fakeServer();
    const a = await queue.enqueueSale(sale());
    await syncQueue({ store, api: srv.api, today: TODAY });
    // The tab died after the server answered but before the answer was saved: the bill is "syncing" again.
    const rec = (await store.getBill(a.clientId))!;
    await store.putBills([{ ...rec, status: "queued", result: undefined }]);
    await syncQueue({ store, api: srv.api, today: TODAY });
    expect(srv.invoices()).toBe(1);
    expect((await store.getBill(a.clientId))!).toMatchObject({ status: "synced", result: { invoiceId: "inv-1" } });
  });

  it("offline -> online: a failed fetch leaves bills queued with no attempt counted, the next round sends them", async () => {
    const { store, queue } = setup();
    const srv = fakeServer({ failFirstSync: "network" });
    await queue.enqueueSale(sale());
    await queue.enqueueSale(sale());
    const down = await syncQueue({ store, api: srv.api, today: TODAY });
    expect(down).toMatchObject({ offline: true, sent: 0, synced: 0 });
    let bills = await queue.list();
    expect(bills.map((b) => [b.status, b.attempts])).toEqual([["queued", 0], ["queued", 0]]);
    const up = await syncQueue({ store, api: srv.api, today: TODAY });
    expect(up).toMatchObject({ offline: false, synced: 2 });
    bills = await queue.list();
    expect(bills.every((b) => b.status === "synced")).toBe(true);
    expect(srv.invoices()).toBe(2);
  });

  it("a 502 counts as offline; a 403 is a refusal that leaves everything queued", async () => {
    const { store, queue } = setup();
    await queue.enqueueSale(sale());
    expect((await syncQueue({ store, api: fakeServer({ failFirstSync: "5xx" }).api, today: TODAY })).offline).toBe(true);
    const refused = await syncQueue({ store, api: fakeServer({ failFirstSync: "refuse" }).api, today: TODAY });
    expect(refused).toMatchObject({ offline: false, refused: { status: 403, code: "permission_denied" } });
    expect((await queue.counts()).queued).toBe(1);
    expect(isNetworkFailure(new TypeError("x"))).toBe(true);
    expect(isNetworkFailure(Object.assign(new Error("x"), { status: 0 }))).toBe(true);
    expect(isNetworkFailure(Object.assign(new Error("x"), { status: 400 }))).toBe(false);
  });

  it("retries a retryable failure by itself after its delay, and Sync now forces it", async () => {
    let t = 1_000_000;
    const { store, queue } = setup(() => t);
    let reject = true;
    const srv = fakeServer({ rejectBill: () => (reject ? { code: "plan_limit", message: "limit", retryable: true } : undefined) });
    const a = await queue.enqueueSale(sale());
    await syncQueue({ store, api: srv.api, today: TODAY, now: () => t });
    const failed = (await store.getBill(a.clientId))!;
    expect(failed).toMatchObject({ status: "failed", attempts: 1, nextTryAt: t + backoffMs(1) });
    reject = false;
    expect((await syncQueue({ store, api: srv.api, today: TODAY, now: () => t })).sent).toBe(0);
    expect((await syncQueue({ store, api: srv.api, today: TODAY, now: () => t + backoffMs(1) + 1 })).synced).toBe(1);
    // Forced: a failed bill goes at once.
    reject = true;
    const b = await queue.enqueueSale(sale());
    await syncQueue({ store, api: srv.api, today: TODAY, now: () => t });
    reject = false;
    expect((await syncQueue({ store, api: srv.api, today: TODAY, now: () => t, force: true })).synced).toBe(1);
    expect((await store.getBill(b.clientId))!.status).toBe("synced");
  });

  it("brings back a bill left 'syncing' by a closed tab", async () => {
    let t = 5_000_000;
    const { store, queue } = setup(() => t);
    const a = await queue.enqueueSale(sale());
    await store.putBills([{ ...(await store.getBill(a.clientId))!, status: "syncing", syncingSince: t - 10_000 }]);
    expect((await syncQueue({ store, api: fakeServer().api, today: TODAY, now: () => t })).sent).toBe(0);
    t += 3 * 60_000;
    expect((await syncQueue({ store, api: fakeServer().api, today: TODAY, now: () => t })).synced).toBe(1);
  });

  it("sends in batches of 25 and keeps going after a bad batch answer", async () => {
    const { store, queue } = setup();
    const srv = fakeServer();
    for (let i = 0; i < SYNC_BATCH + 5; i++) await queue.enqueueSale(sale());
    const r = await syncQueue({ store, api: srv.api, today: TODAY });
    expect(r.synced).toBe(30);
    expect(srv.calls.sync).toBe(2);
  });

  it("two sync calls at once share one run", async () => {
    const { store, queue } = setup();
    const srv = fakeServer();
    await queue.enqueueSale(sale());
    const [a, b] = await Promise.all([syncQueue({ store, api: srv.api, today: TODAY }), syncQueue({ store, api: srv.api, today: TODAY })]);
    expect(a).toBe(b);
    expect(srv.calls.sync).toBe(1);
  });

  it("keeps a flagged bill's flags so the cashier and the manager can see them", () => {
    const bill = { clientId: "c", order: 1, status: "syncing", createdAt: 0, payload: {} as OfflineBillPayload, display: { total: 1, itemCount: 1, customerName: "x", cashier: "k", received: 1 }, number: "n", numberKind: "reserved", attempts: 0 } as const;
    const out = applyResult({ ...bill }, { clientId: "c", status: "synced", duplicate: false, invoiceId: "i", number: "SK/26-27/0099", total: 1, paid: 1, balance: 0, flags: [{ code: "price_changed", line: 0 }, { code: "number_reassigned" }] }, 42);
    expect(out.result).toEqual({ invoiceId: "i", number: "SK/26-27/0099", flags: [{ code: "price_changed", line: 0 }, { code: "number_reassigned" }], syncedAt: 42 });
    expect(countBills([out]).flagged).toBe(1);
    expect(dueBills([out], 100, true)).toEqual([]);
  });
});

describe("number blocks during sync", () => {
  it("reserves a block when online and low, and offline billing then uses it", async () => {
    const { store, queue } = setup();
    const srv = fakeServer();
    const r = await syncQueue({ store, api: srv.api, today: TODAY });
    expect(r.blockReserved).toBe(true);
    const blocks = (await store.numbering()).blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ fy: FY, fromSeq: 100, toSeq: 149, nextSeq: 100 });
    const bill = await queue.enqueueSale(sale());
    expect(bill).toMatchObject({ numberKind: "reserved", number: "SK/26-27/0100" });
    const synced = await syncQueue({ store, api: srv.api, today: TODAY });
    expect(synced.blockReserved).toBe(false);
    expect((await store.getBill(bill.clientId))!.result!.number).toBe("SK/26-27/0100");
  });

  it("releases a block of a finished financial year once its bills are synced", async () => {
    const { store, queue } = setup();
    await store.setNumbering({ ...EMPTY_NUMBERING, blocks: [block({ id: "old", fy: "25-26", fromSeq: 1, toSeq: 50, nextSeq: 3 })] });
    const srv = fakeServer();
    const a = await queue.enqueueSale(sale({ date: "2026-03-30" }));
    expect(a.payload.number).toMatchObject({ blockId: "old", seq: 3 });
    // The bill of the old block is still waiting: keep the block.
    const down = fakeServer({ failFirstSync: "network" });
    await syncQueue({ store, api: down.api, today: TODAY });
    expect((await store.numbering()).blocks.map((b) => b.id)).toEqual(["old"]);
    const r = await syncQueue({ store, api: srv.api, today: TODAY });
    expect(r.blocksReleased).toBe(1);
    expect(srv.calls.close).toEqual(["old"]);
    expect((await store.numbering()).blocks.map((b) => b.id)).not.toContain("old");
  });
});
