import { pk, tenantId, timestamps } from "@srirealtime/db";
import type { InvoiceTotals, LineTotals } from "@srirealtime/gst";
import { sql } from "drizzle-orm";
import { bigint, boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { PurchaseCharge } from "./schema-costing";

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
  /** A physical stock audit (stock count) was approved: the variance counted against the system quantity. */
  "audit",
  /** Goods sent out on a delivery challan (job work, on approval, delivery before the bill; docs/sales-documents.md). */
  "challan_out",
  /** Goods of a delivery challan that came back (approval goods returned, job work back). */
  "challan_return",
  /** A cancelled delivery challan: what was still out comes back. */
  "challan_cancel",
] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/** Known movement ref types; reservations may commit with their own ref type (e.g. "order"). */
export const REF_TYPES = ["invoice", "purchase", "order", "transfer", "credit_note", "grn", "debit_note", "audit", "challan"] as const;
export type RefType = (typeof REF_TYPES)[number] | (string & {});

export const LOCATION_TYPES = ["store", "warehouse"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const RESERVATION_STATUSES = ["active", "released", "committed"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** The part of a transfer line that came from one batch (batch-tracked items). */
export interface TransferBatchPart {
  batchId: string;
  batchNo: string;
  expiry: string | null;
  /** Sent from this batch. */
  qty: number;
  received?: number;
  damaged?: number;
  short?: number;
}

/**
 * A line of a stock transfer, as stored. Old (instant) transfers only have `itemId` and `qty`; the rest is filled by
 * the send / receive flow. `qty` is what was sent; `received + damaged + short` is what has been settled so far.
 */
export interface TransferLine {
  itemId: string;
  qty: number;
  itemName?: string;
  unit?: string;
  /** Moving-average cost at the source when it was sent (paise per unit): the value of the goods on the road. */
  unitCost?: number | null;
  received?: number;
  damaged?: number;
  short?: number;
  reason?: string | null;
  batches?: TransferBatchPart[];
}

export const TRANSFER_STATUSES = ["draft", "in_transit", "partially_received", "closed", "cancelled"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const AUDIT_STATUSES = ["draft", "counting", "review", "approved", "cancelled"] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const BATCH_MOVEMENT_REASONS = [
  "receive",
  "opening",
  "sale",
  "sale_cancel",
  "sale_return",
  "sale_return_cancel",
  "adjustment",
  "audit",
  "expired",
  "damaged",
  "transfer_out",
  "transfer_in",
  "purchase_return",
  "purchase_return_cancel",
  "purchase_cancel",
  "assign",
] as const;
export type BatchMovementReason = (typeof BATCH_MOVEMENT_REASONS)[number];

export const EXPIRED_POLICIES = ["block", "warn", "allow"] as const;
export type ExpiredPolicy = (typeof EXPIRED_POLICIES)[number];
export const PICK_RULES = ["fefo", "manual"] as const;
export type PickRule = (typeof PICK_RULES)[number];
/** Near-expiry discount ladder: batches with `days` or fewer days left get `pct` off (the most severe row that matches). */
export interface DiscountStep {
  days: number;
  pct: number;
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
    /** Value of the movement at weighted-average cost (paise, signed like delta): the cost of goods sold for a sale. */
    costAvg: bigint("cost_avg", { mode: "number" }),
    /** The same at FIFO cost (from the cost layers, docs/valuation-reports.md). */
    costFifo: bigint("cost_fifo", { mode: "number" }),
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
    /** "TR/26-27/0001". Null on the old instant transfers made before the send / receive flow. */
    number: text("number"),
    /** Old rows are `closed`. */
    status: text("status").$type<TransferStatus>().notNull().default("closed"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    sentBy: uuid("sent_by"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    receivedBy: uuid("received_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Vehicle / courier / driver for the transfer note. */
    transport: text("transport"),
    receiveNote: text("receive_note"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    index("stock_transfers_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("stock_transfers_tenant_status_idx").on(t.tenantId, t.status),
  ],
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
    /** Landed charges with their GST and how they are spread (docs/valuation-reports.md); included in `total`. */
    charges: jsonb("charges").$type<PurchaseCharge[]>().notNull().default(sql`'[]'::jsonb`),
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
  /** Batches this line was received into (the rest of `qty` is unbatched). */
  batches?: { batchNo: string; mfgDate: string | null; expiry: string | null; mrp: number | null; qty: number }[];
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
    /** Landed charges (freight, customs duty, insurance...) spread into the stock cost; passed on to the bill. */
    charges: jsonb("charges").$type<PurchaseCharge[]>().notNull().default(sql`'[]'::jsonb`),
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

/** po / grn / dn = purchasing documents; tr = stock transfer note; sa = stock audit; lc = landed-cost voucher. */
export const PURCHASE_DOC_KINDS = ["po", "grn", "dn", "tr", "sa", "lc"] as const;
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

// ------------------------------------------------------------------ batches and expiry

/**
 * A batch (lot) of a saved item: batch number, optional manufacturing and expiry dates, MRP and cost per unit.
 * Stock per location lives in `stock_batch_levels`. The item's total in `stock_items` always includes its batches;
 * whatever is not in a batch is the item's "unbatched" stock.
 */
export const stockBatches = pgTable(
  "stock_batches",
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid("item_id").notNull(),
    batchNo: text("batch_no").notNull(),
    mfgDate: date("mfg_date", { mode: "string" }),
    /** Last day the batch may be sold. Null = does not expire. */
    expiry: date("expiry", { mode: "string" }),
    /** Paise per unit. */
    mrp: integer("mrp"),
    /** Paise per unit, before GST. */
    cost: integer("cost"),
    supplierName: text("supplier_name"),
    note: text("note"),
    ...timestamps(),
  },
  (t) => [
    unique("stock_batches_tenant_item_batch_uq").on(t.tenantId, t.itemId, t.batchNo),
    index("stock_batches_tenant_expiry_idx").on(t.tenantId, t.expiry),
    index("stock_batches_tenant_item_idx").on(t.tenantId, t.itemId),
  ],
);

/** Quantity of a batch at a location. */
export const stockBatchLevels = pgTable(
  "stock_batch_levels",
  {
    id: pk(),
    tenantId: tenantId(),
    batchId: uuid("batch_id").notNull(),
    itemId: uuid("item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    qty: qty("qty").notNull().default("0"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("stock_batch_levels_tenant_batch_loc_uq").on(t.tenantId, t.batchId, t.locationId),
    index("stock_batch_levels_tenant_item_loc_idx").on(t.tenantId, t.itemId, t.locationId),
  ],
);

/** Append-only ledger of batch quantity changes (sales carry the bill so returns can go back to the same batch). */
export const stockBatchMovements = pgTable(
  "stock_batch_movements",
  {
    id: pk(),
    tenantId: tenantId(),
    batchId: uuid("batch_id").notNull(),
    itemId: uuid("item_id").notNull(),
    locationId: uuid("location_id").notNull(),
    delta: qty("delta").notNull(),
    qtyAfter: qty("qty_after").notNull(),
    reason: text("reason").$type<BatchMovementReason>().notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    refNumber: text("ref_number"),
    /** For returns: the id of the sale (bill) the goods came from. */
    sourceRefId: text("source_ref_id"),
    unitCost: integer("unit_cost"),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("stock_batch_movements_tenant_batch_idx").on(t.tenantId, t.batchId, t.createdAt),
    index("stock_batch_movements_tenant_ref_idx").on(t.tenantId, t.refType, t.refId),
    index("stock_batch_movements_tenant_source_idx").on(t.tenantId, t.sourceRefId),
  ],
);

/** Items with batch tracking switched on (or explicitly off, when the shop tracks all). */
export const stockBatchItems = pgTable(
  "stock_batch_items",
  {
    id: pk(),
    tenantId: tenantId(),
    itemId: uuid("item_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps(),
  },
  (t) => [unique("stock_batch_items_tenant_item_uq").on(t.tenantId, t.itemId)],
);

/** One row per shop: how batches behave. */
export const stockBatchSettings = pgTable("stock_batch_settings", {
  tenantId: tenantId().primaryKey(),
  /** Track batches for every item (items can still opt out). */
  trackAll: boolean("track_all").notNull().default(false),
  expiredPolicy: text("expired_policy").$type<ExpiredPolicy>().notNull().default("warn"),
  pickRule: text("pick_rule").$type<PickRule>().notNull().default("fefo"),
  /** Days before expiry that count as "expiring soon" on the dashboard and alerts. */
  alertDays: integer("alert_days").notNull().default(30),
  discountLadder: jsonb("discount_ladder")
    .$type<DiscountStep[]>()
    .notNull()
    .default(sql`'[{"days":30,"pct":20},{"days":60,"pct":10},{"days":90,"pct":5}]'::jsonb`),
  ...timestamps(),
});

// ------------------------------------------------------------------ physical stock audit

export interface AuditTotals {
  lines: number;
  counted: number;
  /** Lines whose count differs from the system quantity. */
  varianceLines: number;
  /** Paise at cost: value of surplus, shortage and the net. */
  surplusValue: number;
  shortageValue: number;
  netValue: number;
}

/** A stock count session. System quantities are frozen into `stock_audit_lines` when the session is created. */
export const stockAudits = pgTable(
  "stock_audits",
  {
    id: pk(),
    tenantId: tenantId(),
    number: text("number").notNull(),
    status: text("status").$type<AuditStatus>().notNull().default("draft"),
    locationId: uuid("location_id").notNull(),
    /** Catalogue categories counted; empty = everything. */
    categoryIds: jsonb("category_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    title: text("title"),
    note: text("note"),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    /** Variance totals at approval (so an approved audit never changes). */
    totals: jsonb("totals").$type<AuditTotals | null>(),
    ...timestamps(),
  },
  (t) => [unique("stock_audits_tenant_number_uq").on(t.tenantId, t.number), index("stock_audits_tenant_status_idx").on(t.tenantId, t.status, t.createdAt)],
);

export const stockAuditLines = pgTable(
  "stock_audit_lines",
  {
    id: pk(),
    tenantId: tenantId(),
    auditId: uuid("audit_id").notNull(),
    itemId: uuid("item_id").notNull(),
    /** Null = the item as a whole (or its unbatched stock). */
    batchId: uuid("batch_id"),
    itemName: text("item_name").notNull(),
    unit: text("unit"),
    barcode: text("barcode"),
    sku: text("sku"),
    batchNo: text("batch_no"),
    expiry: date("expiry", { mode: "string" }),
    /** Frozen when the session was created. */
    systemQty: qty("system_qty").notNull(),
    /** Merged from all counters; null = not counted yet. */
    countedQty: qty("counted_qty"),
    /** Paise per unit at the freeze. */
    unitCost: integer("unit_cost"),
    /** Why it differs (reviewer): damage, theft, entry error, expired, found... */
    reason: text("reason"),
    note: text("note"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
  },
  (t) => [
    unique("stock_audit_lines_audit_item_batch_uq").on(t.auditId, t.itemId, t.batchId).nullsNotDistinct(),
    index("stock_audit_lines_tenant_audit_idx").on(t.tenantId, t.auditId),
    index("stock_audit_lines_tenant_barcode_idx").on(t.tenantId, t.auditId, t.barcode),
  ],
);

/** One counting action (a scan or a typed number) by one counter; a line's count merges every counter's entries. */
export const stockAuditEntries = pgTable(
  "stock_audit_entries",
  {
    id: pk(),
    tenantId: tenantId(),
    auditId: uuid("audit_id").notNull(),
    lineId: uuid("line_id").notNull(),
    /** "add" adds qty to the counter's running count of the line; "set" replaces it. */
    mode: text("mode").$type<"add" | "set">().notNull().default("add"),
    qty: qty("qty").notNull(),
    counter: text("counter").notNull(),
    userId: uuid("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_audit_entries_tenant_line_idx").on(t.tenantId, t.lineId, t.createdAt)],
);

export type StockBatchRow = typeof stockBatches.$inferSelect;
export type StockBatchLevelRow = typeof stockBatchLevels.$inferSelect;
export type StockBatchMovementRow = typeof stockBatchMovements.$inferSelect;
export type StockBatchSettingsRow = typeof stockBatchSettings.$inferSelect;
export type StockAuditRow = typeof stockAudits.$inferSelect;
export type StockAuditLineRow = typeof stockAuditLines.$inferSelect;
export type StockAuditEntryRow = typeof stockAuditEntries.$inferSelect;

export * from "./schema-costing";
