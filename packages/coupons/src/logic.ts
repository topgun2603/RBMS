// Pure coupon rules: evaluation, discount allocation, codes and IST date windows. No I/O.
import type { CouponAppliesTo, CouponType } from "./schema";

export const COUPON_REASONS = [
  "not_found",
  "inactive",
  "not_started",
  "expired",
  "min_order",
  "usage_limit",
  "customer_limit",
  "first_order_only",
  "not_applicable",
  "wrong_channel",
  "not_combinable",
] as const;
export type CouponReason = (typeof COUPON_REASONS)[number];

/** English messages for checkout UIs (clients may translate by `reason`). */
export const REASON_MESSAGES: Record<CouponReason, string> = {
  not_found: "This coupon code doesn't exist",
  inactive: "This coupon is switched off",
  not_started: "This coupon isn't active yet",
  expired: "This coupon has expired",
  min_order: "Add more items to use this coupon",
  usage_limit: "This coupon has been fully used",
  customer_limit: "You have already used this coupon",
  first_order_only: "This coupon is only for your first order",
  not_applicable: "This coupon doesn't apply to the items in your cart",
  wrong_channel: "This coupon can't be used here",
  not_combinable: "A better offer is already applied to your cart",
};

export interface EvaluationLine {
  productId?: string | null;
  categoryId?: string | null;
  /** Paise, the line amount as the customer sees it (qty × price). */
  amount: number;
}

export interface EvaluationContext {
  /** "store", "manual", "pos", "marketplace" or "billing". */
  channel: string;
  /** Paise; used as the eligible subtotal for `applies_to = all`. */
  subtotal: number;
  /** Paise; waived by free-shipping coupons. */
  shipping?: number;
  lines?: EvaluationLine[];
  customerKey?: string | null;
  /** false blocks first-order-only coupons; undefined (unknown) lets them through. */
  isFirstOrder?: boolean;
}

/** The coupon fields evaluation needs (a CouponRow satisfies it). */
export interface CouponRule {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  maxDiscount: number | null;
  minOrder: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  appliesTo: CouponAppliesTo;
  targetIds: string[];
  channels: string[];
  active: boolean;
}

/** Active redemptions so far: in total and by this customer key. */
export interface CouponUsage {
  total: number;
  byCustomer: number;
}

export interface ValidEvaluation {
  valid: true;
  couponId: string;
  code: string;
  type: CouponType;
  /** Paise off the goods (0 for free shipping). */
  discount: number;
  freeShipping: boolean;
  /** Paise of shipping waived (free-shipping coupons). */
  shippingDiscount: number;
  /** Paise the coupon applied to (all lines, or the matching categories/products). */
  eligibleSubtotal: number;
  /** `discount` split over `ctx.lines` (same order; 0 for ineligible lines). Empty when no lines were given. */
  lineDiscounts: number[];
}

export interface InvalidEvaluation {
  valid: false;
  reason: CouponReason;
  message: string;
}

export type CouponEvaluation = ValidEvaluation | InvalidEvaluation;

const invalid = (reason: CouponReason): InvalidEvaluation => ({ valid: false, reason, message: REASON_MESSAGES[reason] });

/** "  diwali-10 " → "DIWALI-10". */
export const normalizeCode = (code: string) => code.trim().toUpperCase();

export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

/** IST is UTC+05:30 with no daylight saving. */
const IST = "+05:30";

/** Start of an IST calendar day: "2026-10-20" → 2026-10-19T18:30:00.000Z. */
export const istDayStart = (date: string) => new Date(`${date}T00:00:00.000${IST}`);
/** Last millisecond of an IST calendar day. */
export const istDayEnd = (date: string) => new Date(`${date}T23:59:59.999${IST}`);

/** Lines the coupon applies to. */
export function eligibleMask(rule: Pick<CouponRule, "appliesTo" | "targetIds">, lines: readonly EvaluationLine[]): boolean[] {
  if (rule.appliesTo === "all") return lines.map(() => true);
  const targets = new Set(rule.targetIds);
  const key = rule.appliesTo === "categories" ? "categoryId" : "productId";
  return lines.map((l) => {
    const id = l[key];
    return !!id && targets.has(id);
  });
}

/**
 * Splits `total` over the masked lines in proportion to their amounts (largest remainder, so the parts add up
 * exactly and no line gets more than its amount).
 */
export function allocateDiscount(total: number, amounts: readonly number[], mask: readonly boolean[]): number[] {
  const base = amounts.reduce((s, a, i) => s + (mask[i] ? Math.max(a, 0) : 0), 0);
  const out = amounts.map(() => 0);
  if (total <= 0 || base <= 0) return out;
  const t = Math.min(total, base);
  const rem: { i: number; frac: number }[] = [];
  let given = 0;
  amounts.forEach((a, i) => {
    if (!mask[i] || a <= 0) return;
    const exact = (t * a) / base;
    const whole = Math.floor(exact);
    out[i] = whole;
    given += whole;
    rem.push({ i, frac: exact - whole });
  });
  rem.sort((x, y) => y.frac - x.frac || x.i - y.i);
  for (let k = 0; given < t && k < rem.length; k++, given++) out[rem[k]!.i]! += 1;
  return out;
}

/**
 * Decides whether a coupon can be used and how much it takes off. Checks, in order: exists, active, channel,
 * start/end time, first order, total usage, per-customer usage, applicability (categories/products), minimum order
 * on the eligible subtotal. Percent discounts honour `maxDiscount`; flat discounts are capped at the eligible subtotal.
 */
export function evaluateCoupon(
  coupon: CouponRule | null | undefined,
  ctx: EvaluationContext,
  usage: CouponUsage,
  now: Date,
): CouponEvaluation {
  if (!coupon) return invalid("not_found");
  if (!coupon.active) return invalid("inactive");
  if (!coupon.channels.includes(ctx.channel)) return invalid("wrong_channel");
  if (coupon.startsAt && now.getTime() < coupon.startsAt.getTime()) return invalid("not_started");
  if (coupon.endsAt && now.getTime() > coupon.endsAt.getTime()) return invalid("expired");
  if (coupon.firstOrderOnly && ctx.isFirstOrder === false) return invalid("first_order_only");
  if (coupon.usageLimit !== null && usage.total >= coupon.usageLimit) return invalid("usage_limit");
  if (coupon.perCustomerLimit !== null && ctx.customerKey && usage.byCustomer >= coupon.perCustomerLimit) {
    return invalid("customer_limit");
  }

  const lines = ctx.lines ?? [];
  const mask = eligibleMask(coupon, lines);
  const amounts = lines.map((l) => Math.max(l.amount, 0));
  let eligibleSubtotal: number;
  if (coupon.appliesTo === "all") {
    eligibleSubtotal = Math.max(ctx.subtotal, 0);
  } else {
    if (!mask.some(Boolean)) return invalid("not_applicable");
    eligibleSubtotal = amounts.reduce((s, a, i) => s + (mask[i] ? a : 0), 0);
  }
  if (eligibleSubtotal < coupon.minOrder) return invalid("min_order");

  const shipping = Math.max(ctx.shipping ?? 0, 0);
  if (coupon.type === "free_shipping") {
    return {
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      type: coupon.type,
      discount: 0,
      freeShipping: true,
      shippingDiscount: shipping,
      eligibleSubtotal,
      lineDiscounts: lines.map(() => 0),
    };
  }

  if (eligibleSubtotal <= 0) return invalid("not_applicable");
  let discount = coupon.type === "percent" ? Math.round((eligibleSubtotal * coupon.value) / 100) : coupon.value;
  if (coupon.maxDiscount !== null) discount = Math.min(discount, coupon.maxDiscount);
  discount = Math.max(Math.min(discount, eligibleSubtotal), 0);

  return {
    valid: true,
    couponId: coupon.id,
    code: coupon.code,
    type: coupon.type,
    discount,
    freeShipping: false,
    shippingDiscount: 0,
    eligibleSubtotal,
    lineDiscounts: lines.length ? allocateDiscount(discount, amounts, mask) : [],
  };
}
