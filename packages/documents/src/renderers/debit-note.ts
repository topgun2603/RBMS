import { esc, fmtDate } from "../html";
import { labels, type Labels } from "../labels";
import type { DebitNoteDocData, InvoiceDocData, RenderContext } from "../types";
import { renderInvoice, type SalesDocVariant } from "./invoice";

/** The invoice layout's data for a debit note to a customer (no payments or UPI QR on the note itself). */
function asInvoice(dn: DebitNoteDocData): InvoiceDocData {
  return {
    id: dn.id,
    number: dn.number,
    status: dn.status,
    date: dn.date,
    dueDate: null,
    customer: dn.customer,
    seller: dn.seller,
    placeOfSupply: dn.placeOfSupply,
    interState: dn.interState,
    lines: dn.lines,
    totals: dn.totals,
    amountInWords: dn.amountInWords ?? null,
    notes: dn.note,
    paid: 0,
    balance: 0,
    cancelReason: dn.cancelReason ?? null,
    updatedAt: dn.updatedAt ?? null,
    einvoice: dn.einvoice ?? null,
  };
}

/** "price_revision" → "Price revised" etc. */
export function debitReasonLabel(reason: string, t: Labels): string {
  const map: Record<string, string> = {
    price_revision: t.debitReasonPrice,
    short_billed: t.debitReasonQty,
    freight: t.debitReasonFreight,
    other_charges: t.debitReasonCharges,
    other: t.reasonOther,
  };
  return map[reason] ?? reason;
}

/** What a debit note prints besides the invoice layout: the bill it raises, the reason and the s.34 line. */
export function debitNoteVariant(dn: DebitNoteDocData, ctx: RenderContext): SalesDocVariant {
  const t = labels(ctx.locale);
  return {
    title: t.debitNote,
    numberLabel: t.debitNoteNo,
    forLabel: t.billTo,
    meta: [
      [t.againstInvoice, dn.invoiceNumber],
      [t.invoiceDate, fmtDate(dn.invoiceDate, ctx.locale)],
    ],
    totals: [],
    blocks: [{ label: t.reason, html: `<p>${esc(debitReasonLabel(dn.reason, t))}</p>` }],
    terms: null,
    note: t.debitNoteNote,
    stamp: dn.status === "cancelled" ? t.cancelled : null,
    showBank: true,
    receiverSign: null,
  };
}

/** GST debit note to a customer on A4 (CGST s.34(3)): "DEBIT NOTE", the original invoice number and date, reason. */
export function renderDebitNote(dn: DebitNoteDocData, ctx: RenderContext): string {
  return renderInvoice(asInvoice(dn), ctx, { doc: debitNoteVariant(dn, ctx) });
}
