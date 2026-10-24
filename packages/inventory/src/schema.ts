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
  /** Goods sent back to the supplier (debit note). */
  "purchase_return",
  /** A cancelled debit note's goods taken back in. */
  "purchase_return_cancel",
  "transfer_out",
  "transfer_in",
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/** Known movement ref types; reservations may commit with their own ref type (e.g. "order"). */
export const REF_TYPES = ["invoice", "purchase", "order", "transfer", "credit_note", "grn", "debit_note"] as const;
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
    /** Paise we already owed the supplier when we started using the app (positive = payable). */
    openingBalance: integer("opening_balance").notNull().default(0),
    openingDate: date("opening_date", { mode: "string" }),
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
    /** Kept in step with `balance <= 0` (the old flag); money lives in `amountPaid`/`returnedAmount`. */
    paid: boolean("paid").notNull().default(false),
    /** Paise paid to the supplier against this bill, net of refunds received. */
    amountPaid: integer("amount_paid").notNull().default(0),
    /** Paise of goods returned on debit notes that reduce what is owed on this bill. */
    returnedAmount: integer("returned_amount").notNull().default(0),
    dueDate: date("due_date", { mode: "string" }),
    /** Supplier's freight and other charges (no GST), included in `total` and capitalised into stock cost. */
    freight: integer("freight").notNull().default(0),
    otherCharges: integer("other_charges").notNull().default(0),
    purchaseOrderId: uuid("purchase_order_id"),
    goodsReceiptId: uuid("goods_receipt_id"),
    status: text("status").$type<PurchaseStatus>().notNull().default("recorded"),
    notes: text("notes"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: uuid("created_by"),
    /** A historical bill brought over from another product: no stock change, original number kept (see invoices.imported). */
    imported: boolean("imported").notNull().default(false),
    importBatchId: uuid("import_batch_id"),
    ...timestamps(),
  },
  (t) => [index("purchases_tenant_date_idx").on(t.tenantId, t.date), index("purchases_tenant_supplier_idx").on(t.tenantId, t.supplierId)],
);

// ------------------------------------------------------------------ supplier payables

export const PAYMENT_MODES = ["cash", "upi", "bank", "cheque", "card", "other"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];
/** `payment` = paid to the supplier; `refund` = money received back from the supplier. */
export const SUPPLIER_PAYMENT_KINDS = ["payment", "refund"] as const;
export type SupplierPaymentKind = (typeof SUPPLIER_PAYMENT_KINDS)[number];

/**
 * Money paid to (or refunded by) a supplier. `purchaseId` null = on account (settles the opening balance or is an
 * advance). A lump payment split over several bills shares one `groupId`. Reversed rows stay for the audit trail.
 */
export const purchasePayments = pgTable(
  "purchase_payments",
  {
    id: pk(),
    tenantId: tenantId(),
    supplierId: uuid("supplier_id"),
    purchaseId: uuid("purchase_id"),
    groupId: uuid("group_id").notNull(),
    kind: text("kind").$type<SupplierPaymentKind>().notNull().default("payment"),
    /** Paise, always positive. */
    amount: integer("amount").notNull(),
    mode: text("mode").$type<PaymentMode>().notNull().default("cash"),
    reference: text("reference"),
    date: date("date", { mode: "string" }).notNull(),
    note: text("note"),
    debitNoteId: uuid("debit_note_id"),
    createdBy: uuid("created_by"),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    reversedBy: uuid("reversed_by"),
    reverseNote: text("reverse_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("purchase_payments_tenant_purchase_idx").on(t.tenantId, t.purchaseId),
    index("purchase_payments_tenant_supplier_idx").on(t.tenantId, t.supplierId, t.date),
    index("purchase_payments_tenant_group_idx").on(t.tenantId, t.groupId),
  ],
);

// ------------------------------------------------------------------ purchase workflow

export const PO_STATUSES = ["draft", "sent", "partially_received", "received", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/** A purchase order line; `received` is the quantity delivered so far. */
export type PoLine = LineTotals & { itemId?: string; received: number };

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: pk(),
    tenantId: tenantId(),
    number: text("number").notNull(),
    supplierId: uuid("supplier_id"),
    supplier: jsonb("supplier").$type<SupplierSnapshot>().notNull(),
    date: date("date", { mode: "string" }).notNull(),
    expectedDate: date("expected_date", { mode: "string" }),
    status: text("status").$type<PoStatus>().notNull().default("draft"),
    placeOfSupply: text("place_of_supply").notNull(),
    lines: jsonb("lines").$type<PoLine[]>().notNull(),
    totals: jsonb("totals").$type<Omit<InvoiceTotals, "lines">>().notNull(),
    /** Ordered value incl. GST, paise. */
    total: integer("total").notNull(),
    locationId: uuid("location_id"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("purchase_orders_tenant_number_uq").on(t.tenantId, t.number),
    index("purchase_orders_tenant_date_idx").on(t.tenantId, t.date),
    index("purchase_orders_tenant_supplier_idx").on(t.tenantId, t.supplierId),
  ],
);

/** A line of a goods receipt. */
export interface GrnLine {
  /** Index of the line on the purchase order. */
  lineIndex: number;
  itemId?: string;
  description: string;
  qty: number;
  /** Taxable value of the received qty (paise, before landed charges). */
  taxable: number;
  /** Landed charges apportioned to this line (paise). */
  landed: number;
}

/** A goods receipt (GRN): what arrived against a purchase order, when and where. Receiving adds stock. */
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: pk(),
    tenantId: tenantId(),
    number: text("number").notNull(),
    purchaseOrderId: uuid("purchase_order_id").notNull(),
    supplierId: uuid("supplier_id"),
    date: date("date", { mode: "string" }).notNull(),
    locationId: uuid("location_id").notNull(),
    lines: jsonb("lines").$type<GrnLine[]>().notNull(),
    freight: integer("freight").notNull().default(0),
    otherCharges: integer("other_charges").notNull().default(0),
    /** The purchase bill made from this receipt, once billed. */
    purchaseId: uuid("purchase_id"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the receipt was cancelled: its stock came back out and the order's received quantities went down. */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    unique("goods_receipts_tenant_number_uq").on(t.tenantId, t.number),
    index("goods_receipts_tenant_po_idx").on(t.tenantId, t.purchaseOrderId),
  ],
);

export const DEBIT_NOTE_STATUSES = ["issued", "cancelled"] as const;
export type DebitNoteStatus = (typeof DEBIT_NOTE_STATUSES)[number];

/** A returned line: `lineIndex` is the line of the purchase bill; amounts are the returned share. */
export type DebitNoteLine = LineTotals & { itemId?: string; lineIndex: number };

/** Goods returned to a supplier against a purchase: reduces stock and what is owed (or is refunded). */
export const debitNotes = pgTable(
  "debit_notes",
  {
    id: pk(),
    tenantId: tenantId(),
    number: text("number").notNull(),
    purchaseId: uuid("purchase_id").notNull(),
    supplierId: uuid("supplier_id"),
    supplierName: text("supplier_name").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    lines: jsonb("lines").$type<DebitNoteLine[]>().notNull(),
    totals: jsonb("totals").$type<Omit<InvoiceTotals, "lines">>().notNull(),
    total: integer("total").notNull(),
    /** Paise of `total` the supplier paid back in money (the rest reduces the balance). */
    refundAmount: integer("refund_amount").notNull().default(0),
    reason: text("reason"),
    locationId: uuid("location_id").notNull(),
    status: text("status").$type<DebitNoteStatus>().notNull().default("issued"),
    createdBy: uuid("created_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("debit_notes_tenant_number_uq").on(t.tenantId, t.number),
    index("debit_notes_tenant_purchase_idx").on(t.tenantId, t.purchaseId),
    index("debit_notes_tenant_date_idx").on(t.tenantId, t.date),
  ],
);

export const PURCHASE_DOC_KINDS = ["po", "grn", "dn"] as const;
export type PurchaseDocKind = (typeof PURCHASE_DOC_KINDS)[number];

/** Per-tenant, per-FY counters for PO / GRN / debit note numbers (like `credit_note_series`). */
export const purchaseDocSeries = pgTable(
  "purchase_doc_series",
  {
    id: pk(),
    tenantId: tenantId(),
    kind: text("kind").$type<PurchaseDocKind>().notNull(),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull(),
    nextSeq: integer("next_seq").notNull(),
    ...timestamps(),
  },
  (t) => [unique("purchase_doc_series_tenant_kind_fy_uq").on(t.tenantId, t.kind, t.fy)],
);

export type PurchasePaymentRow = typeof purchasePayments.$inferSelect;
export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
export type GoodsReceiptRow = typeof goodsReceipts.$inferSelect;
export type DebitNoteRow = typeof debitNotes.$inferSelect;
export type StockLocationRow = typeof stockLocations.$inferSelect;
export type StockTransferRow = typeof stockTransfers.$inferSelect;
export type StockReservationRow = typeof stockReservations.$inferSelect;
export type StockItemRow = typeof stockItems.$inferSelect;
export type StockMovementRow = typeof stockMovements.$inferSelect;
export type SupplierRow = typeof suppliers.$inferSelect;
export type PurchaseRow = typeof purchases.$inferSelect;
