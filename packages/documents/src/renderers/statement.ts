import { esc, escLines, fmtDate, money, page, safeImageUrl, stateLabel } from "../html";
import { labels, type LabelKey } from "../labels";
import type { RenderContext, StatementDocData } from "../types";

const CSS = `
.head{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #e5e7eb;padding-bottom:10px}
.brand{display:flex;align-items:center;gap:10px}
.brand img{max-height:44px;max-width:130px;object-fit:contain}
.brand .name{font-size:14pt;font-weight:700}
.title{text-align:right}
.title h1{font-size:14pt;color:var(--primary);font-weight:700}
.party{display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid #e5e7eb}
.label{font-size:7.5pt;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#6b7280}
.box{border:1px solid #e5e7eb;border-radius:6px;padding:6px 10px;text-align:right;min-width:150px}
.box .v{font-size:13pt;font-weight:700;color:var(--primary)}
.ledger{margin-top:10px;font-size:9pt}
.ledger th{background:#f3f4f6;border-bottom:1px solid #e5e7eb;padding:5px 4px;font-size:8pt;color:#4b5563}
.ledger td{border-bottom:1px solid #f3f4f6;padding:4px}
.ledger tr.open td,.ledger tr.close td{background:#f9fafb;font-weight:700}
.cg{margin-top:14px;text-align:center;font-size:7pt;color:#6b7280}
`;

const ENTRY_LABEL: Record<string, LabelKey> = {
  opening: "entryOpening",
  invoice: "entryInvoice",
  payment: "entryPayment",
  receipt: "entryReceipt",
  cancel: "entryCancel",
  credit_note: "entryCreditNote",
  refund: "entryRefund",
};

/** Customer statement of account (credit book ledger), A4. Positive balance = the customer owes the shop. */
export function renderStatement(data: StatementDocData, ctx: RenderContext): string {
  const t = labels(ctx.locale);
  const L = (k: LabelKey) => esc(t[k]);
  const s = data.seller;
  const c = data.customer;
  const { ledger } = data;
  const brandName = ctx.branding.appName || s.legalName || "";
  const logo = safeImageUrl(ctx.branding.logoUrl);
  const d = (v: string | null | undefined) => fmtDate(v, ctx.locale);
  const bal = (n: number) => (n < 0 ? `${money(-n)} Cr` : money(n));
  const generated = data.generatedOn ?? data.to ?? ledger.entries.at(-1)?.date ?? null;
  const entries = ledger.entries.filter((e) => e.type !== "opening");

  const rows = entries
    .map((e) => {
      const kind = ENTRY_LABEL[e.type];
      const desc = [kind ? t[kind] : e.type, e.description && e.description !== (kind ? t[kind] : "") ? e.description : ""].filter(Boolean).join(" – ");
      return `<tr><td class="num">${esc(d(e.date))}</td><td>${esc(desc)}</td><td class="mono small">${esc(e.number ?? "")}</td><td class="r num">${
        e.debit ? esc(money(e.debit)) : ""
      }</td><td class="r num">${e.credit ? esc(money(e.credit)) : ""}</td><td class="r num">${esc(bal(e.balance))}</td></tr>`;
    })
    .join("\n");

  const body = `
<header class="head">
  <div>
    <div class="brand">${logo ? `<img src="${esc(logo)}" alt="">` : ""}<span class="name">${esc(brandName)}</span></div>
    <div class="small muted" style="margin-top:6px">
      ${s.legalName && s.legalName !== brandName ? `<p>${esc(s.legalName)}</p>` : ""}
      ${s.address ? `<p>${escLines(s.address)}</p>` : ""}
      ${s.city || s.pincode ? `<p>${esc([s.city, s.pincode].filter(Boolean).join(" – "))}</p>` : ""}
      ${s.phone || s.email ? `<p>${esc([s.phone, s.email].filter(Boolean).join(" · "))}</p>` : ""}
      ${s.gstin ? `<p class="b">GSTIN: <span class="mono">${esc(s.gstin)}</span></p>` : ""}
    </div>
  </div>
  <div class="title">
    <h1>${L("statement")}</h1>
    ${data.from || data.to ? `<p class="small" style="margin-top:6px">${L("period")}: ${esc(d(data.from))} – ${esc(d(data.to))}</p>` : ""}
    ${generated ? `<p class="small muted">${L("generatedOn")}: ${esc(d(generated))}</p>` : ""}
  </div>
</header>
<section class="party avoid">
  <div>
    <p class="label">${L("customer")}</p>
    <p class="b">${esc(c.name || "—")}</p>
    ${c.address ? `<p class="small muted">${escLines(c.address)}</p>` : ""}
    <p class="small muted">${[c.phone ? esc(c.phone) : "", c.stateCode ? `${L("state")}: ${esc(stateLabel(c.stateCode))}` : ""].filter(Boolean).join(" &nbsp; ")}</p>
    ${c.gstin ? `<p class="small b">GSTIN: <span class="mono">${esc(c.gstin)}</span></p>` : ""}
  </div>
  <div class="box">
    <p class="label">${ledger.closingBalance < 0 ? L("inCredit") : L("balanceDue")}</p>
    <p class="v num">${esc(money(Math.abs(ledger.closingBalance)))}</p>
  </div>
</section>
<table class="ledger">
<thead><tr><th>${L("date")}</th><th>${L("particulars")}</th><th>${L("ref")}</th><th class="r">${L("debit")}</th><th class="r">${L("credit")}</th><th class="r">${L("balance")}</th></tr></thead>
<tbody>
<tr class="open"><td></td><td>${L("openingBalance")}</td><td></td><td></td><td></td><td class="r num">${esc(bal(ledger.openingBalance))}</td></tr>
${rows}
<tr class="close"><td></td><td>${L("closingBalance")}</td><td></td><td class="r num">${esc(money(entries.reduce((a, e) => a + e.debit, 0)))}</td><td class="r num">${esc(
    money(entries.reduce((a, e) => a + e.credit, 0)),
  )}</td><td class="r num">${esc(bal(ledger.closingBalance))}</td></tr>
</tbody>
</table>
<p class="cg">${L("computerGeneratedDoc")}</p>`;

  return page({ title: `${t.statement} – ${c.name}`, paper: "A4", locale: ctx.locale, branding: ctx.branding, css: CSS, body });
}
