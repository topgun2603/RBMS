/** Outgoing webhook event types (docs/batch3.md B4). `ping` is sent only by the "Send test" button. */
export const WEBHOOK_EVENT_TYPES = [
  "order.created",
  "order.status_changed",
  "invoice.issued",
  "invoice.paid",
  "invoice.cancelled",
  "credit_note.issued",
  "credit_note.cancelled",
  "payment.received",
  "customer.created",
  "product.created",
  "product.updated",
  "stock.low",
  "review.created",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export const PING_EVENT = "ping";

/** Subscribing to `*` means every event, including ones added later. */
export const ALL_EVENTS = "*";

export interface EventDef {
  type: WebhookEventType;
  /** Module that emits it. */
  module: string;
  label: string;
  description: string;
  /** Example of `data` (money in paise, ISO timestamps). */
  sample: Record<string, unknown>;
}

const T = "2026-10-15T10:30:00.000Z";
const ORDER = "6f1d2c3b-1111-4a5b-8c9d-0e1f2a3b4c5d";
const INVOICE = "7a2e3d4c-2222-4b6c-9d0e-1f2a3b4c5d6e";
const CUSTOMER = "8b3f4e5d-3333-4c7d-8e1f-2a3b4c5d6e7f";
const PRODUCT = "9c4a5f6e-4444-4d8e-9f2a-3b4c5d6e7f80";

const order = {
  id: ORDER,
  number: "ORD/26-27/0042",
  status: "placed",
  customer: { name: "Meena R", phone: "+919876543210", email: "meena@example.com" },
  total: 125000,
  paymentMethod: "upi",
  createdAt: T,
};
const invoice = {
  id: INVOICE,
  number: "INV/26-27/0108",
  status: "issued",
  customer: { id: CUSTOMER, name: "Meena R", phone: "+919876543210" },
  total: 118000,
  balance: 118000,
  issuedAt: T,
};

export const WEBHOOK_EVENTS: EventDef[] = [
  { type: "order.created", module: "orders", label: "Order placed", description: "A new online or counter order was placed.", sample: order },
  {
    type: "order.status_changed",
    module: "orders",
    label: "Order status changed",
    description: "An order moved to another status (confirmed, packed, shipped, delivered, cancelled, returned).",
    sample: { ...order, status: "shipped", previousStatus: "packed", changedAt: T },
  },
  { type: "invoice.issued", module: "invoices", label: "Bill issued", description: "A draft bill was issued and got its number.", sample: invoice },
  {
    type: "invoice.paid",
    module: "invoices",
    label: "Bill fully paid",
    description: "A bill's balance reached zero.",
    sample: { ...invoice, status: "paid", balance: 0, paidAt: T },
  },
  {
    type: "invoice.cancelled",
    module: "invoices",
    label: "Bill cancelled",
    description: "An issued bill was cancelled.",
    sample: { ...invoice, status: "cancelled", reason: "Duplicate bill", cancelledAt: T },
  },
  {
    type: "credit_note.issued",
    module: "invoices",
    label: "Credit note issued",
    description: "A credit note (return or price correction) was issued against a bill.",
    sample: {
      id: "3f4a5b6c-7777-4b1c-8d2e-3f4a5b6c7d8e",
      number: "CN/26-27/0007",
      date: "2026-10-15",
      invoice: { id: INVOICE, number: "INV/26-27/0108", date: "2026-10-12" },
      customer: { id: CUSTOMER, name: "Meena R", phone: "+919876543210", gstin: null },
      reason: "return",
      refundMode: "cash",
      refundAmount: 59000,
      taxable: 56190,
      cgst: 1405,
      sgst: 1405,
      igst: 0,
      total: 59000,
      lines: [{ description: "Cotton saree", qty: 1, taxable: 56190, total: 59000, restock: true }],
      issuedAt: T,
    },
  },
  {
    type: "credit_note.cancelled",
    module: "invoices",
    label: "Credit note cancelled",
    description: "A credit note was cancelled on the day it was issued (the bill's balance comes back).",
    sample: { id: "3f4a5b6c-7777-4b1c-8d2e-3f4a5b6c7d8e", number: "CN/26-27/0007", invoice: { id: INVOICE, number: "INV/26-27/0108" }, total: 59000, reason: "Entered twice", cancelledAt: T },
  },
  {
    type: "payment.received",
    module: "payments",
    label: "Payment received",
    description: "A payment was recorded against a bill or order (cash, UPI, card or online).",
    sample: { id: "1d2e3f4a-5555-4e9f-8a3b-4c5d6e7f8091", amount: 50000, method: "upi", reference: "UPI-4155", invoiceId: INVOICE, orderId: null, receivedAt: T },
  },
  {
    type: "customer.created",
    module: "invoices",
    label: "Customer added",
    description: "A customer was added from billing, the store or an import.",
    sample: { id: CUSTOMER, name: "Meena R", phone: "+919876543210", email: null, gstin: null, createdAt: T },
  },
  {
    type: "product.created",
    module: "catalogue",
    label: "Product added",
    description: "A product or item was added to the catalogue.",
    sample: { id: PRODUCT, name: "Cotton saree", sku: "SAR-001", price: 149900, gstRate: 5, active: true, createdAt: T },
  },
  {
    type: "product.updated",
    module: "catalogue",
    label: "Product changed",
    description: "A product's details, price or availability changed.",
    sample: { id: PRODUCT, name: "Cotton saree", sku: "SAR-001", price: 139900, gstRate: 5, active: true, changed: ["price"], updatedAt: T },
  },
  {
    type: "stock.low",
    module: "inventory",
    label: "Stock running low",
    description: "An item's stock fell to or below its reorder level.",
    sample: { productId: PRODUCT, variantId: null, name: "Cotton saree", sku: "SAR-001", quantity: 3, reorderLevel: 5, at: T },
  },
  {
    type: "review.created",
    module: "reviews",
    label: "New review",
    description: "A customer left a product review.",
    sample: { id: "2e3f4a5b-6666-4fa0-9b4c-5d6e7f8091a2", productId: PRODUCT, rating: 5, title: "Lovely fabric", status: "pending", createdAt: T },
  },
];

export const isWebhookEventType = (t: string): t is WebhookEventType => (WEBHOOK_EVENT_TYPES as readonly string[]).includes(t);

/** Does an endpoint's `events` list include `type`? */
export const subscribes = (events: readonly string[], type: string) => events.includes(ALL_EVENTS) || events.includes(type);

/** The JSON body sent to endpoints. */
export interface WebhookPayload<D = unknown> {
  /** Event id; the same across endpoints and redeliveries (use it to de-duplicate). */
  id: string;
  type: WebhookEventType | typeof PING_EVENT;
  /** ISO timestamp of the event. */
  createdAt: string;
  tenant: { slug: string };
  data: D;
}

export function buildPayload<D>(id: string, type: WebhookPayload["type"], tenantSlug: string, data: D, createdAt: Date): WebhookPayload<D> {
  return { id, type, createdAt: createdAt.toISOString(), tenant: { slug: tenantSlug }, data };
}
