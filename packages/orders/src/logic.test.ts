import { describe, expect, it, vi } from "vitest";
import { computeInvoice } from "@srirealtime/gst";
import {
  allocateLoyaltyDiscount,
  allowedTransitions,
  balanceOf,
  BLOCKING_EFFECTS,
  buildBaseLines,
  computeOrderTotals,
  customerKeyOf,
  derivePaymentStatus,
  exclusiveOf,
  istRange,
  itemsText,
  monthStart,
  moneyText,
  normalizeSettings,
  ORDER_TEMPLATES,
  planPlacement,
  planTransition,
  principalRate,
  runEffects,
  shouldAutoConfirm,
  splitProportionally,
  toIndianE164,
  type OrderEffect,
  type TransitionState,
} from "./logic";
import type { CatalogItem } from "./ports";
import { ORDER_STATUSES, type OrderStatus } from "./schema";

// ------------------------------------------------------------------ status machine

const ALLOWED: Record<OrderStatus, OrderStatus[]> = {
  placed: ["confirmed", "packed", "shipped", "delivered", "cancelled"],
  confirmed: ["packed", "shipped", "delivered", "cancelled"],
  packed: ["shipped", "delivered", "cancelled"],
  shipped: ["delivered"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
};

const state = (patch: Partial<TransitionState> = {}): TransitionState => ({
  status: "placed",
  paymentMethod: "online",
  total: 10_000,
  paid: 0,
  stockState: "reserved",
  couponCode: null,
  invoiceId: null,
  ...patch,
});
const opts = { invoiceOn: "delivered" as const, returnsEnabled: true };
const types = (effects: OrderEffect[]) => effects.map((e) => (e.type === "notify" ? `notify:${e.template}:${e.audience}` : e.type));

describe("allowedTransitions / planTransition: every pair", () => {
  for (const from of ORDER_STATUSES) {
    for (const to of ORDER_STATUSES) {
      const allowed = ALLOWED[from].includes(to);
      it(`${from} → ${to}: ${allowed ? "allowed" : from === to ? "same" : "refused"}`, () => {
        const plan = planTransition(state({ status: from }), to, opts);
        expect(plan.ok).toBe(allowed);
        if (!plan.ok) expect(plan.code).toBe(from === to ? "same_status" : "not_allowed");
      });
    }
  }

  it("lists next statuses; returns only with the feature", () => {
    for (const s of ORDER_STATUSES) expect(allowedTransitions(s, { returnsEnabled: true })).toEqual(ALLOWED[s]);
    expect(allowedTransitions("delivered", { returnsEnabled: false })).toEqual([]);
    const plan = planTransition(state({ status: "delivered" }), "returned", { ...opts, returnsEnabled: false });
    expect(plan).toMatchObject({ ok: false, code: "feature_disabled" });
  });
});

describe("planTransition: side effects", () => {
  it("confirmed notifies; invoices only when invoiceOn = confirmed", () => {
    const p = planTransition(state(), "confirmed", opts);
    expect(p.ok && types(p.effects)).toEqual(["notify:order.confirmed:customer"]);
    const q = planTransition(state(), "confirmed", { ...opts, invoiceOn: "confirmed" });
    expect(q.ok && types(q.effects)).toEqual(["invoice.create", "notify:order.confirmed:customer"]);
    const has = planTransition(state({ invoiceId: "inv1" }), "confirmed", { ...opts, invoiceOn: "confirmed" });
    expect(has.ok && types(has.effects)).toEqual(["notify:order.confirmed:customer"]);
  });

  it("packed has no side effects; shipped notifies", () => {
    const p = planTransition(state({ status: "confirmed" }), "packed", opts);
    expect(p.ok && p.effects).toEqual([]);
    const s = planTransition(state({ status: "packed" }), "shipped", opts);
    expect(s.ok && types(s.effects)).toEqual(["notify:order.shipped:customer"]);
  });

  it("delivered commits stock, invoices and notifies", () => {
    const p = planTransition(state({ status: "shipped", paid: 10_000 }), "delivered", opts);
    expect(p.ok && types(p.effects)).toEqual(["stock.commit", "invoice.create", "notify:order.delivered:customer"]);
  });

  it("delivered COD: marks paid before invoicing", () => {
    const p = planTransition(state({ status: "shipped", paymentMethod: "cod" }), "delivered", opts);
    expect(p.ok && types(p.effects)).toEqual(["stock.commit", "payment.collectCod", "invoice.create", "notify:order.delivered:customer"]);
    const paid = planTransition(state({ status: "shipped", paymentMethod: "cod", paid: 10_000 }), "delivered", opts);
    expect(paid.ok && types(paid.effects)).not.toContain("payment.collectCod");
  });

  it("delivered with invoiceOn = confirmed doesn't invoice twice, but catches up when missing", () => {
    const done = planTransition(state({ status: "shipped", invoiceId: "inv1", paid: 10_000 }), "delivered", { ...opts, invoiceOn: "confirmed" });
    expect(done.ok && types(done.effects)).toEqual(["stock.commit", "notify:order.delivered:customer"]);
    const missing = planTransition(state({ status: "shipped", paid: 10_000 }), "delivered", { ...opts, invoiceOn: "confirmed" });
    expect(missing.ok && types(missing.effects)).toContain("invoice.create");
  });

  it("delivered without reserved stock doesn't commit", () => {
    const p = planTransition(state({ status: "shipped", stockState: "none", paid: 10_000 }), "delivered", opts);
    expect(p.ok && types(p.effects)).toEqual(["invoice.create", "notify:order.delivered:customer"]);
  });

  it("skipping forward gathers the steps' effects and notifies once for the final status", () => {
    const p = planTransition(state({ paymentMethod: "cash", paid: 0 }), "delivered", { ...opts, invoiceOn: "confirmed" });
    expect(p.ok && p.path).toEqual(["confirmed", "packed", "shipped", "delivered"]);
    expect(p.ok && types(p.effects)).toEqual(["stock.commit", "invoice.create", "notify:order.delivered:customer"]);
  });

  it("cancelled releases stock and coupon, cancels the invoice, notifies", () => {
    const p = planTransition(state({ status: "confirmed", couponCode: "DIWALI10", invoiceId: "inv1" }), "cancelled", opts);
    expect(p.ok && types(p.effects)).toEqual(["stock.release", "invoice.cancel", "coupon.release", "notify:order.cancelled:customer"]);
    const bare = planTransition(state({ stockState: "none" }), "cancelled", opts);
    expect(bare.ok && types(bare.effects)).toEqual(["notify:order.cancelled:customer"]);
    expect(bare.ok && bare.path).toEqual(["cancelled"]);
  });

  it("returned restocks sold stock and cancels the invoice, no message", () => {
    const p = planTransition(state({ status: "delivered", stockState: "committed", invoiceId: "inv1" }), "returned", opts);
    expect(p.ok && types(p.effects)).toEqual(["stock.restock", "invoice.cancel"]);
    const none = planTransition(state({ status: "delivered", stockState: "none" }), "returned", opts);
    expect(none.ok && none.effects).toEqual([]);
  });
});

describe("planPlacement / auto-confirm", () => {
  it("reserves stock, redeems the coupon, then tells customer and owner", () => {
    expect(types(planPlacement({ couponCode: "DIWALI10", notifyOwner: true }))).toEqual([
      "stock.reserve",
      "coupon.redeem",
      "notify:order.placed:customer",
      "notify:order.received:owner",
    ]);
    expect(types(planPlacement({ couponCode: null, notifyOwner: false }))).toEqual(["stock.reserve", "notify:order.placed:customer"]);
    expect(BLOCKING_EFFECTS).toEqual(["stock.reserve", "coupon.redeem"]);
    expect(ORDER_TEMPLATES.placed).toBe("order.placed");
  });
  it("auto-confirms non-online orders at once and online orders once paid", () => {
    const o = { status: "placed" as const, paymentMethod: "online" as const, paid: 0, total: 100 };
    expect(shouldAutoConfirm({ autoConfirm: true }, o)).toBe(false);
    expect(shouldAutoConfirm({ autoConfirm: true }, { ...o, paid: 100 })).toBe(true);
    expect(shouldAutoConfirm({ autoConfirm: true }, { ...o, paymentMethod: "cod" })).toBe(true);
    expect(shouldAutoConfirm({ autoConfirm: false }, { ...o, paymentMethod: "cod" })).toBe(false);
    expect(shouldAutoConfirm({ autoConfirm: true }, { ...o, status: "confirmed", paid: 100 })).toBe(false);
  });
});

describe("runEffects", () => {
  const e1: OrderEffect = { type: "stock.reserve" };
  const e2: OrderEffect = { type: "coupon.redeem" };
  const e3: OrderEffect = { type: "notify", template: "order.placed", audience: "customer" };

  it("blocking: undoes completed effects in reverse and rethrows", async () => {
    const undo = vi.fn(async () => undefined);
    const run = vi.fn(async (e: OrderEffect) => {
      if (e.type === "coupon.redeem") throw new Error("usage_limit");
    });
    await expect(runEffects([e1, e2, e3], run, { mode: "blocking", undo })).rejects.toThrow("usage_limit");
    expect(run).toHaveBeenCalledTimes(2);
    expect(undo.mock.calls).toEqual([[e1]]);
  });

  it("best-effort: reports failures and keeps going", async () => {
    const onFailure = vi.fn();
    const run = vi.fn(async (e: OrderEffect) => {
      if (e.type === "stock.reserve") throw new Error("down");
    });
    const r = await runEffects([e1, e2, e3], run, { mode: "best-effort", onFailure });
    expect(run).toHaveBeenCalledTimes(3);
    expect(r.failed).toEqual([e1]);
    expect(r.done).toEqual([e2, e3]);
    expect(onFailure).toHaveBeenCalledWith(e1, expect.any(Error));
  });

  it("best-effort survives a failing failure reporter", async () => {
    const r = await runEffects([e1, e3], async (e) => {
      if (e === e1) throw new Error("x");
    }, {
      mode: "best-effort",
      onFailure: () => {
        throw new Error("log down");
      },
    });
    expect(r.done).toEqual([e3]);
  });
});

describe("payment status", () => {
  const p = (patch: Partial<Parameters<typeof derivePaymentStatus>[0]>) =>
    derivePaymentStatus({ total: 1000, paid: 0, refunded: 0, paymentMethod: "online", ...patch });
  it("derives from money and method", () => {
    expect(p({})).toBe("pending");
    expect(p({ paymentMethod: "cod" })).toBe("cod");
    expect(p({ paymentMethod: "cash" })).toBe("unpaid");
    expect(p({ paymentMethod: "cash", paid: 500 })).toBe("unpaid");
    expect(p({ paid: 1000 })).toBe("paid");
    expect(p({ paid: 1000, refunded: 300 })).toBe("partially_refunded");
    expect(p({ paid: 1000, refunded: 1000 })).toBe("refunded");
    expect(p({ total: 0, paymentMethod: "cash" })).toBe("paid");
  });
  it("balance", () => {
    expect(balanceOf({ total: 1000, paid: 1000, refunded: 200 })).toBe(200);
  });
});

// ------------------------------------------------------------------ pricing

const item = (patch: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "v1",
  productId: "p1",
  name: "Cotton Saree – Red",
  sku: "SAR-RED",
  barcode: null,
  hsn: "5208",
  unit: "pcs",
  rate: 47524,
  price: 49900,
  taxInclusive: true,
  gstRate: 5,
  image: null,
  categoryId: "c1",
  ...patch,
});

describe("exclusiveOf", () => {
  it("strips GST from tax-inclusive prices only", () => {
    expect(exclusiveOf(49900, 5, true)).toBe(47524);
    expect(exclusiveOf(11800, 18, true)).toBe(10000);
    expect(exclusiveOf(10000, 0, true)).toBe(10000);
    expect(exclusiveOf(10000, 18, false)).toBe(10000);
    expect(exclusiveOf(100, 0.25, true)).toBe(100);
  });
});

describe("buildBaseLines", () => {
  it("prices from the catalogue and ignores client prices unless allowed", () => {
    const r = buildBaseLines([item()], [{ variantId: "v1", qty: 2, price: 100 }], { allowPriceOverride: false });
    expect(r.ok && r.lines[0]).toMatchObject({ price: 49900, rate: 47524, gross: 99800, gstRate: 5, categoryId: "c1" });
    const m = buildBaseLines([item()], [{ variantId: "v1", qty: 2, price: 45000 }], { allowPriceOverride: true });
    expect(m.ok && m.lines[0]).toMatchObject({ price: 45000, rate: exclusiveOf(45000, 5, true), gross: 90000 });
  });
  it("reports unknown variants and bad GST rates", () => {
    expect(buildBaseLines([item()], [{ variantId: "v2", qty: 1 }], { allowPriceOverride: false })).toEqual({ ok: false, missing: ["v2"], badGst: [] });
    expect(buildBaseLines([item({ gstRate: 7 })], [{ variantId: "v1", qty: 1 }], { allowPriceOverride: false })).toEqual({
      ok: false,
      missing: [],
      badGst: ["v1"],
    });
  });
  it("handles fractional quantities", () => {
    const r = buildBaseLines([item({ unit: "m", price: 12050, taxInclusive: false })], [{ variantId: "v1", qty: 2.5 }], { allowPriceOverride: false });
    expect(r.ok && r.lines[0]!.gross).toBe(30125);
  });
});

describe("computeOrderTotals", () => {
  const lines = (items: CatalogItem[], qty = 1) => {
    const r = buildBaseLines(items, items.map((i) => ({ variantId: i.id, qty })), { allowPriceOverride: false });
    if (!r.ok) throw new Error("bad");
    return r.lines;
  };

  it("tax-inclusive MRP: the customer pays the shelf price", () => {
    const { lines: l, totals } = computeOrderTotals(lines([item()]), { shipping: 0, sellerState: "33", placeOfSupply: "33" });
    expect(l[0]).toMatchObject({ rate: 47524, taxable: 47524, cgst: 1188, sgst: 1188, igst: 0, discount: 0, price: 49900, variantId: "v1" });
    expect(totals).toMatchObject({ subtotal: 49900, discount: 0, shipping: 0, total: 49900, interState: false, shippingLine: null });
  });

  it("inter-state supply uses IGST", () => {
    const { totals } = computeOrderTotals(lines([item({ taxInclusive: false, price: 10000, rate: 10000, gstRate: 18 })]), {
      shipping: 0,
      sellerState: "33",
      placeOfSupply: "29",
    });
    expect(totals).toMatchObject({ taxable: 10000, igst: 1800, cgst: 0, sgst: 0, total: 11800, interState: true });
  });

  it("coupon shares are converted to the exclusive basis on tax-inclusive lines", () => {
    // ₹499 saree with ₹49.90 off (10%): the customer pays ₹449.10 → rounds to ₹449.
    const { lines: l, totals } = computeOrderTotals(lines([item()]), { lineDiscounts: [4990], shipping: 0, sellerState: "33", placeOfSupply: "33" });
    expect(l[0]!.discount).toBe(exclusiveOf(4990, 5, true)); // 4752
    // GST is taken out of the ₹449.10 charged: taxable round(44910 / 1.05) = 42771, the line totals ₹449.10 exactly.
    expect(l[0]).toMatchObject({ taxable: 42771, amount: 42771 + 4752, cgst: 1070, sgst: 1069, total: 44910 });
    expect(totals.discount).toBe(4990);
    expect(totals.total).toBe(44900);
  });

  describe("tax-inclusive line totals equal the charged price (regression: ₹999 showed as ₹999.01)", () => {
    const invoiceOf = (l: ReturnType<typeof computeOrderTotals>, inter = false) =>
      computeInvoice(
        [
          ...l.lines.map((x) => ({ description: x.name, qty: x.qty, rate: x.rate, discount: x.discount || undefined, gstRate: x.gstRate, inclusiveTotal: x.taxInclusive && x.gstRate ? x.total : undefined })),
          ...[l.totals.shippingLine, l.totals.codFeeLine].filter((x) => x != null),
        ],
        { sellerState: "33", placeOfSupply: inter ? "29" : "33" },
      );

    it.each([
      [99900, 5],
      [89910, 5],
      [49900, 12],
      [129900, 18],
      [1, 5],
      [99999, 28],
      [2550, 0.25],
    ])("₹%s at %s%% stays exact", (price, gstRate) => {
      const r = computeOrderTotals(lines([item({ price, gstRate })]), { shipping: 0, sellerState: "33", placeOfSupply: "33" });
      const line = r.lines[0]!;
      expect(line.total).toBe(price);
      expect(line.taxable + line.cgst + line.sgst).toBe(price);
      expect(line.amount - line.discount).toBe(line.taxable);
      expect(Math.abs(line.cgst - line.sgst)).toBeLessThanOrEqual(1);
    });

    it("₹999 at 5%: ₹951.43 + ₹23.79 + ₹23.78 = ₹999.00", () => {
      const { lines: l } = computeOrderTotals(lines([item({ price: 99900, gstRate: 5 })]), { shipping: 0, sellerState: "33", placeOfSupply: "33" });
      expect(l[0]).toMatchObject({ rate: 95143, amount: 95143, taxable: 95143, cgst: 2379, sgst: 2378, total: 99900 });
    });

    it("prices from ₹1 to ₹2,000 (qty 1–3, intra and inter-state) total exactly, and the invoice balances", () => {
      const bad: string[] = [];
      for (let price = 100; price <= 200_000; price += 173) {
        for (const qty of [1, 2, 3]) {
          for (const inter of [false, true]) {
            const r = computeOrderTotals(lines([item({ price, gstRate: 5 })], qty), { shipping: 4900, codFee: 2900, sellerState: "33", placeOfSupply: inter ? "29" : "33" });
            const inv = invoiceOf(r, inter);
            const okLine = r.lines[0]!.total === price * qty && r.totals.shippingLine!.total === 4900 && r.totals.codFeeLine!.total === 2900;
            const okInv =
              inv.total === r.totals.total &&
              inv.lines.every((x, i) => x.total === [r.lines[0]!.total, 4900, 2900][i]) &&
              inv.taxable + inv.cgst + inv.sgst + inv.igst === price * qty + 4900 + 2900;
            if (!okLine || !okInv) bad.push(`${price}×${qty}${inter ? " inter" : ""}`);
          }
        }
      }
      expect(bad).toEqual([]);
    });

    it("₹899.10 with a coupon share and mixed rates: every line is exact and the invoice balances", () => {
      const base = lines([item({ id: "v1", price: 89910, gstRate: 5 }), item({ id: "v2", price: 129900, gstRate: 18 }), item({ id: "v3", price: 50000, gstRate: 12, taxInclusive: false })], 2);
      const r = computeOrderTotals(base, { lineDiscounts: [10000, 7700, 3000], shipping: 0, sellerState: "33", placeOfSupply: "33" });
      expect(r.lines[0]!.total).toBe(89910 * 2 - 10000);
      expect(r.lines[1]!.total).toBe(129900 * 2 - 7700);
      expect(r.lines[2]).toMatchObject({ taxable: 97000, cgst: 5820, sgst: 5820, total: 108640 }); // exclusive: unchanged
      const inv = invoiceOf(r);
      expect(inv.lines.map((x) => x.total)).toEqual(r.lines.map((x) => x.total));
      expect(inv.total).toBe(r.totals.total);
    });
  });

  it("coupon on exclusive lines reduces the taxable value directly", () => {
    const { lines: l } = computeOrderTotals(lines([item({ taxInclusive: false, price: 10000, rate: 10000, gstRate: 18 })]), {
      lineDiscounts: [1000],
      shipping: 0,
      sellerState: "33",
      placeOfSupply: "33",
    });
    expect(l[0]).toMatchObject({ discount: 1000, taxable: 9000, cgst: 810, sgst: 810, total: 10620 });
  });

  it("shipping is a GST-inclusive composite line at the principal item's rate", () => {
    const base = lines([item({ id: "v1", gstRate: 5, price: 49900 }), item({ id: "v2", gstRate: 12, price: 10000, taxInclusive: true })]);
    const { lines: l, totals } = computeOrderTotals(base, { shipping: 5000, sellerState: "33", placeOfSupply: "33" });
    expect(l).toHaveLength(2);
    expect(totals.shippingLine).toMatchObject({ description: "Shipping charges", hsn: "996812", gstRate: 5, rate: exclusiveOf(5000, 5, true) });
    expect(totals.shipping).toBe(5000);
    expect(totals.total).toBe(49900 + 10000 + 5000);
  });

  it("free shipping waives the charge", () => {
    const { totals } = computeOrderTotals(lines([item()]), { shipping: 5000, freeShipping: true, sellerState: "33", placeOfSupply: "33" });
    expect(totals).toMatchObject({ shipping: 0, shippingWaived: 5000, shippingLine: null, total: 49900 });
  });

  it("COD fee is its own taxed line after shipping", () => {
    const { lines: l, totals } = computeOrderTotals(lines([item()]), { shipping: 4000, codFee: 3000, sellerState: "33", placeOfSupply: "33" });
    expect(l).toHaveLength(1);
    expect(totals.shippingLine).toMatchObject({ description: "Shipping charges", rate: exclusiveOf(4000, 5, true) });
    expect(totals.codFeeLine).toMatchObject({ description: "COD charges", hsn: "996812", gstRate: 5, rate: exclusiveOf(3000, 5, true) });
    expect(totals).toMatchObject({ shipping: 4000, codFee: 3000, total: 49900 + 4000 + 3000 });
  });

  it("a free-shipping coupon waives shipping but not the COD fee", () => {
    const { totals } = computeOrderTotals(lines([item()]), { shipping: 4000, freeShipping: true, codFee: 3000, sellerState: "33", placeOfSupply: "33" });
    expect(totals).toMatchObject({ shipping: 0, shippingWaived: 4000, shippingLine: null, codFee: 3000, total: 49900 + 3000 });
    expect(totals.codFeeLine).toMatchObject({ description: "COD charges", rate: exclusiveOf(3000, 5, true) });
  });

  it("no COD fee → no COD line", () => {
    const { totals } = computeOrderTotals(lines([item()]), { shipping: 0, sellerState: "33", placeOfSupply: "33" });
    expect(totals).toMatchObject({ codFee: 0, codFeeLine: null });
  });

  it("principal rate: largest taxable value, ties to the higher rate", () => {
    expect(principalRate([{ gstRate: 5, amount: 100 }, { gstRate: 18, amount: 50 }])).toBe(5);
    expect(principalRate([{ gstRate: 5, amount: 100 }, { gstRate: 12, amount: 100 }])).toBe(12);
    expect(principalRate([])).toBe(0);
  });

  describe("loyalty points", () => {
    const opts = { shipping: 0, sellerState: "33", placeOfSupply: "33" };
    const exact = (t: { taxable: number; cgst: number; sgst: number; igst: number }) => t.taxable + t.cgst + t.sgst + t.igst;

    it("allocates over what each line still charges, summing exactly", () => {
      expect(allocateLoyaltyDiscount(10000, [{ gross: 30000 }, { gross: 10000 }])).toEqual([7500, 2500]);
      expect(allocateLoyaltyDiscount(100, [{ gross: 100 }, { gross: 100 }, { gross: 100 }])).toEqual([34, 33, 33]);
      // Coupon shares come off first: remaining 20000 / 10000.
      expect(allocateLoyaltyDiscount(3001, [{ gross: 30000 }, { gross: 10000 }], [10000, 0])).toEqual([2001, 1000]);
      // Never above a line's remaining charge; a fully discounted line gets nothing.
      expect(allocateLoyaltyDiscount(50000, [{ gross: 10000 }, { gross: 5000 }], [0, 5000])).toEqual([10000, 0]);
      expect(allocateLoyaltyDiscount(0, [{ gross: 10000 }])).toEqual([0]);
      for (const d of [1, 7, 333, 9999, 12345]) {
        const parts = allocateLoyaltyDiscount(d, [{ gross: 49900 }, { gross: 12999 }, { gross: 333 }], [4990, 0, 33]);
        expect(parts.reduce((s, v) => s + v, 0)).toBe(d);
        expect(parts[0]).toBeLessThanOrEqual(49900 - 4990);
        expect(parts[2]).toBeLessThanOrEqual(300);
      }
    });

    it("tax-inclusive lines: the total drops by exactly the points discount", () => {
      const base = lines([item({ id: "v1", price: 49900, gstRate: 5 }), item({ id: "v2", price: 129900, gstRate: 18 })]);
      const before = computeOrderTotals(base, opts);
      for (const d of [1, 100, 2345, 9999]) {
        const ld = allocateLoyaltyDiscount(d, base);
        const after = computeOrderTotals(base, { ...opts, loyaltyDiscounts: ld, loyaltyPoints: d });
        expect(exact(before.totals) - exact(after.totals)).toBe(d);
        after.lines.forEach((l, i) => {
          expect(l.total).toBe(base[i]!.gross - ld[i]!);
          // The line discount carries the share on the exclusive basis; taxable + discount = amount.
          expect(l.discount).toBe(exclusiveOf(ld[i]!, l.gstRate, true));
          expect(l.taxable + l.discount).toBe(l.amount);
        });
        expect(after.totals.loyalty).toEqual({ points: d, discount: d });
        expect(after.totals.discount).toBe(0);
      }
      expect(computeOrderTotals(base, { ...opts, loyaltyDiscounts: [0, 0] }).totals.loyalty).toBeUndefined();
    });

    it("mixed with a coupon: coupon first, points on the rest", () => {
      const base = lines([item()], 2); // 2 x Rs 499
      const coupon = [9980];
      const ld = allocateLoyaltyDiscount(10000, base, coupon);
      const withCoupon = computeOrderTotals(base, { ...opts, lineDiscounts: coupon });
      const r = computeOrderTotals(base, { ...opts, lineDiscounts: coupon, loyaltyDiscounts: ld, loyaltyPoints: 100 });
      expect(r.lines[0]!.total).toBe(99800 - 9980 - 10000);
      expect(exact(withCoupon.totals) - exact(r.totals)).toBe(10000);
      expect(r.lines[0]!.discount).toBe(exclusiveOf(9980 + 10000, 5, true));
      expect(r.totals).toMatchObject({ discount: 9980, loyalty: { points: 100, discount: 10000 }, total: 79800 });
    });

    it("exclusive lines: the share is converted to the exclusive basis and GST is recomputed", () => {
      const base = lines([item({ taxInclusive: false, price: 10000, rate: 10000, gstRate: 18 })]);
      const r = computeOrderTotals(base, { ...opts, loyaltyDiscounts: [1180], loyaltyPoints: 12 });
      expect(r.lines[0]).toMatchObject({ discount: 1000, taxable: 9000, cgst: 810, sgst: 810, total: 10620 });
      expect(r.totals).toMatchObject({ total: 10600, loyalty: { points: 12, discount: 1180 } });
      // Capped at the line's remaining charge.
      const capped = computeOrderTotals(base, { ...opts, lineDiscounts: [10000], loyaltyDiscounts: [500] });
      expect(capped.totals.loyalty).toBeUndefined();
      expect(capped.lines[0]!.total).toBe(0);
    });

    it("a GST invoice copied from the order equals the order", () => {
      const base = lines([item({ id: "v1", price: 49900, gstRate: 5 }), item({ id: "v2", taxInclusive: false, price: 10000, rate: 10000, gstRate: 18 })]);
      const coupon = [1000, 500];
      const ld = allocateLoyaltyDiscount(4321, base, coupon);
      const r = computeOrderTotals(base, { shipping: 4900, sellerState: "33", placeOfSupply: "33", lineDiscounts: coupon, loyaltyDiscounts: ld, loyaltyPoints: 43 });
      const inv = computeInvoice(
        [
          ...r.lines.map((x) => ({ description: x.name, qty: x.qty, rate: x.rate, discount: x.discount || undefined, gstRate: x.gstRate, inclusiveTotal: x.taxInclusive && x.gstRate ? x.total : undefined })),
          ...[r.totals.shippingLine].filter((x) => x != null),
        ],
        { sellerState: "33", placeOfSupply: "33" },
      );
      expect({ taxable: inv.taxable, cgst: inv.cgst, sgst: inv.sgst, total: inv.total }).toEqual({ taxable: r.totals.taxable, cgst: r.totals.cgst, sgst: r.totals.sgst, total: r.totals.total });
    });
  });

  it("splits a discount proportionally", () => {
    expect(splitProportionally(100, [300, 100])).toEqual([75, 25]);
    expect(splitProportionally(10, [1, 1, 1])).toEqual([1, 1, 1]);
    expect(splitProportionally(100, [100, 100, 100])).toEqual([34, 33, 33]);
  });
});

describe("helpers", () => {
  it("settings defaults", () => {
    expect(normalizeSettings({})).toEqual({ prefix: "ORD", invoiceOn: "delivered", allowBackorder: false, autoConfirm: false, notifyOwner: true });
    expect(normalizeSettings({ prefix: " SHOP ", invoiceOn: "confirmed", autoConfirm: true, notifyOwner: false })).toMatchObject({
      prefix: "SHOP",
      invoiceOn: "confirmed",
      autoConfirm: true,
      notifyOwner: false,
    });
  });
  it("customer keys and phones", () => {
    expect(customerKeyOf({ accountId: "a1", phone: "9876543210" })).toBe("acct:a1");
    expect(customerKeyOf({ phone: "098765 43210" })).toBe("ph:+919876543210");
    expect(customerKeyOf({ email: " Ravi@Mail.com " })).toBe("em:ravi@mail.com");
    expect(customerKeyOf({})).toBeNull();
    expect(toIndianE164("+1 555 0100")).toBeNull();
  });
  it("text helpers", () => {
    expect(moneyText(123450, "sms")).toBe("Rs.1,234.50");
    expect(moneyText(123450, "whatsapp")).toBe("₹1,234.50");
    expect(itemsText([{ qty: 2, unit: "pcs" }, { qty: 2.5, unit: "m" }])).toBe("3 items");
    expect(itemsText([{ qty: 1, unit: "pcs" }])).toBe("1 item");
  });
  it("IST ranges", () => {
    const r = istRange("2026-10-01", "2026-10-31");
    expect(r.start?.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(r.end?.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    expect(istRange(null, null)).toEqual({ start: null, end: null });
    expect(monthStart("2026-10-15")).toBe("2026-10-01");
  });
});
