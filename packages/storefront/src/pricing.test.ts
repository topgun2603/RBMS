import { describe, expect, it } from "vitest";
import type { StoreVariant, VariantAvailability } from "./ports";
import {
  buildPricedCart,
  clampQty,
  couponContext,
  estimateTaxExtra,
  MAX_CART_LINES,
  mergeCartLines,
  priceLines,
  setCartLine,
} from "./pricing";

const V1 = "00000000-0000-4000-8000-000000000001";
const V2 = "00000000-0000-4000-8000-000000000002";
const V3 = "00000000-0000-4000-8000-000000000003";

const variant = (id: string, over: Partial<StoreVariant> = {}): StoreVariant => ({
  id,
  productId: `p-${id.slice(-1)}`,
  productSlug: `product-${id.slice(-1)}`,
  productName: `Product ${id.slice(-1)}`,
  title: "M / Red",
  categoryId: "cat-1",
  price: 49900,
  mrp: 59900,
  image: "https://img/x.jpg",
  weightGrams: 250,
  taxInclusive: true,
  gstRate: 5,
  status: "active",
  channels: ["store", "billing"],
  ...over,
});
const stock = (itemId: string, available: number, tracked = true): VariantAvailability => ({ itemId, available, tracked });

const build = (lines: Parameters<typeof priceLines>[0], variants: StoreVariant[], avail: VariantAvailability[] = [], coupon: Parameters<typeof buildPricedCart>[0]["coupon"] = null) =>
  buildPricedCart({ token: "tok", priced: priceLines(lines, variants, avail), coupon, pincode: null, delivery: null });

describe("priceLines / buildPricedCart", () => {
  it("prices available lines at the current (tax-inclusive) price", () => {
    const cart = build([{ variantId: V1, qty: 2, price: 49900 }, { variantId: V2, qty: 1 }], [variant(V1), variant(V2, { price: 19900 })]);
    expect(cart.lines.map((l) => [l.variantId, l.qty, l.lineTotal, l.available, l.problem])).toEqual([
      [V1, 2, 99800, true, undefined],
      [V2, 1, 19900, true, undefined],
    ]);
    expect(cart.subtotal).toBe(119700);
    expect(cart.itemCount).toBe(3);
    expect(cart.discount).toBe(0);
    expect(cart.total).toBe(119700);
    expect(cart.taxExtra).toBe(0);
    expect(cart.weightGrams).toBe(750);
    expect(cart.warnings).toEqual([]);
    expect(cart.lines[0]).toMatchObject({ productSlug: "product-1", name: "Product 1", variantTitle: "M / Red", mrp: 59900, maxQty: 99 });
  });

  it("empty cart", () => {
    const cart = build([], []);
    expect(cart).toMatchObject({ lines: [], itemCount: 0, subtotal: 0, discount: 0, total: 0, coupon: null, warnings: [] });
  });

  it("empty cart with a coupon reports it unusable (empty_cart) without a discount", () => {
    const cart = build([], [], [], { code: "DIWALI", result: null });
    expect(cart.coupon).toEqual({ code: "DIWALI", valid: false, reason: "empty_cart", freeShipping: false });
    expect(cart.discount).toBe(0);
    expect(cart.warnings).toContain("coupon_invalid");
  });

  it("flags out-of-stock variants unavailable and leaves them out of the totals", () => {
    const cart = build([{ variantId: V1, qty: 2 }, { variantId: V2, qty: 1 }], [variant(V1), variant(V2)], [stock(V1, 0)]);
    expect(cart.lines[0]).toMatchObject({ available: false, problem: "unavailable", lineTotal: 0, maxQty: 0, qty: 2 });
    expect(cart.subtotal).toBe(49900);
    expect(cart.itemCount).toBe(1);
    expect(cart.warnings).toEqual(["items_unavailable"]);
  });

  it("archived, draft and non-store products are unavailable", () => {
    const cart = build(
      [{ variantId: V1, qty: 1 }, { variantId: V2, qty: 1 }, { variantId: V3, qty: 1 }],
      [variant(V1, { status: "archived" }), variant(V2, { status: "draft" }), variant(V3, { channels: ["billing"] })],
    );
    expect(cart.lines.every((l) => !l.available && l.problem === "unavailable")).toBe(true);
    expect(cart.subtotal).toBe(0);
  });

  it("drops lines whose variant no longer exists, with a warning", () => {
    const priced = priceLines([{ variantId: V1, qty: 1 }, { variantId: V2, qty: 1 }], [variant(V1)], []);
    expect(priced.removed).toEqual([V2]);
    const cart = buildPricedCart({ token: "t", priced, coupon: null, pincode: null, delivery: null });
    expect(cart.lines).toHaveLength(1);
    expect(cart.warnings).toEqual(["items_removed"]);
  });

  it("caps qty to tracked availability (qty_reduced); untracked stock is unlimited up to 99", () => {
    const cart = build(
      [{ variantId: V1, qty: 5 }, { variantId: V2, qty: 120 }, { variantId: V3, qty: 3 }],
      [variant(V1), variant(V2), variant(V3)],
      [stock(V1, 2.7), stock(V2, 0, false)],
    );
    expect(cart.lines[0]).toMatchObject({ qty: 2, maxQty: 2, problem: "qty_reduced", lineTotal: 99800 });
    expect(cart.lines[1]).toMatchObject({ qty: 99, maxQty: 99, available: true });
    expect(cart.lines[1]!.problem).toBeUndefined(); // stored qty is clamped to 99 before stock is considered
    expect(cart.lines[2]).toMatchObject({ qty: 3, maxQty: 99 });
    expect(cart.lines[2]!.problem).toBeUndefined();
    expect(cart.warnings).toEqual(["qty_reduced"]);
  });

  it("uses the requested qty (just capped by a PUT) for the flag", () => {
    const priced = priceLines([{ variantId: V1, qty: 2 }], [variant(V1)], [stock(V1, 2)], { requested: new Map([[V1, 5]]) });
    expect(priced.calcs[0]!.line).toMatchObject({ qty: 2, problem: "qty_reduced" });
  });

  it("keeps a line whose price changed since it was added, at the new price, flagged", () => {
    const cart = build([{ variantId: V1, qty: 2, price: 45000 }], [variant(V1, { price: 49900 })]);
    expect(cart.lines[0]).toMatchObject({ price: 49900, lineTotal: 99800, available: true, problem: "price_changed" });
    expect(cart.warnings).toEqual(["prices_changed"]);
  });

  it("qty_reduced wins the line flag but the price change still warns", () => {
    const cart = build([{ variantId: V1, qty: 5, price: 45000 }], [variant(V1)], [stock(V1, 1)]);
    expect(cart.lines[0]!.problem).toBe("qty_reduced");
    expect(cart.warnings).toEqual(["prices_changed", "qty_reduced"]);
  });

  it("applies a valid coupon discount (capped at the subtotal)", () => {
    const cart = build([{ variantId: V1, qty: 1 }], [variant(V1)], [], {
      code: "TEN",
      result: { valid: true, couponId: "c1", discount: 4990, freeShipping: false },
    });
    expect(cart.discount).toBe(4990);
    expect(cart.total).toBe(49900 - 4990);
    expect(cart.coupon).toEqual({ code: "TEN", valid: true, freeShipping: false });

    const big = build([{ variantId: V1, qty: 1 }], [variant(V1)], [], { code: "BIG", result: { valid: true, couponId: "c", discount: 999999, freeShipping: true } });
    expect(big.discount).toBe(49900);
    expect(big.total).toBe(0);
    expect(big.coupon?.freeShipping).toBe(true);
  });

  it("surfaces coupon invalid reasons with no discount", () => {
    for (const reason of ["min_order", "expired", "not_found", "first_order_only", "usage_limit"]) {
      const cart = build([{ variantId: V1, qty: 1 }], [variant(V1)], [], { code: "X", result: { valid: false, reason } });
      expect(cart.coupon).toEqual({ code: "X", valid: false, reason, freeShipping: false });
      expect(cart.discount).toBe(0);
      expect(cart.warnings).toContain("coupon_invalid");
    }
  });

  it("delivery: passes options through and warns when not serviceable", () => {
    const priced = priceLines([{ variantId: V1, qty: 1 }], [variant(V1)], []);
    const ok = buildPricedCart({
      token: "t",
      priced,
      coupon: null,
      pincode: "600001",
      delivery: { serviceable: true, options: [{ id: "r1", name: "Standard", amount: 5000, etaDays: [2, 4], codAllowed: true, codFee: 2000 }] },
    });
    expect(ok.delivery?.options).toHaveLength(1);
    expect(ok.pincode).toBe("600001");
    expect(ok.total).toBe(49900); // shipping is chosen at checkout
    const no = buildPricedCart({ token: "t", priced, coupon: null, pincode: "999999", delivery: { serviceable: false, options: [] } });
    expect(no.warnings).toEqual(["not_serviceable"]);
    const failed = buildPricedCart({ token: "t", priced, coupon: null, pincode: "600001", delivery: null, deliveryFailed: true });
    expect(failed.warnings).toEqual(["delivery_unavailable"]);
  });

  it("estimates GST on top of tax-exclusive lines after the discount", () => {
    const priced = priceLines(
      [{ variantId: V1, qty: 1 }, { variantId: V2, qty: 1 }],
      [variant(V1, { price: 10000, taxInclusive: false, gstRate: 18 }), variant(V2, { price: 10000 })],
      [],
    );
    expect(estimateTaxExtra(priced.calcs, 0)).toBe(1800);
    expect(estimateTaxExtra(priced.calcs, 2000)).toBe(Math.round((10000 - 1000) * 0.18));
  });

  it("couponContext covers only available lines", () => {
    const priced = priceLines([{ variantId: V1, qty: 2 }, { variantId: V2, qty: 1 }], [variant(V1), variant(V2)], [stock(V2, 0)]);
    expect(couponContext(priced.calcs)).toEqual({ subtotal: 99800, lines: [{ productId: "p-1", categoryId: "cat-1", amount: 99800 }] });
  });
});

describe("cart line helpers", () => {
  it("clampQty", () => {
    expect([clampQty(0), clampQty(-3), clampQty(1.9), clampQty(50), clampQty(500), clampQty(Number.NaN)]).toEqual([0, 0, 1, 50, 99, 0]);
  });

  it("setCartLine adds, updates in place and removes", () => {
    let lines = setCartLine([], { variantId: V1, qty: 2, price: 100 });
    lines = setCartLine(lines, { variantId: V2, qty: 1, price: 200 });
    lines = setCartLine(lines, { variantId: V1, qty: 150, price: 120 });
    expect(lines).toEqual([
      { variantId: V1, qty: 99, price: 120 },
      { variantId: V2, qty: 1, price: 200 },
    ]);
    expect(setCartLine(lines, { variantId: V1, qty: 0 })).toEqual([{ variantId: V2, qty: 1, price: 200 }]);
  });

  it("mergeCartLines sums quantities (capped at 99), keeps the shopper's lines first and their price snapshot", () => {
    const merged = mergeCartLines(
      [{ variantId: V1, qty: 60, price: 100 }, { variantId: V2, qty: 1, price: 200 }],
      [{ variantId: V3, qty: 2, price: 300 }, { variantId: V1, qty: 70, price: 90 }, { variantId: V2, qty: 2 }],
    );
    expect(merged).toEqual([
      { variantId: V1, qty: 99, price: 100 },
      { variantId: V2, qty: 3, price: 200 },
      { variantId: V3, qty: 2, price: 300 },
    ]);
  });

  it("mergeCartLines into an empty cart, skipping zero lines, and caps the number of lines", () => {
    expect(mergeCartLines([], [{ variantId: V1, qty: 0 }, { variantId: V2, qty: 4 }])).toEqual([{ variantId: V2, qty: 4, price: null }]);
    const many = Array.from({ length: MAX_CART_LINES + 5 }, (_, i) => ({ variantId: `v${i}`, qty: 1 }));
    expect(mergeCartLines(many.slice(0, 30), many.slice(30))).toHaveLength(MAX_CART_LINES);
  });
});
