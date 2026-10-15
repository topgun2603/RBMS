/** Pure loyalty helpers for checkout and the account page (money in paise). */
import type { LoyaltyMe, LoyaltyQuote, PricedCart } from "../types";

/**
 * What points are quoted against at checkout: the goods as charged after the coupon (the orders module redeems on
 * Σ line gross − coupon share). Shipping, COD fee and exclusive GST are not part of it.
 */
export function redeemBase(cart: Pick<PricedCart, "subtotal" | "discount">): number {
  return Math.max(0, Math.round(cart.subtotal - cart.discount));
}

/** Points the shopper may apply: a whole number in 0..quote.maxPoints (0 when the quote says no). */
export function clampPoints(points: number, quote: Pick<LoyaltyQuote, "canRedeem" | "maxPoints"> | null | undefined): number {
  if (!quote?.canRedeem || !Number.isFinite(points)) return 0;
  return Math.max(0, Math.min(Math.floor(points), quote.maxPoints));
}

/** Discount for points, paise. */
export const pointsValue = (points: number, pointValuePaise: number) => Math.max(0, Math.round(points * pointValuePaise));

/**
 * Estimated payable after points. The server recomputes GST on the reduced taxable value, so for tax-exclusive lines
 * the real total may differ by a few paise; the confirmed total comes back with the order.
 */
export function totalAfterPoints(estimated: number, discount: number): number {
  return Math.max(0, Math.round(estimated - discount));
}

/** 0–100: progress from the current tier's floor to the next tier (100 at the top tier). */
export function tierProgress(me: Pick<LoyaltyMe, "member" | "nextTier">): number {
  if (!me.nextTier) return 100;
  const spend = me.member?.lifetimeSpend ?? 0;
  const target = me.nextTier.tier.minSpend;
  if (target <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((spend / target) * 100)));
}

/** Signed points label: "+120", "−50". */
export function signedPoints(points: number): string {
  return points > 0 ? `+${points}` : points < 0 ? `−${Math.abs(points)}` : "0";
}
