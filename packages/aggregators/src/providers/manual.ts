import { z } from "zod";
import { maskName, maskPhone, verifySecret } from "../parse";
import { PayloadError, PLATFORMS, type AggregatorProvider, type NormalizedOrder, type WebhookEvent } from "../types";

/**
 * The manual / test provider: our own simple JSON, for development, demos, and shops that relay orders from a tool
 * we don't have a connector for. Nothing is ever sent back (status changes are only recorded).
 *
 * `POST /v1/aggregators/manual/webhook/<key>` with header `X-Aggregator-Secret: <secret>` (or an HMAC-SHA256 hex of the
 * body in `X-Aggregator-Signature`). Money in paise.
 *
 *   { "event": "order", "order": { "id": "M-1001", "platform": "zomato", "platformOrderId": "ZO-55",
 *     "type": "delivery", "customer": { "name": "Ravi Kumar", "phone": "9876543210" },
 *     "items": [{ "id": "dosa", "ref": "<catalogue variant id, optional>", "name": "Masala dosa", "qty": 2,
 *                 "price": 12000, "options": [{ "name": "Extra ghee", "price": 2000 }], "note": "crispy" }],
 *     "charges": [{ "title": "Packaging", "amount": 2000 }], "discounts": [], "tax": 1300,
 *     "payment": "prepaid", "pickupInMinutes": 20, "instructions": "No cutlery" } }
 *   { "event": "status", "id": "M-1001", "status": "cancelled", "message": "Customer cancelled" }
 *   { "event": "rider", "id": "M-1001", "rider": { "name": "Arun", "phone": "9000000000", "status": "at-store" } }
 */

const paiseInt = z.number().int().min(0).max(100_000_000);
const text = (n: number) => z.string().trim().max(n);

const orderSchema = z.object({
  id: text(80).min(1),
  platform: z.enum(PLATFORMS).default("other"),
  platformOrderId: text(80).nullish(),
  type: z.enum(["delivery", "pickup"]).default("delivery"),
  customer: z.object({ name: text(120).nullish(), phone: text(30).nullish() }).default({}),
  items: z
    .array(
      z.object({
        id: text(80).min(1),
        ref: text(80).nullish(),
        name: text(200).min(1),
        qty: z.number().positive().max(1000),
        price: paiseInt,
        options: z.array(z.object({ id: text(80).nullish(), name: text(120).min(1), price: paiseInt.default(0), qty: z.number().int().min(1).max(100).default(1) })).max(30).default([]),
        removed: z.array(text(120)).max(30).default([]),
        note: text(200).nullish(),
      }),
    )
    .min(1)
    .max(200),
  charges: z.array(z.object({ title: text(80).min(1), amount: paiseInt })).max(20).default([]),
  discounts: z.array(z.object({ title: text(80).min(1), amount: paiseInt, fundedBy: z.enum(["merchant", "platform", "unknown"]).default("unknown") })).max(20).default([]),
  tax: paiseInt.default(0),
  payment: z.enum(["prepaid", "cod"]).default("prepaid"),
  placedAt: z.string().datetime({ offset: true }).nullish(),
  pickupInMinutes: z.number().int().min(0).max(600).nullish(),
  instructions: text(500).nullish(),
  storeRef: text(80).nullish(),
  test: z.boolean().optional(),
});

const bodySchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("order"), order: orderSchema }),
  z.object({ event: z.literal("status"), id: text(80).min(1), status: z.enum(["cancelled", "dispatched", "completed", "accepted", "ready"]), message: text(300).nullish() }),
  z.object({ event: z.literal("rider"), id: text(80).min(1), rider: z.object({ name: text(120).nullish(), phone: text(30).nullish(), status: text(40).nullish() }) }),
]);

export type ManualWebhook = z.input<typeof bodySchema>;

function normalize(o: z.output<typeof orderSchema>, now: Date): NormalizedOrder {
  const items = o.items.map((i) => {
    const unit = i.price + i.options.reduce((s, x) => s + x.price * x.qty, 0);
    return {
      externalId: i.id,
      merchantRef: i.ref ?? null,
      title: i.name,
      qty: i.qty,
      unitPrice: unit,
      total: Math.round(unit * i.qty),
      options: i.options.map((x) => ({ externalId: x.id ?? null, title: x.name, price: x.price, qty: x.qty })),
      removed: i.removed,
      note: i.note ?? null,
    };
  });
  const itemsTotal = items.reduce((s, i) => s + i.total, 0);
  const charges = o.charges.reduce((s, c) => s + c.amount, 0);
  const discount = o.discounts.reduce((s, d) => s + d.amount, 0);
  const total = itemsTotal + charges - discount + o.tax;
  const placedAt = o.placedAt ? new Date(o.placedAt).toISOString() : now.toISOString();
  return {
    platform: o.platform,
    externalId: o.id,
    platformOrderId: o.platformOrderId ?? null,
    type: o.type,
    customer: { name: maskName(o.customer.name), phone: maskPhone(o.customer.phone) },
    items,
    charges: o.charges,
    discounts: o.discounts,
    taxes: o.tax ? [{ title: "GST", rate: null, amount: o.tax }] : [],
    totals: { items: itemsTotal, charges, discount, tax: o.tax, total },
    payment: { mode: o.payment, amount: total },
    placedAt,
    expectedPickupAt: o.pickupInMinutes != null ? new Date(Date.parse(placedAt) + o.pickupInMinutes * 60_000).toISOString() : null,
    instructions: o.instructions ?? null,
    rider: null,
    storeRef: o.storeRef ?? null,
    ...(o.test ? { test: true } : {}),
  };
}

const HMAC = ["x-aggregator-signature"];
const SECRET = ["x-aggregator-secret"];

export function createManualProvider(now: () => Date = () => new Date()): AggregatorProvider {
  return {
    id: "manual",
    label: "Manual / test",
    signatureHeaders: [...SECRET, ...HMAC],
    verifyWebhook: (input, creds) => verifySecret(input, creds.webhookSecret, { hmac: HMAC, secret: SECRET }),
    parseWebhook(body): WebhookEvent {
      const r = bodySchema.safeParse(body);
      if (!r.success) throw new PayloadError(`Manual webhook: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      const b = r.data;
      if (b.event === "order") return { kind: "order", order: normalize(b.order, now()) };
      if (b.event === "status") return { kind: "status", externalId: b.id, status: b.status, message: b.message ?? null };
      return { kind: "rider", externalId: b.id, rider: { name: b.rider.name ?? null, phone: maskPhone(b.rider.phone), status: b.rider.status ?? null, updatedAt: now().toISOString() } };
    },
    statusRequest: () => null,
    menuRequest: () => null,
    stockRequests: () => [],
    storeRequest: () => null,
    sampleWebhook: ({ externalId, platform, items }): ManualWebhook => ({
      event: "order",
      order: {
        id: externalId,
        platform,
        platformOrderId: `TEST-${externalId}`,
        type: "delivery",
        customer: { name: "Test Customer", phone: "9999900000" },
        items: items.map((i, n) => ({ id: `test-${n + 1}`, ref: i.ref, name: i.name, qty: i.qty, price: i.price })),
        charges: [{ title: "Packaging", amount: 2000 }],
        tax: Math.round((items.reduce((s, i) => s + i.price * i.qty, 0) + 2000) * 0.05),
        payment: "prepaid",
        pickupInMinutes: 20,
        instructions: "Test order: please ignore",
        test: true,
      },
    }),
  };
}

export const manualProvider = createManualProvider();
