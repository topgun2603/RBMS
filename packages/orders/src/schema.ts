import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { Address, Fulfillment, OrderCustomer, OrderLine, OrderTotals } from "./types";

export const ORDER_STATUSES = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled", "returned"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_CHANNELS = ["store", "manual", "pos", "marketplace"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const PAYMENT_STATUSES = ["unpaid", "pending", "paid", "cod", "refunded", "partially_refunded"] as const;
export type OrderPaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_PAYMENT_METHODS = ["online", "cod", "cash", "upi", "card", "other"] as const;
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

export const ORDER_EVENT_TYPES = ["status", "payment", "note", "fulfillment", "refund"] as const;
export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number];

/** Where the order's stock stands in inventory: never touched (no stock port), reserved, sold, released, returned. */
export const STOCK_STATES = ["none", "reserved", "committed", "released", "returned"] as const;
export type StockState = (typeof STOCK_STATES)[number];

export const orders = pgTable(
  "orders",
  {
    id: pk(),
    tenantId: tenantId(),
    /** "ORD/26-27/0001". */
    number: text("number").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    channel: text("channel").$type<OrderChannel>().notNull(),
    customer: jsonb("customer").$type<OrderCustomer>().notNull(),
    shippingAddress: jsonb("shipping_address").$type<Address | null>(),
    billingAddress: jsonb("billing_address").$type<Address | null>(),
    lines: jsonb("lines").$type<OrderLine[]>().notNull(),
    totals: jsonb("totals").$type<OrderTotals>().notNull(),
    /** Paise. */
    total: integer("total").notNull(),
    /** Paise received (manual + online + COD collected). */
    paid: integer("paid").notNull().default(0),
    /** Paise refunded (recorded only). */
    refunded: integer("refunded").notNull().default(0),
    currency: text("currency").notNull().default("INR"),
    status: text("status").$type<OrderStatus>().notNull().default("placed"),
    paymentStatus: text("payment_status").$type<OrderPaymentStatus>().notNull().default("unpaid"),
    paymentMethod: text("payment_method").$type<OrderPaymentMethod>().notNull(),
    fulfillment: jsonb("fulfillment").$type<Fulfillment>().notNull().default({}),
    stockState: text("stock_state").$type<StockState>().notNull().default("none"),
    couponCode: text("coupon_code"),
    invoiceId: uuid("invoice_id"),
    invoiceNumber: text("invoice_number"),
    locationId: uuid("location_id"),
    /** Internal (staff) note. */
    notes: text("notes"),
    customerNote: text("customer_note"),
    cancelReason: text("cancel_reason"),
    /** Unguessable token for the customer's order page and online payment. */
    accessToken: text("access_token").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    unique("orders_tenant_fy_seq_uq").on(t.tenantId, t.fy, t.seq),
    unique("orders_access_token_uq").on(t.accessToken),
    index("orders_tenant_placed_idx").on(t.tenantId, t.placedAt),
    index("orders_tenant_status_placed_idx").on(t.tenantId, t.status, t.placedAt),
    index("orders_tenant_account_idx").on(t.tenantId, sql`(${t.customer}->>'accountId')`),
    index("orders_tenant_phone_idx").on(t.tenantId, sql`(${t.customer}->>'phone')`),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: pk(),
    tenantId: tenantId(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    type: text("type").$type<OrderEventType>().notNull(),
    fromStatus: text("from_status").$type<OrderStatus>(),
    toStatus: text("to_status").$type<OrderStatus>(),
    message: text("message"),
    /** Null for the system or the customer. */
    actorUserId: uuid("actor_user_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.createdAt), index("order_events_tenant_idx").on(t.tenantId, t.createdAt)],
);

/** Per-tenant, per-FY order counter (like invoice_series). `next_seq` holds the last number handed out. */
export const orderSeries = pgTable(
  "order_series",
  {
    tenantId: tenantId(),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull(),
    nextSeq: integer("next_seq").notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ name: "order_series_pk", columns: [t.tenantId, t.fy] })],
);

export type OrderRow = typeof orders.$inferSelect;
export type OrderEventRow = typeof orderEvents.$inferSelect;
export type OrderSeriesRow = typeof orderSeries.$inferSelect;
