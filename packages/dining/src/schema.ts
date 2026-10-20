import { pk, tenantId, timestamps } from "@srirealtime/db";
import { boolean, date, index, integer, numeric, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const ORDER_TYPES = ["dine_in", "takeaway", "delivery", "online"] as const;
export type DiningOrderType = (typeof ORDER_TYPES)[number];

export const ORDER_STATUSES = ["open", "billed", "cancelled"] as const;
export type DiningOrderStatus = (typeof ORDER_STATUSES)[number];

/** Where an order came from: the restaurant's own staff, a guest at the table (QR menu) or the online store. */
export const ORDER_SOURCES = ["staff", "qr", "online"] as const;
export type DiningOrderSource = (typeof ORDER_SOURCES)[number];

/** Line status: `pending` is on the order but not sent to the kitchen yet; the rest follow its KOT. */
export const ITEM_STATUSES = ["pending", "sent", "cancelled"] as const;
export type DiningItemStatus = (typeof ITEM_STATUSES)[number];

export const KOT_STATUSES = ["new", "preparing", "ready", "served", "cancelled"] as const;
export type KotStatus = (typeof KOT_STATUSES)[number];
/** KOT statuses still on the kitchen display. */
export const ACTIVE_KOT_STATUSES: readonly KotStatus[] = ["new", "preparing", "ready"];

export const DEFAULT_STATION = "kitchen";

const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });

/** A dining area: "Ground floor", "AC hall", "Terrace". */
export const diningAreas = pgTable(
  "dining_areas",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
    ...timestamps(),
  },
  (t) => [unique("dining_areas_tenant_name_uq").on(t.tenantId, t.name)],
);

export const diningTables = pgTable(
  "dining_tables",
  {
    id: pk(),
    tenantId: tenantId(),
    areaId: uuid("area_id"),
    /** What staff call it: "T4", "Family 2". Unique per shop. */
    name: text("name").notNull(),
    seats: integer("seats").notNull().default(4),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
    /** Secret in the table's QR code: guests order to this table from the online menu. */
    qrToken: text("qr_token").notNull(),
    ...timestamps(),
  },
  (t) => [
    unique("dining_tables_tenant_name_uq").on(t.tenantId, t.name),
    unique("dining_tables_qr_token_uq").on(t.qrToken),
    index("dining_tables_tenant_area_idx").on(t.tenantId, t.areaId),
  ],
);

/** Kitchen settings of a menu item (`itemId` = catalogue variant id): which station makes it, veg / non-veg. */
export const diningMenuItems = pgTable(
  "dining_menu_items",
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid("item_id").notNull(),
    /** "kitchen", "bar", "tandoor", "desserts"… KOTs are split per station. */
    station: text("station").notNull().default(DEFAULT_STATION),
    veg: boolean("veg"),
    /** Off = sold out today: hidden from the QR menu and flagged at the counter. */
    available: boolean("available").notNull().default(true),
    ...timestamps(),
  },
  (t) => [unique("dining_menu_items_tenant_item_uq").on(t.tenantId, t.itemId)],
);

/** A running order: a table's tab, a takeaway parcel or an online order on its way to the kitchen. */
export const diningOrders = pgTable(
  "dining_orders",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Per shop per day: 1, 2, 3… (shown as "#12"). */
    number: integer("number").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    type: text("type").$type<DiningOrderType>().notNull().default("dine_in"),
    source: text("source").$type<DiningOrderSource>().notNull().default("staff"),
    status: text("status").$type<DiningOrderStatus>().notNull().default("open"),
    tableId: uuid("table_id"),
    guests: integer("guests"),
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    note: text("note"),
    /** The bill(s) made from this order. */
    invoiceIds: uuid("invoice_ids").array().notNull().default([]),
    /** Online store order this came from. */
    externalRef: text("external_ref"),
    openedBy: uuid("opened_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("dining_orders_tenant_date_number_uq").on(t.tenantId, t.businessDate, t.number),
    index("dining_orders_tenant_status_idx").on(t.tenantId, t.status),
    index("dining_orders_tenant_table_idx").on(t.tenantId, t.tableId, t.status),
    index("dining_orders_tenant_external_idx").on(t.tenantId, t.externalRef),
  ],
);

export const diningOrderItems = pgTable(
  "dining_order_items",
  {
    id: pk(),
    tenantId: tenantId(),
    orderId: uuid("order_id").notNull(),
    itemId: uuid("item_id"),
    name: text("name").notNull(),
    qty: qty("qty").notNull(),
    /** Paise per unit, as billed (GST-inclusive when the item is). */
    rate: integer("rate").notNull(),
    gstRate: real("gst_rate").notNull().default(5),
    hsn: text("hsn"),
    unit: text("unit"),
    /** "Less spicy", "no onion": printed on the KOT. */
    note: text("note"),
    station: text("station").notNull().default(DEFAULT_STATION),
    status: text("status").$type<DiningItemStatus>().notNull().default("pending"),
    kotId: uuid("kot_id"),
    cancelReason: text("cancel_reason"),
    ...timestamps(),
  },
  (t) => [index("dining_order_items_tenant_order_idx").on(t.tenantId, t.orderId), index("dining_order_items_tenant_kot_idx").on(t.tenantId, t.kotId)],
);

/** Kitchen order ticket: the items sent to one station in one go. */
export const diningKots = pgTable(
  "dining_kots",
  {
    id: pk(),
    tenantId: tenantId(),
    orderId: uuid("order_id").notNull(),
    /** Per shop per day. */
    number: integer("number").notNull(),
    businessDate: date("business_date", { mode: "string" }).notNull(),
    station: text("station").notNull().default(DEFAULT_STATION),
    status: text("status").$type<KotStatus>().notNull().default("new"),
    /** Some items were cancelled after sending: the kitchen sees a void slip. */
    hasVoids: boolean("has_voids").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    servedAt: timestamp("served_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    unique("dining_kots_tenant_date_number_uq").on(t.tenantId, t.businessDate, t.number),
    index("dining_kots_tenant_status_idx").on(t.tenantId, t.status, t.station),
    index("dining_kots_tenant_order_idx").on(t.tenantId, t.orderId),
  ],
);

export type DiningAreaRow = typeof diningAreas.$inferSelect;
export type DiningTableRow = typeof diningTables.$inferSelect;
export type DiningMenuItemRow = typeof diningMenuItems.$inferSelect;
export type DiningOrderRow = typeof diningOrders.$inferSelect;
export type DiningOrderItemRow = typeof diningOrderItems.$inferSelect;
export type DiningKotRow = typeof diningKots.$inferSelect;
