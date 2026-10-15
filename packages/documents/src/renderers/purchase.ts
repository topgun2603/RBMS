import { esc, escLines, fmtDate, money, page, pct, qty, stateLabel } from "../html";
import { labels, type LabelKey } from "../labels";
import type { PurchaseDocData, RenderContext } from "../types";

const CSS = `
.head{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #e5e7eb;padding-bottom:10px}
.head h1{font-size:15pt;color:var(--primary);font-weight:700}
.label{font-size:7.5pt;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6b7280}
.cols{display:flex;gap:24px;padding:8px 0;border-bottom:1px solid #e5e7eb}.cols>div{flex:1}
.lines{margin-top:8px;font-size:9pt}
.lines th{background:#f3f4f6;border-bottom:1px solid #e5e7eb;padding:5px 4px;font-size:8pt;color:#4b5563}
.lines td{border-bottom:1px solid #e5e7eb;padding:5px 4px;vertical-align:top}
.tot{width:240px;margin-left:auto;margin-top:8px}
.tot div{display:flex;justify-content:space-between;padding:1.5px 0}
.tot .grand{border-top:1px solid #d1d5db;margin-top:4px;padding-top:4px;font-weight:700;font-size:12pt}
`;

/** Supplier bill as recorded in inventory (for filing / ITC), A4. */
export function renderPurchase(p: PurchaseDocData, ctx: RenderContext): string {
  const t = labels(ctx.locale);
  const L = (k: LabelKey) => esc(t[k]);
  const inter = p.interState;
  const cancelled = p.status === "cancelled";
  const tr = (label: string, value: string, cls = "") => `<div class="${cls}"><span>${esc(label)}</span><span class="num">${esc(value)}</span></div>`;
  const shop = p.shop;
  const body = `
${cancelled ? `<div class="stamp" aria-hidden="true">${L("cancelled")}</div>` : ""}
<header class="head">
  <div><p class="label">${L("supplier")}</p><p class="b" style="font-size:13pt">${esc(p.supplier.name)}</p>
    ${p.supplier.address ? `<p class="small muted">${escLines(p.supplier.address)}</p>` : ""}
    ${p.supplier.phone ? `<p class="small muted">${esc(p.supplier.phone)}</p>` : ""}
    ${p.supplier.gstin ? `<p class="small b">GSTIN: <span class="mono">${esc(p.supplier.gstin)}</span></p>` : ""}
    ${p.supplier.stateCode ? `<p class="small muted">${L("state")}: ${esc(stateLabel(p.supplier.stateCode))}</p>` : ""}
  </div>
  <div class="r"><h1>${L("purchase")}</h1>
    <p>${L("billNo")}: <span class="b mono">${esc(p.billNumber)}</span></p>
    <p>${L("date")}: ${esc(fmtDate(p.date, ctx.locale))}</p>
    <p class="small">${L("placeOfSupply")}: ${esc(stateLabel(p.placeOfSupply))}</p>
    <p class="small b">${p.paid ? L("paid") : L("unpaid")}</p>
  </div>
</header>
<section class="cols">
  <div><p class="label">${L("boughtBy")}</p><p class="b">${esc(ctx.branding.appName || shop.legalName || "")}</p>
    ${shop.legalName && shop.legalName !== ctx.branding.appName ? `<p class="small">${esc(shop.legalName)}</p>` : ""}
    ${shop.address ? `<p class="small muted">${escLines(shop.address)}</p>` : ""}
    ${shop.gstin ? `<p class="small b">GSTIN: <span class="mono">${esc(shop.gstin)}</span></p>` : ""}
  </div>
</section>
<table class="lines">
<thead><tr><th>#</th><th>${L("item")}</th><th>${L("hsn")}</th><th class="r">${L("qty")}</th><th class="r">${L("rate")}</th><th class="r">${L("taxable")}</th><th class="r">${L("gst")}</th>${
    inter ? `<th class="r">IGST</th>` : `<th class="r">CGST</th><th class="r">SGST</th>`
  }<th class="r">${L("amount")}</th></tr></thead>
<tbody>
${p.lines
  .map(
    (l, i) =>
      `<tr><td class="muted num">${i + 1}</td><td class="b">${esc(l.description)}</td><td class="mono small">${esc(l.hsn || "—")}</td><td class="r num">${esc(qty(l.qty))} ${esc(
        l.unit ?? "",
      )}</td><td class="r num">${esc(money(l.rate))}</td><td class="r num">${esc(money(l.taxable))}</td><td class="r num">${esc(pct(l.gstRate))}</td>${
        inter ? `<td class="r num">${esc(money(l.igst))}</td>` : `<td class="r num">${esc(money(l.cgst))}</td><td class="r num">${esc(money(l.sgst))}</td>`
      }<td class="r num b">${esc(money(l.total))}</td></tr>`,
  )
  .join("\n")}
</tbody>
</table>
<div class="tot avoid">
  ${tr(t.taxableValue, money(p.totals.taxable))}
  ${inter ? tr("IGST", money(p.totals.igst)) : tr("CGST", money(p.totals.cgst)) + tr("SGST", money(p.totals.sgst))}
  ${tr(t.itc, money(p.totals.cgst + p.totals.sgst + p.totals.igst))}
  ${p.totals.roundOff !== 0 ? tr(t.roundOff, `${p.totals.roundOff > 0 ? "+" : "−"}${money(Math.abs(p.totals.roundOff))}`) : ""}
  ${tr(t.grandTotal, money(p.total), "grand")}
</div>
${p.notes ? `<div style="margin-top:10px"><p class="label">${L("notes")}</p><p>${escLines(p.notes)}</p></div>` : ""}`;
  return page({ title: `${t.purchase} ${p.billNumber}`, paper: "A4", locale: ctx.locale, branding: ctx.branding, css: CSS, body });
}
