/**
 * Pure credit note business rules (no database): how the money goes back, the number prefix and when a note may be
 * cancelled. The GST maths (returnable quantities, line shares, totals) is `computeCreditNote` in @rbms/gst.
 */
import { CreditNoteError, DEFAULT_INVOICE_PREFIX, sanitizePrefix } from "@rbms/gst";
import type { RefundMode } from "./schema";

export interface CreditSettlement {
  /** Paise paid back now (cash / UPI / card). */
  refund: number;
  /** Paise of the note that the customer had already paid and that stays as credit in their book. */
  toCreditBook: number;
  /** Paise of the note that only reduced what was still owed on the bill. */
  reducesBalance: number;
}

/**
 * How a credit note's money goes back. The part of the note up to the bill's open balance just reduces what is owed;
 * the rest was already paid and is refunded (cash/UPI/card) or kept as credit in the customer's book. With "none"
 * the note must fit within the open balance (nothing was paid for it).
 */
export function settleCreditNote(
  inv: { total: number; paid: number; credited: number },
  noteTotal: number,
  mode: RefundMode,
  opts: { hasCustomer: boolean },
): CreditSettlement {
  const open = Math.max(inv.total - inv.paid - inv.credited, 0);
  const reducesBalance = Math.min(noteTotal, open);
  const excess = Math.max(noteTotal - open, 0);
  if (mode === "credit_book") {
    if (!opts.hasCustomer && excess > 0) {
      throw new CreditNoteError("credit_note_refund", "Keeping the money in the credit book needs a saved customer; refund it instead");
    }
    return { refund: 0, toCreditBook: excess, reducesBalance };
  }
  if (mode === "none") {
    if (excess > 0) throw new CreditNoteError("credit_note_refund", "This bill is already paid; choose how the money goes back (cash, UPI, card or credit book)");
    return { refund: 0, toCreditBook: 0, reducesBalance };
  }
  return { refund: excess, toCreditBook: 0, reducesBalance };
}

/** Number prefix of credit notes: "CN", or "CN" + the bill's own prefix when it isn't the default ("MDU" → "CNMDU"). */
export function creditNotePrefix(invoicePrefix: string | null | undefined): string {
  const p = sanitizePrefix(invoicePrefix);
  if (p === DEFAULT_INVOICE_PREFIX) return "CN";
  return sanitizePrefix(`CN${p}`);
}

/** A note may be cancelled on the IST day it was issued, and only when no money was paid out with it. */
export function cancelProblem(note: { status: string; issuedOn: string; refundAmount: number }, today: string): string | null {
  if (note.status === "cancelled") return "This credit note is already cancelled";
  if (note.issuedOn !== today) return "A credit note can only be cancelled on the day it was issued";
  if (note.refundAmount > 0) return "Money was refunded with this credit note; it can't be cancelled";
  return null;
}
