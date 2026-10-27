/**
 * Debit notes to customers (CGST Act s.34(3)): raise the value of an earlier bill — a price revised upwards, quantity
 * short-billed, freight or other charges billed later (docs/expenses-debit-notes.md). Re-exported by schema.ts, which
 * drizzle-kit reads. Not the supplier debit notes of purchase returns (`debit_notes`, packages/inventory).
 */
import { pk, tenantId, timestamps } from "@srirealtime/db";
import type { InvoiceTotals, LineTotals } from "@srirealtime/gst";
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { CustomerSnapshot, SellerProfile } from "./ports";

/** Why the bill's value goes up. */
export const DEBIT_NOTE_REASONS = ["price_revision", "short_billed", "freight", "other_charges", "other"] as const;
export type DebitNoteReason = (typeof DEBIT_NOTE_REASONS)[number];

export const SALES_DEBIT_NOTE_STATUSES = ["issued", "cancelled"] as const;
export type SalesDebitNoteStatus = (typeof SALES_DEBIT_NOTE_STATUSES)[number];

/**
 * One line of a debit note: an extra amount on an invoice line (`line` = its index; price revised or more quantity) or
 * a new charge (freight, packing ...; `line` absent). GST-exclusive paise like a bill line.
 */
export type SalesDebitNoteLine = LineTotals & { line?: number };
export type SalesDebitNoteTotals = Omit<InvoiceTotals, "lines">;

export const salesDebitNotes = pgTable(
  "sales_debit_notes",
  {
    id: pk(),
    tenantId: tenantId(),
    /** The original bill (must be issued). */
    invoiceId: uuid("invoice_id").notNull(),
    /** The original bill's branch; drives the number series. */
    branchId: uuid("branch_id"),
    customerId: uuid("customer_id"),
    /** Buyer and seller as on the original bill. */
    customer: jsonb("customer").$type<CustomerSnapshot>().notNull(),
    seller: jsonb("seller").$type<SellerProfile>().notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    /** The original bill's grand total (B2CL vs B2CS for an unregistered buyer). */
    invoiceTotal: integer("invoice_total").notNull(),
    number: text("number").notNull(),
    fy: text("fy").notNull(),
    seq: integer("seq").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    status: text("status").$type<SalesDebitNoteStatus>().notNull().default("issued"),
    reason: text("reason").$type<DebitNoteReason>().notNull(),
    note: text("note"),
    /** Original place of supply and tax split. */
    placeOfSupply: text("place_of_supply").notNull(),
    interState: boolean("inter_state").notNull(),
    lines: jsonb("lines").$type<SalesDebitNoteLine[]>().notNull(),
    totals: jsonb("totals").$type<SalesDebitNoteTotals>().notNull(),
    /** Paise the customer owes more. */
    total: integer("total").notNull(),
    /** Paise received against the note (customer receipts allocated to it). */
    paid: integer("paid").notNull().default(0),
    dueDate: date("due_date", { mode: "string" }),
    createdBy: uuid("created_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
    cancelReason: text("cancel_reason"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("sales_debit_notes_tenant_branch_fy_seq_uq").on(
      t.tenantId,
      sql`coalesce(${t.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.fy,
      t.seq,
    ),
    index("sales_debit_notes_tenant_invoice_idx").on(t.tenantId, t.invoiceId),
    index("sales_debit_notes_tenant_date_idx").on(t.tenantId, t.date),
    index("sales_debit_notes_tenant_customer_idx").on(t.tenantId, t.customerId),
  ],
);

/** Per-tenant, per-branch, per-FY debit note counter (`branch_id` null = no branch), like `credit_note_series`. */
export const salesDebitNoteSeries = pgTable(
  "sales_debit_note_series",
  {
    id: pk(),
    tenantId: tenantId(),
    branchId: uuid("branch_id"),
    fy: text("fy").notNull(),
    prefix: text("prefix").notNull(),
    nextSeq: integer("next_seq").notNull(),
    ...timestamps(),
  },
  (t) => [unique("sales_debit_note_series_tenant_branch_fy_uq").on(t.tenantId, t.branchId, t.fy).nullsNotDistinct()],
);

/**
 * Money of a customer receipt (credit book) allocated to a debit note, after the customer's open bills. Removed with
 * the receipt. The receipt itself is what the books post (money / Debtors).
 */
export const salesDebitNoteAllocations = pgTable(
  "sales_debit_note_allocations",
  {
    id: pk(),
    tenantId: tenantId(),
    debitNoteId: uuid("debit_note_id")
      .notNull()
      .references(() => salesDebitNotes.id),
    receiptId: uuid("receipt_id").notNull(),
    amount: integer("amount").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sales_debit_note_allocations_tenant_note_idx").on(t.tenantId, t.debitNoteId),
    index("sales_debit_note_allocations_tenant_receipt_idx").on(t.tenantId, t.receiptId),
  ],
);

export type SalesDebitNoteRow = typeof salesDebitNotes.$inferSelect;
