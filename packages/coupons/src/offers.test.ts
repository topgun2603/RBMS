import { describe, expect, it } from "vitest";
import type { CouponRule } from "./logic";
import {
  evaluateBundle,
  evaluateBxgy,
  evaluateFreeGift,
  evaluateTiered,
  isOfferLive,
  offerLabel,
  offersForProduct,
  priceCartOffers,
  selectOffers,
  type OfferRule,
  type PricingLine,
} from "./offers";
import { offerInputSchema } from "./offers-service";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const GIFT = "44444444-4444-4444-8444-444444444444";
const V = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-10-21T06:00:00Z");

const line = (variant: number, productId: string, unitPrice: number, qty: number, patch: Partial<PricingLine> = {}): PricingLine => ({ variantId: V(variant), productId, unitPrice, qty, ...patch });

const offer = (patch: Partial<OfferRule> & Pick<OfferRule, "kind" | "config">): OfferRule => ({
  id: patch.id ?? `o-${patch.kind}`,
  name: "Offer",
  appliesTo: "all",
  targetIds: [],
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  perCustomerLimit: null,
  channels: ["store"],
  stackable: false,
  combinesWithCoupons: false,
  active: true,
  ...patch,
});

const b2g1 = (patch: Partial<OfferRule> = {}) => offer({ kind: "bxgy", config: { buyQty: 2, getQty: 1, getPercent: 100 }, ...patch });

const coupon = (patch: Partial<CouponRule> = {}): CouponRule => ({
  id: "c1",
  code: "SAVE10",
  type: "percent",
  value: 10,
  maxDiscount: null,
  minOrder: 0,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  perCustomerLimit: null,
  firstOrderOnly: false,
  appliesTo: "all",
  targetIds: [],
  channels: ["store"],
  active: true,
  ...patch,
});

describe("buy X get Y", () => {
  it("gives the cheapest unit free", () => {
    const lines = [line(1, P1, 50000, 1), line(2, P2, 30000, 1), line(3, P3, 20000, 1)];
    const o = evaluateBxgy(b2g1(), lines);
    expect(o.discount).toBe(20000);
    expect(o.lineDiscounts).toEqual([0, 0, 20000]);
    expect(o.applications).toBe(1);
    expect(o.nudge).toBeNull();
  });

  it("counts units within one line and repeats per group", () => {
    const o = evaluateBxgy(b2g1(), [line(1, P1, 10000, 7)]);
    // 7 units → 2 groups → 2 free.
    expect(o.discount).toBe(20000);
    expect(o.applications).toBe(2);
    // 7 % 3 = 1 → add 2 more for the next free one.
    expect(o.nudge).toMatchObject({ addQty: 2, reward: { type: "units", qty: 1, percent: 100 } });
  });

  it("nudges before the first reward: add 1 more to get 1 free", () => {
    const o = evaluateBxgy(b2g1(), [line(1, P1, 10000, 2)]);
    expect(o.discount).toBe(0);
    expect(o.nudge?.addQty).toBe(1);
  });

  it("honours percent rewards with rounding, scope and max applications", () => {
    const rule = b2g1({ appliesTo: "categories", targetIds: [CAT], config: { buyQty: 1, getQty: 1, getPercent: 50, maxApplications: 1 } });
    const lines = [line(1, P1, 999, 2, { categoryId: CAT }), line(2, P2, 333, 2, { categoryId: CAT }), line(3, P3, 1, 5)];
    const o = evaluateBxgy(rule, lines);
    // 4 in-scope units, 2 sets but capped at 1 → the cheapest (333) at 50% = 166.5 → 167.
    expect(o.lineDiscounts).toEqual([0, 167, 0]);
    expect(o.nudge).toBeNull();
  });

  it("ignores fractional units (loose items)", () => {
    expect(evaluateBxgy(b2g1(), [line(1, P1, 10000, 2.5)]).discount).toBe(0);
  });
});

describe("tiered offers", () => {
  const tiers = (basis: "qty" | "amount") =>
    offer({
      kind: "tiered",
      config: {
        basis,
        tiers:
          basis === "qty"
            ? [
                { min: 3, type: "percent", value: 10 },
                { min: 5, type: "percent", value: 15 },
              ]
            : [
                { min: 99900, type: "flat", value: 10000 },
                { min: 199900, type: "percent", value: 10 },
              ],
      },
    });

  it("buy 3+ get 10% off, spread over the lines", () => {
    const o = evaluateTiered(tiers("qty"), [line(1, P1, 33333, 2), line(2, P2, 10001, 1)]);
    // eligible 76667 → 10% = 7666.7 → 7667, split by amount.
    expect(o.discount).toBe(7667);
    expect(o.lineDiscounts.reduce((s, v) => s + v, 0)).toBe(7667);
    expect(o.nudge).toMatchObject({ addQty: 2, reward: { type: "percent", value: 15 } });
  });

  it("spend tiers: flat below, percent above, nudge with the amount", () => {
    const below = evaluateTiered(tiers("amount"), [line(1, P1, 50000, 1)]);
    expect(below.discount).toBe(0);
    expect(below.nudge).toMatchObject({ addAmount: 49900, reward: { type: "flat", value: 10000 } });
    const first = evaluateTiered(tiers("amount"), [line(1, P1, 120000, 1)]);
    expect(first.discount).toBe(10000);
    expect(first.nudge?.addAmount).toBe(79900);
    const top = evaluateTiered(tiers("amount"), [line(1, P1, 250000, 1)]);
    expect(top.discount).toBe(25000);
    expect(top.nudge).toBeNull();
  });

  it("flat tier never exceeds the eligible amount", () => {
    const o = evaluateTiered(offer({ kind: "tiered", config: { basis: "qty", tiers: [{ min: 1, type: "flat", value: 99999 }] } }), [line(1, P1, 500, 1)]);
    expect(o.discount).toBe(500);
  });
});

describe("free gift", () => {
  const gift = offer({ kind: "free_gift", config: { minAmount: 99900, giftProductId: GIFT, giftVariantId: V(9), giftQty: 1 } });

  it("is free once the spend (without the gift) is reached", () => {
    const o = evaluateFreeGift(gift, [line(1, P1, 100000, 1), line(9, GIFT, 15000, 2)]);
    expect(o.lineDiscounts).toEqual([0, 15000]);
    expect(o.gift).toMatchObject({ unlocked: true, inCart: true, remaining: 0 });
  });

  it("the gift doesn't count towards the threshold; nudges with what's left", () => {
    const o = evaluateFreeGift(gift, [line(1, P1, 90000, 1), line(9, GIFT, 15000, 1)]);
    expect(o.discount).toBe(0);
    expect(o.nudge).toMatchObject({ addAmount: 9900, reward: { type: "gift", variantId: V(9) } });
    expect(o.gift).toMatchObject({ unlocked: false, inCart: true, remaining: 9900 });
  });

  it("tells the cart to add the gift when it's unlocked but missing", () => {
    const o = evaluateFreeGift(gift, [line(1, P1, 100000, 1)]);
    expect(o.discount).toBe(0);
    expect(o.gift).toMatchObject({ unlocked: true, inCart: false });
  });
});

describe("bundles", () => {
  const combo = (priceType: "fixed" | "percent", value: number) =>
    offer({
      kind: "bundle",
      config: {
        priceType,
        value,
        items: [
          { productId: P1, variantId: null, qty: 1 },
          { productId: P2, variantId: V(2), qty: 1 },
        ],
      },
    });

  it("fixed price: the saving is spread over the set by price", () => {
    const o = evaluateBundle(combo("fixed", 100000), [line(1, P1, 80000, 1), line(2, P2, 40000, 1)]);
    expect(o.discount).toBe(20000);
    expect(o.lineDiscounts).toEqual([13333, 6667]);
    expect(o.applications).toBe(1);
  });

  it("counts complete sets only, any variant matches by product", () => {
    const o = evaluateBundle(combo("percent", 10), [line(1, P1, 10000, 3), line(5, P1, 20000, 1), line(2, P2, 5000, 2)]);
    // 2 sets: (P1 v1 + P2) twice → 10% of 15000 each.
    expect(o.applications).toBe(2);
    expect(o.discount).toBe(3000);
  });

  it("a specific variant must match exactly; nudges with the missing products", () => {
    const o = evaluateBundle(combo("fixed", 100000), [line(1, P1, 80000, 1), line(3, P2, 40000, 1)]);
    expect(o.discount).toBe(0);
    expect(o.nudge).toMatchObject({ reward: { type: "bundle" }, productIds: [P2], addQty: 1 });
  });

  it("a fixed price above the regular price saves nothing", () => {
    expect(evaluateBundle(combo("fixed", 999999), [line(1, P1, 100, 1), line(2, P2, 100, 1)]).discount).toBe(0);
  });
});

describe("combining offers", () => {
  const lines = [line(1, P1, 50000, 1), line(2, P2, 30000, 1), line(3, P3, 20000, 1)];

  it("best single offer wins by default", () => {
    const a = evaluateBxgy(b2g1({ id: "a" }), lines); // 20000
    const t = evaluateTiered(offer({ id: "t", kind: "tiered", config: { basis: "qty", tiers: [{ min: 3, type: "percent", value: 25 }] } }), lines); // 25000
    const s = selectOffers([a, t], lines);
    expect(s.applied.map((o) => o.offerId)).toEqual(["t"]);
    expect(s.discount).toBe(25000);
  });

  it("stackable offers add up on what's left of each line", () => {
    const a = evaluateBxgy(b2g1({ id: "a", stackable: true }), lines);
    const t = evaluateTiered(offer({ id: "t", stackable: true, kind: "tiered", config: { basis: "qty", tiers: [{ min: 3, type: "percent", value: 25 }] } }), lines);
    const s = selectOffers([a, t], lines);
    expect(s.applied).toHaveLength(2);
    // Line 3 is free from BxGy → its 25% share (5000) can't apply on top.
    expect(s.lineDiscounts).toEqual([12500, 7500, 20000]);
    expect(s.discount).toBe(40000);
  });
});

describe("priceCartOffers with a coupon", () => {
  const lines = [line(1, P1, 50000, 1), line(2, P2, 30000, 1), line(3, P3, 20000, 1)];
  const base = { channel: "store", lines, now: NOW };

  it("no coupon: offers only, with explanations per line", () => {
    const r = priceCartOffers({ ...base, offers: [b2g1()] });
    expect(r.offerDiscount).toBe(20000);
    expect(r.lines[2]).toMatchObject({ offerDiscount: 20000, offerIds: ["o-bxgy"] });
    expect(r.coupon).toBeNull();
    expect(r.discount).toBe(20000);
  });

  it("coupons stack only when every applied offer allows it (coupon on the discounted amounts)", () => {
    const r = priceCartOffers({ ...base, offers: [b2g1({ combinesWithCoupons: true })], coupon: { code: "SAVE10", rule: coupon(), usage: { total: 0, byCustomer: 0 } } });
    expect(r.offerDiscount).toBe(20000);
    expect(r.couponDiscount).toBe(8000); // 10% of 80000
    expect(r.discount).toBe(28000);
    expect(r.lineDiscounts.reduce((s, v) => s + v, 0)).toBe(28000);
  });

  it("best for the customer: a bigger coupon replaces a non-combinable offer", () => {
    const r = priceCartOffers({ ...base, offers: [b2g1()], coupon: { code: "BIG", rule: coupon({ value: 30 }), usage: { total: 0, byCustomer: 0 } } });
    expect(r.offers).toHaveLength(0);
    expect(r.couponDiscount).toBe(30000);
    expect(r.coupon?.valid).toBe(true);
  });

  it("a smaller coupon loses to a non-combinable offer: not_combinable", () => {
    const r = priceCartOffers({ ...base, offers: [b2g1()], coupon: { code: "SAVE10", rule: coupon(), usage: { total: 0, byCustomer: 0 } } });
    expect(r.offerDiscount).toBe(20000);
    expect(r.coupon).toMatchObject({ valid: false, reason: "not_combinable" });
    expect(r.couponDiscount).toBe(0);
  });

  it("free-shipping coupons always combine", () => {
    const r = priceCartOffers({ ...base, shipping: 5000, offers: [b2g1()], coupon: { code: "SHIPFREE", rule: coupon({ type: "free_shipping", value: 0 }), usage: { total: 0, byCustomer: 0 } } });
    expect(r.offerDiscount).toBe(20000);
    expect(r.freeShipping).toBe(true);
    expect(r.shippingDiscount).toBe(5000);
  });

  it("an unknown coupon is reported and offers still apply", () => {
    const r = priceCartOffers({ ...base, offers: [b2g1()], coupon: { code: "NOPE", rule: null, usage: { total: 0, byCustomer: 0 } } });
    expect(r.coupon).toMatchObject({ valid: false, reason: "not_found" });
    expect(r.offerDiscount).toBe(20000);
  });

  it("skips offers that are off, out of dates, other channels or used up", () => {
    const off = b2g1({ id: "off", active: false });
    const later = b2g1({ id: "later", startsAt: new Date("2026-11-01T00:00:00Z") });
    const pos = b2g1({ id: "pos", channels: ["pos"] });
    const used = b2g1({ id: "used", usageLimit: 5 });
    const r = priceCartOffers({ ...base, offers: [off, later, pos, used], offerUsage: new Map([["used", { total: 5, byCustomer: 0 }]]) });
    expect(r.discount).toBe(0);
    expect(isOfferLive(used, { channel: "store", now: NOW }, { total: 4, byCustomer: 0 })).toBe(true);
    expect(isOfferLive(b2g1({ perCustomerLimit: 1 }), { channel: "store", now: NOW, customerKey: "acct:1" }, { total: 1, byCustomer: 1 })).toBe(false);
  });

  it("collection scope uses the lines' collections", () => {
    const rule = b2g1({ appliesTo: "collections", targetIds: [COL] });
    const inCol = lines.map((l) => ({ ...l, collectionIds: [COL] }));
    expect(priceCartOffers({ ...base, lines: inCol, offers: [rule] }).discount).toBe(20000);
    expect(priceCartOffers({ ...base, offers: [rule] }).discount).toBe(0);
  });

  it("gifts and nudges come back for the cart", () => {
    const gift = offer({ kind: "free_gift", config: { minAmount: 150000, giftProductId: GIFT, giftVariantId: V(9), giftQty: 1 } });
    const r = priceCartOffers({ ...base, offers: [gift, b2g1({ config: { buyQty: 3, getQty: 1, getPercent: 100 } })] });
    expect(r.gifts[0]).toMatchObject({ unlocked: false, remaining: 50000 });
    expect(r.nudges.map((n) => n.kind).sort()).toEqual(["bxgy", "free_gift"]);
  });
});

describe("labels, product badges and validation", () => {
  it("labels", () => {
    expect(offerLabel(b2g1())).toBe("Buy 2 get 1 free");
    expect(offerLabel({ kind: "tiered", config: { basis: "qty", tiers: [{ min: 3, type: "percent", value: 10 }] } })).toBe("Buy 3+ get 10% off");
    expect(offerLabel({ kind: "free_gift", config: { minAmount: 99900, giftProductId: GIFT, giftVariantId: V(9), giftQty: 1 } })).toBe("Free gift on orders above ₹999");
    expect(offerLabel({ kind: "bundle", config: { priceType: "fixed", value: 49900, items: [] } })).toBe("Combo for ₹499");
  });

  it("offers for a product page", () => {
    const rules = [
      b2g1({ id: "cat", appliesTo: "categories", targetIds: [CAT] }),
      b2g1({ id: "other", appliesTo: "products", targetIds: [P2] }),
      offer({ id: "bun", kind: "bundle", config: { priceType: "percent", value: 10, items: [{ productId: P1, variantId: null, qty: 1 }, { productId: P3, variantId: null, qty: 1 }] } }),
    ];
    expect(offersForProduct(rules, { productId: P1, categoryId: CAT }).map((r) => r.id)).toEqual(["cat", "bun"]);
  });

  it("validates kind-specific config", () => {
    expect(offerInputSchema.safeParse({ kind: "bxgy", name: "B2G1", config: { buyQty: 2, getQty: 1 } }).success).toBe(true);
    const bad = offerInputSchema.safeParse({ kind: "bundle", name: "Combo", config: { priceType: "fixed", value: 100, items: [{ productId: P1, qty: 1 }] } });
    expect(bad.success).toBe(false);
    const tierPct = offerInputSchema.safeParse({ kind: "tiered", name: "T", config: { basis: "qty", tiers: [{ min: 2, type: "percent", value: 120 }] } });
    expect(tierPct.success).toBe(false);
    const scoped = offerInputSchema.safeParse({ kind: "tiered", name: "T", appliesTo: "categories", config: { basis: "qty", tiers: [{ min: 2, type: "percent", value: 10 }] } });
    expect(scoped.success).toBe(false);
    const ok = offerInputSchema.parse({ kind: "bundle", name: "Diwali combo", appliesTo: "products", targetIds: [P1], config: { priceType: "fixed", value: 49900, items: [{ productId: P1 }, { productId: P2, variantId: V(2), qty: 2 }] } });
    expect(ok.appliesTo).toBe("all");
    expect(ok.targetIds).toEqual([]);
    expect((ok.config as { items: unknown[] }).items).toEqual([
      { productId: P1, variantId: null, qty: 1 },
      { productId: P2, variantId: V(2), qty: 2 },
    ]);
  });
});
