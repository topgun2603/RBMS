import {
  AppError,
  badRequest,
  conflict,
  defineSort,
  listFilter,
  listQuerySchema as baseListQuery,
  newId,
  notFound,
  randomToken,
  rangeOrder,
  runList,
  searchAny,
  type FeatureGatePort,
  type ListPage,
  type TenantRef,
} from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import {
  financialYear,
  formatInvoiceNumber,
  isValidDate,
  isValidStateCode,
  normalizeStateCode,
  sanitizePrefix,
  todayIST,
} from "@srirealtime/gst";
import { and, asc, count, desc, eq, gte, inArray, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ORDER_FEATURES_KEYS } from "./features";
import {
  allocateLoyaltyDiscount,
  allowedTransitions,
  balanceOf,
  buildBaseLines,
  computeOrderTotals,
  customerKeyOf,
  derivePaymentStatus,
  isBlocking,
  istRange,
  itemsText,
  monthStart,
  moneyText,
  normalizeSettings,
  planPlacement,
  planTransition,
  runEffects,
  shouldAutoConfirm,
  splitProportionally,
  toIndianE164,
  type BaseLine,
  type LineRequest,
  type OrderEffect,
  type OrderTemplate,
  type TransitionState,
} from "./logic";
import {
  noopLogger,
  type CatalogPort,
  type CartPricingResult,
  type CouponPort,
  type InvoicingPort,
  type LoggerPort,
  type NotifierPort,
  type NotifierSendInput,
  type OrderEventsPort,
  type OrderLoyaltyPort,
  type OrderPaymentEvent,
  type OrderSettings,
  type OrderSettingsPort,
  type SellerPort,
  type ShopContactPort,
  type StockPort,
} from "./ports";
import {
  ORDER_CHANNELS,
  ORDER_STATUSES,
  orderEvents,
  orders,
  orderSeries,
  PAYMENT_STATUSES,
  type OrderChannel,
  type OrderEventRow,
  type OrderEventType,
  type OrderPaymentMethod,
  type OrderPaymentStatus,
  type OrderRow,
  type OrderStatus,
  type StockState,
} from "./schema";
import type { Address, Fulfillment, OrderCustomer, OrderLine, OrderTotals } from "./types";

/** Money columns are Postgres `integer` (paise). */
export const MAX_PAISE = 2_000_000_000;
/** Used when neither the shop nor the order has a state (Tamil Nadu). */
export const DEFAULT_STATE_CODE = "33";

export interface OrderLinks {
  /** The customer's order page, e.g. `${shop}/o/${accessToken}`. */
  customer?(tenantId: string, order: { id: string; number: string; accessToken: string }): string | Promise<string>;
  /** The order in the shop's admin app. */
  owner?(tenantId: string, order: { id: string; number: string }): string | Promise<string>;
}

export interface OrdersDeps {
  db: Db;
  catalog: CatalogPort;
  seller: SellerPort;
  settings: OrderSettingsPort;
  /** Inventory reservations. Without it stock isn't touched. */
  stock?: StockPort;
  /** GST invoices for orders. Without it no invoice is made. */
  invoicing?: InvoicingPort;
  /** Coupons module. Without it coupon codes are refused. */
  coupons?: CouponPort;
  notifier?: NotifierPort;
  shopContacts?: ShopContactPort;
  /** Checks `orders` (checkout), `orders.returns` and `coupons` outside the route pipeline. Without it all are on. */
  featureGate?: FeatureGatePort;
  links?: OrderLinks;
  /** Told about new orders, status changes and money recorded on orders (best effort). */
  events?: OrderEventsPort;
  /** Loyalty points redeemed at placement (`loyaltyPoints`). Without it orders asking for points are refused. */
  loyalty?: OrderLoyaltyPort;
  /** State code used when the shop has none set. Default "33" (Tamil Nadu). */
  defaultStateCode?: string;
  log?: LoggerPort;
  /** Clock override for tests. */
  now?: () => Date;
}

// ------------------------------------------------------------------ DTOs

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface OrderSummary {
  id: string;
  number: string;
  channel: OrderChannel;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  paymentMethod: OrderPaymentMethod;
  customerName: string;
  customerPhone: string | null;
  itemCount: number;
  total: number;
  paid: number;
  branchId: string | null;
  placedAt: Date;
}

export interface OrderListResult extends ListPage<OrderSummary> {
  /** Orders per status for the same filters (status filter aside); same as `facets.status`. */
  counts: Record<OrderStatus, number>;
}

export interface OrderEvent {
  id: string;
  type: OrderEventType;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  message: string | null;
  actorUserId: string | null;
  data: Record<string, unknown>;
  createdAt: Date;
}

export interface Order {
  id: string;
  number: string;
  channel: OrderChannel;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  paymentMethod: OrderPaymentMethod;
  customer: OrderCustomer;
  shippingAddress: Address | null;
  billingAddress: Address | null;
  lines: OrderLine[];
  totals: OrderTotals;
  total: number;
  paid: number;
  refunded: number;
  /** total − (paid − refunded). */
  balance: number;
  currency: string;
  fulfillment: Fulfillment;
  stockState: StockState;
  couponCode: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  locationId: string | null;
  /** Shop branch (multi-branch shops), null otherwise. */
  branchId: string | null;
  notes: string | null;
  customerNote: string | null;
  cancelReason: string | null;
  /** For the customer's order link / online payment. */
  accessToken: string;
  placedAt: Date;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Oldest first. */
  events: OrderEvent[];
  nextStatuses: OrderStatus[];
}

/** What a storefront customer sees: no internal notes or staff ids. */
export type CustomerOrder = Omit<Order, "notes" | "events" | "nextStatuses" | "stockState" | "locationId" | "branchId"> & {
  events: Omit<OrderEvent, "actorUserId" | "data">[];
};

export interface OrdersSummary {
  today: { count: number; total: number };
  pending: { placed: number; confirmed: number; packed: number };
  month: { count: number; total: number };
}

export interface PaymentTarget {
  tenantId: string;
  purposeId: string;
  amount: number;
  description: string;
  customer: { name?: string; phone?: string; email?: string };
  payable: boolean;
  reason?: string;
}

// ------------------------------------------------------------------ validation

const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());

const money = z.number().int("Amounts are whole paise").min(0).max(MAX_PAISE);
const dateStr = z.string().refine(isValidDate, "Use a valid YYYY-MM-DD date");
const stateCode = z.union([z.string(), z.number()]).transform((v, ctx) => {
  const c = normalizeStateCode(v);
  if (!c || !isValidStateCode(c)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Unknown GST state code" });
    return z.NEVER;
  }
  return c;
});
const phone = z.string().trim().regex(/^\+?[0-9][0-9 ()-]{5,19}$/, "Invalid phone number");
const email = z.string().trim().toLowerCase().email().max(254);
const qty = z
  .number()
  .positive()
  .max(100_000)
  .refine((q) => Math.abs(Math.round(q * 1000) - q * 1000) < 1e-6, "Quantity allows up to 3 decimals");
const locale = z.string().trim().regex(/^[a-z]{2}([-_][A-Za-z]{2})?$/, "Invalid locale");
/** Loyalty points to redeem on the order (needs the customer's phone and the loyalty port). */
const loyaltyPoints = z.number().int("Whole points only").positive().max(10_000_000);

export const addressSchema = z.object({
  name: opt(z.string().trim().max(120)),
  phone: opt(phone),
  line1: z.string().trim().min(1).max(200),
  line2: opt(z.string().trim().max(200)),
  landmark: opt(z.string().trim().max(120)),
  city: z.string().trim().min(1).max(80),
  district: opt(z.string().trim().max(80)),
  stateCode,
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, "PIN code must be 6 digits"),
  country: z.string().trim().toUpperCase().length(2).default("IN"),
});

const customerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: opt(phone),
  email: opt(email),
  customerId: opt(z.string().uuid()),
  accountId: opt(z.string().trim().min(1).max(64)),
  locale: opt(locale),
});

const lineRequestSchema = z.object({
  variantId: z.string().uuid(),
  qty,
  /** Manual orders only: price per unit (same basis as the catalogue price). */
  price: opt(money),
});

const fulfillmentSchema = z.object({
  carrier: opt(z.string().trim().max(80)),
  trackingNumber: opt(z.string().trim().max(80)),
  trackingUrl: opt(z.string().trim().url().max(500)),
  shipmentId: opt(z.string().trim().max(120)),
});

export const manualOrderSchema = z.object({
  channel: z.enum(["manual", "pos", "marketplace"]).default("manual"),
  customer: customerSchema,
  shippingAddress: addressSchema.nullable().optional(),
  billingAddress: addressSchema.nullable().optional(),
  lines: z.array(lineRequestSchema).min(1, "Add at least one item").max(200),
  couponCode: opt(z.string().trim().max(64)),
  paymentMethod: z.enum(["online", "cod", "cash", "upi", "card", "other"]).default("cash"),
  /** Paise, GST-inclusive. */
  shipping: money.default(0),
  notes: opt(z.string().trim().max(2000)),
  customerNote: opt(z.string().trim().max(1000)),
  locationId: opt(z.string().uuid()),
  loyaltyPoints: loyaltyPoints.optional(),
  /** Overrides the shop's backorder setting for this order. */
  allowBackorder: z.boolean().optional(),
  /** Record full payment now (counter sale paid in cash/UPI). */
  markPaid: z.boolean().optional(),
  paymentReference: opt(z.string().trim().max(100)),
});
export type ManualOrderInput = z.input<typeof manualOrderSchema>;

/** Storefront checkout. Line prices are never accepted from the client. */
export const checkoutSchema = z.object({
  customer: customerSchema.extend({ phone }),
  shippingAddress: addressSchema,
  billingAddress: addressSchema.nullable().optional(),
  lines: z.array(z.object({ variantId: z.string().uuid(), qty })).min(1).max(100),
  couponCode: opt(z.string().trim().max(64)),
  paymentMethod: z.enum(["online", "cod"]),
  /** Paise, GST-inclusive (computed by the storefront server, not the browser). */
  shipping: money.default(0),
  /**
   * Cash-on-delivery fee, paise GST-inclusive (from the delivery rate). Charged as its own "COD charges" line and not
   * waived by a free-shipping coupon. Ignored unless `paymentMethod` is "cod".
   */
  codFee: money.default(0),
  customerNote: opt(z.string().trim().max(1000)),
  locationId: opt(z.string().uuid()),
  /** Shop branch the order belongs to (the host passes the default branch for storefront orders). */
  branchId: opt(z.string().uuid()),
  loyaltyPoints: loyaltyPoints.optional(),
});
export type CheckoutInput = z.input<typeof checkoutSchema>;

export const statusInputSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: opt(z.string().trim().max(500)),
  fulfillment: fulfillmentSchema.optional(),
});
export type StatusInput = z.input<typeof statusInputSchema>;

export const noteInputSchema = z.object({ message: z.string().trim().min(1).max(2000) });
export type NoteInput = z.input<typeof noteInputSchema>;

export const paymentInputSchema = z.object({
  amount: money.min(1, "Amount must be positive"),
  method: z.enum(["cash", "upi", "card", "bank", "cheque", "other"]),
  reference: opt(z.string().trim().max(100)),
  date: dateStr.optional(),
});
export type OrderPaymentInput = z.input<typeof paymentInputSchema>;

export const refundInputSchema = z.object({
  amount: money.min(1, "Amount must be positive"),
  reason: opt(z.string().trim().max(500)),
  method: z.enum(["cash", "upi", "card", "bank", "online", "other"]).optional(),
  reference: opt(z.string().trim().max(100)),
});
export type RefundInput = z.input<typeof refundInputSchema>;

export const fulfillmentInputSchema = fulfillmentSchema;
export type FulfillmentInput = z.input<typeof fulfillmentInputSchema>;

export const onlinePaymentSchema = z.object({
  tenantId: z.string().uuid(),
  orderId: z.string().uuid(),
  amount: money.min(1),
  method: z.enum(["upi", "card", "bank", "wallet", "other"]),
  providerPaymentId: z.string().trim().min(1).max(100),
  provider: z.string().trim().max(20).optional(),
  paidAt: z.coerce.date(),
});
export type OnlineOrderPaymentInput = z.input<typeof onlinePaymentSchema>;

/**
 * GET /v1/orders (docs/CONVENTIONS.md → "Lists and tables"). `status`, `paymentStatus`, `channel` and `branchId` take
 * comma lists. Default 50 / max 500 rows (the CSV export and the kanban board ask for more than a table page).
 */
export const listQuerySchema = baseListQuery({ defaultLimit: 50, maxLimit: 500 })
  .extend({
    status: listFilter.oneOf(ORDER_STATUSES),
    paymentStatus: listFilter.oneOf(PAYMENT_STATUSES),
    channel: listFilter.oneOf(ORDER_CHANNELS),
    branchId: listFilter.ids(),
    from: listFilter.date(),
    to: listFilter.date(),
  })
  .superRefine(rangeOrder("from", "to"));
export type OrderListQuery = z.input<typeof listQuerySchema>;

/** Order list sort fields ("placed" = placed time; "number" follows the FY series). */
export const ORDER_SORT = defineSort(
  {
    number: sql`(${orders.fy}, ${orders.seq})`,
    placed: orders.placedAt,
    customer: sql`lower(${orders.customer}->>'name')`,
    total: orders.total,
    status: orders.status,
  },
  { default: "-placed", tieBreaker: [orders.seq, orders.id] },
);

export const customerListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
export type CustomerListQuery = z.input<typeof customerListQuerySchema>;

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Hands out the next order sequence for (tenant, FY). The row lock taken by the upsert serialises concurrent orders
 * until the surrounding transaction ends; a rollback leaves no gap.
 */
export function allocateOrderSeqStatement(db: DbOrTx, args: { tenantId: string; fy: string; prefix: string }) {
  const current = sql`${sql.identifier("order_series")}.${sql.identifier("next_seq")}`;
  return db
    .insert(orderSeries)
    .values({ tenantId: args.tenantId, fy: args.fy, prefix: args.prefix, nextSeq: 1 })
    .onConflictDoUpdate({
      target: [orderSeries.tenantId, orderSeries.fy],
      set: { nextSeq: sql`${current} + 1`, prefix: args.prefix, updatedAt: sql`now()` },
    })
    .returning({ seq: orderSeries.nextSeq });
}

/**
 * Dashboard aggregates. The IST day/month starts are bound as ISO strings cast to timestamptz: postgres-js refuses a
 * raw Date as a parameter inside a sql`` fragment (no column to map it).
 */
export function summaryColumns(dayStart: Date, monthStartAt: Date) {
  const live = sql`${orders.status} not in ('cancelled')`;
  const day = sql`${dayStart.toISOString()}::timestamptz`;
  const month = sql`${monthStartAt.toISOString()}::timestamptz`;
  return {
    todayCount: sql<number>`count(*) filter (where ${orders.placedAt} >= ${day} and ${live})::int`,
    todayTotal: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.placedAt} >= ${day} and ${live}), 0)`,
    monthCount: sql<number>`count(*) filter (where ${orders.placedAt} >= ${month} and ${live})::int`,
    monthTotal: sql<string>`coalesce(sum(${orders.total}) filter (where ${orders.placedAt} >= ${month} and ${live}), 0)`,
    placed: sql<number>`count(*) filter (where ${orders.status} = 'placed')::int`,
    confirmed: sql<number>`count(*) filter (where ${orders.status} = 'confirmed')::int`,
    packed: sql<number>`count(*) filter (where ${orders.status} = 'packed')::int`,
  };
}

const emptyCounts = (): Record<OrderStatus, number> =>
  Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;

const toEvent = (e: OrderEventRow): OrderEvent => ({
  id: e.id,
  type: e.type,
  fromStatus: e.fromStatus ?? null,
  toStatus: e.toStatus ?? null,
  message: e.message,
  actorUserId: e.actorUserId,
  data: e.data ?? {},
  createdAt: e.createdAt,
});

const stateOf = (r: OrderRow): TransitionState => ({
  status: r.status,
  paymentMethod: r.paymentMethod,
  total: r.total,
  paid: r.paid - r.refunded,
  stockState: r.stockState,
  couponCode: r.couponCode,
  hasOffers: (r.totals.offers?.length ?? 0) > 0,
  invoiceId: r.invoiceId,
});

/** Columns stamped when an order enters a status. */
const STAMP: Partial<Record<OrderStatus, "confirmedAt" | "shippedAt" | "deliveredAt" | "cancelledAt">> = {
  confirmed: "confirmedAt",
  shipped: "shippedAt",
  delivered: "deliveredAt",
  cancelled: "cancelledAt",
};

function cleanFulfillment(f: z.output<typeof fulfillmentSchema> | undefined): Fulfillment {
  const out: Fulfillment = {};
  if (!f) return out;
  for (const k of ["carrier", "trackingNumber", "trackingUrl", "shipmentId"] as const) {
    if (f[k] !== undefined) out[k] = f[k] ?? null;
  }
  return out;
}

function cleanAddress(a: z.output<typeof addressSchema> | null | undefined): Address | null {
  if (!a) return null;
  return {
    name: a.name ?? null,
    phone: a.phone ? (toIndianE164(a.phone) ?? a.phone) : null,
    line1: a.line1,
    line2: a.line2 ?? null,
    landmark: a.landmark ?? null,
    city: a.city,
    district: a.district ?? null,
    stateCode: a.stateCode,
    pincode: a.pincode,
    country: a.country,
  };
}

function cleanCustomer(c: z.output<typeof customerSchema>): OrderCustomer {
  return {
    name: c.name,
    phone: c.phone ? (toIndianE164(c.phone) ?? c.phone) : null,
    email: c.email ?? null,
    customerId: c.customerId ?? null,
    accountId: c.accountId ?? null,
    locale: c.locale ?? null,
  };
}

/** Everything needed to place an order, from either a manual entry or a checkout. */
interface PlaceDraft {
  channel: OrderChannel;
  customer: OrderCustomer;
  shippingAddress: Address | null;
  billingAddress: Address | null;
  requests: LineRequest[];
  allowPriceOverride: boolean;
  couponCode: string | null;
  paymentMethod: OrderPaymentMethod;
  shipping: number;
  /** COD fee (GST-inclusive), checkout only. */
  codFee?: number;
  notes: string | null;
  customerNote: string | null;
  locationId: string | null;
  branchId: string | null;
  /** Loyalty points to redeem. */
  loyaltyPoints?: number;
  allowBackorder?: boolean;
  markPaid?: { method: OrderPaymentMethod; reference: string | null };
  createdBy: string | null;
}

interface EffectContext {
  actorUserId: string | null;
  reason?: string | null;
  /** Placement only: what the coupon redeem records. */
  couponAmount?: number;
  /** Placement only: the automatic offers to record. */
  offers?: { offerId: string; amount: number }[];
  allowBackorder?: boolean;
}

export class OrdersService {
  private readonly db: Db;
  private readonly catalog: CatalogPort;
  private readonly sellerPort: SellerPort;
  private readonly settingsPort: OrderSettingsPort;
  private readonly stock?: StockPort;
  private readonly invoicing?: InvoicingPort;
  private readonly coupons?: CouponPort;
  private readonly notifier?: NotifierPort;
  private readonly shopContacts?: ShopContactPort;
  private readonly featureGate?: FeatureGatePort;
  private readonly links: OrderLinks;
  private readonly orderEvents?: OrderEventsPort;
  private readonly loyalty?: OrderLoyaltyPort;
  private readonly defaultState: string;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(deps: OrdersDeps) {
    this.db = deps.db;
    this.catalog = deps.catalog;
    this.sellerPort = deps.seller;
    this.settingsPort = deps.settings;
    this.stock = deps.stock;
    this.invoicing = deps.invoicing;
    this.coupons = deps.coupons;
    this.notifier = deps.notifier;
    this.shopContacts = deps.shopContacts;
    this.featureGate = deps.featureGate;
    this.links = deps.links ?? {};
    this.orderEvents = deps.events;
    this.loyalty = deps.loyalty;
    this.defaultState = deps.defaultStateCode ?? DEFAULT_STATE_CODE;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  /** Whether a feature is on for the shop (always true without a gate). Gate failures count as off. */
  private async featureOn(tenantId: string, key: string): Promise<boolean> {
    if (!this.featureGate) return true;
    try {
      return await this.featureGate.isEnabled(tenantId, key);
    } catch (err) {
      this.log.warn({ err, tenantId, feature: key }, "orders: feature check failed");
      return false;
    }
  }

  async settings(tenantId: string): Promise<Required<OrderSettings>> {
    return normalizeSettings(await this.settingsPort.get(tenantId));
  }

  // ================================================================ reading

  private async row(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<OrderRow> {
    if (!UUID_RE.test(id)) throw notFound("Order");
    const q = db
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Order");
    return row;
  }

  private async events(tenantId: string, orderId: string): Promise<OrderEvent[]> {
    const rows = await this.db
      .select()
      .from(orderEvents)
      .where(and(eq(orderEvents.tenantId, tenantId), eq(orderEvents.orderId, orderId)))
      .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id));
    return rows.map(toEvent);
  }

  private toOrder(r: OrderRow, events: OrderEvent[], returnsEnabled: boolean): Order {
    return {
      id: r.id,
      number: r.number,
      channel: r.channel,
      status: r.status,
      paymentStatus: r.paymentStatus,
      paymentMethod: r.paymentMethod,
      customer: r.customer,
      shippingAddress: r.shippingAddress ?? null,
      billingAddress: r.billingAddress ?? null,
      lines: r.lines,
      totals: r.totals,
      total: r.total,
      paid: r.paid,
      refunded: r.refunded,
      balance: balanceOf(r),
      currency: r.currency,
      fulfillment: r.fulfillment ?? {},
      stockState: r.stockState,
      couponCode: r.couponCode,
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      locationId: r.locationId,
      branchId: r.branchId ?? null,
      notes: r.notes,
      customerNote: r.customerNote,
      cancelReason: r.cancelReason,
      accessToken: r.accessToken,
      placedAt: r.placedAt,
      confirmedAt: r.confirmedAt,
      shippedAt: r.shippedAt,
      deliveredAt: r.deliveredAt,
      cancelledAt: r.cancelledAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      events,
      nextStatuses: allowedTransitions(r.status, { returnsEnabled }),
    };
  }

  private async full(r: OrderRow): Promise<Order> {
    const [events, returnsEnabled] = await Promise.all([
      this.events(r.tenantId, r.id),
      r.status === "delivered" ? this.featureOn(r.tenantId, ORDER_FEATURES_KEYS.returns) : Promise.resolve(false),
    ]);
    return this.toOrder(r, events, returnsEnabled);
  }

  async get(tenantId: string, id: string): Promise<Order> {
    return this.full(await this.row(this.db, tenantId, id));
  }

  private summaryOf(
    r: Pick<OrderRow, "id" | "number" | "channel" | "status" | "paymentStatus" | "paymentMethod" | "customer" | "lines" | "total" | "paid" | "placedAt"> & {
      branchId?: string | null;
    },
  ): OrderSummary {
    return {
      id: r.id,
      number: r.number,
      channel: r.channel,
      status: r.status,
      paymentStatus: r.paymentStatus,
      paymentMethod: r.paymentMethod,
      customerName: r.customer?.name ?? "",
      customerPhone: r.customer?.phone ?? null,
      itemCount: r.lines?.length ?? 0,
      total: r.total,
      paid: r.paid,
      branchId: r.branchId ?? null,
      placedAt: r.placedAt,
    };
  }

  /** Filters shared by the list and its status counts. */
  listConditions(tenantId: string, p: z.output<typeof listQuerySchema>, withStatus: boolean): SQL | undefined {
    const conds: (SQL | undefined)[] = [eq(orders.tenantId, tenantId)];
    if (withStatus && p.status?.length) conds.push(inArray(orders.status, p.status));
    if (p.paymentStatus?.length) conds.push(inArray(orders.paymentStatus, p.paymentStatus));
    if (p.channel?.length) conds.push(inArray(orders.channel, p.channel));
    if (p.branchId?.length) conds.push(inArray(orders.branchId, p.branchId));
    const { start, end } = istRange(p.from, p.to);
    if (start) conds.push(gte(orders.placedAt, start));
    if (end) conds.push(lt(orders.placedAt, end));
    conds.push(
      searchAny(p.q, [
        orders.number,
        sql`${orders.customer}->>'name'`,
        sql`${orders.customer}->>'phone'`,
        sql`${orders.customer}->>'email'`,
      ]),
    );
    return and(...conds);
  }

  /** Order list: paged, sorted (ORDER_SORT), filtered; `counts` / `facets.status` = orders per status under the other filters. */
  async list(tenantId: string, query: OrderListQuery = {}): Promise<OrderListResult> {
    const p = listQuerySchema.parse(query);
    const order = ORDER_SORT.orderBy(p.sort);
    const where = this.listConditions(tenantId, p, true);
    const [page, byStatus] = await Promise.all([
      runList(p, {
        rows: () =>
          this.db
            .select({
              id: orders.id,
              number: orders.number,
              channel: orders.channel,
              status: orders.status,
              paymentStatus: orders.paymentStatus,
              paymentMethod: orders.paymentMethod,
              customer: orders.customer,
              lines: orders.lines,
              total: orders.total,
              paid: orders.paid,
              branchId: orders.branchId,
              placedAt: orders.placedAt,
            })
            .from(orders)
            .where(where)
            .orderBy(...order)
            .limit(p.limit)
            .offset(p.offset),
        count: () => this.db.select({ total: count() }).from(orders).where(where),
        map: (r) => this.summaryOf(r),
      }),
      this.db
        .select({ status: orders.status, n: count() })
        .from(orders)
        .where(this.listConditions(tenantId, p, false))
        .groupBy(orders.status),
    ]);
    const counts = emptyCounts();
    for (const r of byStatus) counts[r.status] = Number(r.n);
    return { ...page, counts, facets: { status: { ...counts } } };
  }

  /** Dashboard: today's and this month's orders (IST, cancelled excluded) and orders waiting for the shop. */
  async summary(tenantId: string): Promise<OrdersSummary> {
    const today = todayIST(this.now());
    const { start: dayStart } = istRange(today, null);
    const { start: mStart } = istRange(monthStart(today), null);
    const [r] = await this.db
      .select(summaryColumns(dayStart!, mStart!))
      .from(orders)
      .where(eq(orders.tenantId, tenantId));
    const n = (v: unknown) => Number(v ?? 0);
    return {
      today: { count: n(r?.todayCount), total: n(r?.todayTotal) },
      pending: { placed: n(r?.placed), confirmed: n(r?.confirmed), packed: n(r?.packed) },
      month: { count: n(r?.monthCount), total: n(r?.monthTotal) },
    };
  }

  // ================================================================ storefront customers

  private toCustomerOrder(o: Order): CustomerOrder {
    const { notes: _n, events, nextStatuses: _s, stockState: _st, locationId: _l, branchId: _b, ...rest } = o;
    return {
      ...rest,
      events: events
        .filter((e) => e.type === "status" || e.type === "fulfillment" || e.type === "payment" || e.type === "refund")
        .map(({ actorUserId: _a, data: _d, ...e }) => e),
    };
  }

  async listForCustomer(tenantId: string, accountId: string, query: CustomerListQuery = {}): Promise<ListResult<OrderSummary>> {
    const p = customerListQuerySchema.parse(query);
    const where = and(eq(orders.tenantId, tenantId), sql`${orders.customer}->>'accountId' = ${accountId}`);
    const [rows, [counted]] = await Promise.all([
      this.db.select().from(orders).where(where).orderBy(desc(orders.placedAt)).limit(p.limit).offset(p.offset),
      this.db.select({ total: count() }).from(orders).where(where),
    ]);
    return { items: rows.map((r) => this.summaryOf(r)), total: counted?.total ?? 0 };
  }

  async getForCustomer(tenantId: string, accountId: string, id: string): Promise<CustomerOrder> {
    const row = await this.row(this.db, tenantId, id);
    if (row.customer?.accountId !== accountId) throw notFound("Order");
    return this.toCustomerOrder(await this.full(row));
  }

  /**
   * The newest delivered order of this storefront account that contains `productId` (reviews' verified-buyer check),
   * or null. `accountId` is the store-customer id stored in `customer.accountId`.
   */
  async deliveredOrderWithProduct(tenantId: string, accountId: string, productId: string): Promise<{ orderId: string } | null> {
    if (!accountId || !UUID_RE.test(productId)) return null;
    const [row] = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.status, "delivered"),
          sql`${orders.customer}->>'accountId' = ${accountId}`,
          sql`${orders.lines} @> ${JSON.stringify([{ productId }])}::jsonb`,
        ),
      )
      .orderBy(desc(orders.deliveredAt))
      .limit(1);
    return row ? { orderId: row.id } : null;
  }

  /** Guest order page by access token. With `tenantId`, orders of other shops are not found. */
  async getByToken(token: string, tenantId: string | null = null): Promise<CustomerOrder> {
    const row = await this.rowByToken(token);
    if (!row || (tenantId && row.tenantId !== tenantId)) throw notFound("Order");
    return this.toCustomerOrder(await this.full(row));
  }

  private async rowByToken(token: string): Promise<OrderRow | null> {
    if (!TOKEN_RE.test(token)) return null;
    const [row] = await this.db.select().from(orders).where(eq(orders.accessToken, token)).limit(1);
    return row ?? null;
  }

  /** Whether this customer has no earlier (non-cancelled) order. Unknown without an account or phone. */
  private async isFirstOrder(tenantId: string, c: OrderCustomer): Promise<boolean | undefined> {
    const conds: SQL[] = [];
    if (c.accountId) conds.push(sql`${orders.customer}->>'accountId' = ${c.accountId}`);
    if (c.phone) conds.push(sql`${orders.customer}->>'phone' = ${c.phone}`);
    if (!conds.length) return undefined;
    const [r] = await this.db
      .select({ n: count() })
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), ne(orders.status, "cancelled"), or(...conds)));
    return (r?.n ?? 0) === 0;
  }

  // ================================================================ placing orders

  /**
   * Manual order entered by staff (phone/WhatsApp orders, counter sales, marketplace orders typed in). `opts` comes
   * from the request's branch: the order is stored under `branchId`, and stock is reserved at the body's
   * `locationId`, else the branch's location.
   */
  async create(
    tenantId: string,
    input: ManualOrderInput,
    actorUserId: string | null = null,
    opts: { branchId?: string | null; locationId?: string | null } = {},
  ): Promise<Order> {
    const b = manualOrderSchema.parse(input);
    return this.place(tenantId, {
      channel: b.channel,
      customer: cleanCustomer(b.customer),
      shippingAddress: cleanAddress(b.shippingAddress),
      billingAddress: cleanAddress(b.billingAddress),
      requests: b.lines.map((l) => ({ variantId: l.variantId, qty: l.qty, price: l.price ?? null })),
      allowPriceOverride: true,
      couponCode: b.couponCode ?? null,
      paymentMethod: b.paymentMethod,
      shipping: b.shipping,
      notes: b.notes ?? null,
      customerNote: b.customerNote ?? null,
      locationId: b.locationId ?? opts.locationId ?? null,
      branchId: opts.branchId ?? null,
      loyaltyPoints: b.loyaltyPoints,
      allowBackorder: b.allowBackorder,
      markPaid: b.markPaid ? { method: b.paymentMethod, reference: b.paymentReference ?? null } : undefined,
      createdBy: actorUserId,
    });
  }

  /**
   * Storefront checkout (batch 2). Prices, GST and the coupon come from the catalogue and coupons module — never
   * from the client. Online orders start `pending` until the payments module calls `recordOnlinePayment`.
   */
  async createFromCheckout(tenant: TenantRef | string, input: CheckoutInput): Promise<Order> {
    const tenantId = typeof tenant === "string" ? tenant : tenant.id;
    if (!(await this.featureOn(tenantId, ORDER_FEATURES_KEYS.base))) {
      throw new AppError(403, "feature_disabled", "This shop isn't taking online orders", { feature: ORDER_FEATURES_KEYS.base });
    }
    const b = checkoutSchema.parse(input);
    return this.place(tenantId, {
      channel: "store",
      customer: cleanCustomer(b.customer),
      shippingAddress: cleanAddress(b.shippingAddress),
      billingAddress: cleanAddress(b.billingAddress),
      requests: b.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
      allowPriceOverride: false,
      couponCode: b.couponCode ?? null,
      paymentMethod: b.paymentMethod,
      shipping: b.shipping,
      codFee: b.paymentMethod === "cod" ? b.codFee : 0,
      notes: null,
      customerNote: b.customerNote ?? null,
      locationId: b.locationId ?? null,
      branchId: b.branchId ?? null,
      loyaltyPoints: b.loyaltyPoints,
      createdBy: null,
    });
  }

  /** Prices the lines from the catalogue. 400 invalid_items `{ missing, badGst }` when some can't be sold. */
  private async priceLines(tenantId: string, draft: PlaceDraft): Promise<BaseLine[]> {
    const ids = [...new Set(draft.requests.map((r) => r.variantId))];
    const items = await this.catalog.getVariants(tenantId, ids, draft.channel === "store" ? { channel: "store" } : undefined);
    const built = buildBaseLines(items, draft.requests, { allowPriceOverride: draft.allowPriceOverride });
    if (!built.ok) {
      throw new AppError(400, "invalid_items", "Some items can't be ordered any more", { missing: built.missing, badGst: built.badGst });
    }
    return built.lines;
  }

  private async place(tenantId: string, draft: PlaceDraft): Promise<Order> {
    const settings = await this.settings(tenantId);
    const base = await this.priceLines(tenantId, draft);
    const seller = await this.sellerPort.get(tenantId);
    const sellerState = normalizeStateCode(seller.stateCode) ?? draft.shippingAddress?.stateCode ?? this.defaultState;
    const placeOfSupply = draft.shippingAddress?.stateCode ?? draft.billingAddress?.stateCode ?? sellerState;
    const subtotal = base.reduce((s, l) => s + l.gross, 0);
    const customerKey = customerKeyOf(draft.customer);
    const id = newId();

    // Automatic offers + coupon: priced by the coupons module (best for the customer), redeemed as a blocking effect below.
    let couponCode: string | null = null;
    let lineDiscounts: number[] | undefined;
    let freeShipping = false;
    let applied: CartPricingResult["offers"] = [];
    let couponGoods: number | null = null;
    const pricing =
      this.coupons?.priceCart && (await this.featureOn(tenantId, "coupons"))
        ? await this.coupons.priceCart(tenantId, {
            channel: draft.channel,
            lines: base.map((l) => ({ variantId: l.variantId, productId: l.productId, categoryId: l.categoryId ?? null, unitPrice: l.price, qty: l.qty, amount: l.gross })),
            shipping: draft.shipping,
            couponCode: draft.couponCode ? draft.couponCode.trim().toUpperCase() : null,
            customerKey,
            isFirstOrder: draft.couponCode ? await this.isFirstOrder(tenantId, draft.customer) : undefined,
          })
        : null;
    if (pricing) {
      if (draft.couponCode) {
        const result = pricing.coupon;
        if (!result || !result.valid) {
          const reason = result && !result.valid ? result.reason : "not_found";
          const message = result && !result.valid ? result.message : undefined;
          throw new AppError(400, "coupon_invalid", message ?? "This coupon can't be used", { reason });
        }
        couponCode = draft.couponCode.trim().toUpperCase();
        freeShipping = result.freeShipping;
        couponGoods = pricing.couponDiscount;
      }
      applied = pricing.offers.filter((o) => o.discount > 0);
      if (pricing.lineDiscounts.length === base.length && pricing.lineDiscounts.some((d) => d > 0)) lineDiscounts = pricing.lineDiscounts;
    } else if (draft.couponCode) {
      const code = draft.couponCode.trim().toUpperCase();
      if (!this.coupons || !(await this.featureOn(tenantId, "coupons"))) {
        throw new AppError(400, "coupon_invalid", "Coupons can't be used in this shop", { reason: "not_found" });
      }
      const result = await this.coupons.evaluate(tenantId, code, {
        channel: draft.channel,
        subtotal,
        shipping: draft.shipping,
        lines: base.map((l) => ({ productId: l.productId, categoryId: l.categoryId, amount: l.gross })),
        customerKey,
        isFirstOrder: await this.isFirstOrder(tenantId, draft.customer),
      });
      if (!result.valid) {
        throw new AppError(400, "coupon_invalid", result.message ?? "This coupon can't be used", { reason: result.reason });
      }
      couponCode = code;
      freeShipping = result.freeShipping;
      lineDiscounts =
        result.lineDiscounts && result.lineDiscounts.length === base.length
          ? result.lineDiscounts
          : splitProportionally(result.discount, base.map((l) => l.gross));
    }

    // Loyalty points: redeemed now (the discount must be known to price the order), given back if placement fails.
    let loyalty: { points: number; discounts: number[] } | null = null;
    if (draft.loyaltyPoints) {
      const phone = draft.customer.phone;
      if (!phone) throw new AppError(400, "loyalty_phone_required", "Add the customer's phone number to use loyalty points");
      if (!this.loyalty) throw new AppError(400, "loyalty_unavailable", "Loyalty points can't be used in this shop");
      const orderAmount = base.reduce((s, l, i) => s + l.gross - Math.min(Math.max(lineDiscounts?.[i] ?? 0, 0), l.gross), 0);
      const redeemed = await this.loyalty.redeem(tenantId, {
        phone,
        name: draft.customer.name || null,
        points: draft.loyaltyPoints,
        orderId: id,
        orderAmount,
      });
      const discount = Math.round(redeemed.discount);
      if (discount > orderAmount) {
        await this.reverseLoyalty(tenantId, id);
        throw new AppError(400, "loyalty_invalid", "The points discount is more than the order amount", { discount, orderAmount });
      }
      if (discount > 0) loyalty = { points: redeemed.points, discounts: allocateLoyaltyDiscount(discount, base, lineDiscounts) };
      else await this.reverseLoyalty(tenantId, id);
    }

    // The order as it will be stored; effects read from (and update) this copy.
    let row: OrderRow;
    let effects: OrderEffect[];
    let ctx: EffectContext;
    try {
      const { lines, totals } = computeOrderTotals(base, {
        lineDiscounts,
        ...(loyalty ? { loyaltyDiscounts: loyalty.discounts, loyaltyPoints: loyalty.points } : {}),
        shipping: draft.shipping,
        freeShipping,
        codFee: draft.codFee ?? 0,
        sellerState,
        placeOfSupply,
      });
      if (applied.length) {
        totals.offers = applied.map((o) => ({ id: o.offerId, kind: o.kind, name: o.name, label: o.label, discount: o.discount }));
        totals.offerDiscount = applied.reduce((s, o) => s + o.discount, 0);
      }

      const now = this.now();
      const fy = financialYear(todayIST(now));
      const prefix = sanitizePrefix(settings.prefix);
      const paid = draft.markPaid ? totals.total : 0;
      row = {
        id,
        tenantId,
        number: "",
        fy,
        seq: 0,
        channel: draft.channel,
        customer: draft.customer,
        shippingAddress: draft.shippingAddress,
        billingAddress: draft.billingAddress,
        lines,
        totals,
        total: totals.total,
        paid,
        refunded: 0,
        currency: "INR",
        status: "placed",
        paymentStatus: derivePaymentStatus({ total: totals.total, paid, refunded: 0, paymentMethod: draft.paymentMethod }),
        paymentMethod: draft.paymentMethod,
        fulfillment: {},
        stockState: "none",
        couponCode,
        invoiceId: null,
        invoiceNumber: null,
        locationId: draft.locationId,
        branchId: draft.branchId,
        notes: draft.notes,
        customerNote: draft.customerNote,
        cancelReason: null,
        accessToken: randomToken(18),
        placedAt: now,
        confirmedAt: null,
        shippedAt: null,
        deliveredAt: null,
        cancelledAt: null,
        createdBy: draft.createdBy,
        createdAt: now,
        updatedAt: now,
      };

      effects = planPlacement({ couponCode, hasOffers: applied.length > 0, notifyOwner: settings.notifyOwner });
      ctx = {
        actorUserId: draft.createdBy,
        couponAmount: (couponGoods ?? totals.discount) + totals.shippingWaived,
        offers: applied.map((o) => ({ offerId: o.offerId, amount: o.discount })),
        allowBackorder: draft.allowBackorder ?? settings.allowBackorder,
      };
      const blocking = effects.filter(isBlocking);
      // Stock reservation and coupon redemption must succeed (409 insufficient_stock / coupon_invalid pass through).
      await runEffects(blocking, (e) => this.applyEffect(row, e, ctx), { mode: "blocking", undo: (e) => this.undoEffect(row, e) });

      try {
        await this.db.transaction(async (tx) => {
          const [series] = await allocateOrderSeqStatement(tx, { tenantId, fy, prefix });
          row.seq = series!.seq;
          row.number = formatInvoiceNumber(prefix, fy, row.seq);
          await tx.insert(orders).values(row);
          await tx.insert(orderEvents).values({
            tenantId,
            orderId: id,
            type: "status",
            toStatus: "placed",
            message: "Order placed",
            actorUserId: draft.createdBy,
            data: { channel: draft.channel },
          });
          if (draft.markPaid && paid > 0) {
            await tx.insert(orderEvents).values({
              tenantId,
              orderId: id,
              type: "payment",
              message: `Payment received: ${moneyText(paid, "whatsapp")}`,
              actorUserId: draft.createdBy,
              data: { amount: paid, method: draft.markPaid.method, reference: draft.markPaid.reference, source: "manual" },
            });
          }
        });
      } catch (err) {
        for (const e of [...blocking].reverse()) await this.undoEffect(row, e).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      if (loyalty) await this.reverseLoyalty(tenantId, id);
      throw err;
    }
    this.log.info({ tenantId, orderId: id, number: row.number, channel: row.channel, total: row.total }, "order placed");

    await this.runBestEffort(row, effects.filter((e) => !isBlocking(e)), ctx);
    await this.emitCreated(tenantId, id);

    if (shouldAutoConfirm(settings, row)) {
      try {
        return await this.updateStatus(tenantId, id, { status: "confirmed", note: "Confirmed automatically" }, null);
      } catch (err) {
        this.log.error({ err, tenantId, orderId: id }, "orders: auto-confirm failed");
      }
    }
    return this.get(tenantId, id);
  }

  // ================================================================ status changes

  /** Moves the order along its flow (409 invalid_transition otherwise) and runs the side effects. */
  async updateStatus(tenantId: string, id: string, input: StatusInput, actorUserId: string | null = null): Promise<Order> {
    const b = statusInputSchema.parse(input);
    const current = await this.row(this.db, tenantId, id);
    const settings = await this.settings(tenantId);
    const returnsEnabled = b.status === "returned" ? await this.featureOn(tenantId, ORDER_FEATURES_KEYS.returns) : false;
    const plan = planTransition(stateOf(current), b.status, { invoiceOn: settings.invoiceOn, returnsEnabled });
    if (!plan.ok) {
      if (plan.code === "feature_disabled") {
        throw new AppError(403, "feature_disabled", plan.message, { feature: ORDER_FEATURES_KEYS.returns });
      }
      throw new AppError(409, "invalid_transition", plan.message, {
        from: current.status,
        to: b.status,
        allowed: allowedTransitions(current.status, { returnsEnabled: true }),
      });
    }

    const now = this.now();
    const set: Partial<OrderRow> = { status: plan.to, updatedAt: now };
    for (const step of plan.path) {
      const col = STAMP[step];
      if (col && !current[col]) set[col] = now;
    }
    const fulfillment = cleanFulfillment(b.fulfillment);
    if (Object.keys(fulfillment).length) set.fulfillment = { ...(current.fulfillment ?? {}), ...fulfillment };
    if (plan.to === "cancelled") set.cancelReason = b.note ?? null;

    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(orders)
        .set(set)
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id), eq(orders.status, plan.from)))
        .returning();
      if (!updated) return null;
      await tx.insert(orderEvents).values({
        tenantId,
        orderId: id,
        type: "status",
        fromStatus: plan.from,
        toStatus: plan.to,
        message: b.note ?? null,
        actorUserId,
        data: { ...(plan.path.length > 1 ? { path: plan.path } : {}), ...(Object.keys(fulfillment).length ? { fulfillment } : {}) },
      });
      return updated;
    });
    if (!row) throw conflict("This order was changed meanwhile; reload and try again");
    this.log.info({ tenantId, orderId: id, from: plan.from, to: plan.to }, "order status changed");

    await this.runBestEffort(row, plan.effects, { actorUserId, reason: b.note ?? `Order ${row.number} ${plan.to}` });
    const order = await this.get(tenantId, id);
    if (this.orderEvents?.statusChanged) {
      try {
        await this.orderEvents.statusChanged({ tenantId, order, from: plan.from, to: plan.to });
      } catch (err) {
        this.log.error({ err, tenantId, orderId: id, from: plan.from, to: plan.to }, "orders: status listener failed");
      }
    }
    return order;
  }

  /** Tells the events port about a new order. Never throws. */
  private async emitCreated(tenantId: string, id: string) {
    if (!this.orderEvents?.created) return;
    try {
      await this.orderEvents.created(tenantId, await this.get(tenantId, id));
    } catch (err) {
      this.log.error({ err, tenantId, orderId: id }, "orders: created listener failed");
    }
  }

  /** Gives back points redeemed for an order that wasn't placed. Never throws. */
  private async reverseLoyalty(tenantId: string, orderId: string) {
    if (!this.loyalty) return;
    try {
      await this.loyalty.reverse(tenantId, orderId);
    } catch (err) {
      this.log.error({ err, tenantId, orderId }, "orders: giving back loyalty points failed");
    }
  }

  // ================================================================ side effects

  private async runBestEffort(row: OrderRow, effects: OrderEffect[], ctx: EffectContext) {
    await runEffects(effects, (e) => this.applyEffect(row, e, ctx), {
      mode: "best-effort",
      onFailure: async (e, err) => {
        this.log.error({ err, tenantId: row.tenantId, orderId: row.id, effect: e }, "orders: side effect failed");
        if (e.type === "notify") return; // Messages never block and aren't worth a timeline entry.
        const label = EFFECT_LABELS[e.type] ?? e.type;
        await this.addEvent(this.db, row, {
          type: "note",
          message: `${label} failed: ${errorText(err)}`,
          data: { kind: "effect_failed", effect: e.type, error: errorText(err) },
        });
      },
    });
  }

  private addEvent(
    db: DbOrTx,
    row: Pick<OrderRow, "tenantId" | "id">,
    e: { type: OrderEventType; message?: string | null; actorUserId?: string | null; data?: Record<string, unknown>; fromStatus?: OrderStatus; toStatus?: OrderStatus },
  ) {
    return db.insert(orderEvents).values({
      tenantId: row.tenantId,
      orderId: row.id,
      type: e.type,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      message: e.message ?? null,
      actorUserId: e.actorUserId ?? null,
      data: e.data ?? {},
    });
  }

  private async setStock(row: OrderRow, state: StockState) {
    row.stockState = state;
    await this.db
      .update(orders)
      .set({ stockState: state })
      .where(and(eq(orders.tenantId, row.tenantId), eq(orders.id, row.id)));
  }

  /** Executes one planned effect against the ports, updating `row` (and the database) with the outcome. */
  private async applyEffect(row: OrderRow, e: OrderEffect, ctx: EffectContext): Promise<void> {
    const { tenantId, id } = row;
    switch (e.type) {
      case "stock.reserve": {
        // Placement: the order isn't stored yet; the state is saved with the insert.
        if (!this.stock) return;
        await this.stock.reserve(tenantId, {
          refType: "order",
          refId: id,
          locationId: row.locationId,
          lines: row.lines.map((l) => ({ itemId: l.variantId, qty: l.qty })),
          allowBackorder: ctx.allowBackorder ?? false,
        });
        row.stockState = "reserved";
        return;
      }
      case "coupon.redeem": {
        if (!this.coupons) return;
        if (row.couponCode) await this.coupons.redeem(tenantId, row.couponCode, { refType: "order", refId: id }, customerKeyOf(row.customer), ctx.couponAmount ?? 0);
        if (ctx.offers?.length && this.coupons.redeemOffers) {
          try {
            await this.coupons.redeemOffers(tenantId, { refType: "order", refId: id }, customerKeyOf(row.customer), ctx.offers);
          } catch (err) {
            // This effect isn't undone by the runner when it fails: give the coupon (and any offers) back here.
            await this.coupons.release(tenantId, "order", id).catch(() => undefined);
            throw err;
          }
        }
        return;
      }
      case "stock.release": {
        if (!this.stock) return;
        await this.stock.release(tenantId, "order", id);
        await this.setStock(row, "released");
        return;
      }
      case "stock.commit": {
        if (!this.stock) return;
        await this.stock.commit(tenantId, "order", id);
        await this.setStock(row, "committed");
        return;
      }
      case "stock.restock": {
        if (!this.stock) return;
        if (!this.stock.restock) throw new Error("Inventory can't take returns back automatically; adjust the stock by hand");
        await this.stock.restock(tenantId, "order", id);
        await this.setStock(row, "returned");
        return;
      }
      case "coupon.release": {
        if (!this.coupons) return;
        await this.coupons.release(tenantId, "order", id);
        return;
      }
      case "payment.collectCod": {
        let collected = 0;
        const updated = await this.db.transaction(async (tx) => {
          const locked = await this.row(tx, tenantId, id, true);
          const due = balanceOf(locked);
          if (due <= 0) return locked;
          collected = due;
          const paid = locked.paid + due;
          const [u] = await tx
            .update(orders)
            .set({ paid, paymentStatus: derivePaymentStatus({ ...locked, paid }) })
            .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
            .returning();
          await this.addEvent(tx, locked, {
            type: "payment",
            message: `Cash on delivery collected: ${moneyText(due, "whatsapp")}`,
            actorUserId: ctx.actorUserId,
            data: { amount: due, method: "cod", source: "cod" },
          });
          return u!;
        });
        Object.assign(row, { paid: updated.paid, paymentStatus: updated.paymentStatus });
        await this.paymentRecorded(row, collected, "cod");
        return;
      }
      case "invoice.create": {
        if (!this.invoicing || row.invoiceId) return;
        const order = await this.get(tenantId, id);
        if (order.invoiceId) return;
        const inv = await this.invoicing.createFromOrder(tenantId, order);
        const [u] = await this.db
          .update(orders)
          .set({ invoiceId: inv.invoiceId, invoiceNumber: inv.number })
          .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id), sql`${orders.invoiceId} is null`))
          .returning({ id: orders.id });
        if (!u) this.log.warn({ tenantId, orderId: id, invoiceId: inv.invoiceId }, "orders: order already had an invoice; kept the first");
        else {
          row.invoiceId = inv.invoiceId;
          row.invoiceNumber = inv.number;
          await this.addEvent(this.db, row, {
            type: "note",
            message: `Invoice ${inv.number} issued`,
            actorUserId: ctx.actorUserId,
            data: { kind: "invoice", invoiceId: inv.invoiceId, number: inv.number },
          });
        }
        return;
      }
      case "invoice.cancel": {
        if (!this.invoicing || !row.invoiceId) return;
        await this.invoicing.cancelInvoice(tenantId, row.invoiceId, ctx.reason || `Order ${row.number} ${row.status}`);
        await this.addEvent(this.db, row, {
          type: "note",
          message: row.invoiceNumber ? `Invoice ${row.invoiceNumber} cancelled` : "Invoice cancelled",
          actorUserId: ctx.actorUserId,
          data: { kind: "invoice_cancelled", invoiceId: row.invoiceId },
        });
        return;
      }
      case "notify":
        await this.notify(row, e.template, e.audience);
        return;
    }
  }

  /** Compensation for blocking placement effects. */
  private async undoEffect(row: OrderRow, e: OrderEffect): Promise<void> {
    try {
      if (e.type === "stock.reserve" && this.stock && row.stockState === "reserved") {
        await this.stock.release(row.tenantId, "order", row.id);
        row.stockState = "released";
      }
      if (e.type === "coupon.redeem" && this.coupons) await this.coupons.release(row.tenantId, "order", row.id);
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId, orderId: row.id, effect: e }, "orders: undo after a failed placement failed");
    }
  }

  // ================================================================ notifications

  private async link(kind: "customer" | "owner", row: OrderRow): Promise<string> {
    try {
      if (kind === "customer" && this.links.customer) return await this.links.customer(row.tenantId, row);
      if (kind === "owner" && this.links.owner) return await this.links.owner(row.tenantId, row);
    } catch (err) {
      this.log.warn({ err, tenantId: row.tenantId, orderId: row.id }, "orders: link builder failed");
    }
    return "";
  }

  /** Template variables (documented in @srirealtime/notify templates). */
  async messageVars(row: OrderRow, audience: "customer" | "owner", channel: NotifierSendInput["channel"]): Promise<Record<string, string>> {
    let shop = "";
    try {
      shop = (await this.sellerPort.get(row.tenantId)).legalName ?? "";
    } catch {
      // Shop name is cosmetic.
    }
    const f = row.fulfillment ?? {};
    const link = await this.link(audience, row);
    return {
      shop,
      customer: row.customer.name,
      number: row.number,
      amount: moneyText(row.total, channel),
      items: itemsText(row.lines),
      link: audience === "customer" && f.trackingUrl ? f.trackingUrl : link,
      orderLink: link,
      tracking: [f.carrier, f.trackingNumber].filter(Boolean).join(" ") || "-",
      carrier: f.carrier ?? "",
      trackingNumber: f.trackingNumber ?? "",
      trackingUrl: f.trackingUrl ?? "",
      reason: row.cancelReason ?? "",
      paymentMethod: row.paymentMethod,
    };
  }

  /** Sends `template` to the customer (WhatsApp + email) or the shop owners. Never throws. */
  private async notify(row: OrderRow, template: OrderTemplate, audience: "customer" | "owner"): Promise<void> {
    if (!this.notifier) return;
    const targets: { channel: NotifierSendInput["channel"]; to: string; locale?: string }[] = [];
    try {
      if (audience === "customer") {
        const locale = row.customer.locale ?? undefined;
        const ph = toIndianE164(row.customer.phone);
        if (ph) targets.push({ channel: "whatsapp", to: ph, locale });
        if (row.customer.email) targets.push({ channel: "email", to: row.customer.email, locale });
      } else if (this.shopContacts) {
        for (const c of await this.shopContacts.ownerContacts(row.tenantId)) {
          const ph = toIndianE164(c.phone ?? null);
          if (ph) targets.push({ channel: "whatsapp", to: ph });
          if (c.email) targets.push({ channel: "email", to: c.email });
        }
      }
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId, orderId: row.id }, "orders: could not resolve message recipients");
      return;
    }
    for (const t of targets) {
      try {
        const vars = await this.messageVars(row, audience, t.channel);
        await this.notifier.send({ tenantId: row.tenantId, channel: t.channel, to: t.to, template, vars, ...(t.locale ? { locale: t.locale } : {}) });
      } catch (err) {
        this.log.error({ err, tenantId: row.tenantId, orderId: row.id, template, channel: t.channel }, "orders: notification failed");
      }
    }
  }

  /** Tells the events port about a stored payment. Never throws. */
  private async paymentRecorded(
    row: Pick<OrderRow, "tenantId" | "id" | "channel" | "customer" | "paymentStatus">,
    amount: number,
    source: OrderPaymentEvent["source"],
  ) {
    if (!this.orderEvents?.paymentRecorded || amount <= 0) return;
    try {
      await this.orderEvents.paymentRecorded({
        tenantId: row.tenantId,
        orderId: row.id,
        channel: row.channel,
        accountId: row.customer?.accountId ?? null,
        amount,
        source,
        paymentStatus: row.paymentStatus,
      });
    } catch (err) {
      this.log.error({ err, tenantId: row.tenantId, orderId: row.id, source }, "orders: payment listener failed");
    }
  }

  // ================================================================ notes, payments, refunds, fulfillment, invoice retry

  async addNote(tenantId: string, id: string, input: NoteInput, actorUserId: string | null = null): Promise<Order> {
    const b = noteInputSchema.parse(input);
    const row = await this.row(this.db, tenantId, id);
    await this.addEvent(this.db, row, { type: "note", message: b.message, actorUserId });
    return this.full(row);
  }

  async updateFulfillment(tenantId: string, id: string, input: FulfillmentInput, actorUserId: string | null = null): Promise<Order> {
    const f = cleanFulfillment(fulfillmentInputSchema.parse(input));
    if (!Object.keys(f).length) throw badRequest("Nothing to update");
    const row = await this.db.transaction(async (tx) => {
      const locked = await this.row(tx, tenantId, id, true);
      if (locked.status === "cancelled") throw badRequest("This order was cancelled");
      const [u] = await tx
        .update(orders)
        .set({ fulfillment: { ...(locked.fulfillment ?? {}), ...f } })
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
        .returning();
      await this.addEvent(tx, locked, { type: "fulfillment", message: "Shipping details updated", actorUserId, data: { ...f } });
      return u!;
    });
    return this.full(row);
  }

  /** Money received outside online payments (cash, UPI to the shop's QR, card machine). */
  async addPayment(tenantId: string, id: string, input: OrderPaymentInput, actorUserId: string | null = null): Promise<Order> {
    const b = paymentInputSchema.parse(input);
    const row = await this.db.transaction(async (tx) => {
      const locked = await this.row(tx, tenantId, id, true);
      if (locked.status === "cancelled") throw badRequest("This order was cancelled");
      const due = balanceOf(locked);
      if (b.amount > due) throw badRequest(due <= 0 ? "This order is already paid" : `Only ${moneyText(due, "whatsapp")} is due on this order`);
      const paid = locked.paid + b.amount;
      const [u] = await tx
        .update(orders)
        .set({ paid, paymentStatus: derivePaymentStatus({ ...locked, paid }) })
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
        .returning();
      await this.addEvent(tx, locked, {
        type: "payment",
        message: `Payment received: ${moneyText(b.amount, "whatsapp")}`,
        actorUserId,
        data: { amount: b.amount, method: b.method, reference: b.reference ?? null, date: b.date ?? todayIST(this.now()), source: "manual" },
      });
      return u!;
    });
    await this.paymentRecorded(row, b.amount, "manual");
    return this.full(row);
  }

  /** Records a refund made outside the app (v1 records only; no gateway refund). */
  async addRefund(tenantId: string, id: string, input: RefundInput, actorUserId: string | null = null): Promise<Order> {
    const b = refundInputSchema.parse(input);
    const row = await this.db.transaction(async (tx) => {
      const locked = await this.row(tx, tenantId, id, true);
      const refundable = locked.paid - locked.refunded;
      if (b.amount > refundable) {
        throw badRequest(refundable <= 0 ? "Nothing has been paid on this order" : `At most ${moneyText(refundable, "whatsapp")} can be refunded`);
      }
      const refunded = locked.refunded + b.amount;
      const [u] = await tx
        .update(orders)
        .set({ refunded, paymentStatus: derivePaymentStatus({ ...locked, refunded }) })
        .where(and(eq(orders.tenantId, tenantId), eq(orders.id, id)))
        .returning();
      await this.addEvent(tx, locked, {
        type: "refund",
        message: `Refund: ${moneyText(b.amount, "whatsapp")}${b.reason ? ` — ${b.reason}` : ""}`,
        actorUserId,
        data: { amount: b.amount, reason: b.reason ?? null, method: b.method ?? null, reference: b.reference ?? null },
      });
      return u!;
    });
    return this.full(row);
  }

  /** Retries the GST invoice after a failure (`POST /:id/invoice`). Errors are returned to the caller. */
  async retryInvoice(tenantId: string, id: string, actorUserId: string | null = null): Promise<Order> {
    const row = await this.row(this.db, tenantId, id);
    if (row.invoiceId) return this.full(row);
    if (!this.invoicing) throw new AppError(503, "not_configured", "Invoicing is not set up");
    const settings = await this.settings(tenantId);
    const due = row.status === "delivered" || (settings.invoiceOn === "confirmed" && ["confirmed", "packed", "shipped"].includes(row.status));
    if (!due) throw badRequest(row.status === "cancelled" || row.status === "returned" ? `This order was ${row.status}` : "The invoice is issued when the order is delivered");
    await this.applyEffect(row, { type: "invoice.create" }, { actorUserId });
    return this.get(tenantId, id);
  }

  // ================================================================ online payments (payments module glue)

  /**
   * Resolves the payments module's "order" purpose. `ref` is the order's access token (never the id: the checkout is
   * public and the prefill carries the customer's name and phone).
   */
  async paymentTarget(ref: string): Promise<PaymentTarget> {
    const row = await this.rowByToken(ref);
    if (!row) throw notFound("Order");
    const c = row.customer;
    const target: PaymentTarget = {
      tenantId: row.tenantId,
      purposeId: row.id,
      amount: Math.max(balanceOf(row), 0),
      description: `Order ${row.number}`,
      customer: {
        ...(c.name ? { name: c.name } : {}),
        ...(c.phone ? { phone: c.phone } : {}),
        ...(c.email ? { email: c.email } : {}),
      },
      payable: true,
    };
    if (row.status === "cancelled" || row.status === "returned") return { ...target, payable: false, reason: `This order was ${row.status}` };
    if (target.amount <= 0) return { ...target, payable: false, reason: "This order is already paid" };
    return target;
  }

  /**
   * Records a successful online payment (payments module `onPaid`). Idempotent on the provider payment id (checked
   * under the order's row lock). Never refuses money: payments on cancelled orders are recorded and logged.
   */
  async recordOnlinePayment(input: OnlineOrderPaymentInput): Promise<{ recorded: boolean; order: Order }> {
    const b = onlinePaymentSchema.parse(input);
    const { recorded, row } = await this.db.transaction(async (tx) => {
      const locked = await this.row(tx, b.tenantId, b.orderId, true);
      const [dup] = await tx
        .select({ id: orderEvents.id })
        .from(orderEvents)
        .where(
          and(
            eq(orderEvents.tenantId, b.tenantId),
            eq(orderEvents.orderId, b.orderId),
            eq(orderEvents.type, "payment"),
            sql`${orderEvents.data}->>'providerPaymentId' = ${b.providerPaymentId}`,
          ),
        )
        .limit(1);
      if (dup) return { recorded: false, row: locked };
      if (locked.status === "cancelled" || b.amount > balanceOf(locked)) {
        this.log.warn(
          { tenantId: b.tenantId, orderId: locked.id, status: locked.status, amount: b.amount, balance: balanceOf(locked) },
          "orders: online payment exceeds the balance or the order is cancelled; recorded anyway",
        );
      }
      const paid = locked.paid + b.amount;
      const [u] = await tx
        .update(orders)
        .set({ paid, paymentStatus: derivePaymentStatus({ ...locked, paid }) })
        .where(and(eq(orders.tenantId, b.tenantId), eq(orders.id, locked.id)))
        .returning();
      await this.addEvent(tx, locked, {
        type: "payment",
        message: `Paid online: ${moneyText(b.amount, "whatsapp")}`,
        data: {
          amount: b.amount,
          method: b.method,
          source: "online",
          provider: b.provider ?? null,
          providerPaymentId: b.providerPaymentId,
          paidAt: b.paidAt.toISOString(),
        },
      });
      return { recorded: true, row: u! };
    });
    if (recorded) {
      this.log.info({ tenantId: b.tenantId, orderId: row.id, amount: b.amount }, "order paid online");
      await this.paymentRecorded(row, b.amount, "online");
      const settings = await this.settings(b.tenantId).catch(() => null);
      if (settings && shouldAutoConfirm(settings, row)) {
        try {
          return { recorded, order: await this.updateStatus(b.tenantId, row.id, { status: "confirmed", note: "Confirmed after online payment" }, null) };
        } catch (err) {
          this.log.error({ err, tenantId: b.tenantId, orderId: row.id }, "orders: auto-confirm after payment failed");
        }
      }
    }
    return { recorded, order: await this.full(row) };
  }
}

const EFFECT_LABELS: Partial<Record<OrderEffect["type"], string>> = {
  "stock.release": "Releasing reserved stock",
  "stock.commit": "Reducing stock",
  "stock.restock": "Returning stock",
  "coupon.release": "Releasing the coupon",
  "payment.collectCod": "Recording the COD payment",
  "invoice.create": "Creating the invoice",
  "invoice.cancel": "Cancelling the invoice",
};

function errorText(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return m.slice(0, 300);
}
