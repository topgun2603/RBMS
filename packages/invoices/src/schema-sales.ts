/**
 * Proforma invoices, sale orders and delivery challans (docs/sales-documents.md). Re-exported by schema.ts (drizzle-kit
 * reads that file). Every table is tenant-scoped. None of them is a tax invoice: GST returns, sales reports and the books
 * only see the bills made from them. Only a delivery challan moves stock (out, and back in for returned goods).
 */
import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { InvoiceTotals, LineTotals } from "./calc";
import type { CustomerSnapshot, SellerProfile } from "./ports";

/** The three document kinds; each has its own number series per branch and FY. */
export const SALES_DOC_KINDS = ["proforma", "sale_order", "challan"] as const;
export type SalesDocKind = (typeof SALES_DOC_KINDS)[number];

/** A line of a sale order or challan: the computed line plus a stable key (fulfilment is tracked per key). */
export type SalesDocLine = LineTotals & {
  key: string;
  /** Challan lines made from a sale order: the order line they deliver. */
  orderLineKey?: string;
};

/** One entry of a document's timeline. */
export interface SalesDocEvent {
  at: string;
  type:
    | "created"
    | "edited"
    | "issued"
    | "sent"
    | "advance"
    | "converted"
    | "delivered"
    | "invoiced"
    | "returned"
    | "cancelled"
    | "reopened";
  /** Staff user id. */
  by?: string | null;
  note?: string | null;
}

/** Per-tenant, per-branch, per-FY counter of each kind (`branch_id` null = no branch), like `invoice_series`. */
export const salesDocSeries = pgTable(
  "sales_doc_series",
  {
    id: pk(),
    tenantId: tenantId(),
    kind: text("kind").$type<SalesDocKind>().notNull(),
    branchId: uuid("branch_id"),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull(),
    nextSeq: integer("next_seq").notNull(),
    ...timestamps(),
  },
  (t) => [unique("sales_doc_series_tenant_kind_branch_fy_uq").on(t.tenantId, t.kind, t.branchId, t.fy).nullsNotDistinct()],
);

// ------------------------------------------------------------------ proforma invoices

/** "expired" is not stored: an issued proforma past its valid-until date reads as expired. */
export const PROFORMA_STATUSES = ["draft", "issued", "converted", "cancelled"] as const;
export type ProformaStatus = (typeof PROFORMA_STATUSES)[number];
export const PROFORMA_DISPLAY_STATUSES = [...PROFORMA_STATUSES, "expired"] as const;
export type ProformaDisplayStatus = (typeof PROFORMA_DISPLAY_STATUSES)[number];

/**
 * A proforma invoice: the bill as it will be, sent before the sale (for an advance, a purchase approval or a loan). Not a
 * tax invoice; its own series (PI/26-27/0001). Advances against it are customer receipts (`against_kind = proforma`).
 */
export const proformaInvoices = pgTable(
  "proforma_invoices",
  {
    id: pk(),
    tenantId: tenantId(),
    branchId: uuid("branch_id"),
    customerId: uuid("customer_id"),
    customer: jsonb("customer").$type<CustomerSnapshot>().notNull(),
    seller: jsonb("seller").$type<SellerProfile>().notNull(),
    number: text("number").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    status: text("status").$type<ProformaStatus>().notNull().default("draft"),
    date: date("date", { mode: "string" }).notNull(),
    /** Null = no expiry. */
    validUntil: date("valid_until", { mode: "string" }),
    placeOfSupply: text("place_of_supply").notNull(),
    interState: boolean("inter_state").notNull().default(false),
    lines: jsonb("lines").$type<LineTotals[]>().notNull(),
    totals: jsonb("totals").$type<Omit<InvoiceTotals, "lines">>().notNull(),
    /** Paise. */
    total: integer("total").notNull(),
    notes: text("notes"),
    terms: text("terms"),
    deliveryText: text("delivery_text"),
    /** 1-100: the advance asked for. */
    advancePercent: integer("advance_percent"),
    quotationId: uuid("quotation_id"),
    quotationNumber: text("quotation_number"),
    shareToken: text("share_token").unique("proforma_invoices_share_token_uq"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    invoiceId: uuid("invoice_id"),
    invoiceNumber: text("invoice_number"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    events: jsonb("events").$type<SalesDocEvent[]>().notNull().default([]),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("proforma_invoices_tenant_branch_fy_seq_uq").on(
      t.tenantId,
      sql`coalesce(${t.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.fy,
      t.seq,
    ),
    index("proforma_invoices_tenant_date_idx").on(t.tenantId, t.date),
    index("proforma_invoices_tenant_customer_idx").on(t.tenantId, t.customerId),
    index("proforma_invoices_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
  ],
);

// ------------------------------------------------------------------ sale orders

/** Stored and derived from the lines: delivered / invoiced quantities against what was ordered. */
export const SALE_ORDER_STATUSES = ["open", "partly_delivered", "delivered", "invoiced", "cancelled"] as const;
export type SaleOrderStatus = (typeof SALE_ORDER_STATUSES)[number];

/**
 * A customer's order (B2B / counter orders with a promised date): items, quantities, advance, optional stock hold. Goods
 * leave on delivery challans and/or bills; both are tracked per line (ordered, delivered, invoiced).
 */
export const saleOrders = pgTable(
  "sale_orders",
  {
    id: pk(),
    tenantId: tenantId(),
    branchId: uuid("branch_id"),
    customerId: uuid("customer_id"),
    customer: jsonb("customer").$type<CustomerSnapshot>().notNull(),
    seller: jsonb("seller").$type<SellerProfile>().notNull(),
    number: text("number").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    status: text("status").$type<SaleOrderStatus>().notNull().default("open"),
    date: date("date", { mode: "string" }).notNull(),
    promisedDate: date("promised_date", { mode: "string" }),
    /** The customer's purchase order number. */
    customerRef: text("customer_ref"),
    placeOfSupply: text("place_of_supply").notNull(),
    interState: boolean("inter_state").notNull().default(false),
    lines: jsonb("lines").$type<SalesDocLine[]>().notNull(),
    totals: jsonb("totals").$type<Omit<InvoiceTotals, "lines">>().notNull(),
    /** Paise. */
    total: integer("total").notNull(),
    notes: text("notes"),
    terms: text("terms"),
    advancePercent: integer("advance_percent"),
    /** Hold stock for the undelivered quantities (an inventory reservation, ref type `sale_order`). */
    reserveStock: boolean("reserve_stock").notNull().default(false),
    /** Stock location the reservation is held at (the branch's). */
    locationId: uuid("location_id"),
    quotationId: uuid("quotation_id"),
    quotationNumber: text("quotation_number"),
    shareToken: text("share_token").unique("sale_orders_share_token_uq"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    events: jsonb("events").$type<SalesDocEvent[]>().notNull().default([]),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("sale_orders_tenant_branch_fy_seq_uq").on(
      t.tenantId,
      sql`coalesce(${t.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.fy,
      t.seq,
    ),
    index("sale_orders_tenant_status_date_idx").on(t.tenantId, t.status, t.date),
    index("sale_orders_tenant_customer_idx").on(t.tenantId, t.customerId),
  ],
);

/** A bill made straight from a sale order (not through a challan) and the quantities of each order line it bills. */
export const saleOrderInvoices = pgTable(
  "sale_order_invoices",
  {
    id: pk(),
    tenantId: tenantId(),
    saleOrderId: uuid("sale_order_id")
      .notNull()
      .references(() => saleOrders.id),
    invoiceId: uuid("invoice_id").notNull(),
    invoiceNumber: text("invoice_number"),
    lines: jsonb("lines").$type<{ key: string; qty: number }[]>().notNull(),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    unique("sale_order_invoices_invoice_uq").on(t.tenantId, t.invoiceId),
    index("sale_order_invoices_tenant_order_idx").on(t.tenantId, t.saleOrderId),
  ],
);

// ------------------------------------------------------------------ delivery challans

/**
 * Why goods move without a bill (CGST Rule 55): job work, on approval / sale or return, delivery before the bill, and
 * movements that are not a supply (exhibition, own use, repair). Only approval and before-invoice challans are billed.
 */
export const CHALLAN_REASONS = ["job_work", "approval", "before_invoice", "exhibition", "other"] as const;
export type ChallanReason = (typeof CHALLAN_REASONS)[number];

/** "invoiced" is stored with the bill's id; a cancelled / deleted bill makes the challan billable again. */
export const CHALLAN_STATUSES = ["issued", "partly_returned", "returned", "invoiced", "cancelled"] as const;
export type ChallanStatus = (typeof CHALLAN_STATUSES)[number];

export const TRANSPORT_MODES = ["road", "rail", "air", "ship", "hand"] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/** Transport details printed on the challan (and used for the e-way bill when one is needed). */
export interface ChallanTransport {
  mode?: TransportMode | null;
  transporterName?: string | null;
  /** Transporter GSTIN / TRANSIN. */
  transporterId?: string | null;
  vehicleNo?: string | null;
  /** LR / RR / airway bill number and date. */
  docNo?: string | null;
  docDate?: string | null;
  distanceKm?: number | null;
}

/** Goods of a challan that came back (approval goods not kept, job work returned). */
export interface ChallanReturn {
  id: string;
  date: string;
  lines: { key: string; qty: number }[];
  note?: string | null;
  by?: string | null;
  at: string;
}

export const deliveryChallans = pgTable(
  "delivery_challans",
  {
    id: pk(),
    tenantId: tenantId(),
    branchId: uuid("branch_id"),
    customerId: uuid("customer_id"),
    /** The consignee. */
    customer: jsonb("customer").$type<CustomerSnapshot>().notNull(),
    seller: jsonb("seller").$type<SellerProfile>().notNull(),
    number: text("number").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    status: text("status").$type<ChallanStatus>().notNull().default("issued"),
    reason: text("reason").$type<ChallanReason>().notNull(),
    date: date("date", { mode: "string" }).notNull(),
    /** Approval / job work: when the goods are due back. */
    returnBy: date("return_by", { mode: "string" }),
    placeOfSupply: text("place_of_supply").notNull(),
    interState: boolean("inter_state").notNull().default(false),
    lines: jsonb("lines").$type<SalesDocLine[]>().notNull(),
    totals: jsonb("totals").$type<Omit<InvoiceTotals, "lines">>().notNull(),
    /** Paise: value of the goods sent (with GST). */
    total: integer("total").notNull(),
    /** Delivery address when it differs from the consignee's. */
    shipTo: text("ship_to"),
    transport: jsonb("transport").$type<ChallanTransport>().notNull().default({}),
    /** E-way bill generated on the portal (number and date), when the consignment needs one. */
    ewbNo: text("ewb_no"),
    ewbDate: date("ewb_date", { mode: "string" }),
    notes: text("notes"),
    terms: text("terms"),
    saleOrderId: uuid("sale_order_id"),
    saleOrderNumber: text("sale_order_number"),
    returns: jsonb("returns").$type<ChallanReturn[]>().notNull().default([]),
    invoiceId: uuid("invoice_id"),
    invoiceNumber: text("invoice_number"),
    invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
    /** Stock location the goods left from. */
    locationId: uuid("location_id"),
    shareToken: text("share_token").unique("delivery_challans_share_token_uq"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    events: jsonb("events").$type<SalesDocEvent[]>().notNull().default([]),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("delivery_challans_tenant_branch_fy_seq_uq").on(
      t.tenantId,
      sql`coalesce(${t.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.fy,
      t.seq,
    ),
    index("delivery_challans_tenant_date_idx").on(t.tenantId, t.date),
    index("delivery_challans_tenant_customer_idx").on(t.tenantId, t.customerId),
    index("delivery_challans_tenant_order_idx").on(t.tenantId, t.saleOrderId),
    index("delivery_challans_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
  ],
);

export type SalesDocSeriesRow = typeof salesDocSeries.$inferSelect;
export type ProformaRow = typeof proformaInvoices.$inferSelect;
export type SaleOrderRow = typeof saleOrders.$inferSelect;
export type SaleOrderInvoiceRow = typeof saleOrderInvoices.$inferSelect;
export type ChallanRow = typeof deliveryChallans.$inferSelect;
