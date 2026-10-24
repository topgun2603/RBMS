import type { InvoiceDocData, QuotationDocData, RenderContext } from "../types";
import { renderInvoice, renderInvoiceThermal, type QuotationVariant } from "./invoice";

/** The invoice layout's data for a quotation (no due date, no payments, no UPI QR). */
function asInvoice(q: QuotationDocData): InvoiceDocData {
  return {
    id: q.id,
    number: q.number,
    status: q.status,
    date: q.date,
    dueDate: null,
    customer: q.customer,
    seller: q.seller,
    placeOfSupply: q.placeOfSupply,
    interState: q.interState,
    lines: q.lines,
    totals: q.totals,
    amountInWords: q.amountInWords,
    notes: q.notes,
    paid: 0,
    balance: 0,
    updatedAt: q.updatedAt ?? null,
  };
}

const variantOf = (q: QuotationDocData): { quotation: QuotationVariant } => ({
  quotation: {
    rev: q.rev,
    validUntil: q.validUntil,
    terms: q.terms,
    deliveryText: q.deliveryText,
    advancePercent: q.advancePercent,
    advanceAmount: q.advanceAmount,
    acceptedBy: q.acceptedBy,
    acceptedAt: q.acceptedAt,
  },
});

/** Quotation on A4: titled "Quotation" / "மதிப்பீடு" with validity, terms, delivery time and the advance asked for. */
export function renderQuotation(q: QuotationDocData, ctx: RenderContext): string {
  return renderInvoice(asInvoice(q), ctx, variantOf(q));
}

/** 80 mm quotation slip. */
export function renderQuotationThermal(q: QuotationDocData, ctx: RenderContext): string {
  return renderInvoiceThermal(asInvoice(q), ctx, variantOf(q));
}
