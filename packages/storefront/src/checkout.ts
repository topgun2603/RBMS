import { AppError } from "@srirealtime/core";
import { z } from "zod";
import { parseAddress, type FieldIssue, type ShopperAddress } from "./address";
import type { DeliveryOption, DeliveryQuote, StoreSettings } from "./ports";
import type { PricedCart } from "./pricing";

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  open: true,
  closedMessage: "",
  codEnabled: true,
  codMaxAmount: 500000,
  minOrderValue: 0,
  contactPhone: "",
  contactEmail: "",
  social: {},
  policies: {},
};

/** Fills a partial `store` settings object with the defaults. */
export function normalizeStoreSettings(s: Partial<StoreSettings> | null | undefined): StoreSettings {
  const v = s ?? {};
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.round(x) : d);
  return {
    open: typeof v.open === "boolean" ? v.open : DEFAULT_STORE_SETTINGS.open,
    closedMessage: typeof v.closedMessage === "string" ? v.closedMessage : "",
    codEnabled: typeof v.codEnabled === "boolean" ? v.codEnabled : DEFAULT_STORE_SETTINGS.codEnabled,
    codMaxAmount: num(v.codMaxAmount, DEFAULT_STORE_SETTINGS.codMaxAmount),
    minOrderValue: num(v.minOrderValue, 0),
    contactPhone: typeof v.contactPhone === "string" ? v.contactPhone : "",
    contactEmail: typeof v.contactEmail === "string" ? v.contactEmail : "",
    social: { ...(v.social ?? {}) },
    policies: { ...(v.policies ?? {}) },
  };
}

export const checkoutBodySchema = z
  .object({
    cartToken: z.string().trim().min(1).max(64),
    addressId: z.string().uuid().optional(),
    address: z.unknown().optional(),
    deliveryOptionId: z.string().trim().min(1).max(100),
    paymentMethod: z.enum(["online", "cod"]),
    customerNote: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(1000).optional()),
  })
  .refine((b) => b.addressId !== undefined || b.address !== undefined, { message: "Choose or enter an address", path: ["address"] });
export type CheckoutBody = z.input<typeof checkoutBodySchema>;

export type CheckoutIssueCode =
  | "store_closed"
  | "cart_empty"
  | "items_unavailable"
  | "qty_reduced"
  | "below_min_order"
  | "address_invalid"
  | "not_serviceable"
  | "delivery_option_invalid"
  | "cod_disabled"
  | "cod_not_allowed"
  | "cod_over_max"
  | "online_payment_unavailable";

export interface CheckoutIssue {
  code: CheckoutIssueCode;
  message: string;
  /** Variant ids (items), field issues (address), amounts (paise). */
  details?: unknown;
}

export interface CheckoutCheckInput {
  settings: StoreSettings;
  cart: PricedCart;
  /** Raw address (from the book or the body); validated here. */
  address: unknown;
  deliveryOptionId: string;
  /** Quote for the address pincode; null when it couldn't be fetched. */
  quote: DeliveryQuote | null;
  paymentMethod: "online" | "cod";
  /** `payments` feature on for the shop. */
  onlinePaymentsEnabled: boolean;
}

export interface CheckoutPlan {
  address: ShopperAddress;
  option: DeliveryOption;
  /** Paise sent to orders as shipping: the option amount (a free-shipping coupon may waive it). */
  shipping: number;
  /** Paise sent to orders as the COD fee (COD only): charged as its own line, never waived. */
  codFee: number;
  /** What the shopper will roughly pay: goods − discount + GST on exclusive items + shipping (free-shipping coupons waive it). */
  estimatedTotal: number;
}

export type CheckoutCheck = { ok: true; plan: CheckoutPlan } | { ok: false; issues: CheckoutIssue[] };

const rupees = (p: number) => `₹${(p / 100).toFixed(p % 100 === 0 ? 0 : 2)}`;

/** Everything checkout refuses, in one pass (pure). Prices in `cart` were re-read from the catalogue. */
export function validateCheckout(input: CheckoutCheckInput): CheckoutCheck {
  const { settings, cart } = input;
  const issues: CheckoutIssue[] = [];

  if (!settings.open) {
    issues.push({ code: "store_closed", message: settings.closedMessage || "The store isn't taking orders right now" });
  }
  if (cart.lines.length === 0) {
    issues.push({ code: "cart_empty", message: "Your cart is empty" });
  } else {
    const unavailable = cart.lines.filter((l) => !l.available).map((l) => l.variantId);
    if (unavailable.length) issues.push({ code: "items_unavailable", message: "Some items are out of stock — remove them to continue", details: unavailable });
    const reduced = cart.lines.filter((l) => l.available && l.problem === "qty_reduced").map((l) => l.variantId);
    if (reduced.length) issues.push({ code: "qty_reduced", message: "Fewer units are in stock than in your cart — check the quantities", details: reduced });
  }
  const goods = cart.subtotal - cart.discount;
  if (cart.lines.length && settings.minOrderValue > 0 && goods < settings.minOrderValue) {
    issues.push({
      code: "below_min_order",
      message: `Minimum order is ${rupees(settings.minOrderValue)}`,
      details: { minOrderValue: settings.minOrderValue, amount: goods },
    });
  }

  const parsed = parseAddress(input.address);
  if (!parsed.ok) issues.push({ code: "address_invalid", message: "Check the delivery address", details: parsed.issues satisfies FieldIssue[] });

  let option: DeliveryOption | undefined;
  if (parsed.ok) {
    if (!input.quote || !input.quote.serviceable) {
      issues.push({ code: "not_serviceable", message: "We don't deliver to this PIN code yet", details: { pincode: parsed.address.pincode } });
    } else {
      option = input.quote.options.find((o) => o.id === input.deliveryOptionId);
      if (!option) issues.push({ code: "delivery_option_invalid", message: "Choose a delivery option again", details: { deliveryOptionId: input.deliveryOptionId } });
    }
  }

  const freeShipping = cart.coupon?.valid === true && cart.coupon.freeShipping;
  const codFee = input.paymentMethod === "cod" && option ? Math.max(0, option.codFee) : 0;
  const shipping = option ? Math.max(0, option.amount) : 0;
  const estimatedTotal = goods + cart.taxExtra + (freeShipping ? 0 : shipping) + codFee;

  if (input.paymentMethod === "cod") {
    if (!settings.codEnabled) issues.push({ code: "cod_disabled", message: "Cash on delivery isn't available — pay online" });
    else if (option && !option.codAllowed) issues.push({ code: "cod_not_allowed", message: "Cash on delivery isn't available for this delivery option" });
    else if (settings.codMaxAmount > 0 && estimatedTotal > settings.codMaxAmount) {
      issues.push({
        code: "cod_over_max",
        message: `Cash on delivery is available up to ${rupees(settings.codMaxAmount)} — pay online`,
        details: { codMaxAmount: settings.codMaxAmount, amount: estimatedTotal },
      });
    }
  } else if (!input.onlinePaymentsEnabled) {
    issues.push({ code: "online_payment_unavailable", message: "Online payment isn't available — choose cash on delivery" });
  }

  if (issues.length || !parsed.ok || !option) return { ok: false, issues };
  return { ok: true, plan: { address: parsed.address, option, shipping, codFee, estimatedTotal } };
}

/** 400 (409 when the store is closed) with every issue in `details.issues`; the code is the first issue's. */
export function checkoutError(issues: CheckoutIssue[]): AppError {
  const first = issues[0]!;
  return new AppError(first.code === "store_closed" ? 409 : 400, first.code, first.message, { issues });
}
