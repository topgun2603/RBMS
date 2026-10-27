import { esc, escLines, fmtDate, money, qty } from "../html";
import { labels, type Labels } from "../labels";
import type { InvoiceDocData, RenderContext, SalesDocDocData } from "../types";
import { renderInvoice, type SalesDocVariant } from "./invoice";

/** The invoice layout's data for a proforma, sale order or challan (no due date, payments or UPI QR). */
function asInvoice(d: SalesDocDocData): InvoiceDocData {
  return {
    id: d.id,
    number: d.number,
    status: d.status,
    date: d.date,
    dueDate: null,
    customer: d.customer,
    seller: d.seller,
    placeOfSupply: d.placeOfSupply,
    interState: d.interState,
    lines: d.lines,
    totals: d.totals,
    amountInWords: d.amountInWords,
    notes: d.notes,
    paid: 0,
    balance: 0,
    updatedAt: d.updatedAt ?? null,
  };
}

/** "job_work" → "Job work" etc. */
export function challanReasonLabel(reason: string | undefined, t: Labels): string {
  const map: Record<string, string> = {
    job_work: t.reasonJobWork,
    approval: t.reasonApproval,
    before_invoice: t.reasonBeforeInvoice,
    exhibition: t.reasonExhibition,
    other: t.reasonNotSupply,
  };
  return reason ? (map[reason] ?? reason) : "";
}

function modeLabel(mode: string | null | undefined, t: Labels): string | null {
  const map: Record<string, string> = { road: t.modeRoad, rail: t.modeRail, air: t.modeAir, ship: t.modeShip, hand: t.modeHand };
  return mode ? (map[mode] ?? mode) : null;
}

const rowsHtml = (rows: [string, string | null | undefined][]) =>
  rows
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `<p><span class="muted">${esc(k)}:</span> ${esc(String(v))}</p>`)
    .join("");

/** What each kind prints besides the invoice layout. */
export function salesDocVariant(doc: SalesDocDocData, ctx: RenderContext): SalesDocVariant {
  const t = labels(ctx.locale);
  const d = (v: string | null | undefined) => fmtDate(v, ctx.locale);
  const stamp = doc.status === "cancelled" ? t.cancelled : doc.status === "expired" ? t.expired : doc.status === "converted" || doc.status === "invoiced" ? t.billed : null;
  const advanceRows = (): [string, string][] => {
    const out: [string, string][] = [];
    if (doc.advancePercent && (doc.advanceAmount ?? 0) > 0) out.push([`${t.advanceRequired} (${doc.advancePercent}%)`, money(doc.advanceAmount!)]);
    if ((doc.advanceReceived ?? 0) > 0) {
      out.push([t.advanceReceived, money(doc.advanceReceived!)]);
      out.push([t.balanceAfterAdvance, money(Math.max(doc.totals.total - doc.advanceReceived!, 0))]);
    }
    return out;
  };

  if (doc.kind === "proforma") {
    const meta: [string, string][] = [];
    if (doc.validUntil) meta.push([t.validUntil, d(doc.validUntil)]);
    if (doc.quotationNumber) meta.push([t.againstQuotation, doc.quotationNumber]);
    return {
      title: t.proformaInvoice,
      numberLabel: t.proformaNo,
      forLabel: t.billTo,
      meta,
      totals: advanceRows(),
      blocks: doc.deliveryText ? [{ label: t.deliveryTime, html: `<p>${escLines(doc.deliveryText)}</p>` }] : [],
      terms: doc.terms,
      note: t.proformaNote,
      stamp,
      showBank: true,
      receiverSign: null,
    };
  }

  if (doc.kind === "sale_order") {
    const meta: [string, string][] = [];
    if (doc.promisedDate) meta.push([t.promisedDate, d(doc.promisedDate)]);
    if (doc.customerRef) meta.push([t.customerRef, doc.customerRef]);
    if (doc.quotationNumber) meta.push([t.againstQuotation, doc.quotationNumber]);
    const delivered = (doc.progress ?? []).some((p) => p.delivered > 0);
    const blocks = delivered
      ? [
          {
            label: t.deliveryStatus,
            html: (doc.progress ?? [])
              .map((p) => `<p>${esc(p.description)}: ${esc(qty(p.delivered))} / ${esc(qty(p.ordered))} ${esc(p.unit ?? "")} ${esc(t.deliveredQty.toLowerCase())}</p>`)
              .join(""),
          },
        ]
      : [];
    return {
      title: t.saleOrder,
      numberLabel: t.saleOrderNo,
      forLabel: t.orderFrom,
      meta,
      totals: advanceRows(),
      blocks,
      terms: doc.terms,
      note: t.saleOrderNote,
      stamp: doc.status === "cancelled" ? t.cancelled : null,
      showBank: true,
      receiverSign: null,
    };
  }

  // Delivery challan (CGST Rule 55): purpose, transport, e-way bill, returned goods and the receiver's signature.
  const meta: [string, string][] = [[t.challanReason, challanReasonLabel(doc.reason, t)]];
  if (doc.returnBy) meta.push([t.returnBy, d(doc.returnBy)]);
  if (doc.saleOrderNumber) meta.push([t.saleOrderRef, doc.saleOrderNumber]);
  if (doc.ewbNo) meta.push([t.ewbNo, doc.ewbNo]);
  if (doc.ewbDate) meta.push([t.ewbDate, d(doc.ewbDate)]);
  if (doc.invoiceNumber) meta.push([t.billedIn, doc.invoiceNumber]);
  const tr = doc.transport ?? {};
  const transport = rowsHtml([
    [t.transportMode, modeLabel(tr.mode, t)],
    [t.transporter, [tr.transporterName, tr.transporterId].filter(Boolean).join(" · ") || null],
    [t.vehicleNo, tr.vehicleNo],
    [t.lrNo, [tr.docNo, tr.docDate ? d(tr.docDate) : null].filter(Boolean).join(" · ") || null],
    [t.distanceKm, tr.distanceKm ? String(tr.distanceKm) : null],
  ]);
  const blocks: SalesDocVariant["blocks"] = [];
  if (doc.shipTo) blocks.push({ label: t.shipTo, html: `<p>${escLines(doc.shipTo)}</p>` });
  if (transport) blocks.push({ label: t.transport, html: transport });
  if (doc.returned?.length) {
    blocks.push({ label: t.returnedGoods, html: doc.returned.map((r) => `<p>${esc(r.description)}: ${esc(qty(r.qty))} ${esc(r.unit ?? "")}</p>`).join("") });
  }
  return {
    title: t.deliveryChallan,
    numberLabel: t.challanNo,
    forLabel: t.consignee,
    meta,
    totals: [],
    blocks,
    terms: doc.terms,
    note: `${t.challanNote} ${t.challanCopies}`,
    stamp: doc.status === "cancelled" ? t.cancelled : null,
    showBank: false,
    receiverSign: { text: t.receivedGoods, label: t.receiverSign },
    totalLabel: t.goodsValue,
  };
}

/** Proforma invoice, sale order or delivery challan on A4 (the invoice layout with the document's own title and fields). */
export function renderSalesDoc(doc: SalesDocDocData, ctx: RenderContext): string {
  return renderInvoice(asInvoice(doc), ctx, { doc: salesDocVariant(doc, ctx) });
}
