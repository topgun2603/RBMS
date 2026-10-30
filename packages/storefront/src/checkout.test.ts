import { AppError } from "@rbms/core";
import { describe, expect, it } from "vitest";
import { normalizeIndianMobile, parseAddress } from "./address";
import { checkoutBodySchema, checkoutError, DEFAULT_STORE_SETTINGS, normalizeStoreSettings, validateCheckout, type CheckoutCheckInput } from "./checkout";
import type { DeliveryQuote } from "./ports";
import type { PricedCart, PricedLine } from "./pricing";
import { RateLimiter } from "./ratelimit";

const line = (over: Partial<PricedLine> = {}): PricedLine => ({
  variantId: "v1",
  productId: "p1",
  productSlug: "p",
  name: "Silk saree",
  variantTitle: "",
  image: null,
  price: 100000,
  mrp: null,
  qty: 1,
  lineTotal: 100000,
  available: true,
  maxQty: 99,
  ...over,
});

const cartOf = (lines: PricedLine[], over: Partial<PricedCart> = {}): PricedCart => {
  const subtotal = lines.filter((l) => l.available).reduce((s, l) => s + l.lineTotal, 0);
  return {
    token: "t",
    lines,
    itemCount: lines.length,
    subtotal,
    discount: 0,
    coupon: null,
    offerDiscount: 0,
    offers: [],
    nudges: [],
    gifts: [],
    freeShipping: null,
    pincode: null,
    delivery: null,
    total: subtotal,
    taxExtra: 0,
    weightGrams: 0,
    warnings: [],
    ...over,
  };
};

const address = {
  name: "Meena",
  phone: "98765 43210",
  line1: "12, Gandhi Street",
  city: "Madurai",
  stateCode: "33",
  pincode: "625001",
};

const quote: DeliveryQuote = {
  serviceable: true,
  options: [
    { id: "std", name: "Standard", amount: 5000, etaDays: [3, 5], codAllowed: true, codFee: 3000 },
    { id: "exp", name: "Express", amount: 12000, etaDays: [1, 2], codAllowed: false, codFee: 0 },
  ],
};

const input = (over: Partial<CheckoutCheckInput> = {}): CheckoutCheckInput => ({
  settings: { ...DEFAULT_STORE_SETTINGS },
  cart: cartOf([line()]),
  address,
  deliveryOptionId: "std",
  quote,
  paymentMethod: "online",
  onlinePaymentsEnabled: true,
  ...over,
});

const codes = (i: CheckoutCheckInput) => {
  const r = validateCheckout(i);
  return r.ok ? [] : r.issues.map((x) => x.code);
};

describe("validateCheckout", () => {
  it("passes a good online checkout with shipping from the option", () => {
    const r = validateCheckout(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan).toMatchObject({ shipping: 5000, codFee: 0, estimatedTotal: 105000 });
    expect(r.plan.address?.phone).toBe("+919876543210");
    expect(r.plan.option?.id).toBe("std");
  });

  it("COD adds the option's COD fee, separately from shipping", () => {
    const r = validateCheckout(input({ paymentMethod: "cod" }));
    expect(r.ok && r.plan).toMatchObject({ shipping: 5000, codFee: 3000, estimatedTotal: 108000 });
  });

  it("a free-shipping coupon waives shipping but the COD fee is still charged", () => {
    const r = validateCheckout(input({ paymentMethod: "cod", cart: cartOf([line()], { coupon: { code: "FREESHIP", valid: true, freeShipping: true } }) }));
    expect(r.ok && r.plan).toMatchObject({ shipping: 5000, codFee: 3000, estimatedTotal: 103000 });
  });

  it("free-shipping coupon waives shipping in the estimate but orders still gets the option amount", () => {
    const r = validateCheckout(input({ cart: cartOf([line()], { coupon: { code: "FREESHIP", valid: true, freeShipping: true } }) }));
    expect(r.ok && r.plan).toMatchObject({ shipping: 5000, estimatedTotal: 100000 });
  });

  it("store closed (409, with the shop's message)", () => {
    const r = validateCheckout(input({ settings: { ...DEFAULT_STORE_SETTINGS, open: false, closedMessage: "Back on Monday" } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]).toMatchObject({ code: "store_closed", message: "Back on Monday" });
    const err = checkoutError(r.issues);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("store_closed");
    expect((err.details as { issues: unknown[] }).issues).toHaveLength(1);
  });

  it("empty cart", () => {
    expect(codes(input({ cart: cartOf([]) }))).toEqual(["cart_empty"]);
  });

  it("unavailable and reduced lines", () => {
    const cart = cartOf([line({ available: false, problem: "unavailable", lineTotal: 0 }), line({ variantId: "v2", problem: "qty_reduced" })]);
    const r = validateCheckout(input({ cart }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => [i.code, i.details])).toEqual([
      ["items_unavailable", ["v1"]],
      ["qty_reduced", ["v2"]],
    ]);
    expect(checkoutError(r.issues).status).toBe(400);
  });

  it("price changes alone don't block (prices are re-read)", () => {
    expect(codes(input({ cart: cartOf([line({ problem: "price_changed" })]) }))).toEqual([]);
  });

  it("below the minimum order (after discount)", () => {
    const settings = { ...DEFAULT_STORE_SETTINGS, minOrderValue: 100000 };
    expect(codes(input({ settings }))).toEqual([]);
    expect(codes(input({ settings, cart: cartOf([line()], { discount: 1 }) }))).toEqual(["below_min_order"]);
  });

  it("COD disabled, not allowed by the rate, over the COD maximum", () => {
    expect(codes(input({ paymentMethod: "cod", settings: { ...DEFAULT_STORE_SETTINGS, codEnabled: false } }))).toEqual(["cod_disabled"]);
    expect(codes(input({ paymentMethod: "cod", deliveryOptionId: "exp" }))).toEqual(["cod_not_allowed"]);
    const settings = { ...DEFAULT_STORE_SETTINGS, codMaxAmount: 107999 };
    expect(codes(input({ paymentMethod: "cod", settings }))).toEqual(["cod_over_max"]);
    expect(codes(input({ paymentMethod: "cod", settings: { ...settings, codMaxAmount: 108000 } }))).toEqual([]);
    expect(codes(input({ paymentMethod: "cod", settings: { ...settings, codMaxAmount: 0 } }))).toEqual([]); // 0 = no limit
  });

  it("online payment needs the payments feature", () => {
    expect(codes(input({ onlinePaymentsEnabled: false }))).toEqual(["online_payment_unavailable"]);
    expect(codes(input({ onlinePaymentsEnabled: false, paymentMethod: "cod" }))).toEqual([]);
  });

  it("delivery option must be in the quote; pincode must be serviceable", () => {
    expect(codes(input({ deliveryOptionId: "nope" }))).toEqual(["delivery_option_invalid"]);
    expect(codes(input({ quote: { serviceable: false, options: [] } }))).toEqual(["not_serviceable"]);
    expect(codes(input({ quote: null }))).toEqual(["not_serviceable"]);
  });

  it("address: required fields, pincode format, phone", () => {
    const r = validateCheckout(input({ address: { stateCode: "33" } }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.code)).toEqual(["address_invalid"]);
    const fields = (r.issues[0]!.details as { field: string }[]).map((f) => f.field).sort();
    expect(fields).toEqual(["city", "line1", "name", "phone", "pincode"]);

    for (const pincode of ["62500", "0625001", "6250011", "62500A", " "]) {
      expect(codes(input({ address: { ...address, pincode } }))).toEqual(["address_invalid"]);
    }
    for (const phone of ["12345", "5876543210", "98765432101", "+44 7700 900123", "phone"]) {
      expect(codes(input({ address: { ...address, phone } }))).toEqual(["address_invalid"]);
    }
    expect(codes(input({ address: { ...address, stateCode: "99" } }))).toEqual(["address_invalid"]);
    expect(codes(input({ address: null }))).toEqual(["address_invalid"]);
  });

  it("reports several problems at once", () => {
    const r = codes(
      input({ settings: { ...DEFAULT_STORE_SETTINGS, open: false, codEnabled: false }, cart: cartOf([]), paymentMethod: "cod", address: {} }),
    );
    expect(r).toEqual(["store_closed", "cart_empty", "address_invalid", "cod_disabled"]);
  });
});

describe("address helpers", () => {
  it("normalizes Indian mobiles to E.164", () => {
    expect(normalizeIndianMobile("98765 43210")).toBe("+919876543210");
    expect(normalizeIndianMobile("+91 98765-43210")).toBe("+919876543210");
    expect(normalizeIndianMobile("919876543210")).toBe("+919876543210");
    expect(normalizeIndianMobile("09876543210")).toBe("+919876543210");
    expect(normalizeIndianMobile("044 2345 6789")).toBeNull(); // landline
    expect(normalizeIndianMobile("")).toBeNull();
  });

  it("parseAddress trims and blanks optional fields", () => {
    const r = parseAddress({ ...address, line2: "  ", landmark: "Near temple", stateCode: 33 });
    expect(r.ok && r.address).toMatchObject({ line2: null, landmark: "Near temple", stateCode: "33", phone: "+919876543210" });
  });
});

describe("checkoutBodySchema", () => {
  const body = { cartToken: "tok_123", addressId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", deliveryOptionId: "standard", paymentMethod: "cod" };
  it("takes optional loyalty points: positive whole numbers up to 10,000,000", () => {
    expect(checkoutBodySchema.parse(body).loyaltyPoints).toBeUndefined();
    expect(checkoutBodySchema.parse({ ...body, loyaltyPoints: 250 }).loyaltyPoints).toBe(250);
    expect(checkoutBodySchema.parse({ ...body, loyaltyPoints: 10_000_000 }).loyaltyPoints).toBe(10_000_000);
    for (const bad of [0, -1, 1.5, 10_000_001, "100"]) expect(checkoutBodySchema.safeParse({ ...body, loyaltyPoints: bad }).success).toBe(false);
  });
});

describe("normalizeStoreSettings", () => {
  it("fills defaults and ignores bad values", () => {
    expect(normalizeStoreSettings(undefined)).toEqual(DEFAULT_STORE_SETTINGS);
    // Trust badge settings: unknown modes are "auto", badges without a title are dropped, at most four.
    expect(normalizeStoreSettings({ trust: { returns: "nope" as never, payment: "confirm", badges: [{ title: " Fresh daily ", text: "x", titleTa: "", textTa: "" }, { title: "", text: "y", titleTa: "", textTa: "" }] } }).trust).toEqual({
      returns: "auto",
      payment: "confirm",
      badges: [{ title: "Fresh daily", text: "x", titleTa: "", textTa: "" }],
    });
    expect(normalizeStoreSettings({ open: false, codMaxAmount: -5 as number, minOrderValue: 19900 })).toMatchObject({
      open: false,
      codMaxAmount: 500000,
      minOrderValue: 19900,
      codEnabled: true,
    });
  });
});

describe("RateLimiter", () => {
  it("allows `limit` hits per window per key", () => {
    let t = 0;
    const rl = new RateLimiter(10, 60_000, () => t);
    for (let i = 0; i < 10; i++) expect(rl.hit("a")).toBe(true);
    expect(rl.hit("a")).toBe(false);
    expect(rl.hit("b")).toBe(true);
    t = 60_001;
    expect(rl.hit("a")).toBe(true);
  });
});

describe("validateCheckout: pickup (takeaway)", () => {
  const pickupSettings = { ...DEFAULT_STORE_SETTINGS, pickupEnabled: true };
  const pickup = (over: Partial<CheckoutCheckInput> = {}) =>
    input({ settings: pickupSettings, fulfilment: "pickup", address: { name: "Meena", phone: "98765 43210" }, deliveryOptionId: "", quote: null, paymentMethod: "cod", ...over });

  it("needs no address, delivery option or PIN code and charges no shipping", () => {
    const r = validateCheckout(pickup());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan).toMatchObject({ pickup: true, address: null, option: null, shipping: 0, codFee: 0, estimatedTotal: 100000, contact: { name: "Meena", phone: "+919876543210" } });
  });
  it("is refused when the shop has pickup off", () => {
    expect(codes(pickup({ settings: { ...DEFAULT_STORE_SETTINGS } }))).toEqual(["pickup_unavailable"]);
  });
  it("asks for a name and a valid mobile", () => {
    expect(codes(pickup({ address: { name: "", phone: "12" } }))).toEqual(["address_invalid"]);
  });
  it("still applies the store closed, minimum order and cash rules", () => {
    expect(codes(pickup({ settings: { ...pickupSettings, open: false } }))).toContain("store_closed");
    expect(codes(pickup({ settings: { ...pickupSettings, minOrderValue: 500000 } }))).toContain("below_min_order");
    expect(codes(pickup({ settings: { ...pickupSettings, codEnabled: false } }))).toEqual(["cod_disabled"]);
  });
  it("online pickup needs online payments", () => {
    expect(codes(pickup({ paymentMethod: "online", onlinePaymentsEnabled: false }))).toEqual(["online_payment_unavailable"]);
  });
  it("delivery is refused when the shop is pickup-only", () => {
    expect(codes(input({ settings: { ...DEFAULT_STORE_SETTINGS, deliveryEnabled: false } }))).toEqual(["delivery_unavailable"]);
  });
  it("body: pickup needs no delivery option", () => {
    expect(checkoutBodySchema.safeParse({ cartToken: "a".repeat(24), fulfilment: "pickup", address: { name: "M", phone: "9876543210" }, paymentMethod: "cod" }).success).toBe(true);
    expect(checkoutBodySchema.safeParse({ cartToken: "a".repeat(24), address: { name: "M" }, paymentMethod: "cod" }).success).toBe(false);
  });
});
