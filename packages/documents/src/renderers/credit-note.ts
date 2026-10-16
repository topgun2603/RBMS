import type { CreditNoteDocData, InvoiceDocData, RenderContext } from "../types";
import { renderInvoice, renderInvoiceThermal, type CreditNoteVariant } from "./invoice";

/** The invoice layout's data for a credit note (no due date, no balance, no UPI QR). */
function asInvoice(cn: CreditNoteDocData): InvoiceDocData {
  return {
    id: cn.id,
    number: cn.number,
    status: cn.status,
    date: cn.date,
    dueDate: null,
    customer: cn.customer,
    seller: cn.seller,
    placeOfSupply: cn.placeOfSupply,
    interState: cn.interState,
    lines: cn.lines,
    totals: cn.totals,
    amountInWords: cn.amountInWords ?? null,
    notes: cn.note,
    paid: 0,
    balance: 0,
    cancelReason: cn.cancelReason ?? null,
    updatedAt: cn.updatedAt ?? null,
    einvoice: cn.einvoice ?? null,
  };
}

const variantOf = (cn: CreditNoteDocData): { creditNote: CreditNoteVariant } => ({
  creditNote: {
    invoiceNumber: cn.invoiceNumber,
    invoiceDate: cn.invoiceDate,
    reason: cn.reason,
    refundMode: cn.refundMode,
    refundAmount: cn.refundAmount,
  },
});

/** GST credit note on A4: "CREDIT NOTE", the original invoice number and date, reason and refund. */
export function renderCreditNote(cn: CreditNoteDocData, ctx: RenderContext): string {
  return renderInvoice(asInvoice(cn), ctx, variantOf(cn));
}

/** 80 mm credit note slip (POS returns). */
export function renderCreditNoteThermal(cn: CreditNoteDocData, ctx: RenderContext): string {
  return renderInvoiceThermal(asInvoice(cn), ctx, variantOf(cn));
}
