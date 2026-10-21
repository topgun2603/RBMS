// Pure rules for the offers & combos screens: the editor draft ⇄ API input, summaries and status. Unit-tested.
import { couponWindow, couponState, type CouponState } from "./coupons";
import { money, paiseToInput, rupeesToPaise } from "./format";
import type {
  BundleConfig,
  BxgyConfig,
  CouponChannel,
  FreeGiftConfig,
  Offer,
  OfferAppliesTo,
  OfferInput,
  OfferKind,
  TieredConfig,
} from "./types";

type T = (key: string, vars?: Record<string, string | number>) => string;

export interface TierDraft {
  min: string;
  type: "percent" | "flat";
  value: string;
}

export interface BundleItemDraft {
  productId: string;
  /** null = any variant of the product. */
  variantId: string | null;
  qty: number;
  /** The variant picked when the item was added (lets "any option" switch back). */
  pinned: string | null;
  /** Display only. */
  name?: string;
  variantTitle?: string;
  price?: number;
  image?: string | null;
}

export interface OfferDraft {
  kind: OfferKind;
  name: string;
  description: string;
  appliesTo: OfferAppliesTo;
  targetIds: string[];
  buyQty: string;
  getQty: string;
  getPercent: string;
  maxApplications: string;
  basis: "qty" | "amount";
  tiers: TierDraft[];
  minAmount: string;
  gift: { productId: string; variantId: string; name?: string; price?: number } | null;
  giftQty: string;
  items: BundleItemDraft[];
  priceType: "fixed" | "percent";
  bundleValue: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perCustomerLimit: string;
  channels: CouponChannel[];
  stackable: boolean;
  combinesWithCoupons: boolean;
  active: boolean;
}

/** The editor's starting point: an existing offer, or sensible defaults per kind. */
export function offerToDraft(o: Offer | null | undefined, kind: OfferKind = "bxgy"): OfferDraft {
  const k = o?.kind ?? kind;
  const w = o ? couponWindow(o) : { from: null, to: null };
  const bx = (k === "bxgy" ? o?.config : null) as BxgyConfig | null;
  const tr = (k === "tiered" ? o?.config : null) as TieredConfig | null;
  const gf = (k === "free_gift" ? o?.config : null) as FreeGiftConfig | null;
  const bd = (k === "bundle" ? o?.config : null) as BundleConfig | null;
  const basis = tr?.basis ?? "qty";
  return {
    kind: k,
    name: o?.name ?? "",
    description: o?.description ?? "",
    appliesTo: o?.appliesTo ?? "all",
    targetIds: o?.targetIds ?? [],
    buyQty: String(bx?.buyQty ?? 2),
    getQty: String(bx?.getQty ?? 1),
    getPercent: String(bx?.getPercent ?? 100),
    maxApplications: bx?.maxApplications ? String(bx.maxApplications) : "",
    basis,
    tiers: tr?.tiers.map((t) => ({ min: basis === "amount" ? paiseToInput(t.min) : String(t.min), type: t.type, value: t.type === "flat" ? paiseToInput(t.value) : String(t.value) })) ?? [{ min: "3", type: "percent", value: "10" }],
    minAmount: gf ? paiseToInput(gf.minAmount) : "",
    gift: gf ? { productId: gf.giftProductId, variantId: gf.giftVariantId } : null,
    giftQty: String(gf?.giftQty ?? 1),
    items: bd?.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty, pinned: i.variantId })) ?? [],
    priceType: bd?.priceType ?? "fixed",
    bundleValue: bd ? (bd.priceType === "fixed" ? paiseToInput(bd.value) : String(bd.value)) : "",
    startsAt: w.from ?? "",
    endsAt: w.to ?? "",
    usageLimit: o?.usageLimit ? String(o.usageLimit) : "",
    perCustomerLimit: o?.perCustomerLimit ? String(o.perCustomerLimit) : "",
    channels: o?.channels ?? ["store"],
    stackable: o?.stackable ?? false,
    combinesWithCoupons: o?.combinesWithCoupons ?? false,
    active: o?.active ?? true,
  };
}

const whole = (v: string, min = 1, max = 99): number | null => {
  if (!/^\d+$/.test(v.trim())) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
};

export type DraftErrors = Partial<Record<string, string>>;

/** Draft → API body, or message keys per field. */
export function draftToInput(d: OfferDraft): { ok: true; input: OfferInput } | { ok: false; errors: DraftErrors } {
  const e: DraftErrors = {};
  if (!d.name.trim()) e.name = "orders.offers.validation.name";
  let config: OfferInput["config"] | null = null;
  if (d.kind === "bxgy") {
    const buyQty = whole(d.buyQty);
    const getQty = whole(d.getQty);
    const getPercent = whole(d.getPercent, 1, 100);
    const maxApplications = d.maxApplications.trim() ? whole(d.maxApplications) : null;
    if (buyQty === null) e.buyQty = "orders.offers.validation.qty";
    if (getQty === null) e.getQty = "orders.offers.validation.qty";
    if (getPercent === null) e.getPercent = "orders.offers.validation.percent";
    if (d.maxApplications.trim() && maxApplications === null) e.maxApplications = "orders.offers.validation.qty";
    if (buyQty && getQty && getPercent) config = { buyQty, getQty, getPercent, maxApplications };
  } else if (d.kind === "tiered") {
    const tiers = d.tiers.map((t, i) => {
      const min = d.basis === "qty" ? whole(t.min, 1, 9999) : rupeesToPaise(t.min);
      const value = t.type === "percent" ? whole(t.value, 1, 100) : rupeesToPaise(t.value);
      if (!min) e[`tiers.${i}.min`] = d.basis === "qty" ? "orders.offers.validation.qty" : "orders.validation.amount";
      if (!value) e[`tiers.${i}.value`] = t.type === "percent" ? "orders.offers.validation.percent" : "orders.validation.amount";
      return { min: min ?? 0, type: t.type, value: value ?? 0 };
    });
    if (!tiers.length) e.tiers = "orders.offers.validation.tiers";
    if (new Set(tiers.map((t) => t.min)).size !== tiers.length) e.tiers = "orders.offers.validation.tierMins";
    config = { basis: d.basis, tiers: [...tiers].sort((a, b) => a.min - b.min) };
  } else if (d.kind === "free_gift") {
    const minAmount = rupeesToPaise(d.minAmount);
    const giftQty = whole(d.giftQty);
    if (!minAmount) e.minAmount = "orders.validation.amount";
    if (!d.gift) e.gift = "orders.offers.validation.gift";
    if (giftQty === null) e.giftQty = "orders.offers.validation.qty";
    if (minAmount && d.gift && giftQty) config = { minAmount, giftProductId: d.gift.productId, giftVariantId: d.gift.variantId, giftQty };
  } else {
    const value = d.priceType === "fixed" ? rupeesToPaise(d.bundleValue) : whole(d.bundleValue, 1, 100);
    if (d.items.length < 2) e.items = "orders.offers.validation.items";
    if (!value) e.bundleValue = d.priceType === "fixed" ? "orders.validation.amount" : "orders.offers.validation.percent";
    if (value) config = { priceType: d.priceType, value, items: d.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })) };
  }
  if (d.kind !== "bundle" && d.appliesTo !== "all" && d.targetIds.length === 0) e.targetIds = "orders.offers.validation.targets";
  if (d.startsAt && d.endsAt && d.endsAt < d.startsAt) e.endsAt = "orders.coupons.validation.dates";
  if (d.usageLimit && !whole(d.usageLimit, 1, 10_000_000)) e.usageLimit = "orders.validation.whole";
  if (d.perCustomerLimit && !whole(d.perCustomerLimit, 1, 10_000)) e.perCustomerLimit = "orders.validation.whole";
  if (!d.channels.length) e.channels = "orders.coupons.validation.channels";
  if (Object.keys(e).length || !config) return { ok: false, errors: Object.keys(e).length ? e : { name: "orders.offers.validation.name" } };
  return {
    ok: true,
    input: {
      kind: d.kind,
      name: d.name.trim(),
      description: d.description.trim() || null,
      appliesTo: d.kind === "bundle" ? "all" : d.appliesTo,
      targetIds: d.kind === "bundle" || d.appliesTo === "all" ? [] : d.targetIds,
      config,
      startsAt: d.startsAt || null,
      endsAt: d.endsAt || null,
      usageLimit: d.usageLimit ? Number(d.usageLimit) : null,
      perCustomerLimit: d.perCustomerLimit ? Number(d.perCustomerLimit) : null,
      channels: d.channels,
      stackable: d.stackable,
      combinesWithCoupons: d.combinesWithCoupons,
      active: d.active,
    },
  };
}

/** "Buy 2 get 1 free", "Spend ₹999 get 10% off"… in the staff member's language. */
export function offerSummary(t: T, o: Pick<Offer, "kind" | "config">): string {
  if (o.kind === "bxgy") {
    const c = o.config as BxgyConfig;
    return c.getPercent >= 100 ? t("orders.offers.sum.bxgyFree", { buy: c.buyQty, get: c.getQty }) : t("orders.offers.sum.bxgyPct", { buy: c.buyQty, get: c.getQty, pct: c.getPercent });
  }
  if (o.kind === "tiered") {
    const c = o.config as TieredConfig;
    return c.tiers
      .map((tier) => {
        const min = c.basis === "qty" ? String(tier.min) : money(tier.min);
        const off = tier.type === "percent" ? `${tier.value}%` : money(tier.value);
        return t(c.basis === "qty" ? "orders.offers.sum.tierQty" : "orders.offers.sum.tierAmount", { min, off });
      })
      .join(" · ");
  }
  if (o.kind === "free_gift") return t("orders.offers.sum.gift", { amount: money((o.config as FreeGiftConfig).minAmount) });
  const c = o.config as BundleConfig;
  const items = t("orders.offers.sum.items", { count: c.items.length });
  return c.priceType === "fixed" ? t("orders.offers.sum.bundleFixed", { items, amount: money(c.value) }) : t("orders.offers.sum.bundlePct", { items, pct: c.value });
}

/** Same states as coupons (off, expired, scheduled, used up, live). */
export const offerState = (o: Pick<Offer, "active" | "startsAt" | "endsAt" | "usageLimit" | "usedCount">, now?: Date): CouponState => couponState(o, now);

/** Combo preview: regular price of the set and what the shopper pays (null while some price is unknown). */
export function bundlePreview(d: Pick<OfferDraft, "items" | "priceType" | "bundleValue">): { regular: number; price: number; save: number } | null {
  if (d.items.length < 2 || d.items.some((i) => i.price === undefined)) return null;
  const regular = d.items.reduce((s, i) => s + (i.price ?? 0) * i.qty, 0);
  const v = d.priceType === "fixed" ? rupeesToPaise(d.bundleValue) : Number(d.bundleValue);
  if (!v || !Number.isFinite(v)) return null;
  const price = d.priceType === "fixed" ? Math.min(v, regular) : regular - Math.round((regular * Math.min(100, v)) / 100);
  return { regular, price, save: Math.max(0, regular - price) };
}
