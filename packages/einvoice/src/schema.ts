import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, date, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { EInvoiceProvider } from "./drivers/types";
import type { DocType } from "./ports";

/**
 * IRN status of a record. `ewb_only` (addition to the contract) = a standalone e-way bill for a bill without an IRN;
 * it never counts as an active e-invoice.
 */
export const RECORD_STATUSES = ["generated", "cancelled", "failed", "ewb_only"] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];
export const EWB_STATUSES = ["active", "cancelled"] as const;
export type EwbStatus = (typeof EWB_STATUSES)[number];

/** Per-shop options stored on the account. */
export interface AccountOptions {
  /** Days after the document date an IRN may still be generated; null = no limit; absent = platform default (30). */
  maxAgeDays?: number | null;
  /** Minimum HSN digits (4/6/8); absent = platform default. */
  minHsnDigits?: 4 | 6 | 8;
}

/** Provider error stored on a failed attempt. */
export interface RecordError {
  kind: string;
  code: string | null;
  message: string;
  errors?: { code: string | null; message: string }[];
}

/**
 * One e-invoice account per shop. `password_enc` = AES-256-GCM of the GSP/NIC API password,
 * `client_credentials_enc` = AES-256-GCM of JSON `{ clientId, clientSecret }`. Never returned by the API.
 */
export const einvoiceAccounts = pgTable("einvoice_accounts", {
  tenantId: uuid("tenant_id").primaryKey(),
  provider: text("provider").$type<EInvoiceProvider>().notNull().default("mock"),
  gstin: text("gstin").notNull(),
  username: text("username").notNull().default(""),
  passwordEnc: text("password_enc"),
  clientCredentialsEnc: text("client_credentials_enc"),
  sandbox: boolean("sandbox").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  options: jsonb("options").$type<AccountOptions>().notNull().default({}),
  ...timestamps(),
});

/**
 * IRN / e-way bill records. At most one `generated` record per invoice (partial unique index); cancelled and failed
 * attempts stay as history.
 */
export const einvoiceRecords = pgTable(
  "einvoice_records",
  {
    id: pk(),
    tenantId: tenantId(),
    invoiceId: uuid("invoice_id").notNull(),
    provider: text("provider").$type<EInvoiceProvider>().notNull(),
    docType: text("doc_type").$type<DocType>().notNull().default("INV"),
    docNo: text("doc_no").notNull(),
    docDate: date("doc_date", { mode: "string" }).notNull(),
    irn: text("irn"),
    ackNo: text("ack_no"),
    ackDate: timestamp("ack_date", { withTimezone: true }),
    signedQr: text("signed_qr"),
    signedInvoice: text("signed_invoice"),
    status: text("status").$type<RecordStatus>().notNull(),
    error: jsonb("error").$type<RecordError>(),
    /** The NIC JSON that was sent (no secrets). */
    payload: jsonb("payload"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    cancelRemark: text("cancel_remark"),
    ewbNo: text("ewb_no"),
    ewbDate: timestamp("ewb_date", { withTimezone: true }),
    ewbValidTill: timestamp("ewb_valid_till", { withTimezone: true }),
    ewbStatus: text("ewb_status").$type<EwbStatus>(),
    ewbCancelledAt: timestamp("ewb_cancelled_at", { withTimezone: true }),
    ewbPayload: jsonb("ewb_payload"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("einvoice_records_active_uidx").on(t.tenantId, t.invoiceId).where(sql`status = 'generated'`),
    index("einvoice_records_tenant_invoice_idx").on(t.tenantId, t.invoiceId, t.createdAt),
    index("einvoice_records_tenant_irn_idx").on(t.tenantId, t.irn),
  ],
);

export type EInvoiceAccountRow = typeof einvoiceAccounts.$inferSelect;
export type EInvoiceRecordRow = typeof einvoiceRecords.$inferSelect;
