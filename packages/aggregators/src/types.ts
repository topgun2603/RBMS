/**
 * The connector's vocabulary. Every provider (UrbanPiper, the manual/test one, later others) turns its own webhook
 * payloads into these shapes and builds its own outgoing HTTP requests from them; the service never sees a
 * provider's format. Money is always integer paise; times are ISO strings.
 */

export const PROVIDERS = ["urbanpiper", "manual"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** The marketplace the customer ordered on. Aggregators relay several; anything else is "other". */
export const PLATFORMS = ["zomato", "swiggy", "ondc", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];

/**
 * Our side of an order's life: `placed` (waiting for the restaurant) → `accepted` (KOTs sent) → `ready` (food packed)
 * → `dispatched` (rider picked it up) → `completed` (delivered). `rejected` (by the restaurant) and `cancelled` (by the
 * customer or platform) end it.
 */
export const ORDER_STATUSES = ["placed", "accepted", "ready", "dispatched", "completed", "rejected", "cancelled"] as const;
export type AggOrderStatus = (typeof ORDER_STATUSES)[number];
export const ACTIVE_STATUSES: readonly AggOrderStatus[] = ["placed", "accepted", "ready"];

/** Status changes we report to the provider. */
export type OutboundStatus = "accepted" | "rejected" | "ready" | "dispatched" | "completed";

/** How GST on an order is treated. */
export const TAX_MODES = ["eco_9_5", "restaurant"] as const;
/**
 * - `eco_9_5`: restaurant service through an e-commerce operator. Since 1 Jan 2022 the operator (Zomato, Swiggy) pays
 *   the GST under section 9(5) of the CGST Act and issues the customer's invoice; the restaurant issues no tax invoice
 *   and reports the value in GSTR-1 (supplies through e-commerce operators liable u/s 9(5)). The default.
 * - `restaurant`: the restaurant charges GST itself and bills the order as usual (supplies where 9(5) does not apply).
 */
export type TaxMode = (typeof TAX_MODES)[number];

export interface Money {
  title: string;
  /** Paise. */
  amount: number;
}

export interface Discount extends Money {
  /** Who pays for it: a merchant discount lowers the restaurant's value of supply, a platform one doesn't. */
  fundedBy: "merchant" | "platform" | "unknown";
}

export interface Tax extends Money {
  /** Percent, e.g. 2.5 for CGST at 2.5 %. */
  rate: number | null;
}

export interface OrderOption {
  externalId: string | null;
  title: string;
  /** Paise per unit of the item. */
  price: number;
  qty: number;
}

export interface NormalizedItem {
  /** The provider's item id (always present: the mapping key). */
  externalId: string;
  /** The merchant reference the item was pushed with (our catalogue id when the menu was pushed from here). */
  merchantRef: string | null;
  title: string;
  qty: number;
  /** Paise per unit, options included. */
  unitPrice: number;
  /** Paise: the line as charged (unit price × qty, before order-level discounts). */
  total: number;
  /** Add-ons / variants chosen ("Extra cheese", "Half"). */
  options: OrderOption[];
  /** Things to leave out ("No onion"). */
  removed: string[];
  note: string | null;
}

export interface Rider {
  name: string | null;
  /** Masked or the platform's relay number. */
  phone: string | null;
  /** The provider's word for where the rider is: "assigned", "at-store", "picked-up", "delivered". */
  status: string | null;
  updatedAt: string | null;
}

export interface NormalizedOrder {
  platform: Platform;
  /** The provider's order id: the idempotency key and the id status callbacks use. */
  externalId: string;
  /** The marketplace's own order number (what the rider and the customer quote), when sent. */
  platformOrderId: string | null;
  type: "delivery" | "pickup";
  /** Only what the kitchen needs: first name + initial, last 4 digits of the phone. */
  customer: { name: string | null; phone: string | null };
  items: NormalizedItem[];
  /** Packaging, delivery and other charges (paise). */
  charges: Money[];
  discounts: Discount[];
  /** Taxes as the platform computed them (under 9(5) the platform pays them). */
  taxes: Tax[];
  totals: { items: number; charges: number; discount: number; tax: number; total: number };
  payment: { mode: "prepaid" | "cod"; amount: number };
  placedAt: string;
  /** When the rider will pick up (or the customer collects). Null when the platform didn't say. */
  expectedPickupAt: string | null;
  instructions: string | null;
  rider: Rider | null;
  /** The provider's store / location reference the order was placed at. */
  storeRef: string | null;
  /** A sample order (the "send a test order" button): never reported back to the provider. */
  test?: boolean;
}

/** What a webhook said. */
export type WebhookEvent =
  | { kind: "order"; order: NormalizedOrder }
  | { kind: "status"; externalId: string; status: "cancelled" | "dispatched" | "completed" | "accepted" | "ready"; message: string | null }
  | { kind: "rider"; externalId: string; rider: Rider }
  | { kind: "ignored"; reason: string };

/** A request a provider wants sent. Built as data so tests can check it without the network. */
export interface HttpRequest {
  method: "GET" | "POST" | "PUT";
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** The shop's credentials for a provider (decrypted only in memory). */
export interface ProviderCredentials {
  /** UrbanPiper: the API username. */
  username: string | null;
  apiKey: string | null;
  /** Shared secret the provider sends with each webhook (header or HMAC). */
  webhookSecret: string | null;
  /** UrbanPiper: the location's `ref_id` (store). */
  storeRef: string | null;
  /** API base URL override (staging / sandbox). */
  baseUrl: string | null;
}

/** The menu we push (built from the catalogue and the kitchen settings). */
export interface MenuPayload {
  categories: { id: string; name: string; sort: number }[];
  items: {
    /** The ref the provider will send back in orders: our catalogue variant id, or the mapped external id. */
    ref: string;
    name: string;
    description: string | null;
    /** Paise, as the customer pays it on the platform (GST-exclusive: the platform adds tax). */
    price: number;
    categoryId: string | null;
    veg: boolean | null;
    available: boolean;
    image: string | null;
  }[];
}

export interface StockChange {
  ref: string;
  available: boolean;
}

/**
 * A delivery-platform connector. Pure: it verifies and parses what comes in and builds what goes out; the service
 * stores, maps, and sends.
 */
export interface AggregatorProvider {
  id: ProviderId;
  label: string;
  /** Header names a webhook may carry its signature / secret in (lower case), for docs and the settings screen. */
  signatureHeaders: string[];
  /** True when the webhook is really from the provider (constant-time). No secret configured = false. */
  verifyWebhook(input: { rawBody: Buffer; headers: Record<string, string | undefined> }, creds: ProviderCredentials): boolean;
  /** Parses a webhook body (already JSON). Throws `PayloadError` when it isn't one we understand. */
  parseWebhook(body: unknown): WebhookEvent;
  /** The request telling the provider about a status change, or null when this provider has no API (manual). */
  statusRequest(creds: ProviderCredentials, externalId: string, update: { status: OutboundStatus; prepMinutes?: number | null; reason?: string | null }): HttpRequest | null;
  menuRequest(creds: ProviderCredentials, menu: MenuPayload, platforms: Platform[]): HttpRequest | null;
  stockRequests(creds: ProviderCredentials, changes: StockChange[], platforms: Platform[]): HttpRequest[];
  /** Store on/off on one platform. */
  storeRequest(creds: ProviderCredentials, platform: Platform, open: boolean): HttpRequest | null;
  /** A webhook body for a sample order of the given items (the "send a test order" button, dev). */
  sampleWebhook(input: { externalId: string; platform: Platform; items: { ref: string; name: string; price: number; qty: number }[]; now: Date }): unknown;
}

/** A webhook body we can't read: answered 400 and logged on the connection. */
export class PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayloadError";
  }
}
