import type { PaymentMethod, PaymentMode, PaymentProvider } from "./ports";

/** Public refs (share tokens) are 16–64 URL-safe characters. */
export const REF_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
export const KEY_ID_PATTERN = /^rzp_(test|live)_[A-Za-z0-9]{6,40}$/;
/** An unpaid order for the same purpose + amount is re-used for this long. */
export const REUSE_WINDOW_MS = 30 * 60_000;
/** Razorpay's minimum order amount (₹1). */
export const MIN_AMOUNT = 100;
export const MAX_AMOUNT = 2_000_000_000;
export const HANDLED_EVENTS = ["payment.captured", "order.paid"] as const;

/** Maps Razorpay's `method` to ours: netbanking → bank; emi, paylater and anything unknown → other. */
export function mapMethod(method: string | null | undefined): PaymentMethod {
  switch (method) {
    case "upi":
      return "upi";
    case "card":
      return "card";
    case "netbanking":
      return "bank";
    case "wallet":
      return "wallet";
    default:
      return "other";
  }
}

export function modeFromKeyId(keyId: string | null | undefined): PaymentMode | null {
  if (!keyId) return null;
  if (keyId.startsWith("rzp_test_")) return "test";
  if (keyId.startsWith("rzp_live_")) return "live";
  return null;
}

export const webhookUrlFor = (baseUrl: string, tenantId: string) =>
  `${baseUrl.replace(/\/+$/, "")}/v1/payments/webhooks/razorpay/${tenantId}`;

/** Razorpay when the tenant has an enabled account; mock only when allowed and no enabled account. */
export function chooseProvider(account: { enabled: boolean } | null | undefined, allowMock: boolean): PaymentProvider | null {
  if (account?.enabled) return "razorpay";
  return allowMock ? "mock" : null;
}

export interface ReusableOrder {
  amount: number;
  provider: string;
  status: string;
  createdAt: Date;
  notes: { keyId?: string } | null;
}

/** Same amount, same provider (and Razorpay key), still unpaid, created in the last 30 minutes. */
export function canReuseOrder(
  order: ReusableOrder,
  want: { amount: number; provider: PaymentProvider; keyId: string | null; now: Date },
): boolean {
  if (order.status !== "created") return false;
  if (order.amount !== want.amount || order.provider !== want.provider) return false;
  if (want.provider === "razorpay" && (order.notes?.keyId ?? null) !== want.keyId) return false;
  return want.now.getTime() - order.createdAt.getTime() < REUSE_WINDOW_MS;
}

export interface WebhookPayment {
  id: string;
  orderId: string;
  amount: number;
  method: string | null;
  status: string | null;
  createdAt: number | null;
}

export interface ParsedWebhook {
  type: string;
  /** Present for payment.captured / order.paid when the payload carries a payment tied to an order. */
  payment: WebhookPayment | null;
}

/** Extracts the event type and the payment entity from a Razorpay webhook payload. */
export function parseWebhook(json: unknown): ParsedWebhook {
  const obj = (json ?? {}) as Record<string, unknown>;
  const type = typeof obj.event === "string" ? obj.event : "";
  const payload = (obj.payload ?? {}) as Record<string, { entity?: Record<string, unknown> } | undefined>;
  const p = payload.payment?.entity;
  const o = payload.order?.entity;
  const orderId = (typeof p?.order_id === "string" && p.order_id) || (typeof o?.id === "string" && o.id) || null;
  if (!p || typeof p.id !== "string" || !orderId || typeof p.amount !== "number") return { type, payment: null };
  return {
    type,
    payment: {
      id: p.id,
      orderId,
      amount: p.amount,
      method: typeof p.method === "string" ? p.method : null,
      status: typeof p.status === "string" ? p.status : null,
      createdAt: typeof p.created_at === "number" ? p.created_at : null,
    },
  };
}

export const isHandledEvent = (type: string) => (HANDLED_EVENTS as readonly string[]).includes(type);
