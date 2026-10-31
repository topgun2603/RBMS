// Pure order rules: status machine with side-effect plans, pricing/GST totals, payment status. No I/O.
import {
  computeInvoice,
  effectiveGstRate,
  exclusiveOf,
  formatINR,
  gstRateAtPrice,
  gstRateForInclusive,
  isGstRate,
  isInterState,
  lineAmount,
  type GstRate,
  type GstRateRule,
  type LineInput,
} from "@rbms/gst";
import type { CatalogItem, OrderSettings } from "./ports";
import type { OrderPaymentMethod, OrderPaymentStatus, OrderStatus, StockState } from "./schema";
import type { OrderLine, OrderTotals } from "./types";

// ------------------------------------------------------------------ status machine

/** The forward flow. Steps may be skipped forwards (e.g. a counter order placed → delivered). */
export const ORDER_FLOW: readonly OrderStatus[] = ["placed", "confirmed", "packed", "shipped", "delivered"];
export const CANCELLABLE: readonly OrderStatus[] = ["placed", "confirmed", "packed"];
/** Statuses waiting for the shop to act (dashboard "pending"). */
export const PENDING_STATUSES = ["placed", "confirmed", "packed"] as const;

export const ORDER_TEMPLATES = {
  placed: "order.placed",
  /** To the shop owner: a new order came in. */
  received: "order.received",
  confirmed: "order.confirmed",
  shipped: "order.shipped",
  delivered: "order.delivered",
  cancelled: "order.cancelled",
} as const;
export type OrderTemplate = (typeof ORDER_TEMPLATES)[keyof typeof ORDER_TEMPLATES];

export type OrderEffect =
  | { type: "stock.reserve" }
  | { type: "stock.release" }
  | { type: "stock.commit" }
  | { type: "stock.restock" }
  | { type: "coupon.redeem" }
  | { type: "coupon.release" }
  /** COD delivered: the cash was collected, mark the balance paid. */
  | { type: "payment.collectCod" }
  | { type: "invoice.create" }
  | { type: "invoice.cancel" }
  | { type: "notify"; template: OrderTemplate; audience: "customer" | "owner" };
export type OrderEffectType = OrderEffect["type"];

/** Effects that must succeed before an order exists; a failure undoes the earlier ones and refuses the order. */
export const BLOCKING_EFFECTS: readonly OrderEffectType[] = ["stock.reserve", "coupon.redeem"];
export const isBlocking = (e: OrderEffect) => BLOCKING_EFFECTS.includes(e.type);

/** Execution order inside one transition: stock, money, invoice, coupons, then messages. */
const EFFECT_ORDER: readonly OrderEffectType[] = [
  "stock.reserve",
  "stock.release",
  "stock.commit",
  "stock.restock",
  "coupon.redeem",
  "payment.collectCod",
  "invoice.create",
  "invoice.cancel",
  "coupon.release",
  "notify",
];
const byExecutionOrder = (a: OrderEffect, b: OrderEffect) => EFFECT_ORDER.indexOf(a.type) - EFFECT_ORDER.indexOf(b.type);

/** What the machine needs to know about an order. */
export interface TransitionState {
  status: OrderStatus;
  paymentMethod: OrderPaymentMethod;
  total: number;
  paid: number;
  stockState: StockState;
  couponCode: string | null;
  /** The order used automatic offers (their redemptions are released with the coupon's). */
  hasOffers?: boolean;
  invoiceId: string | null;
}

export interface TransitionOptions {
  invoiceOn: OrderSettings["invoiceOn"];
  /** Feature `orders.returns`. */
  returnsEnabled: boolean;
}

export type TransitionPlan =
  | { ok: true; from: OrderStatus; to: OrderStatus; /** statuses entered, in order */ path: OrderStatus[]; effects: OrderEffect[] }
  | { ok: false; code: "same_status" | "not_allowed" | "feature_disabled"; message: string };

/** Statuses an order may move to next. */
export function allowedTransitions(status: OrderStatus, opts: { returnsEnabled: boolean }): OrderStatus[] {
  const out: OrderStatus[] = [];
  const i = ORDER_FLOW.indexOf(status);
  if (i >= 0) out.push(...ORDER_FLOW.slice(i + 1));
  if (CANCELLABLE.includes(status)) out.push("cancelled");
  if (status === "delivered" && opts.returnsEnabled) out.push("returned");
  return out;
}

const NOTIFY_ON: Partial<Record<OrderStatus, OrderTemplate>> = {
  confirmed: ORDER_TEMPLATES.confirmed,
  shipped: ORDER_TEMPLATES.shipped,
  delivered: ORDER_TEMPLATES.delivered,
  cancelled: ORDER_TEMPLATES.cancelled,
};

/**
 * Plans moving an order to `to`: whether it is allowed, and the side effects to run (as data, executed by the
 * service). Skipped forward steps contribute their effects; only the final status notifies the customer.
 *
 * - confirmed: invoice when `invoiceOn = confirmed`; notify.
 * - shipped: notify (with tracking).
 * - delivered: commit reserved stock; COD → collected; invoice if none yet; notify.
 * - cancelled (from placed/confirmed/packed): release reserved stock, release the coupon, cancel the invoice; notify.
 * - returned (from delivered, feature orders.returns): restock sold stock, cancel the invoice.
 */
export function planTransition(state: TransitionState, to: OrderStatus, opts: TransitionOptions): TransitionPlan {
  const from = state.status;
  if (to === from) return { ok: false, code: "same_status", message: `The order is already ${from}` };
  if (to === "returned" && from === "delivered" && !opts.returnsEnabled) {
    return { ok: false, code: "feature_disabled", message: "Returns are turned off for this shop" };
  }
  if (!allowedTransitions(from, opts).includes(to)) {
    return { ok: false, code: "not_allowed", message: `A ${from} order can't be marked ${to}` };
  }

  const effects: OrderEffect[] = [];
  const notify = (template: OrderTemplate | undefined) => {
    if (template) effects.push({ type: "notify", template, audience: "customer" });
  };

  if (to === "cancelled") {
    if (state.stockState === "reserved") effects.push({ type: "stock.release" });
    if (state.couponCode || state.hasOffers) effects.push({ type: "coupon.release" });
    if (state.invoiceId) effects.push({ type: "invoice.cancel" });
    notify(NOTIFY_ON.cancelled);
    return { ok: true, from, to, path: [to], effects: effects.sort(byExecutionOrder) };
  }

  if (to === "returned") {
    if (state.stockState === "committed") effects.push({ type: "stock.restock" });
    if (state.invoiceId) effects.push({ type: "invoice.cancel" });
    return { ok: true, from, to, path: [to], effects: effects.sort(byExecutionOrder) };
  }

  const path = ORDER_FLOW.slice(ORDER_FLOW.indexOf(from) + 1, ORDER_FLOW.indexOf(to) + 1);
  let invoicePlanned = !!state.invoiceId;
  for (const step of path) {
    if (step === "confirmed" && opts.invoiceOn === "confirmed" && !invoicePlanned) {
      effects.push({ type: "invoice.create" });
      invoicePlanned = true;
    }
    if (step === "delivered") {
      if (state.stockState === "reserved") effects.push({ type: "stock.commit" });
      if (state.paymentMethod === "cod" && state.paid < state.total) effects.push({ type: "payment.collectCod" });
      // Catch-up: delivered orders always end up invoiced (e.g. the setting changed after confirmation).
      if (!invoicePlanned) {
        effects.push({ type: "invoice.create" });
        invoicePlanned = true;
      }
    }
  }
  notify(NOTIFY_ON[to]);
  return { ok: true, from, to, path, effects: effects.sort(byExecutionOrder) };
}

/**
 * Side effects of placing an order: reserve stock and redeem the coupon and automatic offers (blocking), then tell the
 * customer and owner.
 */
export function planPlacement(input: { couponCode: string | null; hasOffers?: boolean; notifyOwner: boolean }): OrderEffect[] {
  const effects: OrderEffect[] = [{ type: "stock.reserve" }];
  if (input.couponCode || input.hasOffers) effects.push({ type: "coupon.redeem" });
  effects.push({ type: "notify", template: ORDER_TEMPLATES.placed, audience: "customer" });
  if (input.notifyOwner) effects.push({ type: "notify", template: ORDER_TEMPLATES.received, audience: "owner" });
  return effects;
}

/** Whether a newly placed order should be confirmed straight away (online orders wait for the payment). */
export function shouldAutoConfirm(settings: Pick<OrderSettings, "autoConfirm">, order: { status: OrderStatus; paymentMethod: OrderPaymentMethod; paid: number; total: number }) {
  if (!settings.autoConfirm || order.status !== "placed") return false;
  return order.paymentMethod !== "online" || order.paid >= order.total;
}

/**
 * Runs effects one by one. Blocking mode: the first failure undoes the completed ones (reverse order) and rethrows.
 * Best-effort mode: failures are reported to `onFailure` and the rest still run.
 */
export async function runEffects(
  effects: readonly OrderEffect[],
  run: (e: OrderEffect) => Promise<void>,
  opts:
    | { mode: "blocking"; undo: (e: OrderEffect) => Promise<void> }
    | { mode: "best-effort"; onFailure: (e: OrderEffect, err: unknown) => Promise<void> | void },
): Promise<{ done: OrderEffect[]; failed: OrderEffect[] }> {
  const done: OrderEffect[] = [];
  const failed: OrderEffect[] = [];
  for (const e of effects) {
    try {
      await run(e);
      done.push(e);
    } catch (err) {
      if (opts.mode === "blocking") {
        for (const d of [...done].reverse()) {
          try {
            await opts.undo(d);
          } catch {
            // Undo is best effort; the caller logs the original error.
          }
        }
        throw err;
      }
      failed.push(e);
      try {
        await opts.onFailure(e, err);
      } catch {
        // Reporting a failure must never break the remaining effects.
      }
    }
  }
  return { done, failed };
}

// ------------------------------------------------------------------ payments

/** Payment status from the money recorded on the order. */
export function derivePaymentStatus(o: { total: number; paid: number; refunded: number; paymentMethod: OrderPaymentMethod }): OrderPaymentStatus {
  if (o.refunded > 0) return o.refunded >= o.paid ? "refunded" : "partially_refunded";
  if (o.paid >= o.total) return "paid";
  if (o.paymentMethod === "cod") return "cod";
  if (o.paymentMethod === "online") return "pending";
  return "unpaid";
}

export const balanceOf = (o: { total: number; paid: number; refunded: number }) => o.total - (o.paid - o.refunded);

// ------------------------------------------------------------------ pricing and GST

/** Catalogue price → exclusive rate: the one helper from @rbms/gst, re-exported for existing importers. */
export { exclusiveOf };

/** A priced line before tax: catalogue details + qty + the price charged. */
export interface BaseLine {
  variantId: string;
  productId: string;
  categoryId: string | null;
  name: string;
  sku: string | null;
  image: string | null;
  qty: number;
  unit: string;
  price: number;
  rate: number;
  gstRate: GstRate;
  /** Price-band GST rule of the product (apparel / footwear); `computeOrderTotals` re-bands the line after discounts. */
  gstRule?: GstRateRule | null;
  hsn: string | null;
  taxInclusive: boolean;
  /** qty × price, as charged. */
  gross: number;
}

export interface LineRequest {
  variantId: string;
  qty: number;
  /** Staff override (manual orders only), same basis as the catalogue price. */
  price?: number | null;
}

export type BuildLinesResult =
  | { ok: true; lines: BaseLine[] }
  | { ok: false; missing: string[]; badGst: string[] };

/** Prices lines from the catalogue. Client prices are ignored unless `allowPriceOverride` (staff manual orders). */
export function buildBaseLines(items: readonly CatalogItem[], requests: readonly LineRequest[], opts: { allowPriceOverride: boolean }): BuildLinesResult {
  const byId = new Map(items.map((i) => [i.id, i]));
  const missing = [...new Set(requests.filter((r) => !byId.has(r.variantId)).map((r) => r.variantId))];
  const badGst = [...new Set(items.filter((i) => !isGstRate(i.gstRate)).map((i) => i.id))].filter((id) =>
    requests.some((r) => r.variantId === id),
  );
  if (missing.length || badGst.length) return { ok: false, missing, badGst };
  const lines = requests.map((r): BaseLine => {
    const item = byId.get(r.variantId)!;
    const price = opts.allowPriceOverride && r.price !== undefined && r.price !== null ? r.price : item.price;
    // A price-band product is banded at the price charged (a staff price override can move it).
    const gstRate = (item.gstRule ? gstRateAtPrice(item.gstRule, price, item.taxInclusive) : item.gstRate) as GstRate;
    return {
      variantId: item.id,
      productId: item.productId,
      categoryId: item.categoryId ?? null,
      name: item.name,
      sku: item.sku ?? null,
      image: item.image ?? null,
      qty: r.qty,
      unit: item.unit || "pcs",
      price,
      rate: exclusiveOf(price, gstRate, item.taxInclusive),
      gstRate,
      ...(item.gstRule ? { gstRule: item.gstRule } : {}),
      hsn: item.hsn ?? null,
      taxInclusive: item.taxInclusive,
      gross: lineAmount(r.qty, price),
    };
  });
  return { ok: true, lines };
}

/** Splits `total` over `amounts` proportionally (largest remainder; parts add up exactly, none above its amount). */
export function splitProportionally(total: number, amounts: readonly number[]): number[] {
  const base = amounts.reduce((s, a) => s + Math.max(a, 0), 0);
  const out = amounts.map(() => 0);
  if (total <= 0 || base <= 0) return out;
  const t = Math.min(total, base);
  const rem: { i: number; frac: number }[] = [];
  let given = 0;
  amounts.forEach((a, i) => {
    if (a <= 0) return;
    const exact = (t * a) / base;
    out[i] = Math.floor(exact);
    given += out[i]!;
    rem.push({ i, frac: exact - out[i]! });
  });
  rem.sort((x, y) => y.frac - x.frac || x.i - y.i);
  for (let k = 0; given < t && k < rem.length; k++, given++) out[rem[k]!.i]! += 1;
  return out;
}

/**
 * Splits a loyalty-points discount `discount` (paise, as charged) over the goods lines, proportionally to what each
 * line still charges after its coupon share (`gross − couponShare`), by largest remainder: the parts are whole paise,
 * add up exactly to `min(discount, Σ remaining)`, and none exceeds its line's remaining charge.
 */
export function allocateLoyaltyDiscount(
  discount: number,
  lines: readonly { gross: number }[],
  couponDiscounts?: readonly number[],
): number[] {
  const remaining = lines.map((l, i) => Math.max(l.gross - Math.min(Math.max(couponDiscounts?.[i] ?? 0, 0), l.gross), 0));
  return splitProportionally(Math.max(Math.floor(discount), 0), remaining);
}

export const SHIPPING_SAC = "996812";
export const SHIPPING_DESCRIPTION = "Shipping charges";
/** Cash-on-delivery fee: its own taxed line (same SAC and rate rule as shipping), never waived by a free-shipping coupon. */
export const COD_FEE_DESCRIPTION = "COD charges";

/** GST rate of the principal supply (largest taxable line; ties → higher rate), used for shipping. */
export function principalRate(lines: readonly { gstRate: GstRate; amount: number }[]): GstRate {
  let best: { gstRate: GstRate; amount: number } | null = null;
  for (const l of lines) {
    if (!best || l.amount > best.amount || (l.amount === best.amount && l.gstRate > best.gstRate)) best = l;
  }
  return best?.gstRate ?? 0;
}

export interface TotalsOptions {
  /** Coupon discount per line, as charged (same order as `lines`). */
  lineDiscounts?: readonly number[];
  /**
   * Loyalty-points discount per goods line, as charged (same order as `lines`; see `allocateLoyaltyDiscount`). Capped
   * at what the line still charges after its coupon share.
   */
  loyaltyDiscounts?: readonly number[];
  /** Points redeemed for `loyaltyDiscounts`; recorded in `totals.loyalty`. */
  loyaltyPoints?: number;
  /** Shipping charged, GST-inclusive. */
  shipping: number;
  freeShipping?: boolean;
  /** Cash-on-delivery fee, GST-inclusive. Charged as its own line; a free-shipping coupon does not waive it. */
  codFee?: number;
  sellerState: string;
  placeOfSupply: string;
}

/**
 * GST totals via `computeInvoice`: each line at its exclusive rate, the coupon share converted to the exclusive basis
 * for tax-inclusive lines, and shipping as a GST-inclusive composite-supply line at the principal item's rate.
 * Tax-inclusive lines (and shipping/COD) carry `inclusiveTotal` = what is charged, so their GST is worked out
 * backwards and the line total equals the charged price exactly (₹999 stays ₹999.00, not ₹999.01).
 *
 * Loyalty points (`loyaltyDiscounts`) are a discount allowed at the time of supply and recorded on the invoice
 * (Sec 15(3)(a) CGST Act), so they reduce each line's taxable value pro-rata and the GST is worked out again on the
 * lower value — not a payment method. Tax-inclusive lines: the charged share comes off `inclusiveTotal`
 * (gross − coupon − loyalty), so the line total drops by exactly that share. Exclusive lines: the share is charged
 * money (GST-inclusive), so it is converted to the exclusive basis (`exclusiveOf(share, gstRate, true)`) and added to
 * the line discount; the total then drops by the share to within a paisa. Each line's `discount` (exclusive basis)
 * includes its loyalty share, so an invoice copied from the order equals it. `totals.discount` stays the coupon only.
 */
export function computeOrderTotals(base: readonly BaseLine[], opts: TotalsOptions): { lines: OrderLine[]; totals: OrderTotals } {
  const discountsCharged = base.map((_, i) => Math.max(opts.lineDiscounts?.[i] ?? 0, 0));
  const loyaltyCharged = base.map((l, i) => {
    const share = Math.min(discountsCharged[i]!, l.gross);
    return Math.min(Math.max(Math.round(opts.loyaltyDiscounts?.[i] ?? 0), 0), l.gross - share);
  });
  // Price-band lines (apparel / footwear) are taxed at the band of their value after the coupon and loyalty shares
  // (Sec 15(3)(a): discounts on the invoice reduce the value of supply), so rate and gstRate are worked out per line.
  const banded = base.map((l, i) => {
    if (!l.gstRule) return l;
    const share = Math.min(discountsCharged[i]!, l.gross);
    const charged = l.gross - share - loyaltyCharged[i]!;
    let gstRate: number;
    if (l.taxInclusive) gstRate = gstRateForInclusive(l.gstRule, charged, l.qty).rate;
    else {
      // Exclusive price: the loyalty share is charged money, converted at the rate it lands in (two passes settle it).
      const amount = lineAmount(l.qty, l.price);
      gstRate = effectiveGstRate(l.gstRule, amount - share - exclusiveOf(loyaltyCharged[i]!, l.gstRate, true), l.qty);
      gstRate = effectiveGstRate(l.gstRule, amount - share - exclusiveOf(loyaltyCharged[i]!, gstRate, true), l.qty);
    }
    return { ...l, gstRate: gstRate as GstRate, rate: exclusiveOf(l.price, gstRate, l.taxInclusive) };
  });
  const inputs: LineInput[] = banded.map((l, i) => {
    const amount = lineAmount(l.qty, l.rate);
    const share = Math.min(discountsCharged[i]!, l.gross);
    const loyalty = loyaltyCharged[i]!;
    const discount = l.taxInclusive
      ? Math.min(exclusiveOf(share + loyalty, l.gstRate, true), amount)
      : Math.min(share + exclusiveOf(loyalty, l.gstRate, true), amount);
    const input: LineInput = { description: l.name, qty: l.qty, rate: l.rate, gstRate: l.gstRate, itemId: l.variantId, discount };
    // Tax-inclusive price: the line total is what the customer is charged; GST is taken out of it, not re-added.
    if (l.taxInclusive && l.gstRate) input.inclusiveTotal = l.gross - share - loyalty;
    if (l.hsn) input.hsn = l.hsn;
    if (l.unit) input.unit = l.unit;
    return input;
  });
  const shippingCharged = opts.freeShipping ? 0 : Math.max(opts.shipping, 0);
  const shippingWaived = opts.freeShipping ? Math.max(opts.shipping, 0) : 0;
  const codFee = Math.max(opts.codFee ?? 0, 0);
  const serviceRate = principalRate(inputs.map((l) => ({ gstRate: l.gstRate, amount: lineAmount(l.qty, l.rate) - (l.discount ?? 0) })));
  const serviceLine = (description: string, charged: number): LineInput => ({
    description,
    hsn: SHIPPING_SAC,
    qty: 1,
    unit: "job",
    rate: exclusiveOf(charged, serviceRate, true),
    gstRate: serviceRate,
    ...(serviceRate ? { inclusiveTotal: charged } : {}),
  });
  if (shippingCharged > 0) inputs.push(serviceLine(SHIPPING_DESCRIPTION, shippingCharged));
  if (codFee > 0) inputs.push(serviceLine(COD_FEE_DESCRIPTION, codFee));
  const computed = computeInvoice(inputs, { sellerState: opts.sellerState, placeOfSupply: opts.placeOfSupply });
  const lines: OrderLine[] = banded.map((l, i) => {
    const c = computed.lines[i]!;
    return {
      variantId: l.variantId,
      productId: l.productId,
      name: l.name,
      sku: l.sku,
      image: l.image,
      qty: l.qty,
      unit: l.unit,
      price: l.price,
      rate: l.rate,
      gstRate: l.gstRate,
      hsn: l.hsn,
      taxInclusive: l.taxInclusive,
      discount: c.discount ?? 0,
      amount: c.amount,
      taxable: c.taxable,
      cgst: c.cgst,
      sgst: c.sgst,
      igst: c.igst,
      total: c.total,
    };
  });
  const shippingLine = shippingCharged > 0 ? computed.lines[base.length]! : null;
  const codFeeLine = codFee > 0 ? computed.lines[base.length + (shippingLine ? 1 : 0)]! : null;
  const loyaltyDiscount = loyaltyCharged.reduce((s, v) => s + v, 0);
  return {
    lines,
    totals: {
      subtotal: base.reduce((s, l) => s + l.gross, 0),
      discount: base.reduce((s, l, i) => s + Math.min(discountsCharged[i]!, l.gross), 0),
      shipping: shippingCharged,
      shippingWaived,
      shippingLine,
      codFee,
      codFeeLine,
      taxable: computed.taxable,
      cgst: computed.cgst,
      sgst: computed.sgst,
      igst: computed.igst,
      roundOff: computed.roundOff,
      total: computed.total,
      taxBreakup: computed.taxBreakup,
      sellerState: opts.sellerState,
      placeOfSupply: opts.placeOfSupply,
      interState: isInterState(opts.sellerState, opts.placeOfSupply),
      ...(loyaltyDiscount > 0 ? { loyalty: { points: Math.max(Math.round(opts.loyaltyPoints ?? 0), 0), discount: loyaltyDiscount } } : {}),
    },
  };
}

// ------------------------------------------------------------------ settings and small helpers

export const DEFAULT_ORDER_SETTINGS: Required<OrderSettings> = {
  prefix: "ORD",
  invoiceOn: "delivered",
  allowBackorder: false,
  autoConfirm: false,
  notifyOwner: true,
};

export function normalizeSettings(s: Partial<OrderSettings> | null | undefined): Required<OrderSettings> {
  const v = s ?? {};
  return {
    prefix: typeof v.prefix === "string" && v.prefix.trim() ? v.prefix.trim() : DEFAULT_ORDER_SETTINGS.prefix,
    invoiceOn: v.invoiceOn === "confirmed" ? "confirmed" : "delivered",
    allowBackorder: v.allowBackorder === true,
    autoConfirm: v.autoConfirm === true,
    notifyOwner: v.notifyOwner !== false,
  };
}

/** Indian mobile → "+91XXXXXXXXXX", else null (same rules as invoices). */
export function toIndianE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!/^\+?[0-9][0-9 ()-]*$/.test(trimmed)) return null;
  let d = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    if (!d.startsWith("91")) return null;
    d = d.slice(2);
  } else if (d.length === 14 && d.startsWith("0091")) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d) ? `+91${d}` : null;
}

/** Coupon per-customer key: account, else phone, else email. */
export function customerKeyOf(c: { accountId?: string | null; phone?: string | null; email?: string | null }): string | null {
  if (c.accountId) return `acct:${c.accountId}`;
  const phone = toIndianE164(c.phone);
  if (phone) return `ph:${phone}`;
  if (c.email) return `em:${c.email.trim().toLowerCase()}`;
  return null;
}

/** Money for message text: "₹1,234.50" on WhatsApp/email, "Rs.1,234.50" on SMS. */
export function moneyText(paise: number, channel: "whatsapp" | "sms" | "email"): string {
  const s = formatINR(paise);
  return channel === "sms" ? s.replace("₹", "Rs.") : s;
}

/** "2 items" / "1 item" (quantities of fractional units count as one line each). */
export function itemsText(lines: readonly { qty: number; unit: string }[]): string {
  const n = lines.reduce((s, l) => s + (Number.isInteger(l.qty) && l.unit === "pcs" ? l.qty : 1), 0);
  return `${n} item${n === 1 ? "" : "s"}`;
}

/** IST calendar range [from 00:00, to+1 00:00) as instants. */
export function istRange(from?: string | null, to?: string | null): { start: Date | null; end: Date | null } {
  const start = from ? new Date(`${from}T00:00:00.000+05:30`) : null;
  const end = to ? new Date(new Date(`${to}T00:00:00.000+05:30`).getTime() + 86_400_000) : null;
  return { start, end };
}

/** First day of the IST month of `date` ("2026-10-15" → "2026-10-01"). */
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
