import { describe, expect, it } from "vitest";
import {
  allocate,
  balancesByVendor,
  canSetVendorStatus,
  commissionOf,
  effectiveCommissionBps,
  eligibleAtFor,
  formatBps,
  isSettlementEligible,
  istDateOf,
  ledgerBalance,
  maskPayoutAccount,
  payoutAccountSchema,
  pickVendor,
  planPayouts,
  planVendorOrderUpdate,
  reversalEntries,
  saleEntries,
  slugify,
  splitOrder,
  uniqueSlug,
  type PayoutCandidate,
  type VendorOrderState,
} from "./logic";
import type { SourceOrderLine } from "./ports";
import { MARKETPLACE_SETTINGS_DEFAULTS, MARKETPLACE_SETTINGS_SCHEMA, resolveSettings } from "./settings";

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe("allocate", () => {
  it("splits proportionally and sums exactly", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [3, 7])).toEqual([3, 7]);
    expect(allocate(1, [1, 1])).toEqual([1, 0]);
    expect(allocate(999, [500, 300, 200])).toEqual([499, 300, 200]); // remainders .5 .7 .8
  });
  it("gives the remainder to the largest fractions, ties to the earlier index", () => {
    // 5 × (1/3, 1/3, 1/3) = 1.67 each → floors 1,1,1 (+2 to the first two)
    expect(allocate(5, [1, 1, 1])).toEqual([2, 2, 1]);
    // 7 × [1,2,4]/7 exact
    expect(allocate(7, [1, 2, 4])).toEqual([1, 2, 4]);
    // 10 × [1,2] / 3 = 3.33, 6.67 → 3, 7
    expect(allocate(10, [1, 2])).toEqual([3, 7]);
  });
  it("handles totals above the weights (shipping larger than goods)", () => {
    expect(allocate(5000, [100, 300])).toEqual([1250, 3750]);
  });
  it("zero weights get nothing; all-zero weights split evenly", () => {
    expect(allocate(100, [0, 50, 50])).toEqual([0, 50, 50]);
    expect(allocate(100, [0, 0, 0])).toEqual([34, 33, 33]);
    expect(allocate(100, [-5, 5])).toEqual([0, 100]);
  });
  it("negative totals mirror positive ones; empty and zero cases", () => {
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(100, [])).toEqual([]);
    expect(() => allocate(1.5, [1])).toThrow();
  });
  it("always sums exactly (randomised)", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(rnd() * 6);
      const weights = Array.from({ length: n }, () => Math.floor(rnd() * 100_000));
      const total = Math.floor(rnd() * 1_000_000);
      const parts = allocate(total, weights);
      expect(sum(parts)).toBe(total);
      parts.forEach((p, j) => {
        expect(Number.isInteger(p)).toBe(true);
        expect(p).toBeGreaterThanOrEqual(0);
        const base = sum(weights);
        if (base > 0) expect(Math.abs(p - (total * weights[j]!) / base)).toBeLessThan(1);
      });
    }
  });
});

describe("commissionOf", () => {
  it("rounds half up in integer arithmetic", () => {
    expect(commissionOf(10_000, 1000)).toBe(1000);
    expect(commissionOf(12_345, 1000)).toBe(1235); // 1234.5 → 1235
    expect(commissionOf(12_344, 1000)).toBe(1234); // 1234.4
    expect(commissionOf(999, 250)).toBe(25); // 24.975
    expect(commissionOf(1, 5000)).toBe(1); // 0.5 → 1
    expect(commissionOf(1, 4999)).toBe(0);
  });
  it("is zero for no base / no rate and caps at 100 %", () => {
    expect(commissionOf(0, 1000)).toBe(0);
    expect(commissionOf(-500, 1000)).toBe(0);
    expect(commissionOf(5000, 0)).toBe(0);
    expect(commissionOf(5000, 20_000)).toBe(5000);
  });
  it("formats bps", () => {
    expect(formatBps(1000)).toBe("10%");
    expect(formatBps(1250)).toBe("12.5%");
    expect(formatBps(1)).toBe("0.01%");
    expect(effectiveCommissionBps(null, 1000)).toBe(1000);
    expect(effectiveCommissionBps(0, 1000)).toBe(0);
    expect(effectiveCommissionBps(500, 1000)).toBe(500);
  });
});

const line = (over: Partial<SourceOrderLine>): SourceOrderLine => ({
  variantId: "var",
  productId: "prod",
  vendorId: null,
  name: "Item",
  sku: null,
  image: null,
  qty: 1,
  unit: "pcs",
  price: 10_000,
  gstRate: 5,
  discount: 0,
  total: 10_000,
  ...over,
});

describe("splitOrder", () => {
  const bps = (map: Record<string, number>) => (v: string) => map[v] ?? 1000;

  it("groups lines per vendor and keeps the shop's own lines as house", () => {
    const lines = [
      line({ variantId: "a1", vendorId: "A", price: 30_000 }),
      line({ variantId: "h1", vendorId: null, price: 10_000 }),
      line({ variantId: "b1", vendorId: "B", price: 20_000, qty: 2 }),
      line({ variantId: "a2", vendorId: "A", price: 10_000 }),
    ];
    const s = splitOrder(lines, { subtotal: 90_000, discount: 0, shipping: 0, total: 90_000 }, bps({}));
    expect(s.vendors.map((v) => v.vendorId)).toEqual(["A", "B"]);
    expect(s.vendors[0]!.lines.map((l) => l.variantId)).toEqual(["a1", "a2"]);
    expect(s.vendors[0]!.subtotal).toBe(40_000);
    expect(s.vendors[1]!.subtotal).toBe(40_000);
    expect(s.vendors[1]!.lines[0]!.gross).toBe(40_000);
    expect(s.house!.subtotal).toBe(10_000);
    expect(s.vendors[0]!.commission).toBe(4000);
    expect(s.vendors[0]!.net).toBe(36_000);
  });

  it("shares shipping by goods after discount and the coupon by subtotal", () => {
    // A: 300, B: 100 (₹); coupon ₹40 flat; shipping ₹50
    const lines = [line({ vendorId: "A", price: 30_000 }), line({ vendorId: "B", price: 10_000 })];
    const s = splitOrder(lines, { subtotal: 40_000, discount: 4000, shipping: 5000, total: 41_000 }, bps({ A: 1000, B: 1500 }));
    const [a, b] = s.vendors;
    expect(a).toMatchObject({ subtotal: 30_000, discount: 3000, shippingShare: 3750, saleAmount: 30_750, commission: 2700, net: 28_050 });
    expect(b).toMatchObject({ subtotal: 10_000, discount: 1000, shippingShare: 1250, saleAmount: 10_250, commission: 1350, net: 8900 });
    expect(s.platformAmount).toBe(41_000 - 28_050 - 8900);
    expect(s.house).toBeNull();
  });

  it("allocates a product coupon by the lines' coupon shares when present", () => {
    // Only B's line had the coupon.
    const lines = [line({ vendorId: "A", price: 30_000 }), line({ vendorId: "B", price: 10_000, discount: 952 })];
    const s = splitOrder(lines, { subtotal: 40_000, discount: 1000, shipping: 0, total: 39_000 }, bps({}));
    expect(s.vendors[0]!.discount).toBe(0);
    expect(s.vendors[1]!.discount).toBe(1000);
  });

  it("reconciles odd paise exactly (thirds)", () => {
    const lines = [line({ vendorId: "A", price: 3333 }), line({ vendorId: "B", price: 3333 }), line({ vendorId: "C", price: 3334 })];
    const s = splitOrder(lines, { subtotal: 10_000, discount: 1001, shipping: 4999, total: 13_998 }, bps({}));
    expect(sum(s.vendors.map((v) => v.discount))).toBe(1001);
    expect(sum(s.vendors.map((v) => v.shippingShare))).toBe(4999);
    expect(sum(s.vendors.map((v) => v.subtotal))).toBe(10_000);
  });

  it("reconciles fractional quantities to the order subtotal", () => {
    // 0.333 kg × ₹100.01 = 3330.333 → 3330; the order says 3331 (rounded differently upstream)
    const lines = [line({ vendorId: "A", qty: 0.333, price: 10_001 }), line({ vendorId: "B", qty: 1.5, price: 999 })];
    const s = splitOrder(lines, { subtotal: 3331 + 1499, discount: 0, shipping: 0, total: 4830 }, bps({}));
    expect(sum(s.vendors.map((v) => v.subtotal))).toBe(4830);
  });

  it("free shipping and zero-value goods still split exactly", () => {
    const lines = [line({ vendorId: "A", price: 0 }), line({ vendorId: "B", price: 0 })];
    const s = splitOrder(lines, { subtotal: 0, discount: 0, shipping: 5001, total: 5001 }, bps({}));
    expect(s.vendors.map((v) => v.shippingShare)).toEqual([2501, 2500]);
    expect(s.vendors.every((v) => v.commission === 0)).toBe(true);
  });

  it("commission is on goods only and clamps bad rates", () => {
    const s = splitOrder([line({ vendorId: "A", price: 10_000 })], { subtotal: 10_000, discount: 0, shipping: 10_000, total: 20_000 }, () => 20_000);
    expect(s.vendors[0]).toMatchObject({ commissionBps: 10_000, commission: 10_000, saleAmount: 20_000, net: 10_000 });
    const neg = splitOrder([line({ vendorId: "A" })], { subtotal: 10_000, discount: 0, shipping: 0, total: 10_000 }, () => -5);
    expect(neg.vendors[0]!.commission).toBe(0);
  });

  it("an empty order has no parts", () => {
    expect(splitOrder([], { subtotal: 0, discount: 0, shipping: 0, total: 0 }, () => 0)).toEqual({ vendors: [], house: null, platformAmount: 0 });
  });

  it("parts always sum to the order totals (randomised)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const vendorsPool = ["A", "B", "C", null];
    for (let i = 0; i < 300; i++) {
      const n = 1 + Math.floor(rnd() * 8);
      const lines = Array.from({ length: n }, (_, j) =>
        line({
          variantId: `v${j}`,
          vendorId: vendorsPool[Math.floor(rnd() * vendorsPool.length)]!,
          qty: 1 + Math.floor(rnd() * 3),
          price: Math.floor(rnd() * 500_000),
          discount: rnd() < 0.3 ? Math.floor(rnd() * 1000) : 0,
        }),
      );
      const subtotal = sum(lines.map((l) => l.qty * l.price));
      const discount = Math.floor(rnd() * subtotal * 0.3);
      const shipping = Math.floor(rnd() * 20_000);
      const total = subtotal - discount + shipping + Math.floor(rnd() * 5000);
      const s = splitOrder(lines, { subtotal, discount, shipping, total }, () => Math.floor(rnd() * 3000));
      const parts = [...s.vendors, ...(s.house ? [s.house] : [])];
      expect(sum(parts.map((p) => p.subtotal))).toBe(subtotal);
      expect(sum(parts.map((p) => p.discount))).toBe(discount);
      expect(sum(parts.map((p) => p.shippingShare))).toBe(shipping);
      expect(sum(s.vendors.map((v) => v.net)) + s.platformAmount).toBe(total);
      for (const v of s.vendors) {
        expect(v.net).toBe(v.subtotal - v.discount + v.shippingShare - v.commission);
        expect(v.commission).toBe(commissionOf(v.subtotal - v.discount, v.commissionBps));
      }
      expect(sum(parts.map((p) => p.lines.length))).toBe(n);
    }
  });
});

describe("settlement eligibility (IST)", () => {
  it("is eligible from 00:00 IST the day after the window", () => {
    // Delivered 15 Oct 2026 10:00 IST (04:30Z); 7 days → returns through 22 Oct; payable 23 Oct 00:00 IST.
    expect(eligibleAtFor(new Date("2026-10-15T04:30:00Z"), 7).toISOString()).toBe("2026-10-22T18:30:00.000Z");
    // Delivered 15 Oct 23:50 IST (18:20Z) is still the 15th in IST.
    expect(eligibleAtFor(new Date("2026-10-15T18:20:00Z"), 7).toISOString()).toBe("2026-10-22T18:30:00.000Z");
    // Delivered 16 Oct 00:10 IST (15 Oct 18:40Z) is the 16th in IST.
    expect(eligibleAtFor(new Date("2026-10-15T18:40:00Z"), 7).toISOString()).toBe("2026-10-23T18:30:00.000Z");
    expect(eligibleAtFor(new Date("2026-10-15T04:30:00Z"), 1).toISOString()).toBe("2026-10-16T18:30:00.000Z");
  });
  it("a 0-day window is payable at delivery", () => {
    const d = new Date("2026-10-15T04:30:00Z");
    expect(eligibleAtFor(d, 0)).toBe(d);
  });
  it("istDateOf", () => {
    expect(istDateOf(new Date("2026-03-31T18:29:59Z"))).toBe("2026-03-31");
    expect(istDateOf(new Date("2026-03-31T18:30:00Z"))).toBe("2026-04-01");
  });

  const state = (over: Partial<VendorOrderState> = {}): VendorOrderState => ({
    status: "placed",
    settlementStatus: "pending",
    deliveredAt: null,
    eligibleAt: null,
    ...over,
  });
  const NOW = new Date("2026-10-15T06:00:00Z");

  it("follows the order up to delivered and fixes the eligibility date", () => {
    const shipped = planVendorOrderUpdate(state(), { status: "shipped", deliveredAt: null }, 7, NOW);
    expect(shipped).toMatchObject({ changed: true, reverseLedger: false, next: { status: "shipped", eligibleAt: null } });
    const delivered = planVendorOrderUpdate(shipped.next, { status: "delivered", deliveredAt: new Date("2026-10-15T04:30:00Z") }, 7, NOW);
    expect(delivered.next.deliveredAt?.toISOString()).toBe("2026-10-15T04:30:00.000Z");
    expect(delivered.next.eligibleAt?.toISOString()).toBe("2026-10-22T18:30:00.000Z");
    // Repeated sync is a no-op
    expect(planVendorOrderUpdate(delivered.next, { status: "delivered", deliveredAt: new Date("2026-10-15T04:30:00Z") }, 7, NOW).changed).toBe(false);
    // A later settings change doesn't move a fixed date
    expect(planVendorOrderUpdate(delivered.next, { status: "delivered", deliveredAt: null }, 30, NOW).changed).toBe(false);
  });

  it("uses now when the order has no delivery time", () => {
    const p = planVendorOrderUpdate(state({ status: "shipped" }), { status: "delivered", deliveredAt: null }, 0, NOW);
    expect(p.next.deliveredAt).toBe(NOW);
    expect(p.next.eligibleAt).toBe(NOW);
  });

  it("cancel/return before eligibility reverses without ledger entries", () => {
    const p = planVendorOrderUpdate(state({ status: "delivered", deliveredAt: NOW, eligibleAt: NOW }), { status: "returned", deliveredAt: NOW }, 7, NOW);
    expect(p).toMatchObject({ reverseLedger: false, next: { settlementStatus: "reversed", eligibleAt: null, status: "returned" } });
    const c = planVendorOrderUpdate(state(), { status: "cancelled", deliveredAt: null }, 7, NOW);
    expect(c.next.settlementStatus).toBe("reversed");
    expect(c.reverseLedger).toBe(false);
  });

  it("a return after the sale was credited (eligible or settled) reverses the ledger once", () => {
    for (const settlementStatus of ["eligible", "settled"] as const) {
      const p = planVendorOrderUpdate(state({ status: "delivered", settlementStatus, deliveredAt: NOW, eligibleAt: NOW }), { status: "returned", deliveredAt: NOW }, 7, NOW);
      expect(p.reverseLedger).toBe(true);
      expect(p.next.settlementStatus).toBe("reversed");
      expect(p.next.eligibleAt).toBe(NOW);
      const again = planVendorOrderUpdate(p.next, { status: "returned", deliveredAt: NOW }, 7, NOW);
      expect(again).toMatchObject({ changed: false, reverseLedger: false });
    }
  });

  it("isSettlementEligible", () => {
    const at = new Date("2026-10-22T18:30:00Z");
    const vo = state({ status: "delivered", eligibleAt: at });
    expect(isSettlementEligible(vo, new Date(at.getTime() - 1))).toBe(false);
    expect(isSettlementEligible(vo, at)).toBe(true);
    expect(isSettlementEligible({ ...vo, settlementStatus: "eligible" }, at)).toBe(false);
    expect(isSettlementEligible({ ...vo, status: "returned" }, at)).toBe(false);
    expect(isSettlementEligible({ ...vo, eligibleAt: null }, at)).toBe(false);
  });
});

describe("ledger", () => {
  const vo = { subtotal: 30_000, discount: 3000, shippingShare: 3750, commission: 2700, orderNumber: "ORD/26-27/0001" };

  it("sale entries credit the sale and debit the commission", () => {
    const e = saleEntries(vo);
    expect(e.map((x) => [x.type, x.amount])).toEqual([
      ["sale", 30_750],
      ["commission", -2700],
    ]);
    expect(sum(e.map((x) => x.amount))).toBe(28_050);
    expect(saleEntries({ ...vo, commission: 0 })).toHaveLength(1);
  });

  it("reversal entries cancel the sale entries exactly", () => {
    const all = [...saleEntries(vo), ...reversalEntries(vo)];
    expect(sum(all.map((x) => x.amount))).toBe(0);
    expect(reversalEntries(vo).every((e) => e.refType === "vendor_order_reversal")).toBe(true);
  });

  it("ledgerBalance sums by type", () => {
    const b = ledgerBalance([
      { type: "sale", amount: 30_750 },
      { type: "commission", amount: -2700 },
      { type: "sale", amount: 10_000 },
      { type: "commission", amount: -1000 },
      { type: "refund", amount: -10_000 },
      { type: "commission", amount: 1000 },
      { type: "payout", amount: -20_000 },
      { type: "adjustment", amount: 500 },
    ]);
    expect(b).toEqual({ balance: 8550, sales: 40_750, commission: -2700, refunds: -10_000, payouts: -20_000, adjustments: 500 });
    expect(ledgerBalance([])).toEqual({ balance: 0, sales: 0, commission: 0, refunds: 0, payouts: 0, adjustments: 0 });
  });

  it("balancesByVendor", () => {
    const m = balancesByVendor([
      { vendorId: "A", amount: 100 },
      { vendorId: "B", amount: 50 },
      { vendorId: "A", amount: -30 },
    ]);
    expect(Object.fromEntries(m)).toEqual({ A: 70, B: 50 });
  });
});

describe("planPayouts", () => {
  const c = (over: Partial<PayoutCandidate>): PayoutCandidate => ({
    vendorId: "A",
    balance: 100_000,
    vendorStatus: "active",
    kycStatus: "verified",
    payoutAccountStatus: "verified",
    accountType: "bank",
    ...over,
  });
  const opts = { minPayoutPaise: 50_000, requireKyc: true, provider: "manual" as const };

  it("pays the whole balance at or above the minimum", () => {
    const p = planPayouts([c({ vendorId: "A", balance: 50_000 }), c({ vendorId: "B", balance: 123_456 })], opts);
    expect(p.pay).toEqual([
      { vendorId: "A", amount: 50_000 },
      { vendorId: "B", amount: 123_456 },
    ]);
    expect(p.skip).toEqual([]);
  });

  it("carries smaller and negative balances over", () => {
    const p = planPayouts([c({ vendorId: "A", balance: 49_999 }), c({ vendorId: "B", balance: -2000 }), c({ vendorId: "C", balance: 0 })], opts);
    expect(p.pay).toEqual([]);
    expect(p.skip).toEqual([
      { vendorId: "A", reason: "below_minimum", balance: 49_999 },
      { vendorId: "B", reason: "nothing_due", balance: -2000 },
      { vendorId: "C", reason: "nothing_due", balance: 0 },
    ]);
  });

  it("a zero minimum still needs a positive balance", () => {
    const p = planPayouts([c({ balance: 1 }), c({ vendorId: "B", balance: 0 })], { ...opts, minPayoutPaise: 0 });
    expect(p.pay).toEqual([{ vendorId: "A", amount: 1 }]);
  });

  it("blocks suspended sellers, missing KYC and unverified accounts", () => {
    const p = planPayouts(
      [
        c({ vendorId: "S", vendorStatus: "suspended" }),
        c({ vendorId: "K", kycStatus: "pending" }),
        c({ vendorId: "N", accountType: null, payoutAccountStatus: "none" }),
        c({ vendorId: "U", payoutAccountStatus: "pending" }),
      ],
      opts,
    );
    expect(p.skip.map((s) => [s.vendorId, s.reason])).toEqual([
      ["S", "vendor_not_active"],
      ["K", "kyc_not_verified"],
      ["N", "no_payout_account"],
      ["U", "no_payout_account"],
    ]);
  });

  it("KYC isn't needed when the setting is off", () => {
    expect(planPayouts([c({ kycStatus: "none" })], { ...opts, requireKyc: false }).pay).toHaveLength(1);
  });

  it("Razorpay Route needs a linked account", () => {
    const p = planPayouts([c({ vendorId: "B", accountType: "bank" }), c({ vendorId: "R", accountType: "route" })], { ...opts, provider: "razorpayRoute" });
    expect(p.pay).toEqual([{ vendorId: "R", amount: 100_000 }]);
    expect(p.skip[0]).toMatchObject({ vendorId: "B", reason: "account_not_supported" });
  });
});

describe("payout accounts", () => {
  it("validates and masks bank accounts", () => {
    const a = payoutAccountSchema.parse({ type: "bank", holderName: "Murugan Stores", accountNumber: "001234567890", ifsc: "sbin0001234" });
    expect(a).toMatchObject({ ifsc: "SBIN0001234" });
    expect(maskPayoutAccount(a)).toEqual({ type: "bank", holderName: "Murugan Stores", ifsc: "SBIN0001234", last4: "7890" });
    expect(JSON.stringify(maskPayoutAccount(a))).not.toContain("001234567890");
  });
  it("masks UPI ids and keeps Route ids", () => {
    const u = payoutAccountSchema.parse({ type: "upi", vpa: "murugan.stores@okaxis" });
    expect(maskPayoutAccount(u)).toEqual({ type: "upi", vpa: "mu************@okaxis", holderName: null });
    const short = payoutAccountSchema.parse({ type: "upi", vpa: "ab@ybl" });
    expect(maskPayoutAccount(short)).toMatchObject({ vpa: "ab***@ybl" });
    const r = payoutAccountSchema.parse({ type: "route", accountId: "acc_ABCDEFGHIJ1234" });
    expect(maskPayoutAccount(r)).toEqual({ type: "route", accountId: "acc_ABCDEFGHIJ1234" });
  });
  it("rejects bad input", () => {
    expect(payoutAccountSchema.safeParse({ type: "bank", holderName: "X Y", accountNumber: "12ab", ifsc: "SBIN0001234" }).success).toBe(false);
    expect(payoutAccountSchema.safeParse({ type: "bank", holderName: "X Y", accountNumber: "123456789", ifsc: "SBIN1001234" }).success).toBe(false);
    expect(payoutAccountSchema.safeParse({ type: "upi", vpa: "nope" }).success).toBe(false);
    expect(payoutAccountSchema.safeParse({ type: "route", accountId: "acc_short" }).success).toBe(false);
    expect(payoutAccountSchema.safeParse({ type: "cash" }).success).toBe(false);
  });
});

describe("vendors", () => {
  it("slugify", () => {
    expect(slugify("Murugan Silks & Sarees")).toBe("murugan-silks-and-sarees");
    expect(slugify("  Café Ünïcode!! ")).toBe("cafe-unicode");
    expect(slugify("முருகன்")).toBeNull();
    expect(slugify("a")).toBeNull();
    expect(slugify("x".repeat(80))!.length).toBe(60);
  });
  it("uniqueSlug", () => {
    expect(uniqueSlug("murugan", new Set())).toBe("murugan");
    expect(uniqueSlug("murugan", new Set(["murugan", "murugan-2"]))).toBe("murugan-3");
    const long = "x".repeat(60);
    const u = uniqueSlug(long, new Set([long]));
    expect(u.length).toBeLessThanOrEqual(60);
    expect(u.endsWith("-2")).toBe(true);
  });
  it("vendor status moves", () => {
    expect(canSetVendorStatus("pending", "active")).toBe(true);
    expect(canSetVendorStatus("suspended", "active")).toBe(true);
    expect(canSetVendorStatus("active", "suspended")).toBe(true);
    expect(canSetVendorStatus("pending", "suspended")).toBe(true);
    expect(canSetVendorStatus("active", "active")).toBe(false);
    expect(canSetVendorStatus("active", "pending")).toBe(false);
  });

  const m = (vendorId: string, slug: string) => ({ vendorId, slug, name: slug, role: "owner" as const });
  it("pickVendor: only membership, header by id or slug", () => {
    expect(pickVendor([])).toMatchObject({ ok: false, reason: "not_a_vendor" });
    expect(pickVendor([m("1", "one")])).toMatchObject({ ok: true, membership: { vendorId: "1" } });
    const two = [m("1", "one"), m("2", "two")];
    expect(pickVendor(two)).toMatchObject({ ok: false, reason: "vendor_required", vendors: [{ id: "1" }, { id: "2" }] });
    expect(pickVendor(two, "2")).toMatchObject({ ok: true, membership: { vendorId: "2" } });
    expect(pickVendor(two, " TWO ")).toMatchObject({ ok: true, membership: { vendorId: "2" } });
    expect(pickVendor(two, "three")).toMatchObject({ ok: false, reason: "unknown_vendor" });
    // A header naming someone else's seller is refused even with a single membership.
    expect(pickVendor([m("1", "one")], "2")).toMatchObject({ ok: false, reason: "unknown_vendor" });
    expect(pickVendor([m("1", "one")], "")).toMatchObject({ ok: true });
  });
});

describe("settings", () => {
  it("defaults match the contract and pass the schema", () => {
    expect(MARKETPLACE_SETTINGS_DEFAULTS).toMatchObject({ defaultCommissionBps: 1000, returnWindowDays: 7, minPayoutPaise: 50_000, requireKyc: true });
    expect(MARKETPLACE_SETTINGS_SCHEMA.parse(MARKETPLACE_SETTINGS_DEFAULTS)).toEqual(MARKETPLACE_SETTINGS_DEFAULTS);
  });
  it("resolveSettings fills missing and invalid values", () => {
    expect(resolveSettings(null)).toEqual(MARKETPLACE_SETTINGS_DEFAULTS);
    expect(resolveSettings({ returnWindowDays: 3, minPayoutPaise: -1, payoutProvider: "paypal", requireKyc: false })).toEqual({
      ...MARKETPLACE_SETTINGS_DEFAULTS,
      returnWindowDays: 3,
      requireKyc: false,
    });
  });
});
