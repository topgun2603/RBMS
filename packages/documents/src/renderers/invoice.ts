import { amountInWordsINR, upiLink } from "@srirealtime/gst";
import { esc, escLines, fmtDate, fmtDateTime, money, page, pct, qrSvg, qty, safeImageUrl, stateLabel } from "../html";
import { labels, type Labels } from "../labels";
import type { DocLocale, InvoiceDocData, InvoiceEinvoice, RenderContext } from "../types";

const CSS = `
.doc{position:relative}
.head{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #e5e7eb;padding-bottom:10px}
.brand{display:flex;align-items:center;gap:10px}
.brand img{max-height:48px;max-width:140px;object-fit:contain}
.brand .name{font-size:14pt;font-weight:700}
.seller{margin-top:6px;font-size:8.5pt;color:#4b5563}
.seller .strong{color:#111827;font-weight:600}
.title{text-align:right}
.title h1{font-size:15pt;font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:.04em}
.meta{margin-top:6px;display:grid;grid-template-columns:auto auto;gap:1px 10px;justify-content:end;font-size:9pt}
.meta dt{color:#6b7280}.meta dd{margin:0;font-weight:600;text-align:left}
.buyer{border-bottom:1px solid #e5e7eb;padding:8px 0}
.label{font-size:7.5pt;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6b7280}
.lines{margin-top:8px;font-size:9pt}
.lines th{background:#f3f4f6;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;padding:5px 4px;font-size:8pt;color:#4b5563}
.lines td{border-bottom:1px solid #e5e7eb;padding:5px 4px;vertical-align:top}
.sum{display:flex;gap:18px;margin-top:10px}
.sum .left{flex:1;min-width:0}
.sum .right{width:230px}
.breakup{font-size:8pt}
.breakup th{background:#f3f4f6;border-bottom:1px solid #e5e7eb;padding:3px 4px;color:#4b5563}
.breakup td{border-bottom:1px solid #e5e7eb;padding:3px 4px}
.words{margin-top:8px;background:#f3f4f6;border-radius:6px;padding:6px 8px}
.tot{display:flex;justify-content:space-between;gap:10px;padding:1.5px 0}
.tot dt{color:#6b7280}.tot dd{margin:0}
.grand{border-top:1px solid #d1d5db;margin-top:4px;padding-top:5px;font-weight:700}
.grand dd{color:var(--primary);font-size:13pt}
.foot{display:flex;justify-content:space-between;gap:18px;margin-top:14px;border-top:1px solid #e5e7eb;padding-top:8px;font-size:8.5pt}
.foot .left>div{margin-bottom:6px}
.pay{display:flex;align-items:center;gap:10px;flex-direction:row-reverse}
.pay .amt{color:var(--primary);font-weight:700;font-size:11pt}
.sign{margin-top:16px;text-align:right}
.sign .line{margin-top:34px;border-top:1px dashed #9ca3af;padding-top:2px;font-weight:600}
.cg{margin-top:14px;text-align:center;font-size:7pt;color:#6b7280}
.cancel{color:#dc2626}
.einv{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;border-bottom:1px solid #e5e7eb;padding:8px 0}
.einv .info{flex:1;min-width:0;font-size:8.5pt}
.einv dl{margin:0}
.einv .row{display:flex;gap:6px;margin-top:2px}
.einv .row dt{color:#6b7280;flex:none;min-width:64px}
.einv .row dd{margin:0;font-weight:600;min-width:0}
.irn{font-family:"SR Noto Sans",monospace;font-size:7.5pt;word-break:break-all;overflow-wrap:anywhere}
.einv .qrbox{flex:none;text-align:center}
.mockeinv{display:inline-block;margin-top:4px;border:1.5px solid #dc2626;color:#dc2626;font-weight:700;font-size:8pt;padding:1px 6px;border-radius:4px}
`;

/**
 * The e-invoice signed QR as SVG, or "" when there is none or it cannot be encoded. Low error correction ("L")
 * keeps the ~1 KB JWT scannable at print sizes.
 */
function einvoiceQr(e: InvoiceEinvoice, sizePx: number, label: string): string {
  if (!e.signedQrCode) return "";
  try {
    return qrSvg(e.signedQrCode, sizePx, label, "L");
  } catch {
    return "";
  }
}

/** Label/value pairs printed in the e-invoice block (A4 and 80 mm). */
function einvoiceRows(e: InvoiceEinvoice, t: Labels, locale: DocLocale): Array<[string, string, boolean]> {
  const rows: Array<[string, string, boolean]> = [[t.irn, e.irn, true]];
  if (e.ackNo) rows.push([t.ackNo, e.ackNo, false]);
  if (e.ackDate) rows.push([t.ackDate, fmtDateTime(e.ackDate, locale), false]);
  if (e.ewbNo) {
    rows.push([t.ewbNo, e.ewbNo, false]);
    if (e.ewbValidTill) rows.push([t.ewbValidTill, fmtDateTime(e.ewbValidTill, locale), false]);
  }
  return rows;
}

/** A4 "e-Invoice" block: IRN (wrapping monospace), Ack No./Date, e-way bill and the signed QR. */
function einvoiceBlockA4(e: InvoiceEinvoice | null | undefined, t: Labels, locale: DocLocale): string {
  if (!e?.irn) return "";
  const rows = einvoiceRows(e, t, locale)
    .map(([k, v, mono]) => `<div class="row"><dt>${esc(k)}</dt><dd${mono ? ' class="irn"' : ' class="num"'}>${esc(v)}</dd></div>`)
    .join("");
  const qr = einvoiceQr(e, 150, t.einvoiceQr);
  return `
<section class="einv avoid">
  <div class="info">
    <p class="label">${esc(t.einvoice)}</p>
    <dl>${rows}</dl>
    ${e.mock ? `<p class="mockeinv">${esc(t.einvoiceMock)}</p>` : ""}
  </div>
  ${qr ? `<div class="qrbox">${qr}<p class="xs muted">${esc(t.einvoiceQr)}</p></div>` : ""}
</section>`;
}

/** The UPI deep link printed as a QR, when the bill still has a balance. */
export function invoiceUpi(inv: InvoiceDocData, brandName: string, noteLabel: string): string | null {
  const s = inv.seller;
  if (!s.upiId || inv.balance <= 0 || inv.status === "cancelled" || inv.status === "draft") return null;
  return upiLink({
    vpa: s.upiId,
    name: s.legalName || brandName || "Shop",
    amountPaise: inv.balance,
    note: inv.number ? `${noteLabel} ${inv.number}` : noteLabel,
  });
}

/** Extra content when an invoice layout prints a credit note. */
export interface CreditNoteVariant {
  invoiceNumber: string;
  invoiceDate: string;
  reason: string;
  refundMode: string;
  refundAmount: number;
}

/** Extra content when an invoice layout prints a quotation (docs/quotations.md). */
export interface QuotationVariant {
  rev: number;
  validUntil: string;
  /** Terms and conditions of this quotation (the invoice terms of the shop are not printed). */
  terms: string | null;
  deliveryText: string | null;
  advancePercent: number | null;
  advanceAmount: number;
  acceptedBy: string | null;
  acceptedAt: string | null;
}

/** Statuses of a quotation that get a stamp across the page. */
const QUOTE_STAMPS: Record<string, keyof Labels> = { cancelled: "cancelled", expired: "expired", declined: "declined" };

/** "return" → "Goods returned" etc. */
export function reasonLabel(reason: string, t: Labels): string {
  const map: Record<string, string> = { return: t.reasonReturn, price_correction: t.reasonPriceCorrection, discount: t.reasonDiscount, other: t.reasonOther };
  return map[reason] ?? reason;
}

function refundLine(cn: CreditNoteVariant, t: Labels): [string, string] | null {
  const how: Record<string, string> = { cash: t.refundCash, upi: t.refundUpi, card: t.refundCard };
  if (cn.refundAmount > 0) return [`${t.refunded} (${how[cn.refundMode] ?? cn.refundMode})`, money(cn.refundAmount)];
  if (cn.refundMode === "credit_book") return [t.creditedToAccount, ""];
  return null;
}

/** GST tax invoice on A4: same content as billing-ui's printable InvoiceDocument. With `variant.creditNote`, a credit note. */
export function renderInvoice(inv: InvoiceDocData, ctx: RenderContext, variant: { creditNote?: CreditNoteVariant; quotation?: QuotationVariant } = {}): string {
  const cn = variant.creditNote ?? null;
  const qt = variant.quotation ?? null;
  const t = labels(ctx.locale);
  const L = (k: keyof typeof t) => esc(t[k]);
  const seller = inv.seller;
  const buyer = inv.customer;
  const totals = inv.totals;
  const inter = inv.interState;
  const stampKey = qt ? QUOTE_STAMPS[inv.status] : inv.status === "cancelled" ? "cancelled" : undefined;
  const cancelled = inv.status === "cancelled";
  const brandName = ctx.branding.appName || seller.legalName || "";
  const logo = safeImageUrl(ctx.branding.logoUrl);
  const upi = cn || qt ? null : invoiceUpi(inv, brandName, "Invoice");
  const words = inv.amountInWords || amountInWordsINR(totals.total);
  const d = (v: string | null | undefined) => fmtDate(v, ctx.locale);
  const composition = !qt && seller.taxScheme === "composition" && (!seller.compositionFrom || inv.date >= seller.compositionFrom);
  const title = qt ? t.quotation : cn ? t.creditNote : composition ? t.compositionBill : seller.gstin ? t.taxInvoice : t.billOfSupply;
  const refund = cn ? refundLine(cn, t) : null;
  const taxCols = inter ? `<th class="r">IGST</th>` : `<th class="r">CGST</th><th class="r">SGST</th>`;
  const totRow = (label: string, value: string) => `<div class="tot"><dt>${esc(label)}</dt><dd class="num">${esc(value)}</dd></div>`;

  const sellerLines = [
    seller.legalName && seller.legalName !== brandName ? `<p class="strong">${esc(seller.legalName)}</p>` : "",
    seller.address ? `<p>${escLines(seller.address)}</p>` : "",
    seller.city || seller.pincode ? `<p>${esc([seller.city, seller.pincode].filter(Boolean).join(" – "))}</p>` : "",
    seller.stateCode ? `<p>${L("state")}: ${esc(stateLabel(seller.stateCode))}</p>` : "",
    seller.phone || seller.email ? `<p>${esc([seller.phone, seller.email].filter(Boolean).join(" · "))}</p>` : "",
    seller.gstin ? `<p class="strong">GSTIN: <span class="mono">${esc(seller.gstin)}</span></p>` : "",
  ].join("");

  const lines = inv.lines
    .map(
      (l, i) => `<tr>
<td class="muted num">${i + 1}</td>
<td><div class="b">${esc(l.description)}</div>${l.serials?.length ? `<div class="xs mono">${L("serials")}: ${esc(l.serials.join(", "))}</div>` : ""}${l.discount ? `<div class="xs muted">${L("discount")}: −${esc(money(l.discount))}</div>` : ""}</td>
<td class="mono small">${esc(l.hsn || "—")}</td>
<td class="r num">${esc(qty(l.qty))} ${esc(l.unit ?? "")}</td>
<td class="r num">${esc(money(l.rate))}</td>
<td class="r num">${esc(money(l.taxable))}</td>
<td class="r num">${esc(pct(l.gstRate))}</td>
${inter ? `<td class="r num">${esc(money(l.igst))}</td>` : `<td class="r num">${esc(money(l.cgst))}</td><td class="r num">${esc(money(l.sgst))}</td>`}
<td class="r num b">${esc(money(l.total))}</td>
</tr>`,
    )
    .join("\n");

  const breakup = totals.taxBreakup.length
    ? `<p class="label">${L("taxBreakup")}</p>
<table class="breakup"><thead><tr><th>${L("gst")}</th><th class="r">${L("taxable")}</th>${taxCols}<th class="r">${L("totalTax")}</th></tr></thead><tbody>
${totals.taxBreakup
  .map(
    (b) =>
      `<tr><td class="num">${esc(pct(b.gstRate))}</td><td class="r num">${esc(money(b.taxable))}</td>${
        inter ? `<td class="r num">${esc(money(b.igst))}</td>` : `<td class="r num">${esc(money(b.cgst))}</td><td class="r num">${esc(money(b.sgst))}</td>`
      }<td class="r num">${esc(money(b.cgst + b.sgst + b.igst))}</td></tr>`,
  )
  .join("")}
</tbody></table>`
    : "";

  const totalsHtml = [
    totRow(t.subtotal, money(totals.subtotal)),
    totals.discount > 0 ? totRow(t.discount, `−${money(totals.discount)}`) : "",
    totRow(t.taxableValue, money(totals.taxable)),
    inter ? totRow("IGST", money(totals.igst)) : totRow("CGST", money(totals.cgst)) + totRow("SGST", money(totals.sgst)),
    totals.roundOff !== 0 ? totRow(t.roundOff, `${totals.roundOff > 0 ? "+" : "−"}${money(Math.abs(totals.roundOff))}`) : "",
    `<div class="tot grand"><dt>${L("grandTotal")}</dt><dd class="num">${esc(money(totals.total))}</dd></div>`,
    !cn && !qt && inv.paid > 0 ? totRow(t.paid, money(inv.paid)) + `<div class="tot b"><dt>${L("balance")}</dt><dd class="num">${esc(money(inv.balance))}</dd></div>` : "",
    refund ? totRow(refund[0], refund[1]) : "",
    qt && qt.advancePercent && qt.advanceAmount > 0 ? totRow(`${t.advanceRequired} (${qt.advancePercent}%)`, money(qt.advanceAmount)) : "",
  ].join("");

  const bank =
    seller.bankName || seller.accountNumber || seller.ifsc
      ? `<div><p class="label">${L("bankDetails")}</p>${seller.bankName ? `<p>${esc(seller.bankName)}</p>` : ""}${
          seller.accountNumber ? `<p>${L("account")}: <span class="mono">${esc(seller.accountNumber)}</span></p>` : ""
        }${seller.ifsc ? `<p>IFSC: <span class="mono">${esc(seller.ifsc)}</span></p>` : ""}${
          seller.upiId ? `<p>UPI: <span class="mono">${esc(seller.upiId)}</span></p>` : ""
        }</div>`
      : "";

  const body = `<article class="doc">
${stampKey ? `<div class="stamp" aria-hidden="true">${L(stampKey)}</div>` : ""}
<header class="head">
  <div>
    <div class="brand">${logo ? `<img src="${esc(logo)}" alt="">` : ""}<span class="name">${esc(brandName)}</span></div>
    <div class="seller">${sellerLines}</div>
  </div>
  <div class="title">
    <h1>${esc(title)}</h1>
    <dl class="meta">
      <dt>${qt ? L("quotationNo") : cn ? L("creditNoteNo") : L("number")}</dt><dd class="num">${esc(inv.number ?? t.draft)}</dd>
      <dt>${L("date")}</dt><dd class="num">${esc(d(inv.date))}</dd>${qt ? `${qt.rev > 1 ? `<dt>${L("revision")}</dt><dd class="num">${qt.rev}</dd>` : ""}<dt>${L("validUntil")}</dt><dd class="num">${esc(d(qt.validUntil))}</dd>` : ""}
      ${
        cn
          ? `<dt>${L("againstInvoice")}</dt><dd class="num">${esc(cn.invoiceNumber)}</dd><dt>${L("invoiceDate")}</dt><dd class="num">${esc(d(cn.invoiceDate))}</dd>`
          : inv.dueDate
            ? `<dt>${L("dueDate")}</dt><dd class="num">${esc(d(inv.dueDate))}</dd>`
            : ""
      }
      <dt>${L("placeOfSupply")}</dt><dd>${esc(stateLabel(inv.placeOfSupply))}</dd>
    </dl>
  </div>
</header>${einvoiceBlockA4(inv.einvoice, t, ctx.locale)}
<section class="buyer avoid">
  <p class="label">${qt ? L("quotationFor") : L("billTo")}</p>
  <p class="b">${esc(buyer.name || "—")}</p>
  ${buyer.address ? `<p class="muted">${escLines(buyer.address)}</p>` : ""}
  <p class="small muted">${[
    buyer.stateCode ? `${L("state")}: ${esc(stateLabel(buyer.stateCode))}` : "",
    buyer.phone ? esc(buyer.phone) : "",
    buyer.email ? esc(buyer.email) : "",
  ]
    .filter(Boolean)
    .join(" &nbsp; ")}</p>
  ${buyer.gstin ? `<p class="small b">GSTIN: <span class="mono">${esc(buyer.gstin)}</span></p>` : ""}
</section>
<table class="lines">
<thead><tr><th>#</th><th>${L("item")}</th><th>${L("hsn")}</th><th class="r">${L("qty")}</th><th class="r">${L("rate")}</th><th class="r">${L("taxable")}</th><th class="r">${L("gst")}</th>${taxCols}<th class="r">${L("amount")}</th></tr></thead>
<tbody>
${lines}
</tbody>
</table>
<section class="sum avoid">
  <div class="left">
    ${breakup}
    <div class="words"><p class="xs muted">${L("amountInWords")}</p><p class="b">${esc(words)}</p></div>
  </div>
  <dl class="right">${totalsHtml}</dl>
</section>
<section class="foot avoid">
  <div class="left">
    ${composition ? `<div><p class="b">${L("compositionNote")}</p></div>` : ""}${cn ? `<div><p class="label">${L("reason")}</p><p>${esc(reasonLabel(cn.reason, t))}</p></div>` : bank}
    ${inv.notes ? `<div><p class="label">${L("notes")}</p><p>${escLines(inv.notes)}</p></div>` : ""}${qt?.deliveryText ? `<div><p class="label">${L("deliveryTime")}</p><p>${escLines(qt.deliveryText)}</p></div>` : ""}
    ${qt ? (qt.terms ? `<div><p class="label">${L("terms")}</p><p class="muted">${escLines(qt.terms)}</p></div>` : "") : !cn && seller.terms ? `<div><p class="label">${L("terms")}</p><p class="muted">${escLines(seller.terms)}</p></div>` : ""}${qt?.acceptedBy ? `<p class="b">${esc(t.acceptedBy.replace("{name}", qt.acceptedBy).replace("{date}", d(qt.acceptedAt)))}</p>` : ""}
    ${cancelled && inv.cancelReason ? `<p class="cancel">${L("cancelReason")}: ${esc(inv.cancelReason)}</p>` : ""}
  </div>
  <div>
    ${
      upi
        ? `<div class="pay">${qrSvg(upi, 104, `UPI ${money(inv.balance)}`)}<div class="r"><p class="b">${L("scanToPay")}</p><p class="amt num">${esc(
            money(inv.balance),
          )}</p><p class="xs muted">${L("anyUpiApp")}</p></div></div>`
        : ""
    }
    <div class="sign"><p class="muted">${esc(t.forName.replace("{name}", seller.legalName || brandName))}</p><div class="line">${L("signatory")}</div></div>
  </div>
</section>
<p class="cg">${qt ? L("quotationNote") : cn ? L("computerGeneratedNote") : L("computerGenerated")}</p>
</article>`;

  return page({ title: `${qt ? t.quotation : cn ? t.creditNote : t.invoice} ${inv.number ?? ""}`.trim(), paper: "A4", locale: ctx.locale, branding: ctx.branding, css: CSS, body });
}

/** 80 mm thermal receipt. With `variant.creditNote`, a credit note slip. */
export function renderInvoiceThermal(inv: InvoiceDocData, ctx: RenderContext, variant: { creditNote?: CreditNoteVariant; quotation?: QuotationVariant } = {}): string {
  const cn = variant.creditNote ?? null;
  const qt = variant.quotation ?? null;
  const t = labels(ctx.locale);
  const L = (k: keyof typeof t) => esc(t[k]);
  const s = inv.seller;
  const totals = inv.totals;
  const stampKey = qt ? QUOTE_STAMPS[inv.status] : inv.status === "cancelled" ? "cancelled" : undefined;
  const brandName = ctx.branding.appName || s.legalName || "";
  const upi = cn || qt ? null : invoiceUpi(inv, brandName, "Invoice");
  const refund = cn ? refundLine(cn, t) : null;
  const row = (label: string, value: string, cls = "") => `<tr class="${cls}"><td>${esc(label)}</td><td class="r num">${esc(value)}</td></tr>`;

  const css = `
body{font-size:8.5pt;line-height:1.3;width:74mm}
.c h1{font-size:11pt;font-weight:700}
hr{border:0;border-top:1px dashed #000;margin:4px 0}
td{padding:1px 0;vertical-align:top}
.it td{padding-top:3px}
.grand td{font-size:11pt;font-weight:700;border-top:1px solid #000;padding-top:3px}
.qr{margin:4px auto}
.stamp{position:static;transform:none;font-size:14pt;color:#000;border:2px solid #000;margin:4px 0;padding:2px}
.irn{font-family:"SR Noto Sans",monospace;font-size:7pt;word-break:break-all;overflow-wrap:anywhere}
.mockeinv{border:1.5px solid #000;font-weight:700;padding:1px 2px;margin-top:2px}
`;
  const e = inv.einvoice?.irn ? inv.einvoice : null;
  const einv = e
    ? (() => {
        const qr = einvoiceQr(e, 190, t.einvoiceQr);
        const [irnRow, ...rest] = einvoiceRows(e, t, ctx.locale);
        return `
<hr>
<p class="b c">${L("einvoice")}</p>
<p class="xs">${esc(irnRow![0])}:</p><p class="irn">${esc(irnRow![1])}</p>
<table>${rest.map(([k, v]) => row(k, v, "small")).join("")}</table>
${e.mock ? `<p class="mockeinv c">${L("einvoiceMock")}</p>` : ""}
${qr ? `<div class="c">${qr}</div>` : ""}`;
      })()
    : "";
  const body = `
<div class="c">
  <h1>${esc(brandName)}</h1>
  ${s.legalName && s.legalName !== brandName ? `<p>${esc(s.legalName)}</p>` : ""}
  ${s.address ? `<p class="small">${escLines(s.address)}</p>` : ""}
  ${s.city || s.pincode ? `<p class="small">${esc([s.city, s.pincode].filter(Boolean).join(" – "))}</p>` : ""}
  ${s.phone ? `<p class="small">${esc(s.phone)}</p>` : ""}
  ${s.gstin ? `<p class="small b">GSTIN: ${esc(s.gstin)}</p>` : ""}
  <p class="b" style="margin-top:3px">${esc(qt ? t.quotation : cn ? t.creditNote : s.taxScheme === "composition" && (!s.compositionFrom || inv.date >= s.compositionFrom) ? t.compositionBill : s.gstin ? t.taxInvoice : t.billOfSupply)}</p>
  ${!qt && s.taxScheme === "composition" && (!s.compositionFrom || inv.date >= s.compositionFrom) ? `<p class="xs c">${esc(t.compositionNote)}</p>` : ""}
</div>
${stampKey ? `<div class="stamp c">${L(stampKey)}</div>` : ""}
<hr>
<table>
  ${row(qt ? t.quotationNo : cn ? t.creditNoteNo : t.number, inv.number ?? t.draft)}
  ${row(t.date, fmtDate(inv.date, ctx.locale))}${qt ? `${qt.rev > 1 ? row(t.revision, String(qt.rev)) : ""}${row(t.validUntil, fmtDate(qt.validUntil, ctx.locale))}` : ""}
  ${cn ? row(t.againstInvoice, cn.invoiceNumber) + row(t.invoiceDate, fmtDate(cn.invoiceDate, ctx.locale)) + row(t.reason, reasonLabel(cn.reason, t)) : ""}
  ${inv.customer.name ? row(t.customer, inv.customer.name) : ""}
  ${inv.customer.gstin ? row("GSTIN", inv.customer.gstin) : ""}
</table>
<hr>
<table>
${inv.lines
  .map(
    (l) => `<tr class="it"><td colspan="2" class="b">${esc(l.description)}</td></tr>${l.serials?.length ? `<tr><td colspan="2" class="small mono">${L("serials")}: ${esc(l.serials.join(", "))}</td></tr>` : ""}
<tr><td class="small">${esc(qty(l.qty))} ${esc(l.unit ?? "")} × ${esc(money(l.rate))}${l.discount ? ` − ${esc(money(l.discount))}` : ""} · ${esc(pct(l.gstRate))}</td><td class="r num">${esc(money(l.total))}</td></tr>`,
  )
  .join("\n")}
</table>
<hr>
<table>
  ${totals.discount > 0 ? row(t.subtotal, money(totals.subtotal)) + row(t.discount, `−${money(totals.discount)}`) : ""}
  ${row(t.taxableValue, money(totals.taxable))}
  ${inv.interState ? row("IGST", money(totals.igst)) : row("CGST", money(totals.cgst)) + row("SGST", money(totals.sgst))}
  ${totals.roundOff !== 0 ? row(t.roundOff, `${totals.roundOff > 0 ? "+" : "−"}${money(Math.abs(totals.roundOff))}`) : ""}
  ${row(t.grandTotal, money(totals.total), "grand")}
  ${!cn && !qt && inv.paid > 0 ? row(t.paid, money(inv.paid)) + row(t.balance, money(inv.balance), "b") : ""}
  ${refund ? row(refund[0], refund[1], "b") : ""}${qt && qt.advancePercent && qt.advanceAmount > 0 ? row(`${t.advanceRequired} (${qt.advancePercent}%)`, money(qt.advanceAmount), "b") : ""}
</table>
<p class="xs" style="margin-top:3px">${esc(inv.amountInWords || amountInWordsINR(totals.total))}</p>${einv}${
  qt && (qt.deliveryText || inv.notes || qt.terms || qt.acceptedBy)
    ? `<hr>${qt.deliveryText ? `<p class="xs"><b>${L("deliveryTime")}:</b> ${esc(qt.deliveryText)}</p>` : ""}${inv.notes ? `<p class="xs">${escLines(inv.notes)}</p>` : ""}${
        qt.terms ? `<p class="xs"><b>${L("terms")}:</b> ${escLines(qt.terms)}</p>` : ""
      }${qt.acceptedBy ? `<p class="xs b">${esc(t.acceptedBy.replace("{name}", qt.acceptedBy).replace("{date}", fmtDate(qt.acceptedAt, ctx.locale)))}</p>` : ""}`
    : ""
}
${
  upi
    ? `<hr><div class="c"><p class="b">${L("scanToPay")} ${esc(money(inv.balance))}</p>${qrSvg(upi, 120, `UPI ${money(inv.balance)}`)}<p class="xs">${esc(s.upiId)}</p></div>`
    : ""
}
<hr>
<p class="c">${qt ? L("quotationNote") : cn ? L("computerGeneratedNote") : L("thankYou")}</p>`;
  return page({ title: `${qt ? t.quotation : cn ? t.creditNote : t.receipt} ${inv.number ?? ""}`.trim(), paper: "80mm", locale: ctx.locale, branding: ctx.branding, css, body });
}
