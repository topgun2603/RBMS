// Pure shopper texts for automatic offers (badges, nudges) from their kind + numbers. Unit-tested.
import { money } from "./format";
import type { CartNudge, CartOffer, OfferBadge, PricedCart } from "../types";

type T = (key: string, vars?: Record<string, string | number>) => string;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** "Buy 2 get 1 free", "Spend ₹999 get 10% off", "Combo for ₹1,399" … in the shopper's language; falls back to the API label. */
export function offerText(t: T, o: Pick<OfferBadge, "kind" | "config" | "label">): string {
  const c = (o.config ?? {}) as Record<string, unknown>;
  switch (o.kind) {
    case "bxgy": {
      const pct = num(c.getPercent) || 100;
      return pct >= 100 ? t("offer.bxgy.free", { buy: num(c.buyQty), get: num(c.getQty) }) : t("offer.bxgy.percent", { buy: num(c.buyQty), get: num(c.getQty), pct });
    }
    case "tiered": {
      const tiers = Array.isArray(c.tiers) ? (c.tiers as { min: number; type: string; value: number }[]) : [];
      const first = [...tiers].sort((a, b) => a.min - b.min)[0];
      if (!first) return o.label;
      const qty = c.basis === "qty";
      const min = qty ? first.min : money(first.min);
      if (first.type === "percent") return t(qty ? "offer.tier.qtyPercent" : "offer.tier.amountPercent", { min, value: first.value });
      return t(qty ? "offer.tier.qtyFlat" : "offer.tier.amountFlat", { min, amount: money(first.value) });
    }
    case "free_gift":
      return t("offer.gift", { amount: money(num(c.minAmount)) });
    case "bundle":
      return c.priceType === "percent" ? t("offer.bundlePercent", { pct: num(c.value) }) : t("offer.bundleFixed", { amount: money(num(c.value)) });
    default:
      return o.label;
  }
}

/** The applied offer's row in the totals: the offer's own name when the shop gave one, else its summary. */
export function appliedOfferText(o: CartOffer): string {
  return o.name?.trim() || o.label;
}

/** "Add 1 more item to get 1 free", "You're ₹200 away from 10% off", "You're ₹150 away from a free gift". */
export function nudgeText(t: T, n: CartNudge): string {
  const r = n.reward;
  switch (r.type) {
    case "units":
      return r.percent >= 100 ? t("nudge.unitsFree", { qty: n.addQty ?? 1, get: r.qty }) : t("nudge.unitsPercent", { qty: n.addQty ?? 1, get: r.qty, pct: r.percent });
    case "percent":
      return n.addAmount !== undefined ? t("nudge.amountPercent", { amount: money(n.addAmount), value: r.value }) : t("nudge.qtyPercent", { qty: n.addQty ?? 1, value: r.value });
    case "flat":
      return n.addAmount !== undefined ? t("nudge.amountFlat", { amount: money(n.addAmount), value: money(r.value) }) : t("nudge.qtyFlat", { qty: n.addQty ?? 1, amount: money(r.value) });
    case "gift":
      return t("nudge.gift", { amount: money(n.addAmount ?? 0) });
    case "bundle":
      return t("nudge.bundle", { name: n.name });
  }
}

/** Most useful nudges first: the smallest step to a reward (amount nudges compare by rupees, qty by one item ≈ ₹1). */
export function sortNudges(nudges: readonly CartNudge[]): CartNudge[] {
  const weight = (n: CartNudge) => (n.addAmount !== undefined ? n.addAmount : (n.addQty ?? 1) * 100);
  return [...nudges].sort((a, b) => weight(a) - weight(b));
}

/** Goods after offers and coupon (older APIs without offers: subtotal − discount). */
export const goodsTotal = (c: Pick<PricedCart, "subtotal" | "discount" | "offerDiscount">) => c.subtotal - (c.offerDiscount ?? 0) - c.discount;

/**
 * Free-delivery bar state: the server's (`freeShipping`) when present, else the older quote-based rule (an option's
 * `freeAbove`, or a ₹0 quoted option, or a free-shipping coupon). Null = no bar.
 */
export function freeDeliveryState(c: PricedCart): { unlocked: boolean; remaining: number; threshold: number | null; area: boolean } | null {
  const goods = goodsTotal(c);
  if (c.freeShipping !== undefined) {
    const f = c.freeShipping;
    if (!f) return null;
    return { unlocked: f.unlocked, remaining: f.remaining, threshold: f.threshold, area: f.scope === "zone" };
  }
  const thresholds = (c.delivery?.options ?? []).map((o) => o.freeAbove).filter((n): n is number => typeof n === "number" && n > 0);
  const freeAbove = thresholds.length ? Math.min(...thresholds) : null;
  const quotedFree = !!c.delivery?.serviceable && (c.delivery.options.length ?? 0) > 0 && Math.min(...c.delivery.options.map((o) => o.amount)) === 0;
  const unlocked = (!!c.coupon?.valid && c.coupon.freeShipping) || (freeAbove !== null && goods >= freeAbove) || quotedFree;
  if (!unlocked && freeAbove === null) return null;
  return { unlocked, remaining: unlocked ? 0 : Math.max(0, (freeAbove ?? 0) - goods), threshold: freeAbove, area: false };
}
