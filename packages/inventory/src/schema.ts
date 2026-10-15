import { pk, tenantId, timestamps } from "@srirealtime/db";
import type { InvoiceTotals, LineTotals } from "@srirealtime/gst";
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const MOVEMENT_REASONS = ["opening", "adjustment", "sale", "sale_cancel", "purchase", "purchase_cancel"] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

export const REF_TYPES = ["invoice", "purchase"] as const;
export type RefType = (typeof REF_TYPES)[number];

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

/** Current stock per saved item. Items without a row count as qty 0, tracked. */
export const stockItems = pgTable(
  "stock_items",
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid("item_id").notNull(),
    track: boolean("track").notNull().default(true),
    qty: qty("qty").notNull().default("0"),
    reorderLevel: qty("reorder_level").notNull().default("0"),
    /** Moving-average cost, paise per unit (excluding GST). */
    avgCost: integer("avg_cost"),
    ...timestamps(),
  },
  (t) => [unique("stock_items_tenant_item_uq").on(t.tenantId, t.itemId)],
);

/** Append-only stock ledger. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: pk(),
    tenantId: tenantId(),
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
  (t) => [
    index("purchases_tenant_date_idx").on(t.tenantId, t.date),
    index("purchases_tenant_supplier_idx").on(t.tenantId, t.supplierId),
  ],
);

export type StockItemRow = typeof stockItems.$inferSelect;
export type StockMovementRow = typeof stockMovements.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type PurchaseRow = typeof purchases.$inferSelect;
