import { pk, tenantId, timestamps } from "@srirealtime/db";
import type { InvoiceTotals, LineTotals } from "@srirealtime/gst";
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const MOVEMENT_REASONS = [
  "opening",
  "adjustment",
  "sale",
  "sale_cancel",
  /** Goods back from a credit note (sales return). */
  "sale_return",
  /** A cancelled credit note's goods taken out again. */
  "sale_return_cancel",
  "purchase",
  "purchase_cancel",
  "transfer_out",
  "transfer_in",
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/** Known movement ref types; reservations may commit with their own ref type (e.g. "order"). */
export const REF_TYPES = ["invoice", "purchase", "order", "transfer", "credit_note"] as const;
export type RefType = (typeof REF_TYPES)[number] | (string & {});

export const LOCATION_TYPES = ["store", "warehouse"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const RESERVATION_STATUSES = ["active", "released", "committed"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** A line of a stock transfer, as stored. */
export interface TransferLine {
  itemId: string;
  qty: number;
}

export const PURCHASE_STATUSES = ["recorded", "cancelled"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

/** Supplier details frozen on a purchase. */
export interface SupplierSnapshot {
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  address: string | null;
  stateCode: string | null;
}

/** A computed purchase line; `itemId` links it to a saved item whose stock it increased. */
export type PurchaseLine = LineTotals & { itemId?: string };

const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });

/**
 * Where stock is kept. Every tenant has exactly one default location ("Main", code MAIN), created lazily by
 * `InventoryService.ensureDefaultLocation` on the first stock operation.
 */
export const stockLocations = pgTable(
  "stock_locations",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    /** Short upper-case code, unique per tenant (e.g. MAIN, WH1). */
    code: text("code").notNull(),
    type: text("type").$type<LocationType>().notNull().default("store"),
    address: text("address"),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    unique("stock_locations_tenant_code_uq").on(t.tenantId, t.code),
    uniqueIndex("stock_locations_tenant_default_uq")
      .on(t.tenantId)
      .where(sql`${t.isDefault}`),
  ],
);

/**
 * Current stock per saved item and location. Items without a row count as qty 0, tracked.
 * `location_id` is nullable at the database level only for rows created before locations existed; the service
 * moves them to the tenant's default location (self-healing, see `ensureDefaultLocation` / `backfillLocations`)
 * and never writes a null location. The unique key treats nulls as equal so legacy rows stay one per item.
 */
export const stockItems = pgTable(
  "stock_items",
  {
    id: pk(),
    tenantId: tenantId(),
    locationId: uuid("location_id"),
    itemId: uuid("item_id").notNull(),
    track: boolean("track").notNull().default(true),
    qty: qty("qty").notNull().default("0"),
    /** Held by active reservations (orders). available = qty − reserved. */
    reserved: qty("reserved").notNull().default("0"),
    reorderLevel: qty("reorder_level").notNull().default("0"),
    /** Moving-average cost, paise per unit (excluding GST). */
    avgCost: integer("avg_cost"),
    ...timestamps(),
  },
  (t) => [
    unique("stock_items_tenant_location_item_uq").on(t.tenantId, t.locationId, t.itemId).nullsNotDistinct(),
    index("stock_items_tenant_item_idx").on(t.tenantId, t.itemId),
  ],
);

/** Append-only stock ledger. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Null only on rows written before locations existed (backfilled to the default location). */
    locationId: uuid("location_id"),
    itemId: uuid("item_id").notNull(),
    delta: qty("delta").notNull(),
    qtyAfter: qty("qty_after").notNull(),
    reason: text("reason").$type<MovementReason>().notNull(),
    refType: text("ref_type").$type<RefType>(),
    refId: text("ref_id"),
    refNumber: text("ref_number"),
    /** Paise per unit, for incoming stock. */
    unitCost: integer("unit_cost"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_movements_tenant_item_created_idx").on(t.tenantId, t.itemId, t.createdAt),
    index("stock_movements_tenant_ref_idx").on(t.tenantId, t.refType, t.refId),
    index("stock_movements_tenant_location_created_idx").on(t.tenantId, t.locationId, t.createdAt),
  ],
);

/** Immediate moves of stock between two locations (movements `transfer_out` / `transfer_in`, ref type `transfer`). */
export const stockTransfers = pgTable(
  "stock_transfers",
  {
    id: pk(),
    tenantId: tenantId(),
    fromLocationId: uuid("from_location_id").notNull(),
    toLocationId: uuid("to_location_id").notNull(),
    lines: jsonb("lines").$type<TransferLine[]>().notNull(),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_transfers_tenant_created_idx").on(t.tenantId, t.createdAt)],
);

/** Stock held for a reference (e.g. an order) until it is committed (sold) or released. */
export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: pk(),
    tenantId: tenantId(),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    locationId: uuid("location_id").notNull(),
    itemId: uuid("item_id").notNull(),
    qty: qty("qty").notNull(),
    status: text("status").$type<ReservationStatus>().notNull().default("active"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("stock_reservations_tenant_ref_item_uq").on(t.tenantId, t.refType, t.refId, t.itemId),
    index("stock_reservations_tenant_location_item_idx").on(t.tenantId, t.locationId, t.itemId),
  ],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    gstin: text("gstin"),
    address: text("address"),
    stateCode: text("state_code"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("suppliers_tenant_name_idx").on(t.tenantId, t.name)],
);

/** Supplier bills: add stock and carry input tax credit. */
export const purchases = pgTable(
  "purchases",
  {
    id: pk(),
    tenantId: tenantId(),
    supplierId: uuid("supplier_id"),
    supplier: jsonb("supplier").$type<SupplierSnapshot>().notNull(),
    billNumber: text("bill_number").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    /** The shop's state (place of supply for a purchase). */
    placeOfSupply: text("place_of_supply").notNull(),
    interState: boolean("inter_state").notNull().default(false),
    lines: jsonb("lines").$type<PurchaseLine[]>().notNull(),
    totals: jsonb("totals").$type<Omit<InvoiceTotals, "lines">>().notNull(),
    /** Paise. */
    total: integer("total").notNull(),
    paid: boolean("paid").notNull().default(false),
    status: text("status").$type<PurchaseStatus>().notNull().default("recorded"),
    notes: text("notes"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [index("purchases_tenant_date_idx").on(t.tenantId, t.date), index("purchases_tenant_supplier_idx").on(t.tenantId, t.supplierId)],
);

export type StockLocationRow = typeof stockLocations.$inferSelect;
export type StockTransferRow = typeof stockTransfers.$inferSelect;
export type StockReservationRow = typeof stockReservations.$inferSelect;
export type StockItemRow = typeof stockItems.$inferSelect;
export type StockMovementRow = typeof stockMovements.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type PurchaseRow = typeof purchases.$inferSelect;
