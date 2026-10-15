import { AppError } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { describe, expect, it, vi } from "vitest";
import { createSecretBox } from "./crypto";
import type { PayoutDriver } from "./payouts";
import type { KycStatusPort, NotifierPort, SourceOrder } from "./ports";
import type { VendorOrderRow, VendorPayoutRow, VendorRow } from "./schema";
import { MarketplaceService, normalizePhone, type MarketplaceDeps } from "./service";
import { MARKETPLACE_SETTINGS_DEFAULTS, type MarketplaceSettings } from "./settings";

/**
 * Chainable fake for drizzle: every builder method returns the chain, and awaiting it resolves to the next queued
 * result. `ops` records each awaited query's builder calls; `transaction(cb)` runs cb with the same chain.
 */
function fakeDb(results: unknown[][]) {
  const ops: { m: string; args: unknown[] }[][] = [];
  let current: { m: string; args: unknown[] }[] = [];
  const settle = () => {
    ops.push(current);
    current = [];
    return Promise.resolve(results.shift() ?? []);
  };
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej);
        if (prop === "catch") return (rej: (e: unknown) => unknown) => settle().catch(rej);
        if (prop === "transaction") return (cb: (tx: unknown) => unknown) => Promise.resolve().then(() => cb(chain));
        return (...args: unknown[]) => {
          current.push({ m: String(prop), args });
          return chain;
        };
      },
    },
  );
  const find = (method: string) => ops.filter((o) => o.some((x) => x.m === method));
  const argOf = (op: { m: string; args: unknown[] }[], method: string) => op.find((o) => o.m === method)?.args[0];
  return { db: chain as Db, ops, results, find, argOf };
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const VA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAYOUT_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-10-15T06:30:00Z");
const ENC = "test-key";
const box = createSecretBox(ENC);

const vendor = (over: Partial<VendorRow> = {}): VendorRow => ({
  id: VA,
  tenantId: TENANT,
  name: "Murugan Silks",
  slug: "murugan-silks",
  status: "active",
  kycStatus: "verified",
  commissionBps: null,
  description: null,
  logoUrl: null,
  contactName: "Murugan",
  contactPhone: "+919876543210",
  contactEmail: null,
  gstin: null,
  address: null,
  payoutAccountEnc: box.encrypt(JSON.stringify({ type: "bank", holderName: "Murugan", accountNumber: "001234567890", ifsc: "SBIN0001234" })),
  payoutAccountMasked: { type: "bank", holderName: "Murugan", ifsc: "SBIN0001234", last4: "7890" },
  payoutAccountStatus: "verified",
  notes: null,
  approvedAt: NOW,
  suspendedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const vendorOrder = (over: Partial<VendorOrderRow> = {}): VendorOrderRow => ({
  id: "vo-1",
  tenantId: TENANT,
  orderId: ORDER_ID,
  orderNumber: "ORD/26-27/0001",
  vendorId: VA,
  lines: [],
  subtotal: 30_000,
  discount: 3000,
  shippingShare: 3750,
  commissionBps: 1000,
  commission: 2700,
  net: 28_050,
  status: "placed",
  settlementStatus: "pending",
  placedAt: NOW,
  deliveredAt: null,
  eligibleAt: null,
  settledAt: null,
  payoutId: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const payoutRow = (over: Partial<VendorPayoutRow> = {}): VendorPayoutRow => ({
  id: PAYOUT_ID,
  tenantId: TENANT,
  vendorId: VA,
  amount: 100_000,
  status: "pending",
  provider: "mock",
  providerRef: null,
  attempts: 0,
  error: null,
  periodFrom: null,
  periodTo: NOW,
  createdBy: null,
  paidAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const order = (over: Partial<SourceOrder> = {}): SourceOrder => ({
  id: ORDER_ID,
  number: "ORD/26-27/0001",
  status: "placed",
  placedAt: NOW,
  deliveredAt: null,
  customerName: "Priya",
  lines: [
    { variantId: "v1", productId: "p1", vendorId: VA, name: "Silk saree", sku: null, image: null, qty: 1, unit: "pcs", price: 30_000, gstRate: 5, discount: 0, total: 27_000 },
    { variantId: "v2", productId: "p2", vendorId: VB, name: "Brass lamp", sku: null, image: null, qty: 1, unit: "pcs", price: 10_000, gstRate: 12, discount: 0, total: 9000 },
  ],
  totals: { subtotal: 40_000, discount: 4000, shipping: 5000, total: 41_000 },
  ...over,
});

function make(results: unknown[][], over: Partial<MarketplaceDeps> = {}, settings: Partial<MarketplaceSettings> = {}) {
  const f = fakeDb(results);
  const notifier: NotifierPort = { send: vi.fn(async () => ({ logId: "n1" })) };
  const deps: MarketplaceDeps = {
    db: f.db,
    config: { encryptionKey: ENC, allowMock: true },
    settings: { get: async () => ({ ...MARKETPLACE_SETTINGS_DEFAULTS, ...settings }) },
    notifier,
    now: () => NOW,
    ...over,
  };
  return { service: new MarketplaceService(deps), ...f, notifier };
}

describe("syncOrder", () => {
  it("splits a new order into vendor orders with each seller's commission", async () => {
    const getOrder = vi.fn(async () => order());
    const inserted = [vendorOrder(), vendorOrder({ id: "vo-2", vendorId: VB })];
    const { service, find, argOf, notifier } = make(
      [
        [], // existing vendor orders
        [
          { id: VA, commissionBps: null, name: "Murugan Silks", contactPhone: "+919876543210", contactEmail: null },
          { id: VB, commissionBps: 1500, name: "Kumar Brass", contactPhone: null, contactEmail: "kumar@example.com" },
        ],
        inserted, // insert … returning
        inserted, // re-read
      ],
      { orders: { getOrder } },
    );
    const out = await service.syncOrder(TENANT, ORDER_ID);
    expect(out).toHaveLength(2);
    const values = argOf(find("onConflictDoNothing")[0]!, "values") as Record<string, unknown>[];
    expect(values).toEqual([
      expect.objectContaining({ vendorId: VA, subtotal: 30_000, discount: 3000, shippingShare: 3750, commissionBps: 1000, commission: 2700, net: 28_050, status: "placed" }),
      expect.objectContaining({ vendorId: VB, subtotal: 10_000, discount: 1000, shippingShare: 1250, commissionBps: 1500, commission: 1350, net: 8900 }),
    ]);
    expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ channel: "whatsapp", to: "+919876543210", template: "marketplace.vendor_order" }));
    expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ channel: "email", to: "kumar@example.com" }));
  });

  it("treats lines of unknown sellers as the shop's own", async () => {
    const { service, find, argOf } = make(
      [[], [{ id: VA, commissionBps: null, name: "M", contactPhone: null, contactEmail: null }], [vendorOrder()], [vendorOrder()]],
      { orders: { getOrder: async () => order() } },
    );
    await service.syncOrder(TENANT, ORDER_ID);
    const values = argOf(find("onConflictDoNothing")[0]!, "values") as Record<string, unknown>[];
    expect(values.map((v) => v.vendorId)).toEqual([VA]);
  });

  it("does nothing for orders without sellers, when the feature is off, or without the port", async () => {
    const plain = make([[]], { orders: { getOrder: async () => order({ lines: [{ ...order().lines[0]!, vendorId: null }] }) } });
    expect(await plain.service.syncOrder(TENANT, ORDER_ID)).toEqual([]);
    expect(plain.find("insert")).toHaveLength(0);

    const getOrder = vi.fn(async () => order());
    const off = make([], { orders: { getOrder }, featureGate: { isEnabled: async () => false } });
    expect(await off.service.syncOrder(TENANT, ORDER_ID)).toEqual([]);
    expect(getOrder).not.toHaveBeenCalled();

    expect(await make([]).service.syncOrder(TENANT, ORDER_ID)).toEqual([]);
  });

  it("follows delivery with the IST eligibility date", async () => {
    const deliveredAt = new Date("2026-10-15T04:30:00Z");
    const updated = vendorOrder({ status: "delivered", deliveredAt, eligibleAt: new Date("2026-10-22T18:30:00Z") });
    const { service, find, argOf } = make([[vendorOrder({ status: "shipped" })], [updated]], {
      orders: { getOrder: async () => order({ status: "delivered", deliveredAt }) },
    });
    const [vo] = await service.syncOrder(TENANT, ORDER_ID);
    expect(vo!.status).toBe("delivered");
    const set = argOf(find("set")[0]!, "set") as Record<string, Date>;
    expect(set.eligibleAt!.toISOString()).toBe("2026-10-22T18:30:00.000Z");
    expect(find("insert")).toHaveLength(0);
  });

  it("a return after the sale was credited posts the reversal", async () => {
    const credited = vendorOrder({ status: "delivered", settlementStatus: "settled", deliveredAt: NOW, eligibleAt: NOW });
    const { service, find, argOf } = make([[credited], [{ ...credited, status: "returned", settlementStatus: "reversed" }], []], {
      orders: { getOrder: async () => order({ status: "returned", deliveredAt: NOW }) },
    });
    const [vo] = await service.syncOrder(TENANT, ORDER_ID);
    expect(vo!.settlementStatus).toBe("reversed");
    const ledger = argOf(find("insert")[0]!, "values") as { type: string; amount: number; refType: string; refId: string }[];
    expect(ledger.map((e) => [e.type, e.amount, e.refType])).toEqual([
      ["refund", -30_750, "vendor_order_reversal"],
      ["commission", 2700, "vendor_order_reversal"],
    ]);
    expect(ledger.every((e) => e.refId === "vo-1")).toBe(true);
  });

  it("a concurrent update that lost the race posts nothing", async () => {
    const credited = vendorOrder({ status: "delivered", settlementStatus: "eligible", deliveredAt: NOW, eligibleAt: NOW });
    const { service, find } = make([[credited], []], { orders: { getOrder: async () => order({ status: "returned", deliveredAt: NOW }) } });
    await service.syncOrder(TENANT, ORDER_ID);
    expect(find("insert")).toHaveLength(0);
  });
});

describe("releaseEligible", () => {
  it("credits sale and commission for sales past the return window", async () => {
    const due = vendorOrder({ status: "delivered", deliveredAt: NOW, eligibleAt: NOW });
    const { service, find, argOf } = make([[due], [{ id: "vo-1" }], []]);
    expect(await service.releaseEligible(TENANT, NOW)).toBe(1);
    const ledger = argOf(find("insert")[0]!, "values") as { type: string; amount: number }[];
    expect(ledger.map((e) => [e.type, e.amount])).toEqual([
      ["sale", 30_750],
      ["commission", -2700],
    ]);
  });
  it("skips rows another worker already moved", async () => {
    const due = vendorOrder({ status: "delivered", eligibleAt: NOW });
    const { service, find } = make([[due], []]);
    expect(await service.releaseEligible(TENANT, NOW)).toBe(0);
    expect(find("insert")).toHaveLength(0);
  });
});

describe("runPayouts", () => {
  it("pays a seller's balance with the mock provider and debits the ledger", async () => {
    const paid = payoutRow({ status: "paid", attempts: 1, providerRef: "mock_x", paidAt: NOW });
    const { service, find, argOf, notifier } = make(
      [
        [], // releaseEligible: nothing due
        [{ vendorId: VA, amount: 100_000 }], // balances
        [vendor()], // vendor rows
        [], // lock
        [{ amount: 100_000 }], // balance in tx
        [], // last payout
        [payoutRow()], // insert payout
        [], // ledger insert
        [], // vendor orders settled
        [], // status processing
        [paid], // outcome stored
      ],
      {},
      { payoutProvider: "mock" },
    );
    const r = await service.runPayouts(TENANT, {}, "staff1");
    expect(r.created).toHaveLength(1);
    expect(r.created[0]).toMatchObject({ status: "paid", amount: 100_000, vendorName: "Murugan Silks" });
    expect(r.skipped).toEqual([]);
    expect(find("for")).toHaveLength(1);
    const inserts = find("insert");
    expect(argOf(inserts[0]!, "values")).toMatchObject({ vendorId: VA, amount: 100_000, provider: "mock", status: "pending", createdBy: "staff1" });
    expect(argOf(inserts[1]!, "values")).toMatchObject({ type: "payout", amount: -100_000, refType: "payout", refId: PAYOUT_ID });
    expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ template: "marketplace.payout_paid", vars: expect.objectContaining({ amount: "₹1,000.00" }) }));
  });

  it("skips sellers without verified KYC or below the minimum (carry-over)", async () => {
    const { service, find } = make([
      [],
      [
        { vendorId: VA, amount: 100_000 },
        { vendorId: VB, amount: 20_000 },
      ],
      [vendor({ kycStatus: "pending" }), vendor({ id: VB, name: "Kumar Brass" })],
    ]);
    const r = await service.runPayouts(TENANT);
    expect(r.created).toEqual([]);
    expect(r.skipped).toEqual([
      { vendorId: VA, vendorName: "Murugan Silks", reason: "kyc_not_verified", balance: 100_000 },
      { vendorId: VB, vendorName: "Kumar Brass", reason: "below_minimum", balance: 20_000 },
    ]);
    expect(find("insert")).toHaveLength(0);
  });

  it("asks the kyc module and refreshes the cached status", async () => {
    const kyc: KycStatusPort = { status: vi.fn(async () => "verified") };
    const sent: unknown[] = [];
    const driver: PayoutDriver = {
      provider: "manual",
      send: async (i) => {
        sent.push(i);
        return { status: "processing", providerRef: null };
      },
    };
    const { service, find, argOf } = make(
      [
        [],
        [{ vendorId: VA, amount: 60_000 }],
        [vendor({ kycStatus: "pending" })],
        [], // kyc column update
        [],
        [{ amount: 60_000 }],
        [],
        [payoutRow({ amount: 60_000, provider: "manual" })],
        [],
        [],
        [],
        [payoutRow({ amount: 60_000, provider: "manual", status: "processing", attempts: 1 })],
      ],
      { kyc, drivers: { manual: driver } },
    );
    const r = await service.runPayouts(TENANT);
    expect(kyc.status).toHaveBeenCalledWith(TENANT, "vendor", VA);
    expect(argOf(find("set")[0]!, "set")).toEqual({ kycStatus: "verified" });
    expect(r.created[0]).toMatchObject({ status: "processing" });
    expect(sent[0]).toMatchObject({ amount: 60_000, attempt: 1, account: { type: "bank", accountNumber: "001234567890" } });
  });

  it("re-checks the balance under the lock", async () => {
    const { service, find } = make([[], [{ vendorId: VA, amount: 100_000 }], [vendor()], [], [{ amount: 0 }]], {}, { payoutProvider: "mock" });
    const r = await service.runPayouts(TENANT);
    expect(r.created).toEqual([]);
    expect(r.skipped[0]).toMatchObject({ vendorId: VA, reason: "below_minimum" });
    expect(find("insert")).toHaveLength(0);
  });

  it("refuses the mock provider outside development and Route without a transfer port", async () => {
    const prod = make([], { config: { encryptionKey: ENC, allowMock: false } }, { payoutProvider: "mock" });
    await expect(prod.service.runPayouts(TENANT)).rejects.toMatchObject({ status: 400 });
    const route = make([], {}, { payoutProvider: "razorpayRoute" });
    await expect(route.service.runPayouts(TENANT)).rejects.toMatchObject({ status: 400 });
  });

  it("a provider failure leaves the payout failed (money stays reserved) for a retry", async () => {
    const driver: PayoutDriver = { provider: "mock", send: async () => ({ status: "failed", providerRef: null, error: "Bank down" }) };
    const failed = payoutRow({ status: "failed", attempts: 1, error: "Bank down" });
    const { service, find, argOf } = make(
      [[], [{ vendorId: VA, amount: 100_000 }], [vendor()], [], [{ amount: 100_000 }], [], [payoutRow()], [], [], [], [failed]],
      { drivers: { mock: driver } },
      { payoutProvider: "mock" },
    );
    const r = await service.runPayouts(TENANT);
    expect(r.created[0]).toMatchObject({ status: "failed", error: "Bank down" });
    const last = find("set").at(-1)!;
    expect(argOf(last, "set")).toMatchObject({ status: "failed", error: "Bank down", attempts: 1, paidAt: null });
  });
});

describe("payout follow-ups", () => {
  it("retry only failed payouts, with the next attempt number", async () => {
    const sends: number[] = [];
    const driver: PayoutDriver = {
      provider: "mock",
      send: async (i) => {
        sends.push(i.attempt);
        return { status: "paid", providerRef: "ref" };
      },
    };
    const { service } = make([[payoutRow({ status: "failed", attempts: 2 })], [vendor()], [], [payoutRow({ status: "paid", attempts: 3 })]], { drivers: { mock: driver } });
    expect((await service.retryPayout(TENANT, PAYOUT_ID)).status).toBe("paid");
    expect(sends).toEqual([3]);

    const paid = make([[payoutRow({ status: "paid" })]]);
    await expect(paid.service.retryPayout(TENANT, PAYOUT_ID)).rejects.toMatchObject({ status: 409 });
  });

  it("cancel gives the amount back and reopens the sales", async () => {
    const { service, find, argOf } = make([[payoutRow({ status: "failed" })], [payoutRow({ status: "cancelled" })], [], []]);
    const p = await service.cancelPayout(TENANT, PAYOUT_ID, "staff1");
    expect(p.status).toBe("cancelled");
    expect(argOf(find("insert")[0]!, "values")).toMatchObject({ type: "payout", amount: 100_000, refType: "payout_cancelled", refId: PAYOUT_ID });
    expect(argOf(find("set").at(-1)!, "set")).toEqual({ settlementStatus: "eligible", settledAt: null, payoutId: null });

    const paid = make([[payoutRow({ status: "paid" })]]);
    await expect(paid.service.cancelPayout(TENANT, PAYOUT_ID)).rejects.toMatchObject({ status: 409 });
  });

  it("mark paid stores the bank reference", async () => {
    const { service, find, argOf } = make([[payoutRow({ status: "processing", provider: "manual" })], [vendor()], [payoutRow({ status: "paid", providerRef: "UTR1" })]]);
    expect((await service.markPayoutPaid(TENANT, PAYOUT_ID, { reference: "UTR1" })).status).toBe("paid");
    expect(argOf(find("set")[0]!, "set")).toMatchObject({ status: "paid", providerRef: "UTR1", paidAt: NOW });
  });
});

describe("vendor scoping", () => {
  const two = [
    { vendorId: VA, slug: "murugan-silks", name: "Murugan Silks", role: "owner" },
    { vendorId: VB, slug: "kumar-brass", name: "Kumar Brass", role: "staff" },
  ];

  it("needs the x-vendor header when the user belongs to several sellers", async () => {
    const { service } = make([two]);
    const err = await service.resolveVendor(TENANT, "u1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 400, code: "vendor_required", details: { vendors: [{ id: VA }, { id: VB }] } });
  });

  it("resolves by slug and refuses non-members", async () => {
    const { service } = make([two, [vendor({ id: VB, name: "Kumar Brass" })]]);
    const r = await service.resolveVendor(TENANT, "u1", "kumar-brass");
    expect(r).toMatchObject({ role: "staff", vendor: { id: VB } });
    const none = make([[]]);
    await expect(none.service.resolveVendor(TENANT, "u1")).rejects.toMatchObject({ status: 403 });
  });

  it("the seller view hides staff notes", async () => {
    const { service } = make([[]]);
    const self = await service.vendorSelf(TENANT, vendor({ notes: "Watch returns" }), "owner");
    expect(self).not.toHaveProperty("notes");
    expect(self).toMatchObject({ role: "owner", effectiveCommissionBps: 1000, productCount: null, balance: { balance: 0 } });
  });

  it("suspended sellers can't edit their profile", async () => {
    const { service } = make([]);
    await expect(service.updateProfile(TENANT, vendor({ status: "suspended" }), "owner", { description: "x" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("vendors", () => {
  it("payout accounts are stored encrypted; seller-entered ones wait for verification", async () => {
    const { service, find, argOf } = make([[vendor()], []]);
    const r = await service.setPayoutAccount(TENANT, VA, { type: "bank", holderName: "Murugan", accountNumber: "009876543210", ifsc: "hdfc0000123" }, "vendor");
    expect(r).toEqual({ payoutAccount: { type: "bank", holderName: "Murugan", ifsc: "HDFC0000123", last4: "3210" }, payoutAccountStatus: "pending" });
    const set = argOf(find("set")[0]!, "set") as { payoutAccountEnc: string };
    expect(set.payoutAccountEnc).not.toContain("009876543210");
    expect(JSON.parse(box.decrypt(set.payoutAccountEnc))).toMatchObject({ accountNumber: "009876543210" });
  });

  it("create picks a free slug from the name", async () => {
    const { service, find, argOf } = make([[{ slug: "murugan-silks" }], [{ id: VA }], [], [vendor({ slug: "murugan-silks-2" })], [], []]);
    await service.createVendor(TENANT, { name: "Murugan Silks", contactPhone: "98765 43210", ownerUserId: "55555555-5555-4555-8555-555555555555" });
    const inserts = find("insert");
    expect(argOf(inserts[0]!, "values")).toMatchObject({ slug: "murugan-silks-2", status: "active", contactPhone: "+919876543210", approvedAt: NOW });
    expect(argOf(inserts[1]!, "values")).toMatchObject({ vendorId: VA, role: "owner" });
  });

  it("approval notifies a pending seller; illegal moves are refused", async () => {
    const { service, notifier } = make([[vendor({ status: "pending" })], [], [vendor()], [], [], []]);
    await service.setVendorStatus(TENANT, VA, "active");
    expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ template: "marketplace.vendor_approved" }));
    const again = make([[vendor()]]);
    await expect(again.service.setVendorStatus(TENANT, VA, "active")).rejects.toMatchObject({ status: 409 });
  });

  it("sellers with history can't be deleted", async () => {
    const { service } = make([[vendor()], [{ n: 1 }], [{ n: 0 }]]);
    await expect(service.deleteVendor(TENANT, VA)).rejects.toMatchObject({ status: 409 });
  });

  it("the last owner can't be removed", async () => {
    const { service } = make([[vendor()], [{ userId: "u1", role: "owner" }, { userId: "u2", role: "staff" }]]);
    await expect(service.removeVendorUser(TENANT, VA, "u1")).rejects.toMatchObject({ status: 409 });
  });

  it("applications: closed shops refuse, one pending application per user", async () => {
    const closed = make([], {}, { acceptApplications: false });
    await expect(closed.service.apply(TENANT, "u1", { name: "New", contactName: "Anbu", contactPhone: "9876543210" })).rejects.toMatchObject({ status: 403 });
    const dup = make([[{ status: "pending" }]]);
    await expect(dup.service.apply(TENANT, "u1", { name: "New", contactName: "Anbu", contactPhone: "9876543210" })).rejects.toMatchObject({ status: 409 });
  });

  it("adjustments need a note and a non-zero amount", async () => {
    const { service } = make([]);
    await expect(service.adjust(TENANT, VA, { amount: 0, note: "nothing" }, null)).rejects.toThrow();
    await expect(service.adjust(TENANT, VA, { amount: 100, note: "" }, null)).rejects.toThrow();
  });

  it("normalizePhone", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhone("09876543210")).toBe("+919876543210");
    expect(normalizePhone("044 2345 6789")).toBe("044 2345 6789");
  });
});

describe("publicSellers", () => {
  const P1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const P2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const P3 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const card = { id: VA, name: "Murugan Silks", slug: "murugan-silks", logoUrl: null };

  it("maps products to active sellers only and returns public fields", async () => {
    // VB is not returned by the (active-only) query, so its product is left out; P3 is the shop's own.
    const productVendors = vi.fn(async () => ({ [P1]: VA, [P2]: VB, [P3]: null }));
    const products = { count: vi.fn(), list: vi.fn(), productVendors };
    const { service, ops, argOf } = make([[card]], { products });
    const r = await service.publicSellers(TENANT, { productIds: [P1, P2.toUpperCase(), P3, "not-a-uuid"] });
    expect(productVendors).toHaveBeenCalledWith(TENANT, [P1, P2, P3]);
    expect(r).toEqual({ items: [card], products: { [P1]: VA } });
    expect(Object.keys(r.items[0]!)).toEqual(["id", "name", "slug", "logoUrl"]);
    expect(ops).toHaveLength(1);
    expect(argOf(ops[0]!, "select")).toEqual(expect.objectContaining({ id: expect.anything(), slug: expect.anything() }));
  });

  it("answers seller ids without touching the catalogue; nothing valid → no query", async () => {
    const { service, ops } = make([[card]]);
    expect(await service.publicSellers(TENANT, { ids: [VA, VA] })).toEqual({ items: [card], products: {} });
    expect(ops).toHaveLength(1);
    const empty = make([]);
    expect(await empty.service.publicSellers(TENANT, { ids: ["x"], productIds: [P1] })).toEqual({ items: [], products: {} });
    expect(empty.ops).toHaveLength(0);
  });

  it("caps each list and survives a failing catalogue lookup", async () => {
    const many = Array.from({ length: 80 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`);
    const productVendors = vi.fn(async () => {
      throw new Error("down");
    });
    const { service } = make([[]], { products: { count: vi.fn(), list: vi.fn(), productVendors } });
    expect(await service.publicSellers(TENANT, { ids: many, productIds: many })).toEqual({ items: [], products: {} });
    expect((productVendors.mock.calls[0] as unknown as [string, string[]])[1]).toHaveLength(50);
  });
});
