import { describe, expect, it } from "vitest";
import type { CartPricingResult, PublicOfferView, StoreProductSummary, StoreVariant } from "./ports";
import { buildPricedCart, estimateTaxExtra, freeShippingState, offerLines, priceLines } from "./pricing";
import { buildBundleView, bundleLines, bundlePrice, bundleRefs, toBadge } from "./promotions";

const P1 = "10000000-0000-4000-8000-000000000001";
const P2 = "20000000-0000-4000-8000-000000000002";
const V1 = "00000000-0000-4000-8000-000000000001";
const V2 = "00000000-0000-4000-8000-000000000002";
const V3 = "00000000-0000-4000-8000-000000000003";

const variant = (id: string, productId: string, over: Partial<StoreVariant> = {}): StoreVariant => ({
  id,
  productId,
  productSlug: `slug-${productId.slice(0, 2)}`,
  productName: `Product ${productId.slice(0, 2)}`,
  title: "",
  categoryId: null,
  price: 50000,
  mrp: null,
  image: null,
  weightGrams: 100,
  taxInclusive: true,
  gstRate: 5,
  status: "active",
  channels: ["store"],
  ...over,
});
const product = (id: string, over: Partial<StoreProductSummary> = {}): StoreProductSummary => ({
  id,
  name: `Product ${id.slice(0, 2)}`,
  slug: `slug-${id.slice(0, 2)}`,
  image: null,
  priceMin: 50000,
  priceMax: 50000,
  mrp: null,
  status: "active",
  channels: ["store"],
  variantIds: [],
  ...over,
});
const bundleOffer = (over: Partial<PublicOfferView> = {}, config: Record<string, unknown> = {}): PublicOfferView => ({
  id: "b1",
  kind: "bundle",
  name: "Pooja combo",
  description: null,
  slug: "pooja-combo",
  imageUrl: null,
  label: "Combo for ₹799",
  config: {
    priceType: "fixed",
    value: 79900,
    items: [
      { productId: P1, variantId: V1, qty: 1 },
      { productId: P2, variantId: null, qty: 1 },
    ],
    ...config,
  },
  appliesTo: "all",
  endsAt: null,
  ...over,
});

describe("bundle views", () => {
  const products = new Map([
    [P1, product(P1, { variantIds: [V1] })],
    [P2, product(P2, { priceMin: 30000, priceMax: 40000, variantIds: [V2, V3] })],
  ]);
  const variants = new Map([
    [V1, variant(V1, P1, { price: 60000 })],
    [V2, variant(V2, P2, { price: 30000, title: "Small" })],
    [V3, variant(V3, P2, { price: 40000, title: "Large" })],
  ]);

  it("prices the set from the fixed variant and the cheapest option, with the saving", () => {
    const v = buildBundleView(bundleOffer(), products, variants);
    expect(v.items.map((i) => [i.price, i.options.length, i.available])).toEqual([
      [60000, 1, true],
      [30000, 2, true],
    ]);
    expect(v).toMatchObject({ regular: 90000, price: 79900, save: 10100, available: true });
    expect(bundleRefs([bundleOffer()])).toEqual({ productIds: [P1, P2], variantIds: [V1] });
  });

  it("percent bundles and prices that can't go above the regular price", () => {
    expect(bundlePrice({ priceType: "percent", value: 15 }, 90000)).toBe(76500);
    expect(bundlePrice({ priceType: "fixed", value: 999999 }, 90000)).toBe(90000);
  });

  it("an item off sale makes the bundle unavailable", () => {
    const off = new Map(products).set(P2, product(P2, { status: "draft", variantIds: [V2] }));
    expect(buildBundleView(bundleOffer(), off, variants).available).toBe(false);
  });

  it("lines to add: fixed variants, the shopper's pick, a single option picked for them", () => {
    const v = buildBundleView(bundleOffer(), products, variants);
    expect(bundleLines(v, {})).toEqual({ ok: false, error: { code: "choose_variant", productId: P2 } });
    expect(bundleLines(v, { [P2]: "not-an-option" })).toMatchObject({ ok: false });
    expect(bundleLines(v, { [P2]: V3 }, 2)).toEqual({ ok: true, lines: [{ variantId: V1, qty: 2 }, { variantId: V3, qty: 2 }] });
    const single = buildBundleView(bundleOffer(), new Map(products).set(P2, product(P2, { variantIds: [V2] })), variants);
    expect(bundleLines(single, {})).toEqual({ ok: true, lines: [{ variantId: V1, qty: 1 }, { variantId: V2, qty: 1 }] });
  });

  it("badges keep what the store translates", () => {
    expect(toBadge({ ...bundleOffer(), kind: "bxgy", label: "Buy 2 get 1 free", config: { buyQty: 2, getQty: 1, getPercent: 100 } })).toMatchObject({ kind: "bxgy", label: "Buy 2 get 1 free", config: { buyQty: 2 } });
  });
});

describe("cart pricing with offers", () => {
  const variants = [variant(V1, P1, { price: 50000 }), variant(V2, P2, { price: 30000, taxInclusive: false, gstRate: 18 }), variant(V3, P2, { status: "draft" })];
  const priced = () => priceLines([{ variantId: V1, qty: 2 }, { variantId: V3, qty: 1 }, { variantId: V2, qty: 1 }], variants, []);
  const pricing: CartPricingResult = {
    // Two available lines (V1, V2) in order; V3 is unavailable and skipped.
    lines: [
      { offerDiscount: 0, couponDiscount: 10000, discount: 10000, offerIds: [] },
      { offerDiscount: 30000, couponDiscount: 0, discount: 30000, offerIds: ["o1"] },
    ],
    offers: [{ offerId: "o1", kind: "bxgy", name: "B2G1", label: "Buy 2 get 1 free", discount: 30000, applications: 1 }],
    offerDiscount: 30000,
    coupon: { valid: true, couponId: "c1", discount: 10000, freeShipping: false },
    couponDiscount: 10000,
    freeShipping: false,
    nudges: [{ offerId: "t1", kind: "tiered", name: "Spend more", label: "Spend ₹2,000 get 10% off", addAmount: 70000, reward: { type: "percent", value: 10 } }],
    gifts: [],
  };

  it("sends only available lines to offers", () => {
    expect(offerLines(priced().calcs).map((l) => l.variantId)).toEqual([V1, V2]);
  });

  it("maps line discounts back, totals = subtotal − offers − coupon, GST estimate per line", () => {
    const cart = buildPricedCart({ token: "t", priced: priced(), coupon: { code: "SAVE", result: null }, pincode: null, delivery: null, pricing, freeShipping: { threshold: 99900, scope: "shop" } });
    expect(cart.subtotal).toBe(130000);
    expect(cart.offerDiscount).toBe(30000);
    expect(cart.discount).toBe(10000);
    expect(cart.total).toBe(90000);
    expect(cart.lines[2]).toMatchObject({ variantId: V2, offerDiscount: 30000, offerIds: ["o1"] });
    expect(cart.lines[0]!.offerDiscount).toBeUndefined();
    expect(cart.offers).toEqual([{ id: "o1", kind: "bxgy", name: "B2G1", label: "Buy 2 get 1 free", discount: 30000, applications: 1 }]);
    expect(cart.coupon).toMatchObject({ code: "SAVE", valid: true });
    // The free exclusive-GST line adds no tax.
    expect(cart.taxExtra).toBe(0);
    expect(cart.nudges[0]).toMatchObject({ addAmount: 70000 });
    expect(cart.freeShipping).toEqual({ threshold: 99900, remaining: 9900, unlocked: false, scope: "shop" });
  });

  it("a coupon beaten by an offer is reported invalid", () => {
    const beaten = { ...pricing, coupon: { valid: false as const, reason: "not_combinable" }, couponDiscount: 0, lines: pricing.lines.map((l) => ({ ...l, couponDiscount: 0, discount: l.offerDiscount })) };
    const cart = buildPricedCart({ token: "t", priced: priced(), coupon: { code: "SAVE", result: null }, pincode: null, delivery: null, pricing: beaten });
    expect(cart.coupon).toEqual({ code: "SAVE", valid: false, reason: "not_combinable", freeShipping: false });
    expect(cart.warnings).toContain("coupon_invalid");
    expect(cart.total).toBe(100000);
  });

  it("free-shipping state", () => {
    expect(freeShippingState(null, 100, false)).toBeNull();
    expect(freeShippingState({ threshold: null, scope: "shop" }, 100, false)).toBeNull();
    expect(freeShippingState({ threshold: 0, scope: "shop" }, 100, false)).toMatchObject({ unlocked: true, remaining: 0 });
    expect(freeShippingState({ threshold: 50000, scope: "zone" }, 60000, false)).toMatchObject({ unlocked: true });
    expect(freeShippingState(null, 100, true)).toMatchObject({ unlocked: true });
  });

  it("estimateTaxExtra uses each line's own discount when given", () => {
    const p = priced();
    expect(estimateTaxExtra(p.calcs, 0, [0, 0, 10000])).toBe(Math.round((30000 - 10000) * 0.18));
    expect(estimateTaxExtra(p.calcs, 0)).toBe(5400);
  });
});
