import { pk, tenantId, timestamps } from "@srirealtime/db";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { CreditNoteLineTotals, CreditNoteTotals, InvoiceTotals, LineTotals } from "./calc";
import type { CustomerSnapshot, SellerProfile } from "./ports";
import type { ExportDetails, ForeignAmounts, SupplyType } from "./export-calc";

export const INVOICE_STATUSES = ["draft", "issued", "partially_paid", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "upi", "card", "bank", "cheque", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Where an invoice payment came from: entered on the bill, allocated from a customer receipt, paid online, or a refund
 * (negative amount) given back with a credit note.
 */
export const PAYMENT_SOURCES = ["manual", "receipt", "online", "refund"] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

/** Points used on a bill (loyalty redemption), stored on `invoices.totals`. */
export interface LoyaltyRedemption {
  points: number;
  /** Paise taken off the bill (GST-inclusive). */
  discount: number;
}

/** Totals stored on an invoice: the computed totals without lines, plus any loyalty redemption. */
export type StoredInvoiceTotals = Omit<InvoiceTotals, "lines"> & { loyalty?: LoyaltyRedemption };

/** Documents an advance (customer receipt) can be taken against. */
export const ADVANCE_AGAINST_KINDS = ["proforma", "sale_order"] as const;
export type AdvanceAgainstKind = (typeof ADVANCE_AGAINST_KINDS)[number];

export const MESSAGE_CHANNELS = ["whatsapp", "sms"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** The shop's buyers. */
export const billingCustomers = pgTable(
  "billing_customers",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    gstin: text("gstin"),
    address: text("address"),
    stateCode: text("state_code"),
    /** ISO 3166 alpha-2 country of a buyer outside India (state code 96); null = India. */
    country: text("country"),
    /** Paise; + = they owed the shop before using the app, − = advance held. */
    openingBalance: integer("opening_balance").notNull().default(0),
    /** Paise; null = no limit. */
    creditLimit: integer("credit_limit"),
    /** Public account-statement link token. */
    statementToken: text("statement_token").unique("billing_customers_statement_token_uq"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("billing_customers_tenant_name_idx").on(t.tenantId, t.name)],
);

/** Money received "on account" from a customer, allocated oldest-first to open bills. */
export const customerReceipts = pgTable(
  "customer_receipts",
  {
    id: pk(),
    tenantId: tenantId(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => billingCustomers.id),
    /** Paise. */
    amount: integer("amount").notNull(),
    method: text("method").$type<PaymentMethod>().notNull(),
    date: date("date", { mode: "string" }).notNull(),
    reference: text("reference"),
    note: text("note"),
    /** Paise left unallocated (customer advance). */
    advance: integer("advance").notNull().default(0),
    /**
     * An advance taken against a proforma invoice or a sale order (docs/sales-documents.md): kept for that document (never
     * allocated to other open bills) and allocated to the bill made from it.
     */
    againstKind: text("against_kind").$type<AdvanceAgainstKind>(),
    againstId: uuid("against_id"),
    againstNumber: text("against_number"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    index("customer_receipts_tenant_customer_date_idx").on(t.tenantId, t.customerId, t.date),
    index("customer_receipts_tenant_date_idx").on(t.tenantId, t.date),
    index("customer_receipts_tenant_against_idx").on(t.tenantId, t.againstId),
  ],
);

/** Saved products/services. */
export const billingItems = pgTable(
  "billing_items",
  {
    id: pk(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    hsn: text("hsn"),
    unit: text("unit").notNull().default("pcs"),
    /** Paise per unit. */
    rate: integer("rate").notNull(),
    gstRate: real("gst_rate").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("billing_items_tenant_name_idx").on(t.tenantId, t.name)],
);

export const invoices = pgTable(
  "invoices",
  {
    id: pk(),
    tenantId: tenantId(),
    customerId: uuid("customer_id"),
    /** Shop branch (multi-branch shops); null = no branch. Drives the number series and seller details. */
    branchId: uuid("branch_id"),
    customer: jsonb("customer").$type<CustomerSnapshot>().notNull(),
    /** Null until issued (drafts show the live profile). */
    seller: jsonb("seller").$type<SellerProfile>(),
    number: text("number"),
    fy: text("fy"),
    seq: integer("seq"),
    status: text("status").$type<InvoiceStatus>().notNull().default("draft"),
    date: date("date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    placeOfSupply: text("place_of_supply").notNull(),
    interState: boolean("inter_state").notNull().default(false),
    lines: jsonb("lines").$type<LineTotals[]>().notNull(),
    totals: jsonb("totals").$type<StoredInvoiceTotals>().notNull(),
    /** Paise. */
    total: integer("total").notNull(),
    /** Paise; net money received (refunds given with credit notes are taken off). */
    paid: integer("paid").notNull().default(0),
    /** Paise; total of the bill's issued credit notes (returns, price corrections). Balance = total − paid − credited. */
    credited: integer("credited").notNull().default(0),
    /** POS till session the bill was made at (null = not from a till). */
    tillSessionId: uuid("till_session_id"),
    notes: text("notes"),
    shareToken: text("share_token").unique("invoices_share_token_uq"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    /**
     * A historical bill brought over from another product (Vyapar, Tally ...). It never changed stock here, is never
     * messaged, e-invoiced or put in GSTR-1, and keeps its original number outside the shop's series (fy/seq null).
     */
    imported: boolean("imported").notNull().default(false),
    /** The import batch (import_jobs.id) that created it; undo deletes by this. */
    importBatchId: uuid("import_batch_id"),
    /**
     * Who moves the stock of this bill. Null = the bill (on issue, back on cancel). "challan" = its delivery challans
     * already took the goods out (docs/sales-documents.md), so issuing or cancelling the bill never moves stock again.
     */
    stockMovedBy: text("stock_moved_by").$type<"challan">(),
    /** Domestic, export with / without IGST, SEZ with / without IGST (docs/recurring-export-gstin.md). */
    supplyType: text("supply_type").$type<SupplyType>().notNull().default("domestic"),
    /** ISO 4217 code of a foreign-currency bill; null = rupees. Rupee columns stay the accounting truth. */
    currency: text("currency"),
    /** Rupees for one unit of `currency`, as typed (4 decimals). */
    exchangeRate: doublePrecision("exchange_rate"),
    /** Foreign-currency figures of the bill (minor units), stored next to the rupee ones. */
    foreign: jsonb("foreign").$type<ForeignAmounts>(),
    /** Shipping bill no. / date / port code and the frozen LUT of an export or SEZ bill. */
    exportDetails: jsonb("export_details").$type<ExportDetails>(),
    /** The recurring run that made this bill (docs/recurring-export-gstin.md); one bill per run. */
    recurringRunId: uuid("recurring_run_id"),
    ...timestamps(),
  },
  (t) => [
    // One number per (branch series, FY, seq); bills without a branch share the "no branch" series (coalesced to the
    // nil uuid so they collide like any other branch). Only numbered bills: drafts have no fy/seq yet.
    uniqueIndex("invoices_tenant_branch_fy_seq_uq")
      .on(t.tenantId, sql`coalesce(${t.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.fy, t.seq)
      .where(sql`${t.seq} is not null`),
    index("invoices_tenant_branch_date_idx").on(t.tenantId, t.branchId, t.date),
    index("invoices_tenant_status_date_idx").on(t.tenantId, t.status, t.date),
    index("invoices_tenant_customer_idx").on(t.tenantId, t.customerId),
    // runReminders scans open bills by due date across tenants.
    index("invoices_status_due_idx").on(t.status, t.dueDate),
  ],
);

export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: pk(),
    tenantId: tenantId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    method: text("method").$type<PaymentMethod>().notNull(),
    date: date("date", { mode: "string" }).notNull(),
    reference: text("reference"),
    /** Set when the payment is an allocation of a customer receipt. */
    receiptId: uuid("receipt_id").references(() => customerReceipts.id),
    source: text("source").$type<PaymentSource>().notNull().default("manual"),
    /** Credit note a refund (source "refund") belongs to. */
    creditNoteId: uuid("credit_note_id"),
    /**
     * A payment received in a foreign currency: what came in (minor units of `currency`) at the rate the bank gave.
     * `amount` is what it settled on the bill (at the bill's rate); `forex_diff` = rupees received − amount (+ = gain).
     */
    currency: text("currency"),
    foreignAmount: integer("foreign_amount"),
    exchangeRate: doublePrecision("exchange_rate"),
    forexDiff: integer("forex_diff").notNull().default(0),
    /** POS till session the money went into / came out of. */
    tillSessionId: uuid("till_session_id"),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    index("invoice_payments_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
    index("invoice_payments_tenant_till_idx").on(t.tenantId, t.tillSessionId),
    index("invoice_payments_tenant_date_idx").on(t.tenantId, t.date),
    index("invoice_payments_receipt_idx").on(t.receiptId),
    // Online payments are recorded once per provider payment id.
    uniqueIndex("invoice_payments_online_ref_uq")
      .on(t.invoiceId, t.reference)
      .where(sql`${t.source} = 'online'`),
  ],
);

/** Automatic overdue reminders already sent: one per bill per "days after due" step. */
export const invoiceReminders = pgTable(
  "invoice_reminders",
  {
    id: pk(),
    tenantId: tenantId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    /** Days after the due date. */
    day: integer("day").notNull(),
    channel: text("channel").$type<MessageChannel>().notNull(),
    logId: text("log_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("invoice_reminders_invoice_day_uq").on(t.invoiceId, t.day)],
);

/** WhatsApp / SMS messages sent about a bill or a customer's account. */
export const invoiceMessages = pgTable(
  "invoice_messages",
  {
    id: pk(),
    tenantId: tenantId(),
    invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id"),
    /** Notify template key, e.g. "invoice.issued". */
    template: text("template").notNull(),
    channel: text("channel").$type<MessageChannel>().notNull(),
    toMasked: text("to_masked").notNull(),
    logId: text("log_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invoice_messages_tenant_invoice_idx").on(t.tenantId, t.invoiceId, t.sentAt),
    index("invoice_messages_tenant_customer_idx").on(t.tenantId, t.customerId, t.sentAt),
  ],
);

/**
 * Per-tenant, per-branch, per-FY invoice counter (`branch_id` null = no branch). `next_seq` holds the last number
 * handed out.
 */
export const invoiceSeries = pgTable(
  "invoice_series",
  {
    id: pk(),
    tenantId: tenantId(),
    branchId: uuid("branch_id"),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull(),
    nextSeq: integer("next_seq").notNull(),
    ...timestamps(),
  },
  (t) => [unique("invoice_series_tenant_branch_fy_uq").on(t.tenantId, t.branchId, t.fy).nullsNotDistinct()],
);

// ------------------------------------------------------------------ credit notes (GST returns / value corrections)

export const CREDIT_NOTE_REASONS = ["return", "price_correction", "discount", "other"] as const;
export type CreditNoteReason = (typeof CREDIT_NOTE_REASONS)[number];

/** How the money of a credit note goes back: paid out (cash/UPI/card), kept in the customer's credit book, or nothing. */
export const REFUND_MODES = ["cash", "upi", "card", "credit_book", "none"] as const;
export type RefundMode = (typeof REFUND_MODES)[number];

export const CREDIT_NOTE_STATUSES = ["issued", "cancelled"] as const;
export type CreditNoteStatus = (typeof CREDIT_NOTE_STATUSES)[number];

/** One line of a credit note: a share of an invoice line (returned quantity, or a value-only correction). */
export type CreditNoteLine = CreditNoteLineTotals;
export type { CreditNoteTotals };

export const creditNotes = pgTable(
  "credit_notes",
  {
    id: pk(),
    tenantId: tenantId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id),
    /** The original bill's branch; drives the number series. */
    branchId: uuid("branch_id"),
    customerId: uuid("customer_id"),
    /** Buyer and seller as on the original invoice. */
    customer: jsonb("customer").$type<CustomerSnapshot>().notNull(),
    seller: jsonb("seller").$type<SellerProfile>().notNull(),
    /** Original invoice number and date (printed on the note). */
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    number: text("number").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    status: text("status").$type<CreditNoteStatus>().notNull().default("issued"),
    reason: text("reason").$type<CreditNoteReason>().notNull(),
    note: text("note"),
    refundMode: text("refund_mode").$type<RefundMode>().notNull(),
    /** Paise paid back to the customer (cash/UPI/card); 0 for credit book / none. */
    refundAmount: integer("refund_amount").notNull().default(0),
    /** The refund's invoice payment row (negative amount). */
    refundPaymentId: uuid("refund_payment_id"),
    /** Original place of supply and tax split. */
    placeOfSupply: text("place_of_supply").notNull(),
    interState: boolean("inter_state").notNull(),
    lines: jsonb("lines").$type<CreditNoteLine[]>().notNull(),
    totals: jsonb("totals").$type<CreditNoteTotals>().notNull(),
    /** Paise. */
    total: integer("total").notNull(),
    tillSessionId: uuid("till_session_id"),
    createdBy: uuid("created_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("credit_notes_tenant_branch_fy_seq_uq").on(
      t.tenantId,
      sql`coalesce(${t.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.fy,
      t.seq,
    ),
    index("credit_notes_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
    index("credit_notes_tenant_date_idx").on(t.tenantId, t.date),
    index("credit_notes_tenant_customer_idx").on(t.tenantId, t.customerId),
    index("credit_notes_tenant_till_idx").on(t.tenantId, t.tillSessionId),
  ],
);

/** Per-tenant, per-branch, per-FY credit note counter (`branch_id` null = no branch), like `invoice_series`. */
export const creditNoteSeries = pgTable(
  "credit_note_series",
  {
    id: pk(),
    tenantId: tenantId(),
    branchId: uuid("branch_id"),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull(),
    nextSeq: integer("next_seq").notNull(),
    ...timestamps(),
  },
  (t) => [unique("credit_note_series_tenant_branch_fy_uq").on(t.tenantId, t.branchId, t.fy).nullsNotDistinct()],
);

// ------------------------------------------------------------------ POS till sessions

export const TILL_STATUSES = ["open", "closed"] as const;
export type TillStatus = (typeof TILL_STATUSES)[number];

/** Why cash went in (pay-in) or out (pay-out) of the drawer; the Z report totals them. */
export const TILL_CASH_CATEGORIES = ["petty_expense", "owner_drawing", "change_float", "other"] as const;
export type TillCashCategory = (typeof TILL_CASH_CATEGORIES)[number];

/** Cash put into (+) or taken out of (−) the drawer during a session. */
export interface TillCashEntry {
  id: string;
  /** Paise, signed: + = cash in, − = cash out. */
  amount: number;
  /** Absent on entries made before categories existed (read as "other"). */
  category?: TillCashCategory;
  reason: string;
  by: string | null;
  byName: string | null;
  at: string;
}

/** Notes and coins counted, e.g. { "500": 4, "100": 7 }. */
export type DenominationCount = Record<string, number>;

/**
 * The drawer handed from one cashier to the next without closing the day: the outgoing cashier's count, what was
 * expected at that moment and the difference. The next leg starts from the counted cash, so the difference stays with
 * the cashier who handed over.
 */
export interface TillHandover {
  id: string;
  at: string;
  fromBy: string | null;
  fromName: string | null;
  toBy: string | null;
  toName: string;
  count: DenominationCount | null;
  expected: number;
  counted: number;
  /** counted − expected (paise; + = extra, − = short). */
  difference: number;
  note: string | null;
  approvedByName: string | null;
}

/** One cash drawer session of a register (device) at a branch: opened with a float, closed with a count. */
export const tillSessions = pgTable(
  "till_sessions",
  {
    id: pk(),
    tenantId: tenantId(),
    branchId: uuid("branch_id"),
    /** Register / device name, e.g. "Counter 1". */
    register: text("register").notNull(),
    status: text("status").$type<TillStatus>().notNull().default("open"),
    /** IST business date the session was opened on. */
    date: date("date", { mode: "string" }).notNull(),
    openingCash: integer("opening_cash").notNull(),
    openingCount: jsonb("opening_count").$type<DenominationCount>(),
    openedBy: uuid("opened_by"),
    openedByName: text("opened_by_name"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    cashEntries: jsonb("cash_entries").$type<TillCashEntry[]>().notNull().default([]),
    closingCount: jsonb("closing_count").$type<DenominationCount>(),
    /** Paise, computed at close: opening + cash sales − cash refunds ± cash in/out. */
    expectedCash: integer("expected_cash"),
    countedCash: integer("counted_cash"),
    /** counted − expected (paise; + = extra, − = short). */
    difference: integer("difference"),
    /** X report frozen at close (the Z report). */
    summary: jsonb("summary"),
    /** Z report number of the register (Z1, Z2 ...), set at close; never reused, a closed session cannot be re-opened. */
    zNumber: integer("z_number"),
    /** Cashier changes during the session (the drawer counted and handed over). */
    handovers: jsonb("handovers").$type<TillHandover[]>().notNull().default([]),
    /** Why the count differs from the expected cash (required when it does). */
    differenceReason: text("difference_reason"),
    /** Manager who approved a difference beyond the shop's limit at close. */
    closeApprovedBy: uuid("close_approved_by"),
    closeApprovedByName: text("close_approved_by_name"),
    note: text("note"),
    closedBy: uuid("closed_by"),
    closedByName: text("closed_by_name"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    // One open session per register (per branch).
    uniqueIndex("till_sessions_open_register_uq")
      .on(t.tenantId, sql`coalesce(${t.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`, sql`lower(${t.register})`)
      .where(sql`${t.status} = 'open'`),
    index("till_sessions_tenant_date_idx").on(t.tenantId, t.date),
    // Z numbers run per register (and branch) and never repeat.
    uniqueIndex("till_sessions_z_number_uq")
      .on(t.tenantId, sql`coalesce(${t.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`, sql`lower(${t.register})`, t.zNumber)
      .where(sql`${t.zNumber} is not null`),
  ],
);

// ------------------------------------------------------------------ quotations (estimates; docs/quotations.md)

/** "expired" is not stored: a sent quotation past its valid-until date reads as expired (see quotations-calc). */
export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "declined", "cancelled", "converted"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];
/** Statuses shown to staff and filtered on: the stored ones plus the derived "expired". */
export const QUOTATION_DISPLAY_STATUSES = [...QUOTATION_STATUSES, "expired"] as const;
export type QuotationDisplayStatus = (typeof QUOTATION_DISPLAY_STATUSES)[number];

/** What a quotation became: a bill, an online-store order, or a proforma invoice / sale order (docs/sales-documents.md). */
export const QUOTATION_CONVERSIONS = ["invoice", "order", "proforma", "sale_order"] as const;
export type QuotationConversion = (typeof QUOTATION_CONVERSIONS)[number];

/** One entry of a quotation's timeline. */
export interface QuotationEvent {
  at: string;
  type: "created" | "revised" | "sent" | "viewed" | "accepted" | "declined" | "converted" | "cancelled";
  /** Staff user id, or the customer's typed name for accepted / declined. */
  by?: string | null;
  note?: string | null;
}

/**
 * A quotation. Revisions share one number and `groupId`; each revision is its own row (`rev` 1, 2 ...) and only the
 * newest has `latest = true`. A quotation never touches stock, GST returns, loyalty or the credit book.
 */
export const quotations = pgTable(
  "quotations",
  {
    id: pk(),
    tenantId: tenantId(),
    /** All revisions of one quotation share this (the first revision's id). */
    groupId: uuid("group_id").notNull(),
    rev: integer("rev").notNull().default(1),
    latest: boolean("latest").notNull().default(true),
    branchId: uuid("branch_id"),
    customerId: uuid("customer_id"),
    customer: jsonb("customer").$type<CustomerSnapshot>().notNull(),
    /** The shop's details as they were when the quotation was saved. */
    seller: jsonb("seller").$type<SellerProfile>().notNull(),
    number: text("number").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    status: text("status").$type<QuotationStatus>().notNull().default("draft"),
    date: date("date", { mode: "string" }).notNull(),
    validUntil: date("valid_until", { mode: "string" }).notNull(),
    placeOfSupply: text("place_of_supply").notNull(),
    interState: boolean("inter_state").notNull().default(false),
    lines: jsonb("lines").$type<LineTotals[]>().notNull(),
    totals: jsonb("totals").$type<Omit<InvoiceTotals, "lines">>().notNull(),
    /** Paise. */
    total: integer("total").notNull(),
    notes: text("notes"),
    terms: text("terms"),
    /** Free text such as "2 weeks after advance". */
    deliveryText: text("delivery_text"),
    /** 1-100; the advance the shop asks for when the quotation is accepted. */
    advancePercent: integer("advance_percent"),
    shareToken: text("share_token").unique("quotations_share_token_uq"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    /** Name the customer typed when accepting / declining on the public page. */
    respondedBy: text("responded_by"),
    responseNote: text("response_note"),
    convertedKind: text("converted_kind").$type<QuotationConversion>(),
    convertedId: uuid("converted_id"),
    convertedNumber: text("converted_number"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    events: jsonb("events").$type<QuotationEvent[]>().notNull().default([]),
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("quotations_tenant_branch_fy_seq_rev_uq").on(
      t.tenantId,
      sql`coalesce(${t.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.fy,
      t.seq,
      t.rev,
    ),
    index("quotations_tenant_latest_date_idx").on(t.tenantId, t.latest, t.date),
    index("quotations_tenant_group_idx").on(t.tenantId, t.groupId),
    index("quotations_tenant_customer_idx").on(t.tenantId, t.customerId),
    index("quotations_tenant_converted_idx").on(t.tenantId, t.convertedId),
  ],
);

/** Per-tenant, per-branch, per-FY quotation counter (`branch_id` null = no branch), like `invoice_series`. */
export const quotationSeries = pgTable(
  "quotation_series",
  {
    id: pk(),
    tenantId: tenantId(),
    branchId: uuid("branch_id"),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull(),
    nextSeq: integer("next_seq").notNull(),
    ...timestamps(),
  },
  (t) => [unique("quotation_series_tenant_branch_fy_uq").on(t.tenantId, t.branchId, t.fy).nullsNotDistinct()],
);

export type QuotationRow = typeof quotations.$inferSelect;
export type CreditNoteRow = typeof creditNotes.$inferSelect;
export type TillSessionRow = typeof tillSessions.$inferSelect;

export type BillingCustomer = typeof billingCustomers.$inferSelect;
export type BillingItem = typeof billingItems.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoicePaymentRow = typeof invoicePayments.$inferSelect;
export type InvoiceSeries = typeof invoiceSeries.$inferSelect;
export type CustomerReceiptRow = typeof customerReceipts.$inferSelect;
export type InvoiceReminderRow = typeof invoiceReminders.$inferSelect;
export type InvoiceMessageRow = typeof invoiceMessages.$inferSelect;

// Proforma invoices, sale orders and delivery challans (docs/sales-documents.md); drizzle-kit reads this file.
export * from "./schema-sales";
// Recurring invoices and the GSTIN lookup cache (docs/recurring-export-gstin.md).
export * from "./schema-recurring";
// Debit notes to customers (docs/expenses-debit-notes.md).
export * from "./schema-debit-notes";
