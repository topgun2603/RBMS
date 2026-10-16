import { AppError, notFound } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { describe, expect, it, vi } from "vitest";
import { canDecideReview, orderAdvanceTarget, planFulfilment, reviewAfterEvent } from "./logic";
import type { NotifierPort, OrderActionsPort, SourceOrder, StockPort, VendorVariant } from "./ports";
import type { VendorOrderRow, VendorProductReviewRow, VendorRow } from "./schema";
import { MarketplaceService, type MarketplaceDeps } from "./service";
import { MARKETPLACE_SETTINGS_DEFAULTS, MARKETPLACE_SETTINGS_PUBLIC_KEYS, resolveSettings, type MarketplaceSettings } from "./settings";

/** Chainable drizzle fake: awaiting a query resolves to the next queued result (`[]` when the queue is empty). */
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
  return { db: chain as Db, ops, find, argOf };
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const VA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const VARIANT = "77777777-7777-4777-8777-777777777777";
const LOC_DEFAULT = "88888888-8888-4888-8888-888888888888";
const LOC_SELLER = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2026-10-15T06:30:00Z");

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
  payoutAccountEnc: null,
  payoutAccountMasked: null,
  payoutAccountStatus: "none",
  notes: null,
  stockLocationId: null,
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
  discount: 0,
  shippingShare: 0,
  commissionBps: 1000,
  commission: 3000,
  net: 27_000,
  status: "confirmed",
  settlementStatus: "pending",
  placedAt: NOW,
  deliveredAt: null,
  eligibleAt: null,
  settledAt: null,
  payoutId: null,
  packedAt: null,
  shippedAt: null,
  carrier: null,
  trackingNumber: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const review = (over: Partial<VendorProductReviewRow> = {}): VendorProductReviewRow => ({
  id: "r-1",
  tenantId: TENANT,
  vendorId: VA,
  productId: "p-1",
  status: "pending",
  productName: "Clay lamp",
  productImage: null,
  reason: null,
  changedAfterApproval: false,
  changedFields: [],
  submittedAt: NOW,
  reviewedAt: null,
  reviewedBy: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const sourceOrder = (over: Partial<SourceOrder> = {}): SourceOrder => ({
  id: ORDER_ID,
  number: "ORD/26-27/0001",
  status: "confirmed",
  placedAt: NOW,
  deliveredAt: null,
  customerName: "Priya",
  lines: [{ variantId: "v1", productId: "p1", vendorId: VA, name: "Silk saree", sku: null, image: null, qty: 1, unit: "pcs", price: 30_000, gstRate: 5, discount: 0, total: 30_000 }],
  totals: { subtotal: 30_000, discount: 0, shipping: 0, total: 30_000 },
  ...over,
});

function make(results: unknown[][], over: Partial<MarketplaceDeps> = {}, settings: Partial<MarketplaceSettings> = {}) {
  const f = fakeDb(results);
  const notifier: NotifierPort = { send: vi.fn(async () => ({ logId: "n1" })) };
  const deps: MarketplaceDeps = {
    db: f.db,
    config: { encryptionKey: "k", allowMock: true },
    settings: { get: async () => ({ ...MARKETPLACE_SETTINGS_DEFAULTS, ...settings }) },
    notifier,
    now: () => NOW,
    ...over,
  };
  return { service: new MarketplaceService(deps), ...f, notifier };
}

// ---------------------------------------------------------------- pure logic

describe("review state machine", () => {
  it("submission → pending from anything (a resubmission after rejection too)", () => {
    for (const cur of [null, "pending", "approved", "rejected", "withdrawn"] as const) expect(reviewAfterEvent(cur, "submitted")).toBe("pending");
  });
  it("publishing approves; an approved review stays as is", () => {
    expect(reviewAfterEvent(null, "published")).toBe("approved");
    expect(reviewAfterEvent("pending", "published")).toBe("approved");
    expect(reviewAfterEvent("approved", "published")).toBeNull();
  });
  it("a change to a live product sends it back to review (approved, legacy or already re-reviewing)", () => {
    expect(reviewAfterEvent("approved", "changed")).toBe("pending");
    expect(reviewAfterEvent(null, "changed")).toBe("pending");
    expect(reviewAfterEvent("pending", "changed")).toBe("pending");
    expect(reviewAfterEvent("rejected", "changed")).toBeNull();
    expect(reviewAfterEvent("withdrawn", "changed")).toBeNull();
  });
  it("withdrawing only cancels a waiting review", () => {
    expect(reviewAfterEvent("pending", "withdrawn")).toBe("withdrawn");
    expect(reviewAfterEvent("approved", "withdrawn")).toBeNull();
    expect(reviewAfterEvent("rejected", "withdrawn")).toBeNull();
    expect(reviewAfterEvent(null, "withdrawn")).toBeNull();
  });
  it("only pending reviews can be decided", () => {
    expect(canDecideReview("pending")).toBe(true);
    for (const s of ["approved", "rejected", "withdrawn"] as const) expect(canDecideReview(s)).toBe(false);
  });
});

describe("seller fulfilment plan", () => {
  const open = { status: "confirmed" as const, packedAt: null, shippedAt: null };
  it("packs an open order; shipping packs too", () => {
    expect(planFulfilment(open, "packed", NOW)).toEqual({ ok: true, set: { packedAt: NOW, shippedAt: null } });
    expect(planFulfilment(open, "shipped", NOW)).toEqual({ ok: true, set: { packedAt: NOW, shippedAt: NOW } });
    const earlier = new Date("2026-10-14T00:00:00Z");
    expect(planFulfilment({ ...open, packedAt: earlier }, "shipped", NOW)).toEqual({ ok: true, set: { packedAt: earlier, shippedAt: NOW } });
  });
  it("never lets a seller confirm an order: packing or shipping waits for the shop's confirmation", () => {
    for (const action of ["packed", "shipped"] as const) {
      expect(planFulfilment({ ...open, status: "placed" }, action, NOW)).toMatchObject({ ok: false, code: "not_confirmed" });
    }
  });
  it("refuses closed orders and steps already done (by the seller or the shop)", () => {
    for (const status of ["cancelled", "returned", "delivered"] as const) expect(planFulfilment({ ...open, status }, "packed", NOW)).toMatchObject({ ok: false, code: "order_closed" });
    expect(planFulfilment({ ...open, packedAt: NOW }, "packed", NOW)).toMatchObject({ ok: false, code: "already_done" });
    expect(planFulfilment({ ...open, status: "packed" }, "packed", NOW)).toMatchObject({ ok: false, code: "already_done" });
    expect(planFulfilment({ ...open, status: "shipped" }, "shipped", NOW)).toMatchObject({ ok: false, code: "already_done" });
    expect(planFulfilment({ ...open, status: "packed" }, "shipped", NOW)).toMatchObject({ ok: true });
  });
  it("moves the whole order only when every line is a seller's and every part reached the step", () => {
    const packed = { packedAt: NOW, shippedAt: null };
    const shipped = { packedAt: NOW, shippedAt: NOW };
    const none = { packedAt: null, shippedAt: null };
    expect(orderAdvanceTarget("confirmed", [packed], false)).toBe("packed");
    expect(orderAdvanceTarget("confirmed", [shipped], false)).toBe("shipped");
    expect(orderAdvanceTarget("confirmed", [packed, none], false)).toBeNull();
    expect(orderAdvanceTarget("confirmed", [packed, shipped], false)).toBe("packed");
    expect(orderAdvanceTarget("confirmed", [shipped], true)).toBeNull();
    expect(orderAdvanceTarget("packed", [packed], false)).toBeNull();
    expect(orderAdvanceTarget("cancelled", [shipped], false)).toBeNull();
  });
});

describe("settings", () => {
  it("auto-approve is off by default; sellers may read the payout and return keys", () => {
    expect(MARKETPLACE_SETTINGS_DEFAULTS.autoApproveProducts).toBe(false);
    expect(resolveSettings({ autoApproveProducts: "yes" }).autoApproveProducts).toBe(false);
    expect(MARKETPLACE_SETTINGS_PUBLIC_KEYS).toEqual(expect.arrayContaining(["minPayoutPaise", "returnWindowDays"]));
    expect(MARKETPLACE_SETTINGS_PUBLIC_KEYS).not.toContain("payoutProvider");
    expect(MARKETPLACE_SETTINGS_PUBLIC_KEYS).not.toContain("defaultCommissionBps");
  });
});

// ---------------------------------------------------------------- product reviews

describe("product reviews", () => {
  it("needs review unless the shop auto-approves", async () => {
    expect(await make([]).service.needsProductReview(TENANT, VA)).toBe(true);
    expect(await make([], {}, { autoApproveProducts: true }).service.needsProductReview(TENANT, VA)).toBe(false);
  });

  it("a submission upserts a pending review (clearing an old rejection); a withdrawal without a review writes nothing", async () => {
    const { service, find, argOf } = make([[review({ status: "rejected", reason: "Blurry" })]]);
    await service.onListing(TENANT, { type: "submitted", productId: "p-1", vendorId: VA, name: "Clay lamp", image: null, by: "vendor" });
    const up = find("onConflictDoUpdate")[0]!;
    expect(argOf(up, "values")).toMatchObject({ tenantId: TENANT, productId: "p-1", vendorId: VA, status: "pending", reason: null });
    expect((argOf(up, "onConflictDoUpdate") as { set: Record<string, unknown> }).set).toMatchObject({ status: "pending", reason: null, reviewedAt: null });

    const none = make([[]]);
    await none.service.onListing(TENANT, { type: "withdrawn", productId: "p-1", vendorId: VA, name: "Clay lamp", image: null, by: "vendor" });
    expect(none.find("insert")).toHaveLength(0);
  });

  it("approve publishes through the catalogue, records the reviewer and tells the seller", async () => {
    const publish = vi.fn(async () => undefined);
    const { service, notifier, find, argOf } = make([[review()], [review({ status: "approved" })], [vendor()]], { listings: { publish } });
    const r = await service.approveProductReview(TENANT, "r-1", "owner-1");
    expect(publish).toHaveBeenCalledWith(TENANT, "p-1");
    expect(argOf(find("update")[0]!, "set")).toMatchObject({ status: "approved", reviewedBy: "owner-1" });
    expect(r.status).toBe("approved");
    expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ template: "marketplace.product_approved", vars: { vendorName: "Murugan Silks", productName: "Clay lamp" } }));
  });

  it("decided reviews can't be decided again; a deleted product is withdrawn", async () => {
    const publish = vi.fn(async () => undefined);
    await expect(make([[review({ status: "approved" })]], { listings: { publish } }).service.approveProductReview(TENANT, "r-1", null)).rejects.toMatchObject({ status: 409 });
    expect(publish).not.toHaveBeenCalled();
    await expect(make([[review({ status: "rejected" })]]).service.rejectProductReview(TENANT, "r-1", { reason: "Wrong photo" }, null)).rejects.toMatchObject({
      status: 409,
    });
    const gone = make([[review()], []], { listings: { publish: vi.fn(async () => Promise.reject(notFound("Product"))) } });
    await expect(gone.service.approveProductReview(TENANT, "r-1", null)).rejects.toMatchObject({ status: 409 });
    expect(gone.argOf(gone.find("update")[0]!, "set")).toEqual({ status: "withdrawn" });
  });

  it("an edit after approval re-queues it with the changed fields (merged while waiting); auto-approve or no fields skip it", async () => {
    const changed = { type: "changed" as const, productId: "p-1", vendorId: VA, name: "Clay lamp", image: null, by: "vendor" as const };
    const a = make([[review({ status: "approved" })]]);
    await a.service.onListing(TENANT, { ...changed, fields: ["price"] });
    const set = (a.argOf(a.find("onConflictDoUpdate")[0]!, "onConflictDoUpdate") as { set: Record<string, unknown> }).set;
    expect(set).toMatchObject({ status: "pending", changedAfterApproval: true, changedFields: ["price"], reason: null });

    const b = make([[review({ status: "pending", changedAfterApproval: true, changedFields: ["price"] })]]);
    await b.service.onListing(TENANT, { ...changed, fields: ["name", "images"] });
    expect((b.argOf(b.find("onConflictDoUpdate")[0]!, "onConflictDoUpdate") as { set: Record<string, unknown> }).set).toMatchObject({
      changedFields: ["images", "name", "price"],
    });

    const auto = make([[review({ status: "approved" })]], {}, { autoApproveProducts: true });
    await auto.service.onListing(TENANT, { ...changed, fields: ["price"] });
    expect(auto.find("insert")).toHaveLength(0);
    const none = make([[review({ status: "approved" })]]);
    await none.service.onListing(TENANT, { ...changed, fields: [] });
    expect(none.find("insert")).toHaveLength(0);
  });

  it("approving a re-review clears the flag; rejecting one takes the live product back to draft", async () => {
    const publish = vi.fn(async () => undefined);
    const unpublish = vi.fn(async () => undefined);
    const ok = make([[review({ changedAfterApproval: true, changedFields: ["price"] })], [review({ status: "approved" })], [vendor()]], { listings: { publish, unpublish } });
    await ok.service.approveProductReview(TENANT, "r-1", "owner-1");
    expect(ok.argOf(ok.find("update")[0]!, "set")).toMatchObject({ status: "approved", changedAfterApproval: false, changedFields: [] });
    expect(unpublish).not.toHaveBeenCalled();

    const no = make([[review({ changedAfterApproval: true, changedFields: ["price"] })], [review({ status: "rejected", reason: "Price too high" })], [vendor()]], {
      listings: { publish, unpublish },
    });
    const r = await no.service.rejectProductReview(TENANT, "r-1", { reason: "Price too high" }, "owner-1");
    expect(unpublish).toHaveBeenCalledWith(TENANT, "p-1");
    expect(r).toMatchObject({ status: "rejected", reason: "Price too high" });

    // A first review being rejected never touches the catalogue (the product is still a draft).
    const first = make([[review()], [review({ status: "rejected", reason: "Blurry" })], [vendor()]], { listings: { publish, unpublish } });
    await first.service.rejectProductReview(TENANT, "r-1", { reason: "Blurry" }, null);
    expect(unpublish).toHaveBeenCalledTimes(1);
  });

  it("reject needs a reason and tells the seller why", async () => {
    await expect(make([[review()]]).service.rejectProductReview(TENANT, "r-1", { reason: " " }, null)).rejects.toThrow();
    const { service, notifier } = make([[review()], [review({ status: "rejected", reason: "Add a clear photo" })], [vendor()]]);
    const r = await service.rejectProductReview(TENANT, "r-1", { reason: "Add a clear photo" }, "owner-1");
    expect(r).toMatchObject({ status: "rejected", reason: "Add a clear photo" });
    expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ template: "marketplace.product_rejected", vars: expect.objectContaining({ reason: "Add a clear photo" }) }));
  });

  it("lists with counts per status; productIds must be ids", async () => {
    const { service } = make([[], [{ n: 0 }], [{ status: "pending", n: 2 }]]);
    const r = await service.listProductReviews(TENANT, { vendorId: VA, productIds: `${VARIANT},${ORDER_ID}` as unknown as string[] });
    expect(r).toMatchObject({ items: [], total: 0, counts: { pending: 2, approved: 0, rejected: 0, withdrawn: 0 } });
    await expect(service.listProductReviews(TENANT, { productIds: "x" as unknown as string[] })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------- seller stock

describe("seller stock", () => {
  const variant: VendorVariant = { variantId: VARIANT, productId: "p-1", productName: "Clay lamp", title: "", sku: "LAMP", unit: "pcs", status: "active" };
  const level = (qty: number) => ({ itemId: VARIANT, qty, reserved: 1, available: qty - 1, track: true, status: "ok" });
  const stockPort = (): StockPort & Record<string, ReturnType<typeof vi.fn>> =>
    ({
      defaultLocationId: vi.fn(async () => LOC_DEFAULT),
      levels: vi.fn(async () => [level(2)]),
      adjust: vi.fn(async () => level(7)),
    }) as never;

  it("adjusts only the seller's own variants (others 404, stock untouched)", async () => {
    const stock = stockPort();
    const variants = vi.fn(async () => [] as VendorVariant[]);
    const { service } = make([], { stock, products: { count: async () => 0, list: async () => ({ items: [], total: 0 }), variants } });
    await expect(service.adjustVendorStock(TENANT, vendor(), VARIANT, { mode: "set", qty: 5, reason: "Counted" }, "u1")).rejects.toMatchObject({ status: 404 });
    expect(variants).toHaveBeenCalledWith(TENANT, VA, { variantIds: [VARIANT] });
    expect(stock.adjust).not.toHaveBeenCalled();
  });

  it("adjusts at the shop's default location with the reason and user; the seller's own location wins", async () => {
    const stock = stockPort();
    const variants = vi.fn(async () => [variant]);
    const products = { count: async () => 0, list: async () => ({ items: [], total: 0 }), variants };
    const { service } = make([], { stock, products });
    const r = await service.adjustVendorStock(TENANT, vendor(), VARIANT, { mode: "set", qty: 7, reason: "Counted shelf" }, "u1");
    expect(stock.adjust).toHaveBeenCalledWith(TENANT, VARIANT, { mode: "set", qty: 7, note: "Seller Murugan Silks: Counted shelf", locationId: LOC_DEFAULT }, "u1");
    expect(r).toMatchObject({ before: 2, locationId: LOC_DEFAULT, item: { variantId: VARIANT, qty: 7, available: 6 } });

    const own = stockPort();
    await make([], { stock: own, products }).service.adjustVendorStock(TENANT, vendor({ stockLocationId: LOC_SELLER }), VARIANT, { mode: "add", qty: 3, reason: "New batch" }, "u1");
    expect(own.adjust).toHaveBeenCalledWith(TENANT, VARIANT, expect.objectContaining({ locationId: LOC_SELLER, mode: "add" }), "u1");
    expect(own.defaultLocationId).not.toHaveBeenCalled();
  });

  it("needs a reason and a positive quantity; suspended sellers can't", async () => {
    const stock = stockPort();
    const products = { count: async () => 0, list: async () => ({ items: [], total: 0 }), variants: vi.fn(async () => [variant]) };
    const { service } = make([], { stock, products });
    await expect(service.adjustVendorStock(TENANT, vendor(), VARIANT, { mode: "set", qty: 7, reason: "" }, "u1")).rejects.toThrow();
    await expect(service.adjustVendorStock(TENANT, vendor(), VARIANT, { mode: "add", qty: 0, reason: "Nothing" }, "u1")).rejects.toThrow();
    await expect(service.adjustVendorStock(TENANT, vendor({ status: "suspended" }), VARIANT, { mode: "set", qty: 1, reason: "Counted" }, "u1")).rejects.toMatchObject({ status: 403 });
    expect(stock.adjust).not.toHaveBeenCalled();
  });

  it("lists stock for the seller's variants only", async () => {
    const stock = stockPort();
    const variants = vi.fn(async () => [variant]);
    const { service } = make([], { stock, products: { count: async () => 0, list: async () => ({ items: [], total: 0 }), variants } });
    const r = await service.vendorStock(TENANT, vendor(), { productIds: ORDER_ID });
    expect(variants).toHaveBeenCalledWith(TENANT, VA, { productIds: [ORDER_ID] });
    expect(r).toMatchObject({ total: 1, locationId: LOC_DEFAULT, items: [{ variantId: VARIANT, qty: 2, reserved: 1, available: 1 }] });
    await expect(service.vendorStock(TENANT, vendor(), { productIds: "not-a-uuid" })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------- seller fulfilment

describe("seller fulfilment", () => {
  const owners = { owners: vi.fn(async () => [{ phone: "+919800000001", email: null }]) };

  it("another seller's (or another shop's) vendor order is 404 and nothing moves", async () => {
    const advance = vi.fn(async () => undefined);
    const { service, find } = make([[]], { orders: { getOrder: async () => sourceOrder() }, orderActions: { advance } });
    await expect(service.markFulfilment(TENANT, vendor({ id: VB }), "vo-1", "packed")).rejects.toMatchObject({ status: 404 });
    expect(find("update")).toHaveLength(0);
    expect(advance).not.toHaveBeenCalled();
  });

  it("a single-seller order moves to packed through the orders state machine; the shop is told", async () => {
    const advance = vi.fn<OrderActionsPort["advance"]>(async () => undefined);
    const packed = vendorOrder({ packedAt: NOW });
    const { service, notifier, find, argOf } = make(
      [[vendorOrder()], [vendorOrder()], [vendorOrder()], [packed], [packed], [{ ...packed, status: "packed" }]],
      { orders: { getOrder: async () => sourceOrder() }, orderActions: { advance }, shopContacts: owners },
    );
    const out = await service.markFulfilment(TENANT, vendor(), "vo-1", "packed", {}, "u1");
    expect(argOf(find("update")[0]!, "set")).toMatchObject({ packedAt: NOW, shippedAt: null });
    expect(advance).toHaveBeenCalledWith(TENANT, ORDER_ID, "packed", { note: "Packed by seller Murugan Silks", actorUserId: "u1" });
    expect(out.status).toBe("packed");
    expect(notifier.send).toHaveBeenCalledWith(expect.objectContaining({ template: "marketplace.vendor_order_packed", to: "+919800000001" }));
  });

  it("shipping a single-seller order passes the tracking number to the order", async () => {
    const advance = vi.fn<OrderActionsPort["advance"]>(async () => undefined);
    const shipped = vendorOrder({ packedAt: NOW, shippedAt: NOW, carrier: "DTDC", trackingNumber: "D123456" });
    const { service } = make([[vendorOrder()], [vendorOrder()], [vendorOrder()], [shipped], [shipped], [shipped]], {
      orders: { getOrder: async () => sourceOrder() },
      orderActions: { advance },
    });
    await service.markFulfilment(TENANT, vendor(), "vo-1", "shipped", { carrier: "DTDC", trackingNumber: "D123456" }, "u1");
    expect(advance).toHaveBeenCalledWith(TENANT, ORDER_ID, "shipped", expect.objectContaining({ carrier: "DTDC", trackingNumber: "D123456" }));
    await expect(make([]).service.markFulfilment(TENANT, vendor(), "vo-1", "shipped", {})).rejects.toThrow();
  });

  it("an order with the shop's own lines (or other sellers still packing) stays where it is", async () => {
    const advance = vi.fn(async () => undefined);
    const packed = vendorOrder({ packedAt: NOW });
    const mixed = sourceOrder({ lines: [...sourceOrder().lines, { ...sourceOrder().lines[0]!, variantId: "v9", productId: "p9", vendorId: null }] });
    await make([[vendorOrder()], [vendorOrder()], [vendorOrder()], [packed], [packed], [packed]], {
      orders: { getOrder: async () => mixed },
      orderActions: { advance },
    }).service.markFulfilment(TENANT, vendor(), "vo-1", "packed");
    const two = sourceOrder({ lines: [...sourceOrder().lines, { ...sourceOrder().lines[0]!, variantId: "v2", productId: "p2", vendorId: VB }] });
    await make([[vendorOrder()], [vendorOrder(), vendorOrder({ id: "vo-2", vendorId: VB })], [vendorOrder()], [packed], [packed, vendorOrder({ id: "vo-2", vendorId: VB })], [packed]], {
      orders: { getOrder: async () => two },
      orderActions: { advance },
    }).service.markFulfilment(TENANT, vendor(), "vo-1", "packed");
    expect(advance).not.toHaveBeenCalled();
  });

  it("refuses a delivered order or a step already done, and suspended sellers", async () => {
    const delivered = vendorOrder({ status: "delivered" });
    await expect(
      make([[delivered], [delivered]]).service.markFulfilment(TENANT, vendor(), "vo-1", "packed"),
    ).rejects.toMatchObject({ status: 409, code: "order_closed" });
    const packed = vendorOrder({ packedAt: NOW });
    await expect(make([[packed], [packed]]).service.markFulfilment(TENANT, vendor(), "vo-1", "packed")).rejects.toMatchObject({ status: 409, code: "already_done" });
    await expect(make([[packed], [packed]]).service.markFulfilment(TENANT, vendor(), "vo-1", "packed")).rejects.toBeInstanceOf(AppError);
    await expect(make([]).service.markFulfilment(TENANT, vendor({ status: "suspended" }), "vo-1", "packed")).rejects.toMatchObject({ status: 403 });
  });
});
