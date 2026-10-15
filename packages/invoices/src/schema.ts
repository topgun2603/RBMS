import { pk, tenantId, timestamps } from "@srirealtime/db";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InvoiceTotals, LineTotals } from "./calc";
import type { CustomerSnapshot, SellerProfile } from "./ports";

export const INVOICE_STATUSES = ["draft", "issued", "partially_paid", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_METHODS = ["cash", "upi", "card", "bank", "cheque", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Where an invoice payment came from: entered on the bill, allocated from a customer receipt, or paid online. */
export const PAYMENT_SOURCES = ["manual", "receipt", "online"] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

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
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    index("customer_receipts_tenant_customer_date_idx").on(t.tenantId, t.customerId, t.date),
    index("customer_receipts_tenant_date_idx").on(t.tenantId, t.date),
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
    totals: jsonb("totals").$type<Omit<InvoiceTotals, "lines">>().notNull(),
    /** Paise. */
    total: integer("total").notNull(),
    paid: integer("paid").notNull().default(0),
    notes: text("notes"),
    shareToken: text("share_token").unique("invoices_share_token_uq"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("invoices_tenant_fy_seq_uq").on(t.tenantId, t.fy, t.seq),
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
    createdBy: uuid("created_by"),
    ...timestamps(),
  },
  (t) => [
    index("invoice_payments_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
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

/** Per-tenant, per-FY invoice counter. `next_seq` holds the last number handed out. */
export const invoiceSeries = pgTable(
  "invoice_series",
  {
    tenantId: tenantId(),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull(),
    nextSeq: integer("next_seq").notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ name: "invoice_series_pk", columns: [t.tenantId, t.fy] })],
);

export type BillingCustomer = typeof billingCustomers.$inferSelect;
export type BillingItem = typeof billingItems.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoicePaymentRow = typeof invoicePayments.$inferSelect;
export type InvoiceSeries = typeof invoiceSeries.$inferSelect;
export type CustomerReceiptRow = typeof customerReceipts.$inferSelect;
export type InvoiceReminderRow = typeof invoiceReminders.$inferSelect;
export type InvoiceMessageRow = typeof invoiceMessages.$inferSelect;
