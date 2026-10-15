import { esc, escLines, fmtDate, money, page, qrSvg, qty, safeImageUrl } from "../html";
import { labels, type LabelKey } from "../labels";
import type { DocAddress, DocSeller, OrderDocData, RenderContext } from "../types";

/** Address block lines, escaped. */
export function addressHtml(a: DocAddress | null | undefined, fallbackName?: string | null): string {
  if (!a) return fallbackName ? `<p class="b">${esc(fallbackName)}</p>` : "";
  const name = a.name || fallbackName;
  const place = [a.city, a.district && a.district !== a.city ? a.district : null].filter(Boolean).join(", ");
  const statePin = [a.state || a.stateCode, a.pincode].filter(Boolean).join(" – ");
  return [
    name ? `<p class="b">${esc(name)}</p>` : "",
    a.line1 ? `<p>${escLines(a.line1)}</p>` : "",
    a.line2 ? `<p>${escLines(a.line2)}</p>` : "",
    a.landmark ? `<p>${esc(a.landmark)}</p>` : "",
    place ? `<p>${esc(place)}</p>` : "",
    statePin ? `<p class="b">${esc(statePin)}</p>` : "",
    a.country && a.country !== "IN" && a.country !== "India" ? `<p>${esc(a.country)}</p>` : "",
    a.phone ? `<p>Ph: ${esc(a.phone)}</p>` : "",
  ].join("");
}

const sellerAddress = (s: DocSeller, brand: string) =>
  [
    `<p class="b">${esc(brand || s.legalName || "")}</p>`,
    s.address ? `<p>${escLines(s.address)}</p>` : "",
    s.city || s.pincode ? `<p>${esc([s.city, s.pincode].filter(Boolean).join(" – "))}</p>` : "",
    s.phone ? `<p>Ph: ${esc(s.phone)}</p>` : "",
  ].join("");

const isCod = (o: OrderDocData) => o.paymentMethod === "cod" && o.paymentStatus !== "paid";

/** A4 packing slip: what goes in the box (no prices except the order total). */
export function renderPackingSlip(o: OrderDocData, ctx: RenderContext): string {
  const t = labels(ctx.locale);
  const L = (k: LabelKey) => esc(t[k]);
  const brand = ctx.branding.appName || o.seller.legalName || "";
  const logo = safeImageUrl(ctx.branding.logoUrl);
  const css = `
.head{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #e5e7eb;padding-bottom:10px}
.head h1{font-size:15pt;color:var(--primary);font-weight:700}
.brand{display:flex;align-items:center;gap:10px}.brand img{max-height:44px;max-width:130px;object-fit:contain}
.cols{display:flex;gap:24px;padding:10px 0;border-bottom:1px solid #e5e7eb}
.cols>div{flex:1}
.label{font-size:7.5pt;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:2px}
.items{margin-top:10px}
.items th{background:#f3f4f6;border-bottom:1px solid #e5e7eb;padding:5px 4px;font-size:8pt;color:#4b5563}
.items td{border-bottom:1px solid #e5e7eb;padding:6px 4px;vertical-align:top}
.tick{display:inline-block;width:12px;height:12px;border:1px solid #6b7280;border-radius:2px}
.note{margin-top:10px;border:1px dashed #d1d5db;border-radius:6px;padding:6px 8px}
`;
  const body = `
<header class="head">
  <div class="brand">${logo ? `<img src="${esc(logo)}" alt="">` : ""}<div><p class="b" style="font-size:13pt">${esc(brand)}</p>${
    o.seller.gstin ? `<p class="small">GSTIN: <span class="mono">${esc(o.seller.gstin)}</span></p>` : ""
  }</div></div>
  <div class="r">
    <h1>${L("packingSlip")}</h1>
    <p>${L("orderNo")}: <span class="b mono">${esc(o.number)}</span></p>
    <p class="small">${L("orderDate")}: ${esc(fmtDate(o.placedAt, ctx.locale))}</p>
  </div>
</header>
<section class="cols avoid">
  <div><p class="label">${L("shipTo")}</p>${addressHtml(o.shippingAddress, o.customer.name)}${
    o.customer.phone && !o.shippingAddress?.phone ? `<p>Ph: ${esc(o.customer.phone)}</p>` : ""
  }</div>
  <div><p class="label">${L("shipFrom")}</p>${sellerAddress(o.seller, brand)}</div>
  <div class="r"><p class="label">${L("payment")}</p><p class="b">${isCod(o) ? `${L("cod")}<br>${L("collect")} ${esc(money(o.total))}` : L("prepaid")}</p>
  ${o.fulfillment?.carrier ? `<p class="small" style="margin-top:4px">${L("carrier")}: ${esc(o.fulfillment.carrier)}</p>` : ""}
  ${o.fulfillment?.trackingNumber ? `<p class="small">${L("tracking")}: <span class="mono">${esc(o.fulfillment.trackingNumber)}</span></p>` : ""}
  </div>
</section>
<table class="items">
<thead><tr><th>#</th><th>${L("item")}</th><th>${L("sku")}</th><th class="r">${L("qty")}</th><th class="c">${L("packed")}</th></tr></thead>
<tbody>
${o.lines
  .map(
    (l, i) =>
      `<tr><td class="muted num">${i + 1}</td><td class="b">${esc(l.name)}</td><td class="mono small">${esc(l.sku ?? "—")}</td><td class="r num b">${esc(qty(l.qty))} ${esc(
        l.unit ?? "",
      )}</td><td class="c"><span class="tick"></span></td></tr>`,
  )
  .join("\n")}
</tbody>
</table>
<p class="r small" style="margin-top:6px">${L("items")}: <span class="b">${esc(qty(o.lines.reduce((a, l) => a + l.qty, 0)))}</span></p>
${o.customerNote ? `<div class="note avoid"><p class="label">${L("customerNote")}</p><p>${escLines(o.customerNote)}</p></div>` : ""}
${o.notes ? `<div class="note avoid"><p class="label">${L("notes")}</p><p>${escLines(o.notes)}</p></div>` : ""}
<p class="c small muted" style="margin-top:16px">${L("thankYou")}</p>`;
  return page({ title: `${t.packingSlip} ${o.number}`, paper: "A4", locale: ctx.locale, branding: ctx.branding, css, body });
}

/** A6 shipping label: big ship-to address, from address, COD amount, QR of the order/tracking number. */
export function renderShippingLabel(o: OrderDocData, ctx: RenderContext): string {
  const t = labels(ctx.locale);
  const L = (k: LabelKey) => esc(t[k]);
  const brand = ctx.branding.appName || o.seller.legalName || "";
  const code = o.fulfillment?.trackingNumber || o.number;
  const css = `
body{font-size:9pt}
.lbl{border:1.5px solid #000;border-radius:4px;height:138mm;display:flex;flex-direction:column}
.sec{padding:6px 8px;border-bottom:1px solid #000}
.sec:last-child{border-bottom:0}
.to{flex:1;font-size:12pt;line-height:1.35}
.to .label,.from .label{font-size:7pt}
.label{font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:2px}
.row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.cod{font-size:14pt;font-weight:700;border:2px solid #000;padding:2px 6px;text-align:center}
.from{font-size:8pt}
`;
  const body = `
<div class="lbl">
  <div class="sec row">
    <div><p class="b" style="font-size:11pt">${esc(brand)}</p><p class="small">${L("orderNo")}: <span class="mono b">${esc(o.number)}</span></p><p class="xs">${esc(
      fmtDate(o.placedAt, ctx.locale),
    )}</p></div>
    ${isCod(o) ? `<div class="cod">COD<br>${esc(money(o.total))}</div>` : `<div class="cod">${L("prepaid")}</div>`}
  </div>
  <div class="sec to"><p class="label">${L("shipTo")}</p>${addressHtml(o.shippingAddress, o.customer.name)}${
    o.customer.phone && !o.shippingAddress?.phone ? `<p>Ph: ${esc(o.customer.phone)}</p>` : ""
  }</div>
  <div class="sec row">
    <div class="small">
      ${o.fulfillment?.carrier ? `<p>${L("carrier")}: <span class="b">${esc(o.fulfillment.carrier)}</span></p>` : ""}
      ${o.fulfillment?.trackingNumber ? `<p>${L("tracking")}: <span class="mono b">${esc(o.fulfillment.trackingNumber)}</span></p>` : ""}
      ${o.weightGrams ? `<p>${L("weight")}: ${esc((o.weightGrams / 1000).toFixed(2))} kg</p>` : ""}
      <p>${L("items")}: ${esc(qty(o.lines.reduce((a, l) => a + l.qty, 0)))}</p>
    </div>
    ${qrSvg(code, 80, code)}
  </div>
  <div class="sec from"><p class="label">${L("shipFrom")}</p>${sellerAddress(o.seller, brand)}</div>
</div>`;
  return page({ title: `Label ${o.number}`, paper: "A6", locale: ctx.locale, branding: ctx.branding, css, body });
}
