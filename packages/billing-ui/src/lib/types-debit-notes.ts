/** Debit notes to customers (`/v1/invoices/debit-notes`, docs/expenses-debit-notes.md). Money is integer paise. */
import type { InvoiceTotals, LineTotals } from "@srirealtime/gst";
import type { ISODate, InvoiceParty, SellerProfile } from "./types";

export type DebitNoteReason = "price_revision" | "short_billed" | "freight" | "other_charges" | "other";
export const DEBIT_NOTE_REASONS: DebitNoteReason[] = ["price_revision", "short_billed", "freight", "other_charges", "other"];
export type DebitNoteStatus = "issued" | "cancelled";

export interface DebitNoteSummary {
  id: string;
  number: string;
  date: string;
  status: DebitNoteStatus;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  branchId: string | null;
  customerId: string | null;
  customerName: string;
  customerGstin: string | null;
  reason: DebitNoteReason;
  total: number;
  /** Received against the note (customer receipts, after the open bills). */
  paid: number;
  balance: number;
  dueDate: string | null;
  createdAt: ISODate;
}

/** A line: extra value on a bill line (`line` = its index) or a new charge (no `line`). */
export type DebitNoteLine = LineTotals & { line?: number };

export interface DebitNote extends DebitNoteSummary {
  customer: InvoiceParty;
  seller: Partial<SellerProfile>;
  note: string | null;
  placeOfSupply: string;
  interState: boolean;
  invoiceTotal: number;
  lines: DebitNoteLine[];
  totals: Omit<InvoiceTotals, "lines">;
  amountInWords: string;
  issuedAt: ISODate;
  cancelledAt: ISODate | null;
  cancelReason: string | null;
  canCancel: boolean;
  updatedAt: ISODate;
}

export interface DebitNoteLineInput {
  line?: number;
  description?: string;
  hsn?: string;
  unit?: string;
  qty: number;
  /** Paise per unit, GST-exclusive. */
  rate: number;
  gstRate?: number;
}

export interface DebitNoteInput {
  date?: string;
  reason: DebitNoteReason;
  note?: string;
  dueDate?: string;
  lines: DebitNoteLineInput[];
}
