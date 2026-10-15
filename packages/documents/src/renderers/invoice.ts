import { amountInWordsINR, upiLink } from "@srirealtime/gst";
import { esc, escLines, fmtDate, money, page, pct, qrSvg, qty, safeImageUrl, stateLabel } from "../html";
import { labels } from "../labels";
import type { InvoiceDocData, RenderContext } from "../types";

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
`;

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

/** GST tax invoice on A4: same content as billing-ui's printable InvoiceDocument. */
export function renderInvoice(inv: InvoiceDocData, ctx: RenderContext): string {
  const t = labels(ctx.locale);
  const L = (k: keyof typeof t) => esc(t[k]);
  const seller = inv.seller;
  const buyer = inv.customer;
  const totals = inv.totals;
  const inter = inv.interState;
  const cancelled = inv.status === "cancelled";
  const brandName = ctx.branding.appName || seller.legalName || "";
  const logo = safeImageUrl(ctx.branding.logoUrl);
  const upi = invoiceUpi(inv, brandName, "Invoice");
  const words = inv.amountInWords || amountInWordsINR(totals.total);
  const d = (v: string | null | undefined) => fmtDate(v, ctx.locale);
  const title = seller.gstin ? t.taxInvoice : t.billOfSupply;
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
<td><div class="b">${esc(l.description)}</div>${l.discount ? `<div class="xs muted">${L("discount")}: −${esc(money(l.discount))}</div>` : ""}</td>
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
    inv.paid > 0 ? totRow(t.paid, money(inv.paid)) + `<div class="tot b"><dt>${L("balance")}</dt><dd class="num">${esc(money(inv.balance))}</dd></div>` : "",
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
${cancelled ? `<div class="stamp" aria-hidden="true">${L("cancelled")}</div>` : ""}
<header class="head">
  <div>
    <div class="brand">${logo ? `<img src="${esc(logo)}" alt="">` : ""}<span class="name">${esc(brandName)}</span></div>
    <div class="seller">${sellerLines}</div>
  </div>
  <div class="title">
    <h1>${esc(title)}</h1>
    <dl class="meta">
      <dt>${L("number")}</dt><dd class="num">${esc(inv.number ?? t.draft)}</dd>
      <dt>${L("date")}</dt><dd class="num">${esc(d(inv.date))}</dd>
      ${inv.dueDate ? `<dt>${L("dueDate")}</dt><dd class="num">${esc(d(inv.dueDate))}</dd>` : ""}
      <dt>${L("placeOfSupply")}</dt><dd>${esc(stateLabel(inv.placeOfSupply))}</dd>
    </dl>
  </div>
</header>
<section class="buyer avoid">
  <p class="label">${L("billTo")}</p>
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
    ${bank}
    ${inv.notes ? `<div><p class="label">${L("notes")}</p><p>${escLines(inv.notes)}</p></div>` : ""}
    ${seller.terms ? `<div><p class="label">${L("terms")}</p><p class="muted">${escLines(seller.terms)}</p></div>` : ""}
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
<p class="cg">${L("computerGenerated")}</p>
</article>`;

  return page({ title: `${t.invoice} ${inv.number ?? ""}`.trim(), paper: "A4", locale: ctx.locale, branding: ctx.branding, css: CSS, body });
}

/** 80 mm thermal receipt. */
export function renderInvoiceThermal(inv: InvoiceDocData, ctx: RenderContext): string {
  const t = labels(ctx.locale);
  const L = (k: keyof typeof t) => esc(t[k]);
  const s = inv.seller;
  const totals = inv.totals;
  const cancelled = inv.status === "cancelled";
  const brandName = ctx.branding.appName || s.legalName || "";
  const upi = invoiceUpi(inv, brandName, "Invoice");
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
`;
  const body = `
<div class="c">
  <h1>${esc(brandName)}</h1>
  ${s.legalName && s.legalName !== brandName ? `<p>${esc(s.legalName)}</p>` : ""}
  ${s.address ? `<p class="small">${escLines(s.address)}</p>` : ""}
  ${s.city || s.pincode ? `<p class="small">${esc([s.city, s.pincode].filter(Boolean).join(" – "))}</p>` : ""}
  ${s.phone ? `<p class="small">${esc(s.phone)}</p>` : ""}
  ${s.gstin ? `<p class="small b">GSTIN: ${esc(s.gstin)}</p>` : ""}
  <p class="b" style="margin-top:3px">${esc(s.gstin ? t.taxInvoice : t.billOfSupply)}</p>
</div>
${cancelled ? `<div class="stamp c">${L("cancelled")}</div>` : ""}
<hr>
<table>
  ${row(t.number, inv.number ?? t.draft)}
  ${row(t.date, fmtDate(inv.date, ctx.locale))}
  ${inv.customer.name ? row(t.customer, inv.customer.name) : ""}
  ${inv.customer.gstin ? row("GSTIN", inv.customer.gstin) : ""}
</table>
<hr>
<table>
${inv.lines
  .map(
    (l) => `<tr class="it"><td colspan="2" class="b">${esc(l.description)}</td></tr>
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
  ${inv.paid > 0 ? row(t.paid, money(inv.paid)) + row(t.balance, money(inv.balance), "b") : ""}
</table>
<p class="xs" style="margin-top:3px">${esc(inv.amountInWords || amountInWordsINR(totals.total))}</p>
${
  upi
    ? `<hr><div class="c"><p class="b">${L("scanToPay")} ${esc(money(inv.balance))}</p>${qrSvg(upi, 120, `UPI ${money(inv.balance)}`)}<p class="xs">${esc(s.upiId)}</p></div>`
    : ""
}
<hr>
<p class="c">${L("thankYou")}</p>`;
  return page({ title: `${t.receipt} ${inv.number ?? ""}`.trim(), paper: "80mm", locale: ctx.locale, branding: ctx.branding, css, body });
}
