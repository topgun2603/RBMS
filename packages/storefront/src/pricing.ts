import type { CartPricingResult, CouponContextLine, CouponEvaluationResult, DeliveryOption, OfferGift, OfferNudge, StoreVariant, VariantAvailability } from "./ports";
import { effectiveGstRate, type GstRateRule } from "@rbms/gst";
import type { StoredCartLine } from "./schema";

/** Per-line quantity bounds (whole units). */
export const MAX_LINE_QTY = 99;
/** Distinct lines per cart. */
export const MAX_CART_LINES = 50;
export const STORE_CHANNEL = "store";

export type LineProblem = "unavailable" | "price_changed" | "qty_reduced";

/** Machine-readable cart warnings (the UI translates them). */
export type CartWarning =
  | "items_unavailable"
  | "items_removed"
  | "prices_changed"
  | "qty_reduced"
  | "coupon_invalid"
  | "not_serviceable"
  | "delivery_unavailable";

export interface PricedLine {
  variantId: string;
  productId: string;
  productSlug: string;
  /** Product name. */
  name: string;
  variantTitle: string;
  image: string | null;
  /** Paise per unit as charged (what the shopper sees). */
  price: number;
  mrp: number | null;
  qty: number;
  /** qty × price; 0 for unavailable lines (they don't count). */
  lineTotal: number;
  available: boolean;
  /** Most the shopper can buy now (0 when unavailable). */
  maxQty: number;
  problem?: LineProblem;
  /** Paise off this line by automatic offers (as charged); absent when none. */
  offerDiscount?: number;
  /** The offers behind `offerDiscount` (ids of `PricedCart.offers`). */
  offerIds?: string[];
}

/** An automatic offer applied to the cart (buy X get Y, tier, free gift, bundle). */
export interface CartOffer {
  id: string;
  kind: string;
  name: string;
  /** English summary ("Buy 2 get 1 free"); the store translates from `kind`. */
  label: string;
  discount: number;
  /** Sets / repeats applied. */
  applications: number;
}

/** A product suggested next to a nudge or gift (cart upsell). */
export interface CartProductRef {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  price: number;
  /** The only sellable variant (one-tap add), else null (choose options on the product page). */
  variantId: string | null;
}

export type CartNudge = OfferNudge & { products?: CartProductRef[] };
export type CartGift = OfferGift & { product?: CartProductRef | null };

export interface CartFreeShipping {
  /** Paise of goods (after discounts) from which delivery is free; null = none (no bar). */
  threshold: number | null;
  /** Paise still to add (0 when unlocked). */
  remaining: number;
  unlocked: boolean;
  /** "zone": for the cart's pincode; "shop": everywhere the shop delivers. */
  scope: "zone" | "shop";
}

export interface CartCoupon {
  code: string;
  valid: boolean;
  reason?: string;
  freeShipping: boolean;
}

export interface CartDelivery {
  serviceable: boolean;
  options: DeliveryOption[];
}

export interface PricedCart {
  token: string;
  lines: PricedLine[];
  /** Units of available lines. */
  itemCount: number;
  /** Σ lineTotal of available lines, as charged. */
  subtotal: number;
  /** Coupon discount on the goods, as charged. */
  discount: number;
  coupon: CartCoupon | null;
  /** Automatic offers' discount on the goods, as charged (on top of `discount`). */
  offerDiscount: number;
  offers: CartOffer[];
  /** "Add 1 more to get 1 free", "Add ₹200 more for 10% off". */
  nudges: CartNudge[];
  /** Free-gift offers in reach or unlocked. */
  gifts: CartGift[];
  /** Free-delivery progress; null while unknown. */
  freeShipping: CartFreeShipping | null;
  pincode: string | null;
  delivery: CartDelivery | null;
  /** subtotal − offerDiscount − discount (shipping is chosen at checkout). */
  total: number;
  /** Estimated GST added on top for tax-exclusive products (0 when every price includes GST). */
  taxExtra: number;
  /** Σ weight × qty of available lines (for delivery quotes). */
  weightGrams: number;
  warnings: CartWarning[];
}

/** A priced line plus the details pricing and checkout need but the shopper doesn't. */
export interface LineCalc {
  line: PricedLine;
  categoryId: string | null;
  weightGrams: number;
  taxInclusive: boolean;
  gstRate: number;
  /** Price-band GST rule (apparel / footwear), when the product has one. */
  gstRule?: GstRateRule | null;
  /** The unit price differs from the one stored when the line was set (even when another flag wins). */
  priceChanged: boolean;
}

export interface PricedLines {
  calcs: LineCalc[];
  /** Cart lines whose variant no longer exists (dropped from the result). */
  removed: string[];
}

/** Whole units in 1..MAX_LINE_QTY (0 or less → 0). */
export function clampQty(qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return Math.min(MAX_LINE_QTY, Math.floor(qty));
}

export const isSellable = (v: StoreVariant) => v.status === "active" && v.channels.includes(STORE_CHANNEL);

/** How many units can be bought now: 0 when not sellable, else min(99, available) for tracked stock. */
export function maxQtyFor(v: StoreVariant | undefined, a: VariantAvailability | undefined): number {
  if (!v || !isSellable(v)) return 0;
  if (!a || !a.tracked) return MAX_LINE_QTY;
  return Math.max(0, Math.min(MAX_LINE_QTY, Math.floor(a.available)));
}

/**
 * Prices the cart lines against the current catalogue and stock (pure). Unavailable lines stay (flagged, total 0);
 * quantities above what's in stock are capped (`qty_reduced`); otherwise a unit price that differs from the one stored
 * when the line was set is flagged `price_changed` (the line keeps the current price). Lines of deleted variants are dropped.
 * `requested` overrides the stored qty for the flag (a PUT that was just capped).
 */
export function priceLines(
  lines: readonly StoredCartLine[],
  variants: readonly StoreVariant[],
  availability: readonly VariantAvailability[],
  opts: { requested?: ReadonlyMap<string, number> } = {},
): PricedLines {
  const vById = new Map(variants.map((v) => [v.id, v]));
  const aById = new Map(availability.map((a) => [a.itemId, a]));
  const calcs: LineCalc[] = [];
  const removed: string[] = [];
  for (const l of lines) {
    const v = vById.get(l.variantId);
    if (!v) {
      removed.push(l.variantId);
      continue;
    }
    const maxQty = maxQtyFor(v, aById.get(v.id));
    const wanted = clampQty(opts.requested?.get(v.id) ?? l.qty) || 1;
    const base = {
      variantId: v.id,
      productId: v.productId,
      productSlug: v.productSlug,
      name: v.productName,
      variantTitle: v.title,
      image: v.image,
      price: v.price,
      mrp: v.mrp,
      maxQty,
    };
    const priceChanged = l.price !== undefined && l.price !== null && l.price !== v.price;
    let line: PricedLine;
    if (maxQty <= 0) {
      line = { ...base, qty: wanted, lineTotal: 0, available: false, problem: "unavailable" };
    } else {
      const qty = Math.min(wanted, maxQty);
      line = { ...base, qty, lineTotal: qty * v.price, available: true };
      // One flag per line: fewer units than asked for matters most (checkout refuses it).
      if (qty < wanted) line.problem = "qty_reduced";
      else if (priceChanged) line.problem = "price_changed";
    }
    calcs.push({ line, categoryId: v.categoryId, weightGrams: v.weightGrams ?? 0, taxInclusive: v.taxInclusive, gstRate: v.gstRate, ...(v.gstRule ? { gstRule: v.gstRule } : {}), priceChanged });
  }
  return { calcs, removed };
}

/** The coupon context for the available lines (what orders sends to coupons at checkout). */
export function couponContext(calcs: readonly LineCalc[]): { subtotal: number; lines: CouponContextLine[] } {
  const avail = calcs.filter((c) => c.line.available);
  return {
    subtotal: avail.reduce((s, c) => s + c.line.lineTotal, 0),
    lines: avail.map((c) => ({ productId: c.line.productId, categoryId: c.categoryId, amount: c.line.lineTotal })),
  };
}

/**
 * GST added on top of tax-exclusive lines, after their share of the discount (estimate for display). With
 * `lineDiscounts` (same order as `calcs`) each line's own discount is used instead of a proportional share.
 */
export function estimateTaxExtra(calcs: readonly LineCalc[], discount: number, lineDiscounts?: readonly number[]): number {
  const avail = calcs.filter((c) => c.line.available);
  const subtotal = avail.reduce((s, c) => s + c.line.lineTotal, 0);
  if (subtotal <= 0) return 0;
  let tax = 0;
  calcs.forEach((c, i) => {
    if (!c.line.available || c.taxInclusive || !c.gstRate) return;
    const share = lineDiscounts ? Math.min(lineDiscounts[i] ?? 0, c.line.lineTotal) : Math.round((discount * c.line.lineTotal) / subtotal);
    // Price-band products are taxed at the band of the piece's value after its discount share.
    const rate = c.gstRule ? effectiveGstRate(c.gstRule, c.line.lineTotal - share, c.line.qty) : c.gstRate;
    tax += Math.round(((c.line.lineTotal - share) * rate) / 100);
  });
  return Math.max(0, tax);
}

/** The `priceCart` lines for the available cart lines (same order as `couponContext`). */
export function offerLines(calcs: readonly LineCalc[]) {
  return calcs
    .filter((c) => c.line.available)
    .map((c) => ({ variantId: c.line.variantId, productId: c.line.productId, categoryId: c.categoryId, unitPrice: c.line.price, qty: c.line.qty, amount: c.line.lineTotal }));
}

/** Free-delivery progress for the cart total (goods after discounts). A free-shipping coupon unlocks it. */
export function freeShippingState(info: { threshold: number | null; scope: "zone" | "shop" } | null, total: number, freeCoupon: boolean): CartFreeShipping | null {
  if (freeCoupon) return { threshold: info?.threshold ?? null, remaining: 0, unlocked: true, scope: info?.scope ?? "shop" };
  if (!info || info.threshold === null) return null;
  const remaining = Math.max(0, info.threshold - Math.max(0, total));
  return { threshold: info.threshold, remaining, unlocked: remaining === 0, scope: info.scope };
}

export interface BuildCartInput {
  token: string;
  priced: PricedLines;
  /** The cart's coupon code and its evaluation (null result = not evaluated, e.g. empty cart or coupons off). */
  coupon: { code: string; result: CouponEvaluationResult | null } | null;
  pincode: string | null;
  delivery: CartDelivery | null;
  /** Delivery was asked for (pincode set) but the quote failed. */
  deliveryFailed?: boolean;
  /**
   * Automatic offers + coupon (coupons' `priceCart` over the available lines, in order). When given, the coupon's
   * result is read from it (`coupon.result` may then be null).
   */
  pricing?: CartPricingResult | null;
  /** Decorated nudges / gifts (product cards); default: `pricing`'s own. */
  nudges?: CartNudge[];
  gifts?: CartGift[];
  /** Free-delivery threshold from the delivery module; null when unknown. */
  freeShipping?: { threshold: number | null; scope: "zone" | "shop" } | null;
}

/** Assembles the PricedCart (pure): subtotal and discount in charged prices, coupon reasons surfaced, warnings. */
export function buildPricedCart(input: BuildCartInput): PricedCart {
  const { calcs, removed } = input.priced;
  const lines = calcs.map((c) => c.line);
  const available = lines.filter((l) => l.available);
  const subtotal = available.reduce((s, l) => s + l.lineTotal, 0);
  const itemCount = available.reduce((s, l) => s + l.qty, 0);
  const weightGrams = calcs.filter((c) => c.line.available).reduce((s, c) => s + c.weightGrams * c.line.qty, 0);

  let coupon: CartCoupon | null = null;
  let discount = 0;
  const pricing = input.pricing ?? null;
  // Offers are worked out over the available lines only, in order: map them back onto the cart's lines.
  const perLine = calcs.map(() => 0);
  let offerDiscount = 0;
  if (pricing) {
    let k = 0;
    calcs.forEach((c, i) => {
      if (!c.line.available) return;
      const p = pricing.lines[k++];
      if (!p) return;
      const off = Math.max(0, Math.min(Math.round(p.offerDiscount), c.line.lineTotal));
      perLine[i] = Math.min(Math.max(0, Math.round(p.discount)), c.line.lineTotal);
      if (off > 0) {
        c.line.offerDiscount = off;
        c.line.offerIds = p.offerIds;
        offerDiscount += off;
      }
    });
  }
  if (input.coupon) {
    const r = pricing ? (pricing.coupon ?? input.coupon.result) : input.coupon.result;
    if (r && r.valid) {
      discount = Math.max(0, Math.min(Math.round(pricing ? pricing.couponDiscount : r.discount), subtotal - offerDiscount));
      coupon = { code: input.coupon.code, valid: true, freeShipping: r.freeShipping };
    } else {
      coupon = { code: input.coupon.code, valid: false, reason: r ? r.reason : subtotal > 0 ? "not_found" : "empty_cart", freeShipping: false };
    }
  }

  const warnings: CartWarning[] = [];
  if (lines.some((l) => !l.available)) warnings.push("items_unavailable");
  if (removed.length) warnings.push("items_removed");
  if (calcs.some((c) => c.line.available && c.priceChanged)) warnings.push("prices_changed");
  if (lines.some((l) => l.problem === "qty_reduced")) warnings.push("qty_reduced");
  if (coupon && !coupon.valid) warnings.push("coupon_invalid");
  if (input.delivery && !input.delivery.serviceable) warnings.push("not_serviceable");
  if (input.deliveryFailed) warnings.push("delivery_unavailable");

  return {
    token: input.token,
    lines,
    itemCount,
    subtotal,
    discount,
    coupon,
    offerDiscount,
    offers: (pricing?.offers ?? [])
      .filter((o) => o.discount > 0)
      .map((o) => ({ id: o.offerId, kind: o.kind, name: o.name, label: o.label, discount: o.discount, applications: o.applications })),
    nudges: input.nudges ?? pricing?.nudges ?? [],
    gifts: input.gifts ?? pricing?.gifts ?? [],
    freeShipping: itemCount > 0 ? freeShippingState(input.freeShipping ?? null, subtotal - offerDiscount - discount, !!coupon?.valid && coupon.freeShipping) : null,
    pincode: input.pincode,
    delivery: input.delivery,
    total: subtotal - offerDiscount - discount,
    taxExtra: pricing ? estimateTaxExtra(calcs, 0, perLine) : estimateTaxExtra(calcs, discount),
    weightGrams,
    warnings,
  };
}

/**
 * Merges an anonymous cart's lines into the shopper's (pure): quantities of the same variant are summed and capped at
 * MAX_LINE_QTY; the shopper's lines come first; at most MAX_CART_LINES lines.
 */
export function mergeCartLines(target: readonly StoredCartLine[], source: readonly StoredCartLine[]): StoredCartLine[] {
  const out: StoredCartLine[] = [];
  const index = new Map<string, number>();
  for (const l of [...target, ...source]) {
    const qty = clampQty(l.qty);
    if (qty <= 0) continue;
    const at = index.get(l.variantId);
    if (at !== undefined) {
      const cur = out[at]!;
      out[at] = { ...cur, qty: Math.min(MAX_LINE_QTY, cur.qty + qty), price: cur.price ?? l.price ?? null };
      continue;
    }
    if (out.length >= MAX_CART_LINES) continue;
    index.set(l.variantId, out.length);
    out.push({ variantId: l.variantId, qty, price: l.price ?? null });
  }
  return out;
}

/** Sets (qty > 0) or removes (qty 0) a line (pure). New lines go to the end. */
export function setCartLine(lines: readonly StoredCartLine[], line: StoredCartLine): StoredCartLine[] {
  const qty = clampQty(line.qty);
  const rest = lines.filter((l) => l.variantId !== line.variantId);
  if (qty <= 0) return rest;
  const at = lines.findIndex((l) => l.variantId === line.variantId);
  const next = { variantId: line.variantId, qty, price: line.price ?? null };
  if (at < 0) return [...rest, next];
  return lines.map((l) => (l.variantId === line.variantId ? next : l));
}
