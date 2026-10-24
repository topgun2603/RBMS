import { esc, escLines, fmtDate, fmtDateTime, money, page, qty, stateLabel } from "../html";
import type { DocLocale, DocSeller, RenderContext } from "../types";

/**
 * A stock transfer note (delivery challan style, no prices charged): goods moved between two of the shop's own locations.
 * Branch-to-branch moves of the same GSTIN are not a supply, so the note carries quantities (and values at cost for the
 * shop's own records) but no tax. Own labels so the shared invoice labels stay untouched.
 */
export interface TransferNoteDocData {
  id?: string;
  /** "TR/26-27/0001". */
  number: string;
  status: "draft" | "in_transit" | "partially_received" | "closed" | "cancelled" | (string & {});
  sentAt: Date | string | null;
  receivedAt: Date | string | null;
  from: { name: string; code?: string | null; address?: string | null };
  to: { name: string; code?: string | null; address?: string | null };
  transport: string | null;
  note: string | null;
  receiveNote: string | null;
  lines: {
    itemName: string;
    unit: string;
    qty: number;
    received: number;
    damaged: number;
    short: number;
    reason: string | null;
    /** Paise per unit at the source. */
    unitCost: number | null;
    batches: { batchNo: string; expiry: string | null; qty: number }[];
  }[];
  shop: DocSeller;
  updatedAt?: Date | string | null;
}

const en = {
  title: "Stock transfer note",
  no: "Transfer no.",
  date: "Sent on",
  from: "From",
  to: "To",
  transport: "Vehicle / carrier",
  item: "Item",
  batch: "Batch",
  expiry: "Exp",
  qty: "Sent",
  received: "Received",
  damaged: "Damaged",
  short: "Short",
  value: "Value at cost",
  total: "Total",
  notes: "Notes",
  receiveNote: "Receiving note",
  sender: "Sent by (signature)",
  receiver: "Received by (signature)",
  statusDraft: "Draft",
  statusInTransit: "In transit",
  statusPartial: "Partly received",
  statusClosed: "Received",
  statusCancelled: "Cancelled",
  footer: "Stock moved between the shop's own locations. Not for sale. No tax is charged on this note.",
  gstin: "GSTIN",
} as const;
type Key = keyof typeof en;
const ta: Record<Key, string> = {
  title: "ஸ்டாக் மாற்று குறிப்பு",
  no: "மாற்று எண்",
  date: "அனுப்பிய தேதி",
  from: "அனுப்புபவர்",
  to: "பெறுபவர்",
  transport: "வாகனம் / கூரியர்",
  item: "பொருள்",
  batch: "பேட்ச்",
  expiry: "காலாவதி",
  qty: "அனுப்பியது",
  received: "பெற்றது",
  damaged: "சேதம்",
  short: "குறைவு",
  value: "விலை மதிப்பு",
  total: "மொத்தம்",
  notes: "குறிப்புகள்",
  receiveNote: "பெறுதல் குறிப்பு",
  sender: "அனுப்பியவர் (கையொப்பம்)",
  receiver: "பெற்றவர் (கையொப்பம்)",
  statusDraft: "வரைவு",
  statusInTransit: "வழியில்",
  statusPartial: "பகுதி பெறப்பட்டது",
  statusClosed: "பெறப்பட்டது",
  statusCancelled: "ரத்து",
  footer: "கடையின் சொந்த இடங்களுக்கிடையே ஸ்டாக் மாற்றம். விற்பனைக்கல்ல. இந்தக் குறிப்புக்கு வரி இல்லை.",
  gstin: "GSTIN",
};
const text = (l: DocLocale): Record<Key, string> => (l === "ta" ? ta : en);

const CSS = `
.head{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #e5e7eb;padding-bottom:10px}
.head h1{font-size:15pt;color:var(--primary);font-weight:700}
.label{font-size:7.5pt;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6b7280}
.cols{display:flex;gap:24px;padding:8px 0;border-bottom:1px solid #e5e7eb}.cols>div{flex:1}
.lines{margin-top:8px;font-size:9pt}
.lines th{background:#f3f4f6;border-bottom:1px solid #e5e7eb;padding:5px 4px;font-size:8pt;color:#4b5563}
.lines td{border-bottom:1px solid #e5e7eb;padding:5px 4px;vertical-align:top}
.lines tfoot td{border-top:1px solid #9ca3af;font-weight:700}
.sign{margin-top:44px;display:flex;justify-content:space-between;gap:24px}.sign div{border-top:1px solid #9ca3af;padding-top:4px;min-width:200px;text-align:center;font-size:8.5pt;color:#4b5563}
.pill{display:inline-block;border:1px solid #d1d5db;border-radius:999px;padding:1px 8px;font-size:8pt}
`;

/** A4 transfer note for the driver and the receiving branch. */
export function renderTransferNote(d: TransferNoteDocData, ctx: RenderContext): string {
  const t = text(ctx.locale);
  const status =
    d.status === "draft" ? t.statusDraft : d.status === "in_transit" ? t.statusInTransit : d.status === "partially_received" ? t.statusPartial : d.status === "cancelled" ? t.statusCancelled : t.statusClosed;
  const shop = d.shop;
  const totalValue = d.lines.reduce((a, l) => a + Math.round(l.qty * (l.unitCost ?? 0)), 0);
  const settled = d.lines.some((l) => l.received > 0 || l.damaged > 0 || l.short > 0);
  const place = (p: TransferNoteDocData["from"]) =>
    `<p class="b" style="font-size:12pt">${esc(p.name)}${p.code ? ` <span class="muted small mono">(${esc(p.code)})</span>` : ""}</p>${p.address ? `<p class="small muted">${escLines(p.address)}</p>` : ""}`;
  const body = `
<header class="head">
  <div><p class="b" style="font-size:13pt">${esc(ctx.branding.appName || shop.legalName || "")}</p>
    ${shop.legalName && shop.legalName !== ctx.branding.appName ? `<p class="small">${esc(shop.legalName)}</p>` : ""}
    ${shop.address ? `<p class="small muted">${escLines(shop.address)}</p>` : ""}
    ${shop.gstin ? `<p class="small b">${esc(t.gstin)}: <span class="mono">${esc(shop.gstin)}</span>${shop.stateCode ? ` · ${esc(stateLabel(shop.stateCode))}` : ""}</p>` : ""}
  </div>
  <div class="r"><h1>${esc(t.title)}</h1>
    <p>${esc(t.no)}: <span class="b mono">${esc(d.number)}</span></p>
    ${d.sentAt ? `<p>${esc(t.date)}: ${esc(fmtDateTime(d.sentAt instanceof Date ? d.sentAt : String(d.sentAt), ctx.locale))}</p>` : ""}
    <p><span class="pill">${esc(status)}</span></p>
  </div>
</header>
<section class="cols">
  <div><p class="label">${esc(t.from)}</p>${place(d.from)}</div>
  <div><p class="label">${esc(t.to)}</p>${place(d.to)}</div>
  ${d.transport ? `<div><p class="label">${esc(t.transport)}</p><p class="b">${esc(d.transport)}</p></div>` : ""}
</section>
<table class="lines">
<thead><tr><th>#</th><th>${esc(t.item)}</th><th>${esc(t.batch)}</th><th class="r">${esc(t.qty)}</th>${
    settled ? `<th class="r">${esc(t.received)}</th><th class="r">${esc(t.damaged)}</th><th class="r">${esc(t.short)}</th>` : ""
  }<th class="r">${esc(t.value)}</th></tr></thead>
<tbody>
${d.lines
  .map((l, i) => {
    const batches = l.batches.map((b) => `<div class="small mono">${esc(b.batchNo)}${b.expiry ? ` · ${esc(t.expiry)} ${esc(fmtDate(b.expiry, ctx.locale))}` : ""} × ${esc(qty(b.qty))}</div>`).join("");
    return `<tr><td class="muted num">${i + 1}</td><td class="b">${esc(l.itemName)}${l.reason ? `<div class="small muted">${esc(l.reason)}</div>` : ""}</td><td>${batches || "—"}</td><td class="r num">${esc(qty(l.qty))} ${esc(l.unit)}</td>${
      settled ? `<td class="r num">${esc(qty(l.received))}</td><td class="r num">${esc(qty(l.damaged))}</td><td class="r num">${esc(qty(l.short))}</td>` : ""
    }<td class="r num">${esc(money(Math.round(l.qty * (l.unitCost ?? 0))))}</td></tr>`;
  })
  .join("\n")}
</tbody>
<tfoot><tr><td colspan="${settled ? 7 : 4}" class="r">${esc(t.total)}</td><td class="r num">${esc(money(totalValue))}</td></tr></tfoot>
</table>
${d.note ? `<div style="margin-top:10px"><p class="label">${esc(t.notes)}</p><p>${escLines(d.note)}</p></div>` : ""}
${d.receiveNote ? `<div style="margin-top:6px"><p class="label">${esc(t.receiveNote)}${d.receivedAt ? ` · ${esc(fmtDateTime(d.receivedAt instanceof Date ? d.receivedAt : String(d.receivedAt), ctx.locale))}` : ""}</p><p>${escLines(d.receiveNote)}</p></div>` : ""}
<p class="small muted" style="margin-top:14px">${esc(t.footer)}</p>
<div class="sign"><div>${esc(t.sender)}</div><div>${esc(t.receiver)}</div></div>`;
  return page({ title: `${t.title} ${d.number}`, paper: "A4", locale: ctx.locale, branding: ctx.branding, css: CSS, body });
}
