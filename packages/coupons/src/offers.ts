// Pure automatic-offer pricing: buy X get Y, tiers, free gifts and bundles, the best-for-customer combination with
// coupons, nudges ("add 1 more to get 1 free") and labels. No I/O; money in whole paise.
import { allocateDiscount, evaluateCoupon, type CouponEvaluation, type CouponRule, type CouponUsage } from "./logic";
import type {
  BundleConfig,
  BundleItem,
  BxgyConfig,
  FreeGiftConfig,
  OfferAppliesTo,
  OfferConfig,
  OfferKind,
  TieredConfig,
} from "./schema";

/** A cart / order line as offers see it. */
export interface PricingLine {
  variantId: string;
  productId: string;
  categoryId?: string | null;
  /** Collections the product belongs to (only needed for collection-scoped offers). */
  collectionIds?: readonly string[];
  /** Paise per unit as charged. */
  unitPrice: number;
  qty: number;
  /** Paise as charged for the line (default unitPrice × qty). */
  amount?: number;
}

/** The offer fields pricing needs (an OfferRow satisfies it). */
export interface OfferRule {
  id: string;
  kind: OfferKind;
  name: string;
  appliesTo: OfferAppliesTo;
  targetIds: string[];
  config: OfferConfig;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  channels: string[];
  stackable: boolean;
  combinesWithCoupons: boolean;
  active: boolean;
}

export type OfferReward =
  | { type: "units"; qty: number; percent: number }
  | { type: "percent"; value: number }
  | { type: "flat"; value: number }
  | { type: "gift"; productId: string; variantId: string; qty: number }
  | { type: "bundle" };

/** "You're close": what to add to unlock (or repeat) an offer. */
export interface OfferNudge {
  offerId: string;
  kind: OfferKind;
  name: string;
  /** English summary of the offer ("Buy 2 get 1 free"); clients translate from `kind` + `reward`. */
  label: string;
  /** Units to add (bxgy, tiered by qty). */
  addQty?: number;
  /** Paise to add (tiered by amount, free gift). */
  addAmount?: number;
  reward: OfferReward;
  /** What counts towards it ("all" = anything in the shop, so any suggestion helps). */
  scope: OfferAppliesTo;
  /** Products that would complete it (bundles: the missing items; scope products when the offer names them). */
  productIds?: string[];
}

export interface GiftState {
  offerId: string;
  name: string;
  productId: string;
  variantId: string;
  qty: number;
  /** The spend is reached. */
  unlocked: boolean;
  /** The gift is in the cart (and free when unlocked). */
  inCart: boolean;
  /** Paise still to spend (0 when unlocked). */
  remaining: number;
}

/** One offer worked out on the cart (before combining). */
export interface OfferOutcome {
  offerId: string;
  kind: OfferKind;
  name: string;
  label: string;
  stackable: boolean;
  combinesWithCoupons: boolean;
  /** Paise off, = Σ lineDiscounts. */
  discount: number;
  /** Same order as the lines; never above a line's amount. */
  lineDiscounts: number[];
  /** Times it applied (sets of a bundle / BxGy, 1 for tiers and gifts). */
  applications: number;
  nudge: OfferNudge | null;
  gift: GiftState | null;
}

export interface AppliedOffer {
  offerId: string;
  kind: OfferKind;
  name: string;
  label: string;
  discount: number;
  lineDiscounts: number[];
  applications: number;
}

/** Active offer redemptions so far, by offer id. */
export type OfferUsageMap = ReadonlyMap<string, CouponUsage>;

const lineAmount = (l: PricingLine) => Math.max(0, Math.round(l.amount ?? l.unitPrice * l.qty));
const wholeUnits = (l: PricingLine) => Math.max(0, Math.floor(l.qty));
const rupees = (paise: number) => {
  const r = paise / 100;
  return `₹${Number.isInteger(r) ? r.toLocaleString("en-IN") : r.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/** Whether a line counts for the offer's scope. */
export function inScope(rule: Pick<OfferRule, "appliesTo" | "targetIds">, l: PricingLine): boolean {
  if (rule.appliesTo === "all") return true;
  const targets = rule.targetIds;
  if (rule.appliesTo === "products") return targets.includes(l.productId);
  if (rule.appliesTo === "categories") return !!l.categoryId && targets.includes(l.categoryId);
  return (l.collectionIds ?? []).some((c) => targets.includes(c));
}

/** Switched on, on this channel, inside its dates and under its usage limits. */
export function isOfferLive(rule: OfferRule, ctx: { channel: string; now: Date; customerKey?: string | null }, usage?: CouponUsage): boolean {
  if (!rule.active || !rule.channels.includes(ctx.channel)) return false;
  const t = ctx.now.getTime();
  if (rule.startsAt && t < rule.startsAt.getTime()) return false;
  if (rule.endsAt && t > rule.endsAt.getTime()) return false;
  if (usage && rule.usageLimit !== null && usage.total >= rule.usageLimit) return false;
  if (usage && rule.perCustomerLimit !== null && ctx.customerKey && usage.byCustomer >= rule.perCustomerLimit) return false;
  return true;
}

/** English one-liner for badges, staff lists and nudges. */
export function offerLabel(rule: Pick<OfferRule, "kind" | "config">): string {
  switch (rule.kind) {
    case "bxgy": {
      const c = rule.config as BxgyConfig;
      return c.getPercent >= 100 ? `Buy ${c.buyQty} get ${c.getQty} free` : `Buy ${c.buyQty} get ${c.getQty} at ${c.getPercent}% off`;
    }
    case "tiered": {
      const c = rule.config as TieredConfig;
      const t = [...c.tiers].sort((a, b) => a.min - b.min)[0];
      if (!t) return "Tiered offer";
      const off = t.type === "percent" ? `${t.value}% off` : `${rupees(t.value)} off`;
      return c.basis === "qty" ? `Buy ${t.min}+ get ${off}` : `Spend ${rupees(t.min)} get ${off}`;
    }
    case "free_gift": {
      const c = rule.config as FreeGiftConfig;
      return `Free gift on orders above ${rupees(c.minAmount)}`;
    }
    case "bundle": {
      const c = rule.config as BundleConfig;
      return c.priceType === "fixed" ? `Combo for ${rupees(c.value)}` : `${c.value}% off the combo`;
    }
  }
}

// ------------------------------------------------------------------ single offers

const empty = (rule: OfferRule, lines: readonly PricingLine[]): OfferOutcome => ({
  offerId: rule.id,
  kind: rule.kind,
  name: rule.name,
  label: offerLabel(rule),
  stackable: rule.stackable,
  combinesWithCoupons: rule.combinesWithCoupons,
  discount: 0,
  lineDiscounts: lines.map(() => 0),
  applications: 0,
  nudge: null,
  gift: null,
});

const capToLines = (out: number[], lines: readonly PricingLine[]) => out.map((d, i) => Math.max(0, Math.min(d, lineAmount(lines[i]!))));
const sum = (a: readonly number[]) => a.reduce((s, v) => s + v, 0);
const finish = (o: OfferOutcome, lines: readonly PricingLine[], d: number[]): OfferOutcome => {
  const lineDiscounts = capToLines(d, lines);
  return { ...o, lineDiscounts, discount: sum(lineDiscounts) };
};
const scopeProducts = (rule: OfferRule) => (rule.appliesTo === "products" ? rule.targetIds.slice(0, 12) : undefined);

/**
 * Buy X get Y: every full group of X + Y units in scope gives the Y cheapest units of the cart's in-scope units
 * `getPercent`% off (100 = free), up to `maxApplications` groups. Nudge: units to add for the next reward.
 */
export function evaluateBxgy(rule: OfferRule, lines: readonly PricingLine[]): OfferOutcome {
  const c = rule.config as BxgyConfig;
  const base = empty(rule, lines);
  const buy = Math.max(1, Math.floor(c.buyQty));
  const get = Math.max(1, Math.floor(c.getQty));
  const pct = Math.min(100, Math.max(1, c.getPercent));
  const group = buy + get;
  const units: { i: number; price: number }[] = [];
  lines.forEach((l, i) => {
    if (!inScope(rule, l)) return;
    for (let k = 0; k < wholeUnits(l); k++) units.push({ i, price: Math.max(0, l.unitPrice) });
  });
  const n = units.length;
  let sets = Math.floor(n / group);
  const max = c.maxApplications ?? null;
  if (max !== null && max > 0) sets = Math.min(sets, max);
  units.sort((a, b) => a.price - b.price || a.i - b.i);
  const d = lines.map(() => 0);
  for (const u of units.slice(0, sets * get)) d[u.i]! += pct >= 100 ? u.price : Math.round((u.price * pct) / 100);
  const out = finish({ ...base, applications: sets }, lines, d);
  const capped = max !== null && max > 0 && sets >= max;
  const r = n % group;
  if (n > 0 && !capped && (sets === 0 || r > 0)) {
    out.nudge = {
      offerId: rule.id,
      kind: rule.kind,
      name: rule.name,
      label: base.label,
      scope: rule.appliesTo,
      addQty: group - r,
      reward: { type: "units", qty: get, percent: pct },
      productIds: scopeProducts(rule),
    };
  }
  return out;
}

/** Tiered: the highest tier reached by in-scope units (basis qty) or spend (basis amount), spread over those lines. */
export function evaluateTiered(rule: OfferRule, lines: readonly PricingLine[]): OfferOutcome {
  const c = rule.config as TieredConfig;
  const base = empty(rule, lines);
  const mask = lines.map((l) => inScope(rule, l));
  const amounts = lines.map(lineAmount);
  const eligible = sum(amounts.filter((_, i) => mask[i]));
  const basis = c.basis === "qty" ? lines.reduce((s, l, i) => s + (mask[i] ? wholeUnits(l) : 0), 0) : eligible;
  const tiers = [...c.tiers].sort((a, b) => a.min - b.min);
  const reached = tiers.filter((t) => basis >= t.min).pop();
  const next = tiers.find((t) => t.min > basis);
  let out: OfferOutcome = base;
  if (reached && eligible > 0) {
    const total = reached.type === "percent" ? Math.round((eligible * Math.min(100, reached.value)) / 100) : Math.min(reached.value, eligible);
    out = finish({ ...base, applications: 1 }, lines, allocateDiscount(total, amounts, mask));
  }
  if (next && basis > 0) {
    out.nudge = {
      offerId: rule.id,
      kind: rule.kind,
      name: rule.name,
      label: base.label,
      scope: rule.appliesTo,
      ...(c.basis === "qty" ? { addQty: next.min - basis } : { addAmount: next.min - basis }),
      reward: next.type === "percent" ? { type: "percent", value: next.value } : { type: "flat", value: next.value },
      productIds: scopeProducts(rule),
    };
  }
  return out;
}

/**
 * Free gift: once in-scope spend (the gift lines left out) reaches `minAmount`, up to `giftQty` units of the gift
 * variant are free when they are in the cart. The gift state tells the cart to offer "Add your free gift".
 */
export function evaluateFreeGift(rule: OfferRule, lines: readonly PricingLine[]): OfferOutcome {
  const c = rule.config as FreeGiftConfig;
  const base = empty(rule, lines);
  const isGift = (l: PricingLine) => l.variantId === c.giftVariantId;
  const spend = lines.reduce((s, l) => s + (!isGift(l) && inScope(rule, l) ? lineAmount(l) : 0), 0);
  const unlocked = spend >= c.minAmount && spend > 0;
  const d = lines.map(() => 0);
  let left = Math.max(1, Math.floor(c.giftQty));
  let inCart = false;
  lines.forEach((l, i) => {
    if (!isGift(l)) return;
    inCart = true;
    if (!unlocked || left <= 0) return;
    const take = Math.min(left, wholeUnits(l));
    d[i] = take * Math.max(0, l.unitPrice);
    left -= take;
  });
  const out = finish({ ...base, applications: unlocked && inCart ? 1 : 0 }, lines, d);
  const remaining = Math.max(0, c.minAmount - spend);
  if (spend > 0 || inCart) {
    out.gift = { offerId: rule.id, name: rule.name, productId: c.giftProductId, variantId: c.giftVariantId, qty: Math.max(1, Math.floor(c.giftQty)), unlocked, inCart, remaining };
  }
  if (!unlocked && spend > 0) {
    out.nudge = {
      offerId: rule.id,
      kind: rule.kind,
      name: rule.name,
      label: base.label,
      scope: rule.appliesTo,
      addAmount: remaining,
      reward: { type: "gift", productId: c.giftProductId, variantId: c.giftVariantId, qty: Math.max(1, Math.floor(c.giftQty)) },
    };
  }
  return out;
}

const matchesItem = (item: BundleItem, l: PricingLine) => (item.variantId ? l.variantId === item.variantId : l.productId === item.productId);

/**
 * Bundle: counts complete sets in the cart (each item's qty taken from matching lines, in line order); each set costs
 * `value` (fixed) or gets `value`% off, the saving spread over the set's units by price. Nudge: the missing items
 * when part of a set is in the cart.
 */
export function evaluateBundle(rule: OfferRule, lines: readonly PricingLine[]): OfferOutcome {
  const c = rule.config as BundleConfig;
  const base = empty(rule, lines);
  const items = c.items.filter((it) => it.qty > 0);
  if (items.length === 0) return base;
  const left = lines.map(wholeUnits);
  const d = lines.map(() => 0);
  let sets = 0;
  for (let guard = 0; guard < 99; guard++) {
    const trial = [...left];
    const take = lines.map(() => 0);
    let ok = true;
    for (const it of items) {
      let need = Math.floor(it.qty);
      lines.forEach((l, i) => {
        if (need <= 0 || !matchesItem(it, l)) return;
        const n = Math.min(need, trial[i]!);
        trial[i]! -= n;
        take[i]! += n;
        need -= n;
      });
      if (need > 0) {
        ok = false;
        break;
      }
    }
    if (!ok) break;
    const parts = take.map((n, i) => n * Math.max(0, lines[i]!.unitPrice));
    const regular = sum(parts);
    const saving = c.priceType === "fixed" ? Math.max(0, regular - c.value) : Math.round((regular * Math.min(100, c.value)) / 100);
    allocateDiscount(saving, parts, parts.map((p) => p > 0)).forEach((v, i) => (d[i]! += v));
    for (let i = 0; i < left.length; i++) left[i] = trial[i]!;
    sets++;
  }
  const out = finish({ ...base, applications: sets }, lines, d);
  if (sets === 0) {
    const have = items.filter((it) => lines.some((l) => matchesItem(it, l) && wholeUnits(l) > 0));
    if (have.length > 0) {
      const missing = items.filter((it) => {
        const units = lines.reduce((s, l) => s + (matchesItem(it, l) ? wholeUnits(l) : 0), 0);
        return units < it.qty;
      });
      out.nudge = {
        offerId: rule.id,
        kind: rule.kind,
        name: rule.name,
        label: base.label,
      scope: rule.appliesTo,
        addQty: missing.reduce((s, it) => s + it.qty - lines.reduce((u, l) => u + (matchesItem(it, l) ? wholeUnits(l) : 0), 0), 0),
        reward: { type: "bundle" },
        productIds: [...new Set(missing.map((it) => it.productId))],
      };
    }
  }
  return out;
}

export function evaluateOffer(rule: OfferRule, lines: readonly PricingLine[]): OfferOutcome {
  switch (rule.kind) {
    case "bxgy":
      return evaluateBxgy(rule, lines);
    case "tiered":
      return evaluateTiered(rule, lines);
    case "free_gift":
      return evaluateFreeGift(rule, lines);
    case "bundle":
      return evaluateBundle(rule, lines);
  }
}

// ------------------------------------------------------------------ combining

export interface OfferSelection {
  applied: AppliedOffer[];
  /** Σ per line over the applied offers (capped at each line's amount). */
  lineDiscounts: number[];
  discount: number;
}

const toApplied = (o: OfferOutcome, lineDiscounts: number[]): AppliedOffer => ({
  offerId: o.offerId,
  kind: o.kind,
  name: o.name,
  label: o.label,
  discount: sum(lineDiscounts),
  lineDiscounts,
  applications: o.applications,
});

/**
 * Best for the customer: the larger of (a) the best single non-stackable offer and (b) every stackable offer applied
 * one after another (bigger first), each on what the lines still cost after the earlier ones. Ties go to (a).
 */
export function selectOffers(outcomes: readonly OfferOutcome[], lines: readonly PricingLine[]): OfferSelection {
  const zero = lines.map(() => 0);
  const useful = outcomes.filter((o) => o.discount > 0);
  const exclusive = useful.filter((o) => !o.stackable).sort((a, b) => b.discount - a.discount || a.offerId.localeCompare(b.offerId))[0];
  const a: OfferSelection = exclusive ? { applied: [toApplied(exclusive, exclusive.lineDiscounts)], lineDiscounts: [...exclusive.lineDiscounts], discount: exclusive.discount } : { applied: [], lineDiscounts: zero, discount: 0 };

  const remaining = lines.map(lineAmount);
  const b: OfferSelection = { applied: [], lineDiscounts: lines.map(() => 0), discount: 0 };
  for (const o of useful.filter((x) => x.stackable).sort((x, y) => y.discount - x.discount || x.offerId.localeCompare(y.offerId))) {
    const part = o.lineDiscounts.map((v, i) => Math.min(v, remaining[i]!));
    if (sum(part) <= 0) continue;
    part.forEach((v, i) => {
      remaining[i]! -= v;
      b.lineDiscounts[i]! += v;
    });
    b.applied.push(toApplied(o, part));
  }
  b.discount = sum(b.lineDiscounts);
  return b.discount > a.discount ? b : a;
}

// ------------------------------------------------------------------ the whole cart

export interface CartPricingInput {
  channel: string;
  lines: readonly PricingLine[];
  /** Paise; waived by a free-shipping coupon. */
  shipping?: number;
  now: Date;
  offers: readonly OfferRule[];
  offerUsage?: OfferUsageMap;
  customerKey?: string | null;
  isFirstOrder?: boolean;
  /** The cart's coupon code: its rule (null = unknown code) and usage. */
  coupon?: { code: string; rule: CouponRule | null; usage: CouponUsage } | null;
}

export interface PricedCartLine {
  offerDiscount: number;
  couponDiscount: number;
  /** offerDiscount + couponDiscount (≤ the line amount). */
  discount: number;
  offerIds: string[];
}

export interface CartPricing {
  lines: PricedCartLine[];
  /** offers + coupon per line, as charged (what orders passes to the GST totals). */
  lineDiscounts: number[];
  offers: AppliedOffer[];
  offerDiscount: number;
  /** The coupon's evaluation on the cart after offers (null without a code). `not_combinable` when an offer beats it. */
  coupon: CouponEvaluation | null;
  couponDiscount: number;
  freeShipping: boolean;
  shippingDiscount: number;
  /** offerDiscount + couponDiscount. */
  discount: number;
  nudges: OfferNudge[];
  gifts: GiftState[];
}

function couponOn(input: CartPricingInput, offerLines: readonly number[]): CouponEvaluation {
  const c = input.coupon!;
  const ctxLines = input.lines.map((l, i) => ({ productId: l.productId, categoryId: l.categoryId ?? null, amount: Math.max(0, lineAmount(l) - (offerLines[i] ?? 0)) }));
  return evaluateCoupon(
    c.rule,
    {
      channel: input.channel,
      subtotal: sum(ctxLines.map((l) => l.amount)),
      shipping: input.shipping,
      lines: ctxLines,
      customerKey: input.customerKey ?? null,
      isFirstOrder: input.isFirstOrder,
    },
    c.usage,
    input.now,
  );
}

/**
 * Prices offers and the coupon together, best for the customer:
 * 1. offers are combined by `selectOffers`;
 * 2. the coupon is evaluated on what the lines cost after them. When every applied offer allows coupons (or the coupon
 *    only waives shipping) both apply;
 * 3. otherwise the coupon is tried with only the coupon-friendly offers; whichever total discount is larger wins (ties
 *    go to the coupon the shopper typed). A losing coupon comes back invalid with reason `not_combinable`.
 */
export function priceCartOffers(input: CartPricingInput): CartPricing {
  const lines = input.lines;
  const live = input.offers.filter((r) => isOfferLive(r, { channel: input.channel, now: input.now, customerKey: input.customerKey }, input.offerUsage?.get(r.id)));
  const outcomes = live.map((r) => evaluateOffer(r, lines));
  const byId = new Map(live.map((r) => [r.id, r]));
  let sel = selectOffers(outcomes, lines);
  let coupon: CouponEvaluation | null = null;

  if (input.coupon) {
    const withAll = couponOn(input, sel.lineDiscounts);
    if (!withAll.valid) {
      coupon = withAll;
    } else if (withAll.freeShipping || sel.applied.every((o) => byId.get(o.offerId)?.combinesWithCoupons)) {
      coupon = withAll;
    } else {
      const friendly = selectOffers(outcomes.filter((o) => o.combinesWithCoupons), lines);
      const alt = couponOn(input, friendly.lineDiscounts);
      if (alt.valid && friendly.discount + alt.discount >= sel.discount) {
        sel = friendly;
        coupon = alt;
      } else {
        coupon = { valid: false, reason: "not_combinable", message: "A better offer is already applied to your cart" };
      }
    }
  }

  const couponLines = coupon?.valid && coupon.lineDiscounts.length === lines.length ? coupon.lineDiscounts : lines.map(() => 0);
  const appliedIds = new Set(sel.applied.map((o) => o.offerId));
  const priced: PricedCartLine[] = lines.map((l, i) => {
    const offer = sel.lineDiscounts[i] ?? 0;
    const cpn = Math.min(couponLines[i] ?? 0, Math.max(0, lineAmount(l) - offer));
    return {
      offerDiscount: offer,
      couponDiscount: cpn,
      discount: offer + cpn,
      offerIds: sel.applied.filter((o) => (o.lineDiscounts[i] ?? 0) > 0).map((o) => o.offerId),
    };
  });
  const couponDiscount = sum(priced.map((p) => p.couponDiscount));
  const valid = coupon?.valid ? coupon : null;
  return {
    lines: priced,
    lineDiscounts: priced.map((p) => p.discount),
    offers: sel.applied,
    offerDiscount: sel.discount,
    coupon: valid ? { ...valid, discount: couponDiscount, lineDiscounts: priced.map((p) => p.couponDiscount) } : coupon,
    couponDiscount,
    freeShipping: !!valid?.freeShipping,
    shippingDiscount: valid?.shippingDiscount ?? 0,
    discount: sel.discount + couponDiscount,
    // Offers already giving their best (applied, nothing more to add) don't nudge; the others do.
    nudges: outcomes.filter((o) => o.nudge && !(appliedIds.has(o.offerId) && o.kind !== "bxgy" && o.kind !== "tiered")).map((o) => o.nudge!),
    gifts: outcomes.filter((o) => o.gift).map((o) => o.gift!),
  };
}

/** Offers that concern a product (badges on its page): scope match, bundles naming it, gifts of it. */
export function offersForProduct<R extends OfferRule>(rules: readonly R[], p: { productId: string; categoryId?: string | null; collectionIds?: readonly string[] }): R[] {
  const line: PricingLine = { variantId: "", productId: p.productId, categoryId: p.categoryId ?? null, collectionIds: p.collectionIds ?? [], unitPrice: 0, qty: 0 };
  return rules.filter((r) => {
    if (r.kind === "bundle") return (r.config as BundleConfig).items.some((it) => it.productId === p.productId);
    if (r.kind === "free_gift" && (r.config as FreeGiftConfig).giftProductId === p.productId) return true;
    return inScope(r, line);
  });
}
