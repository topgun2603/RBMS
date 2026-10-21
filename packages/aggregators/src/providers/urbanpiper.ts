import { arr, first, iso, isObj, maskName, maskPhone, num, obj, paise, platformOf, str, verifySecret, type Obj } from "../parse";
import {
  PayloadError,
  type AggregatorProvider,
  type Discount,
  type HttpRequest,
  type Money,
  type NormalizedItem,
  type NormalizedOrder,
  type OutboundStatus,
  type ProviderCredentials,
  type Rider,
  type Tax,
  type WebhookEvent,
} from "../types";

/**
 * UrbanPiper (Hub / POS integration), the aggregator most Indian restaurants use to get Zomato, Swiggy and ONDC
 * orders into one place. Written from UrbanPiper's public POS-integration docs; every field is read tolerantly and
 * unknown fields are ignored, so check a real payload against the fixtures (src/fixtures) when going live.
 *
 * Webhooks (configured per business in UrbanPiper, pointing at our `/v1/aggregators/urbanpiper/webhook/<key>`):
 * - Order placed: `{ customer: { name, phone, email, address }, order: { details: { id, channel, order_type, order_state,
 *   created, delivery_datetime, order_subtotal, order_total, total_charges, total_taxes, discount, instructions,
 *   charges: [{ title, value }], taxes: [{ title, rate, value }], ext_platforms: [{ name, id, delivery_type, discounts }] },
 *   items: [{ id, merchant_id, title, quantity, price, total, instructions, options_to_add: [{ id, merchant_id, title,
 *   price, quantity }], options_to_remove: [{ title }] }], payment: [{ option, amount }], store: { id, merchant_ref_id } } }`
 *   (rupees as numbers, times as epoch ms).
 * - Order status update: `{ order_id, new_state, prev_state, message }` (Cancelled, Dispatched, Completed…).
 * - Rider status: `{ order_id, delivery_info: { current_state, delivery_person_details: { name, phone } } }`.
 *
 * Verification: UrbanPiper lets each webhook carry custom headers. Configure `X-Webhook-Secret: <secret>` (or an
 * `Authorization` header with it); an HMAC-SHA256 hex/base64 signature of the body in `X-UrbanPiper-Signature` /
 * `X-Signature` is accepted too.
 *
 * Outgoing (header `Authorization: apikey <username>:<api_key>`):
 * - status: `PUT {base}/external/api/v1/orders/{id}/status/ { new_status, message, extra? }` with new_status
 *   Acknowledged / Food Ready / Dispatched / Completed / Cancelled
 * - menu: `POST {base}/external/api/v1/inventory/locations/{location_ref_id}/` (categories + items, `flush_items: false`)
 * - item stock: `POST {base}/hub/api/v1/items/ { location_ref_id, platforms, item_ref_ids, action: enable|disable }`
 * - store on/off: `POST {base}/hub/api/v1/location/ { location_ref_id, platforms, action }`
 */

export const URBANPIPER_BASE_URL = "https://api.urbanpiper.com";

const HMAC_HEADERS = ["x-urbanpiper-signature", "x-up-signature", "x-signature"];
const SECRET_HEADERS = ["x-webhook-secret", "x-urbanpiper-secret", "authorization"];

const OUT_STATUS: Record<OutboundStatus, string> = {
  accepted: "Acknowledged",
  ready: "Food Ready",
  dispatched: "Dispatched",
  completed: "Completed",
  rejected: "Cancelled",
};

const COD = new Set(["cash", "cod", "cash_on_delivery"]);

const base = (c: ProviderCredentials) => (c.baseUrl?.trim() || URBANPIPER_BASE_URL).replace(/\/+$/, "");
const headers = (c: ProviderCredentials): Record<string, string> => ({
  "content-type": "application/json",
  authorization: `apikey ${c.username ?? ""}:${c.apiKey ?? ""}`,
});

function money(list: unknown): Money[] {
  return arr(list)
    .filter(isObj)
    .map((c) => ({ title: str(c.title) ?? str(c.name) ?? "Charge", amount: paise(first(num(c.value), num(c.amount))) }))
    .filter((c) => c.amount !== 0);
}

function taxes(list: unknown): Tax[] {
  return arr(list)
    .filter(isObj)
    .map((t) => ({ title: str(t.title) ?? "Tax", rate: num(t.rate), amount: paise(first(num(t.value), num(t.amount))) }))
    .filter((t) => t.amount !== 0);
}

function item(raw: Obj, idx: number): NormalizedItem {
  const qty = Math.max(1, num(raw.quantity) ?? num(raw.qty) ?? 1);
  const options = arr(raw.options_to_add)
    .filter(isObj)
    .map((o) => ({
      externalId: str(o.merchant_id) ?? str(o.id),
      title: str(o.title) ?? "Option",
      price: paise(o.price),
      qty: Math.max(1, num(o.quantity) ?? 1),
    }));
  const removed = arr(raw.options_to_remove)
    .map((o) => (isObj(o) ? str(o.title) : str(o)))
    .filter((v): v is string => !!v);
  // `price` is the item's unit price; options are per unit of the item. `total` (when sent) wins for the line.
  const unit = paise(raw.price) + options.reduce((s, o) => s + o.price * o.qty, 0);
  const total = num(raw.total) !== null ? paise(raw.total) : Math.round(unit * qty);
  return {
    externalId: str(raw.id) ?? str(raw.merchant_id) ?? `line-${idx + 1}`,
    merchantRef: str(raw.merchant_id),
    title: str(raw.title) ?? str(raw.name) ?? "Item",
    qty,
    unitPrice: unit,
    total,
    options,
    removed,
    note: str(raw.instructions),
  };
}

function rider(info: unknown): Rider | null {
  const d = obj(info);
  const p = obj(first(d.delivery_person_details as unknown, d.rider as unknown));
  const name = str(p.name);
  const phone = maskPhone(first(str(p.phone), str(p.alt_phone)));
  const status = str(d.current_state) ?? str(d.status);
  if (!name && !phone && !status) return null;
  return { name, phone, status, updatedAt: iso(d.updated) ?? iso(d.timestamp) ?? null };
}

function order(body: Obj): NormalizedOrder {
  const o = obj(body.order);
  const d = obj(o.details);
  const ext = obj(arr(d.ext_platforms).find(isObj));
  const externalId = str(d.id) ?? str(o.id);
  if (!externalId) throw new PayloadError("UrbanPiper order without order.details.id");
  const items = arr(o.items).filter(isObj).map(item);
  if (items.length === 0) throw new PayloadError("UrbanPiper order without items");

  const charges = money(d.charges);
  const discounts: Discount[] = arr(ext.discounts)
    .filter(isObj)
    .map((x) => ({
      title: str(x.title) ?? str(x.code) ?? "Discount",
      amount: paise(first(num(x.value), num(x.amount))),
      fundedBy: x.is_merchant_discount === true ? ("merchant" as const) : x.is_merchant_discount === false ? ("platform" as const) : ("unknown" as const),
    }))
    .filter((x) => x.amount > 0);
  const orderDiscount = paise(d.discount);
  if (discounts.length === 0 && orderDiscount > 0) discounts.push({ title: str(d.coupon) ?? "Discount", amount: orderDiscount, fundedBy: "unknown" });
  const tax = taxes(d.taxes);

  const itemsTotal = num(d.order_subtotal) !== null ? paise(d.order_subtotal) : items.reduce((s, i) => s + i.total, 0);
  const chargesTotal = num(d.total_charges) !== null ? paise(d.total_charges) : charges.reduce((s, c) => s + c.amount, 0);
  const discountTotal = discounts.reduce((s, x) => s + x.amount, 0);
  const taxTotal = num(d.total_taxes) !== null ? paise(d.total_taxes) : tax.reduce((s, t) => s + t.amount, 0);
  const total = num(d.order_total) !== null ? paise(d.order_total) : itemsTotal + chargesTotal - discountTotal + taxTotal;

  const pays = arr(o.payment).filter(isObj);
  const cod = pays.some((p) => COD.has((str(p.option) ?? "").toLowerCase()));
  const payable = pays.reduce((s, p) => s + paise(p.amount), 0);

  const placedAt = iso(d.created) ?? new Date().toISOString();
  const prep = obj(d.prep_time);
  const prepMin = num(prep.estimated) ?? num(prep.max);
  const expected = first(
    iso(d.expected_pickup_time),
    iso(ext.pickup_time),
    prepMin !== null ? new Date(Date.parse(placedAt) + prepMin * 60_000).toISOString() : null,
    iso(d.delivery_datetime),
  );
  const customer = obj(body.customer);
  const type = (str(d.order_type) ?? "delivery").toLowerCase().includes("pick") ? "pickup" : "delivery";
  return {
    platform: platformOf(first(str(d.channel), str(ext.name))),
    externalId,
    platformOrderId: str(ext.id),
    type,
    customer: { name: maskName(customer.name), phone: maskPhone(customer.phone) },
    items,
    charges,
    discounts,
    taxes: tax,
    totals: { items: itemsTotal, charges: chargesTotal, discount: discountTotal, tax: taxTotal, total },
    payment: { mode: cod ? "cod" : "prepaid", amount: payable || total },
    placedAt,
    expectedPickupAt: expected,
    instructions: str(d.instructions),
    rider: rider(first(o.delivery_info as unknown, body.delivery_info as unknown)),
    storeRef: str(obj(o.store).merchant_ref_id) ?? str(obj(o.store).id),
  };
}

const IN_STATUS: Record<string, "cancelled" | "dispatched" | "completed" | "accepted" | "ready"> = {
  cancelled: "cancelled",
  dispatched: "dispatched",
  completed: "completed",
  delivered: "completed",
  acknowledged: "accepted",
  "food ready": "ready",
};

export const urbanPiperProvider: AggregatorProvider = {
  id: "urbanpiper",
  label: "UrbanPiper",
  signatureHeaders: [...SECRET_HEADERS, ...HMAC_HEADERS],

  verifyWebhook(input, creds) {
    return verifySecret(input, creds.webhookSecret, { hmac: HMAC_HEADERS, secret: SECRET_HEADERS });
  },

  parseWebhook(body): WebhookEvent {
    if (!isObj(body)) throw new PayloadError("Body is not a JSON object");
    if (isObj(body.order) && isObj(obj(body.order).details)) return { kind: "order", order: order(body) };
    const orderId = str(body.order_id) ?? str(obj(body.order).id);
    if (orderId && isObj(body.delivery_info)) {
      const r = rider(body.delivery_info);
      return r ? { kind: "rider", externalId: orderId, rider: r } : { kind: "ignored", reason: "empty rider update" };
    }
    if (orderId && (str(body.new_state) || str(body.status))) {
      const s = (str(body.new_state) ?? str(body.status) ?? "").toLowerCase();
      const status = IN_STATUS[s];
      return status ? { kind: "status", externalId: orderId, status, message: str(body.message) } : { kind: "ignored", reason: `status ${s}` };
    }
    throw new PayloadError("Not an UrbanPiper order, status or rider webhook");
  },

  statusRequest(creds, externalId, update): HttpRequest {
    const body: Record<string, unknown> = {
      new_status: OUT_STATUS[update.status],
      message: update.reason ?? (update.status === "accepted" ? "Accepted" : OUT_STATUS[update.status]),
    };
    // Prep time on acknowledgement (minutes): Zomato / Swiggy use it for rider assignment.
    if (update.status === "accepted" && update.prepMinutes) body.extra = { prep_time: update.prepMinutes };
    return { method: "PUT", url: `${base(creds)}/external/api/v1/orders/${encodeURIComponent(externalId)}/status/`, headers: headers(creds), body };
  },

  menuRequest(creds, menu, platforms) {
    if (!creds.storeRef) return null;
    return {
      method: "POST",
      url: `${base(creds)}/external/api/v1/inventory/locations/${encodeURIComponent(creds.storeRef)}/`,
      headers: headers(creds),
      body: {
        flush_categories: false,
        flush_items: false,
        flush_option_groups: false,
        flush_options: false,
        categories: menu.categories.map((c) => ({ ref_id: c.id, name: c.name, sort_order: c.sort, active: true })),
        items: menu.items.map((i) => ({
          ref_id: i.ref,
          title: i.name,
          description: i.description ?? "",
          available: i.available,
          sold_at_store: true,
          price: i.price / 100,
          current_stock: -1,
          // 1 veg, 2 non-veg, 3 egg (UrbanPiper food types); unknown = leave it to the platform.
          ...(i.veg === null ? {} : { food_type: i.veg ? "1" : "2" }),
          category_ref_ids: i.categoryId ? [i.categoryId] : [],
          ...(i.image ? { img_url: i.image } : {}),
          fulfillment_modes: ["delivery", "pickup"],
          included_platforms: platforms,
        })),
        option_groups: [],
        options: [],
        // No taxes pushed: under 9(5) the platform charges and pays GST on restaurant service.
        taxes: [],
        charges: [],
      },
    };
  },

  stockRequests(creds, changes, platforms) {
    if (!creds.storeRef) return [];
    const out: HttpRequest[] = [];
    for (const action of ["enable", "disable"] as const) {
      const refs = changes.filter((c) => c.available === (action === "enable")).map((c) => c.ref);
      for (let i = 0; i < refs.length; i += 100) {
        out.push({
          method: "POST",
          url: `${base(creds)}/hub/api/v1/items/`,
          headers: headers(creds),
          body: { location_ref_id: creds.storeRef, platforms, item_ref_ids: refs.slice(i, i + 100), action },
        });
      }
    }
    return out;
  },

  storeRequest(creds, platform, open) {
    if (!creds.storeRef) return null;
    return {
      method: "POST",
      url: `${base(creds)}/hub/api/v1/location/`,
      headers: headers(creds),
      body: { location_ref_id: creds.storeRef, platforms: [platform], action: open ? "enable" : "disable" },
    };
  },

  sampleWebhook({ externalId, platform, items, now }) {
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0) / 100;
    const packaging = 20;
    const taxes = Math.round((subtotal + packaging) * 0.05 * 100) / 100;
    return {
      customer: { name: "Test Customer", phone: "+919999900000", email: "" },
      order: {
        details: {
          id: externalId,
          channel: platform,
          order_type: "delivery",
          order_state: "Placed",
          created: now.getTime(),
          delivery_datetime: now.getTime() + 45 * 60_000,
          prep_time: { estimated: 20 },
          order_subtotal: subtotal,
          total_charges: packaging,
          total_taxes: taxes,
          discount: 0,
          order_total: subtotal + packaging + taxes,
          instructions: "Test order: please ignore",
          charges: [{ title: "Packaging charge", value: packaging }],
          taxes: [
            { title: "CGST", rate: 2.5, value: taxes / 2 },
            { title: "SGST", rate: 2.5, value: taxes / 2 },
          ],
          ext_platforms: [{ name: platform, id: `TEST-${externalId}`, kind: "food_aggregator", delivery_type: "partner", discounts: [] }],
        },
        items: items.map((i, n) => ({ id: 9000 + n, merchant_id: i.ref, title: i.name, quantity: i.qty, price: i.price / 100, total: (i.price * i.qty) / 100, options_to_add: [], options_to_remove: [] })),
        payment: [{ option: "payment_gateway", amount: subtotal + packaging + taxes }],
        store: { id: 1, merchant_ref_id: "test-store" },
        next_state: "Acknowledged",
      },
    };
  },
};
