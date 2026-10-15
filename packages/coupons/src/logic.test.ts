import { describe, expect, it } from "vitest";
import {
  allocateDiscount,
  COUPON_REASONS,
  eligibleMask,
  evaluateCoupon,
  istDayEnd,
  istDayStart,
  normalizeCode,
  REASON_MESSAGES,
  type CouponRule,
  type EvaluationContext,
} from "./logic";

const CAT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-15T06:00:00Z"); // 11:30 IST

const rule = (patch: Partial<CouponRule> = {}): CouponRule => ({
  id: "c1",
  code: "DIWALI10",
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

const cart = (patch: Partial<EvaluationContext> = {}): EvaluationContext => ({
  channel: "store",
  subtotal: 100_000,
  shipping: 5_000,
  lines: [
    { productId: P1, categoryId: CAT_A, amount: 60_000 },
    { productId: P2, categoryId: CAT_B, amount: 40_000 },
  ],
  customerKey: "ph:+919876543210",
  ...patch,
});

const unused = { total: 0, byCustomer: 0 };
const reasonOf = (r: ReturnType<typeof evaluateCoupon>) => (r.valid ? "valid" : r.reason);

describe("evaluateCoupon: reasons", () => {
  it("not_found when there is no coupon", () => {
    expect(evaluateCoupon(null, cart(), unused, NOW)).toEqual({ valid: false, reason: "not_found", message: REASON_MESSAGES.not_found });
  });
  it("inactive", () => {
    expect(reasonOf(evaluateCoupon(rule({ active: false }), cart(), unused, NOW))).toBe("inactive");
  });
  it("wrong_channel", () => {
    expect(reasonOf(evaluateCoupon(rule(), cart({ channel: "pos" }), unused, NOW))).toBe("wrong_channel");
    expect(reasonOf(evaluateCoupon(rule({ channels: ["store", "pos"] }), cart({ channel: "pos" }), unused, NOW))).toBe("valid");
  });
  it("not_started / expired", () => {
    expect(reasonOf(evaluateCoupon(rule({ startsAt: new Date("2026-10-16T00:00:00Z") }), cart(), unused, NOW))).toBe("not_started");
    expect(reasonOf(evaluateCoupon(rule({ endsAt: new Date("2026-10-15T05:59:59Z") }), cart(), unused, NOW))).toBe("expired");
    expect(
      reasonOf(evaluateCoupon(rule({ startsAt: new Date("2026-10-15T06:00:00Z"), endsAt: new Date("2026-10-15T06:00:00Z") }), cart(), unused, NOW)),
    ).toBe("valid");
  });
  it("first_order_only blocks known repeat customers only", () => {
    const r = rule({ firstOrderOnly: true });
    expect(reasonOf(evaluateCoupon(r, cart({ isFirstOrder: false }), unused, NOW))).toBe("first_order_only");
    expect(reasonOf(evaluateCoupon(r, cart({ isFirstOrder: true }), unused, NOW))).toBe("valid");
    expect(reasonOf(evaluateCoupon(r, cart(), unused, NOW))).toBe("valid");
  });
  it("usage_limit", () => {
    expect(reasonOf(evaluateCoupon(rule({ usageLimit: 5 }), cart(), { total: 5, byCustomer: 0 }, NOW))).toBe("usage_limit");
    expect(reasonOf(evaluateCoupon(rule({ usageLimit: 5 }), cart(), { total: 4, byCustomer: 0 }, NOW))).toBe("valid");
  });
  it("customer_limit applies only with a customer key", () => {
    const r = rule({ perCustomerLimit: 1 });
    expect(reasonOf(evaluateCoupon(r, cart(), { total: 3, byCustomer: 1 }, NOW))).toBe("customer_limit");
    expect(reasonOf(evaluateCoupon(r, cart({ customerKey: null }), { total: 3, byCustomer: 1 }, NOW))).toBe("valid");
    expect(reasonOf(evaluateCoupon(r, cart(), { total: 3, byCustomer: 0 }, NOW))).toBe("valid");
  });
  it("not_applicable when no line matches the categories/products", () => {
    const r = rule({ appliesTo: "categories", targetIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"] });
    expect(reasonOf(evaluateCoupon(r, cart(), unused, NOW))).toBe("not_applicable");
    expect(reasonOf(evaluateCoupon(r, cart({ lines: [] }), unused, NOW))).toBe("not_applicable");
    expect(reasonOf(evaluateCoupon(rule(), cart({ subtotal: 0, lines: [] }), unused, NOW))).toBe("not_applicable");
  });
  it("min_order is compared with the eligible subtotal", () => {
    const r = rule({ appliesTo: "categories", targetIds: [CAT_B], minOrder: 50_000 });
    expect(reasonOf(evaluateCoupon(r, cart(), unused, NOW))).toBe("min_order"); // only 40 000 eligible
    expect(reasonOf(evaluateCoupon({ ...r, minOrder: 40_000 }, cart(), unused, NOW))).toBe("valid");
    expect(reasonOf(evaluateCoupon(rule({ minOrder: 100_001 }), cart(), unused, NOW))).toBe("min_order");
  });
  it("has a message for every reason", () => {
    for (const r of COUPON_REASONS) expect(REASON_MESSAGES[r]).toBeTruthy();
  });
});

describe("evaluateCoupon: discounts", () => {
  it("percent of the subtotal, split over lines", () => {
    const r = evaluateCoupon(rule(), cart(), unused, NOW);
    expect(r).toMatchObject({ valid: true, couponId: "c1", code: "DIWALI10", discount: 10_000, freeShipping: false, shippingDiscount: 0 });
    expect(r.valid && r.lineDiscounts).toEqual([6_000, 4_000]);
    expect(r.valid && r.eligibleSubtotal).toBe(100_000);
  });
  it("percent capped by max discount", () => {
    const r = evaluateCoupon(rule({ value: 50, maxDiscount: 20_000 }), cart(), unused, NOW);
    expect(r.valid && r.discount).toBe(20_000);
    expect(r.valid && r.lineDiscounts).toEqual([12_000, 8_000]);
  });
  it("percent rounds to the nearest paisa", () => {
    const r = evaluateCoupon(rule({ value: 15 }), cart({ subtotal: 999, lines: [{ amount: 999 }] }), unused, NOW);
    expect(r.valid && r.discount).toBe(150);
  });
  it("flat, capped at the eligible subtotal", () => {
    expect(evaluateCoupon(rule({ type: "flat", value: 25_000 }), cart(), unused, NOW)).toMatchObject({ discount: 25_000 });
    const small = evaluateCoupon(rule({ type: "flat", value: 25_000, appliesTo: "products", targetIds: [P2] }), cart({ lines: [
      { productId: P1, categoryId: CAT_A, amount: 60_000 },
      { productId: P2, categoryId: CAT_B, amount: 20_000 },
    ], subtotal: 80_000 }), unused, NOW);
    expect(small.valid && small.discount).toBe(20_000);
    expect(small.valid && small.lineDiscounts).toEqual([0, 20_000]);
    expect(small.valid && small.eligibleSubtotal).toBe(20_000);
  });
  it("flat honours max discount too", () => {
    expect(evaluateCoupon(rule({ type: "flat", value: 25_000, maxDiscount: 10_000 }), cart(), unused, NOW)).toMatchObject({ discount: 10_000 });
  });
  it("percent on categories only takes from the matching lines", () => {
    const r = evaluateCoupon(rule({ value: 20, appliesTo: "categories", targetIds: [CAT_A] }), cart(), unused, NOW);
    expect(r.valid && r.discount).toBe(12_000);
    expect(r.valid && r.lineDiscounts).toEqual([12_000, 0]);
  });
  it("products targeting", () => {
    const r = evaluateCoupon(rule({ value: 10, appliesTo: "products", targetIds: [P1, P2] }), cart(), unused, NOW);
    expect(r.valid && r.discount).toBe(10_000);
  });
  it("free shipping waives shipping and takes nothing off the goods", () => {
    const r = evaluateCoupon(rule({ type: "free_shipping", value: 0, minOrder: 50_000 }), cart(), unused, NOW);
    expect(r).toMatchObject({ valid: true, discount: 0, freeShipping: true, shippingDiscount: 5_000, lineDiscounts: [0, 0] });
    expect(reasonOf(evaluateCoupon(rule({ type: "free_shipping", minOrder: 200_000 }), cart(), unused, NOW))).toBe("min_order");
  });
  it("works without lines (preview from a subtotal only)", () => {
    const r = evaluateCoupon(rule(), cart({ lines: undefined }), unused, NOW);
    expect(r).toMatchObject({ valid: true, discount: 10_000, lineDiscounts: [] });
  });
});

describe("IST date window", () => {
  it("maps calendar days to IST bounds", () => {
    expect(istDayStart("2026-10-20").toISOString()).toBe("2026-10-19T18:30:00.000Z");
    expect(istDayEnd("2026-10-20").toISOString()).toBe("2026-10-20T18:29:59.999Z");
  });
  it("a coupon for 20 Oct (IST) works from 00:00 to 23:59 IST that day", () => {
    const r = rule({ startsAt: istDayStart("2026-10-20"), endsAt: istDayEnd("2026-10-20") });
    const at = (iso: string) => reasonOf(evaluateCoupon(r, cart(), unused, new Date(iso)));
    expect(at("2026-10-19T18:29:59.999Z")).toBe("not_started"); // 19 Oct 23:59:59 IST
    expect(at("2026-10-19T18:30:00.000Z")).toBe("valid"); // 20 Oct 00:00 IST
    expect(at("2026-10-20T18:29:59.999Z")).toBe("valid"); // 20 Oct 23:59:59 IST
    expect(at("2026-10-20T18:30:00.000Z")).toBe("expired"); // 21 Oct 00:00 IST
  });
});

describe("helpers", () => {
  it("normalises codes", () => {
    expect(normalizeCode("  diwali-10 ")).toBe("DIWALI-10");
  });
  it("masks eligible lines", () => {
    const lines = cart().lines!;
    expect(eligibleMask({ appliesTo: "all", targetIds: [] }, lines)).toEqual([true, true]);
    expect(eligibleMask({ appliesTo: "categories", targetIds: [CAT_B] }, lines)).toEqual([false, true]);
    expect(eligibleMask({ appliesTo: "products", targetIds: [P1] }, lines)).toEqual([true, false]);
    expect(eligibleMask({ appliesTo: "products", targetIds: [P1] }, [{ amount: 1 }])).toEqual([false]);
  });
  it("allocates exactly, by largest remainder, never above a line", () => {
    expect(allocateDiscount(100, [100, 100, 100], [true, true, true])).toEqual([34, 33, 33]);
    expect(allocateDiscount(100, [1, 1, 1], [true, true, true])).toEqual([1, 1, 1]);
    expect(allocateDiscount(1000, [300, 200], [true, true])).toEqual([300, 200]);
    expect(allocateDiscount(10, [100, 100], [false, true])).toEqual([0, 10]);
    expect(allocateDiscount(0, [100], [true])).toEqual([0]);
    const parts = allocateDiscount(9_999, [33_333, 33_333, 33_334], [true, true, true]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(9_999);
  });
});
