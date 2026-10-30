import { documented, isSuperAdmin, permissionDenied, permissionsAllow, requireRole, requireTenant, requireUser, type RequestContext } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { csvDisposition, ordersCsv } from "./csv";
import { ORDER_FEATURES_KEYS, ORDER_PERMISSIONS_KEYS } from "./features";
import {
  fulfillmentInputSchema,
  listQuerySchema,
  manualOrderSchema,
  noteInputSchema,
  paymentInputSchema,
  refundInputSchema,
  statusInputSchema,
} from "./service";
import { ORDER_CHANNELS, ORDER_EVENT_TYPES, ORDER_PAYMENT_METHODS, ORDER_STATUSES, PAYMENT_STATUSES, STOCK_STATES } from "./schema";
import type {
  FulfillmentInput,
  ManualOrderInput,
  NoteInput,
  OrderListQuery,
  OrderPaymentInput,
  OrdersService,
  RefundInput,
  StatusInput,
} from "./service";

const idParam = z.object({ id: z.string().uuid() });
/** Order routes only match UUID-shaped ids, so /summary and unknown paths never reach them. */
const ID = "/:id([0-9a-fA-F-]{36})";
const formatQuery = z.object({ format: z.enum(["json", "csv"]).default("json") });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const FEATURE = { config: { feature: ORDER_FEATURES_KEYS.base } };

// ---- response shapes for the API document and the mobile client (JSON: dates are ISO strings, money in paise)
const isoDateTime = z.string().datetime();
const paise = z.number().int();
const gstRate = z.number();
/** The buyer as frozen on the order. */
export const orderCustomerSchema = z.object({
  name: z.string(),
  /** E.164 when it is a valid Indian mobile, else as entered. */
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** billing_customers id (manual orders). */
  customerId: z.string().nullish(),
  /** Storefront customer account id. */
  accountId: z.string().nullish(),
  locale: z.string().nullish(),
});
export const orderAddressSchema = z.object({
  name: z.string().nullish(),
  phone: z.string().nullish(),
  line1: z.string(),
  line2: z.string().nullish(),
  landmark: z.string().nullish(),
  city: z.string(),
  district: z.string().nullish(),
  /** 2-digit GST state code (the shipping address's is the place of supply). */
  stateCode: z.string(),
  pincode: z.string(),
  country: z.string(),
});
export const orderFulfillmentSchema = z.object({
  carrier: z.string().nullish(),
  trackingNumber: z.string().nullish(),
  trackingUrl: z.string().nullish(),
  shipmentId: z.string().nullish(),
});
/** A computed GST line (`LineTotals`): the shipping and COD fee lines. */
export const orderTaxLineSchema = z.object({
  description: z.string(),
  hsn: z.string().nullish(),
  qty: z.number(),
  unit: z.string().nullish(),
  rate: paise,
  discount: paise.nullish(),
  gstRate,
  itemId: z.string().nullish(),
  inclusiveTotal: paise.nullish(),
  serials: z.array(z.string()).nullish(),
  amount: paise,
  taxable: paise,
  cgst: paise,
  sgst: paise,
  igst: paise,
  total: paise,
});
export const orderLineSchema = z.object({
  /** Catalogue variant id (= invoice / inventory `itemId`). */
  variantId: z.string().uuid(),
  productId: z.string().uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  image: z.string().nullable(),
  /** Up to 3 decimals. */
  qty: z.number(),
  unit: z.string(),
  /** Per unit as charged (includes GST when `taxInclusive`). */
  price: paise,
  /** Per unit before GST. */
  rate: paise,
  gstRate,
  hsn: z.string().nullable(),
  taxInclusive: z.boolean(),
  /** Before GST: the coupon and loyalty share of this line. */
  discount: paise,
  amount: paise,
  taxable: paise,
  cgst: paise,
  sgst: paise,
  igst: paise,
  total: paise,
});
export const orderTotalsSchema = z.object({
  /** Sum of qty x price as charged. */
  subtotal: paise,
  /** Coupon and automatic-offer discount on the goods, as charged. */
  discount: paise,
  /** Automatic offers applied (buy X get Y, tiers, free gifts, bundles); absent when none. */
  offers: z.array(z.object({ id: z.string(), kind: z.string(), name: z.string(), label: z.string(), discount: paise })).optional(),
  /** The offers' part of `discount`; absent when none. */
  offerDiscount: paise.optional(),
  /** Loyalty points used and their discount; absent when none. */
  loyalty: z.object({ points: z.number().int(), discount: paise }).optional(),
  /** Shipping charged (GST-inclusive), after any free-shipping coupon. */
  shipping: paise,
  shippingWaived: paise,
  shippingLine: orderTaxLineSchema.nullable(),
  /** Cash-on-delivery fee (GST-inclusive). Absent on older orders. */
  codFee: paise.optional(),
  codFeeLine: orderTaxLineSchema.nullable().optional(),
  taxable: paise,
  cgst: paise,
  sgst: paise,
  igst: paise,
  roundOff: paise,
  total: paise,
  taxBreakup: z.array(z.object({ gstRate, taxable: paise, cgst: paise, sgst: paise, igst: paise })),
  sellerState: z.string(),
  placeOfSupply: z.string(),
  interState: z.boolean(),
});
/** A timeline entry. `data` depends on the type (payment amount and method, refund, fulfillment fields...). */
export const orderEventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(ORDER_EVENT_TYPES),
  fromStatus: z.enum(ORDER_STATUSES).nullable(),
  toStatus: z.enum(ORDER_STATUSES).nullable(),
  message: z.string().nullable(),
  actorUserId: z.string().uuid().nullable(),
  data: z.record(z.string(), z.unknown()),
  createdAt: isoDateTime,
});
/** A full order (`Order`): the get, create, status, note, payment, refund, fulfillment and invoice answers. */
export const orderSchema = z.object({
  id: z.string().uuid(),
  /** "ORD/26-27/0001". */
  number: z.string(),
  channel: z.enum(ORDER_CHANNELS),
  status: z.enum(ORDER_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  paymentMethod: z.enum(ORDER_PAYMENT_METHODS),
  customer: orderCustomerSchema,
  shippingAddress: orderAddressSchema.nullable(),
  billingAddress: orderAddressSchema.nullable(),
  lines: z.array(orderLineSchema),
  totals: orderTotalsSchema,
  total: paise,
  paid: paise,
  refunded: paise,
  /** total - (paid - refunded). */
  balance: paise,
  currency: z.string(),
  fulfillment: orderFulfillmentSchema,
  stockState: z.enum(STOCK_STATES),
  couponCode: z.string().nullable(),
  invoiceId: z.string().uuid().nullable(),
  invoiceNumber: z.string().nullable(),
  locationId: z.string().uuid().nullable(),
  branchId: z.string().uuid().nullable(),
  /** Internal (staff) note. */
  notes: z.string().nullable(),
  customerNote: z.string().nullable(),
  cancelReason: z.string().nullable(),
  /** For the customer's order link and online payment. */
  accessToken: z.string(),
  placedAt: isoDateTime,
  confirmedAt: isoDateTime.nullable(),
  shippedAt: isoDateTime.nullable(),
  deliveredAt: isoDateTime.nullable(),
  cancelledAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  /** Oldest first. */
  events: z.array(orderEventSchema),
  /** Statuses `POST /:id/status` accepts next. */
  nextStatuses: z.array(z.enum(ORDER_STATUSES)),
});
export const orderSummarySchema = z.object({
  id: z.string().uuid(),
  number: z.string(),
  channel: z.enum(ORDER_CHANNELS),
  status: z.enum(ORDER_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  paymentMethod: z.enum(ORDER_PAYMENT_METHODS),
  customerName: z.string(),
  customerPhone: z.string().nullable(),
  itemCount: z.number().int(),
  total: paise,
  paid: paise,
  branchId: z.string().uuid().nullable(),
  placedAt: isoDateTime,
});
const statusCountsSchema = z.object({
  placed: z.number().int(),
  confirmed: z.number().int(),
  packed: z.number().int(),
  shipped: z.number().int(),
  delivered: z.number().int(),
  cancelled: z.number().int(),
  returned: z.number().int(),
});
export const orderListSchema = z.object({
  items: z.array(orderSummarySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  /** Orders per status under the other filters (every status, 0 included). */
  counts: statusCountsSchema,
  /** `status`: the same as `counts`. */
  facets: z.object({ status: statusCountsSchema }),
});
/** Dashboard: today's and this month's orders (IST, cancelled left out) and orders waiting for the shop. */
export const ordersSummarySchema = z.object({
  today: z.object({ count: z.number().int(), total: paise }),
  pending: z.object({ placed: z.number().int(), confirmed: z.number().int(), packed: z.number().int() }),
  month: z.object({ count: z.number().int(), total: paise }),
});
/** An `orders` route with its API document shapes. */
const typed = (schema: Parameters<typeof documented>[0]) => documented(schema, FEATURE.config);

/**
 * Checks that the user holds at least one of `keys` once the staff module fills `user.permissions`
 * (docs/commerce-batch1.md §5); patterns such as `orders.*` count. Until then (no permissions on the user) the base
 * role check is all there is. Throws 403 `permission_denied` `{ permission }` (the first key).
 */
export function requirePermission(ctx: RequestContext, ...keys: [string, ...string[]]): void {
  const user = requireUser(ctx);
  if (isSuperAdmin(ctx)) return;
  const perms = (user as { permissions?: string[] }).permissions;
  if (!perms) return;
  if (keys.some((k) => permissionsAllow(perms, k))) return;
  throw permissionDenied(keys[0]);
}

/** Who may move an order to `status`: cancel needs orders.cancel; shipped/delivered also accept the Delivery role's keys. */
export function statusPermissions(status: unknown): [string, ...string[]] {
  if (status === "cancelled") return [ORDER_PERMISSIONS_KEYS.cancel];
  if (status === "shipped") return [ORDER_PERMISSIONS_KEYS.manage, ORDER_PERMISSIONS_KEYS.ship];
  if (status === "delivered") return [ORDER_PERMISSIONS_KEYS.manage, ORDER_PERMISSIONS_KEYS.deliver];
  return [ORDER_PERMISSIONS_KEYS.manage];
}

/**
 * Routes under /v1/orders (staff: owner, admin or staff member; feature `orders`). Returns additionally need
 * `orders.returns` (checked by the service). `GET /` accepts `format=csv` and filters (`status`, `paymentStatus`,
 * `channel`, `branchId`, `q`, `from`, `to`).
 */
export function ordersRoutes(service: OrdersService) {
  return async (app: FastifyInstance) => {
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });
      const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
      const userOf = (req: { ctx: RequestContext }) => requireUser(req.ctx).id;

      staff.get("/", typed({ query: listQuerySchema, response: orderListSchema }), async (req, reply) => {
        const q = query(req);
        const { format } = formatQuery.parse(q);
        const { format: _f, ...filters } = q;
        if (format !== "csv") return service.list(tenantOf(req), filters as OrderListQuery);
        const result = await service.list(tenantOf(req), { ...filters, limit: 500, offset: 0 } as OrderListQuery);
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", csvDisposition("orders", q.from, q.to))
          .send(ordersCsv(result.items));
      });
      staff.get("/summary", typed({ response: ordersSummarySchema }), async (req) => service.summary(tenantOf(req)));
      staff.post("/", typed({ body: manualOrderSchema, response: orderSchema }), async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.manage);
        // Multi-branch shops: the order belongs to the request's branch and reserves at its stock location (unless the body names one).
        const branch = req.ctx.branch ?? null;
        return service.create(tenantOf(req), body(req) as ManualOrderInput, userOf(req), {
          branchId: branch?.id ?? null,
          locationId: branch?.locationId ?? null,
        });
      });
      staff.get(ID, typed({ response: orderSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        return service.get(tenantOf(req), id);
      });
      staff.post(`${ID}/status`, typed({ body: statusInputSchema, response: orderSchema }), async (req) => {
        const { id } = idParam.parse(req.params);
        const b = body(req) as StatusInput;
        requirePermission(req.ctx, ...statusPermissions(b.status));
        return service.updateStatus(tenantOf(req), id, b, userOf(req));
      });
      staff.post(`${ID}/notes`, typed({ body: noteInputSchema, response: orderSchema }), async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.manage);
        const { id } = idParam.parse(req.params);
        return service.addNote(tenantOf(req), id, body(req) as NoteInput, userOf(req));
      });
      staff.post(`${ID}/payments`, typed({ body: paymentInputSchema, response: orderSchema }), async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.manage);
        const { id } = idParam.parse(req.params);
        return service.addPayment(tenantOf(req), id, body(req) as OrderPaymentInput, userOf(req));
      });
      staff.post(`${ID}/refunds`, typed({ body: refundInputSchema, response: orderSchema }), async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.refund);
        const { id } = idParam.parse(req.params);
        return service.addRefund(tenantOf(req), id, body(req) as RefundInput, userOf(req));
      });
      staff.post(`${ID}/fulfillment`, typed({ body: fulfillmentInputSchema, response: orderSchema }), async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.manage);
        const { id } = idParam.parse(req.params);
        return service.updateFulfillment(tenantOf(req), id, body(req) as FulfillmentInput, userOf(req));
      });
      staff.post(`${ID}/invoice`, typed({ response: orderSchema }), async (req) => {
        requirePermission(req.ctx, ORDER_PERMISSIONS_KEYS.manage);
        const { id } = idParam.parse(req.params);
        return service.retryInvoice(tenantOf(req), id, userOf(req));
      });
    });
  };
}
