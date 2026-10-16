import { esc, fmtDate, fmtDateTime, money, page } from "../html";
import { labels, type LabelKey, type Labels } from "../labels";
import type { RenderContext, TillDocData } from "../types";

const METHOD: Record<string, LabelKey> = {
  cash: "methodCash",
  upi: "methodUpi",
  card: "methodCard",
  bank: "methodBank",
  cheque: "methodCheque",
  other: "methodOther",
};
const methodLabel = (m: string, t: Labels) => (METHOD[m] ? t[METHOD[m]!] : m);
const signed = (paise: number) => `${paise > 0 ? "+" : paise < 0 ? "−" : ""}${money(Math.abs(paise))}`;

/** The Z report (day close) of a POS till session on 80 mm paper; an open session prints as an X report. */
export function renderTillReport(s: TillDocData, ctx: RenderContext): string {
  const t = labels(ctx.locale);
  const L = (k: LabelKey) => esc(t[k]);
  const r = s.report;
  const closed = s.status === "closed";
  const brand = ctx.branding.appName || s.seller.legalName || "";
  const row = (label: string, value: string, cls = "") => `<tr class="${cls}"><td>${esc(label)}</td><td class="r num">${esc(value)}</td></tr>`;
  const css = `
body{font-size:8.5pt;line-height:1.3;width:74mm}
.c h1{font-size:11pt;font-weight:700}
h2{font-size:9pt;font-weight:700;margin-top:4px}
hr{border:0;border-top:1px dashed #000;margin:4px 0}
td{padding:1px 0;vertical-align:top}
.grand td{font-size:10.5pt;font-weight:700;border-top:1px solid #000;padding-top:3px}
`;
  const counted = s.closingCount
    ? Object.entries(s.closingCount)
        .map(([d, n]) => [Number(d), n] as const)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[0] - a[0])
        .map(([d, n]) => row(`₹${d} × ${n}`, money(d * 100 * n), "small"))
        .join("")
    : "";
  const diff = s.difference ?? 0;
  const body = `
<div class="c">
  <h1>${esc(brand)}</h1>
  ${s.seller.gstin ? `<p class="small">GSTIN: ${esc(s.seller.gstin)}</p>` : ""}
  <p class="b" style="margin-top:3px">${closed ? L("zReport") : L("xReport")}</p>
</div>
<hr>
<table>
  ${row(t.register, s.register + (s.branchName ? ` · ${s.branchName}` : ""))}
  ${row(t.date, fmtDate(s.date, ctx.locale))}
  ${row(t.opened, `${fmtDateTime(s.openedAt, ctx.locale)}${s.openedByName ? ` ${t.by} ${s.openedByName}` : ""}`)}
  ${s.closedAt ? row(t.closed, `${fmtDateTime(s.closedAt, ctx.locale)}${s.closedByName ? ` ${t.by} ${s.closedByName}` : ""}`) : ""}
</table>
<hr>
<h2>${L("sales")}</h2>
<table>
  ${row(t.bills, `${r.bills.count} · ${money(r.bills.total)}`)}
  ${r.bills.cancelled ? row(t.cancelledBills, String(r.bills.cancelled)) : ""}
  ${r.creditNotes.count ? row(t.creditNotes, `${r.creditNotes.count} · −${money(r.creditNotes.total)}`) : ""}
  ${r.onCredit ? row(t.onCredit, money(r.onCredit)) : ""}
</table>
<hr>
<h2>${L("received")}</h2>
<table>
  ${r.payments.map((p) => row(`${methodLabel(p.method, t)} · ${p.count}`, money(p.amount))).join("") || row("—", money(0))}
  ${row(t.grandTotal, money(r.collected), "b")}
</table>
${
  r.refunds.length
    ? `<hr><h2>${L("refunds")}</h2><table>${r.refunds.map((p) => row(`${methodLabel(p.method, t)} · ${p.count}`, `−${money(p.amount)}`)).join("")}</table>`
    : ""
}
<hr>
<h2>${L("methodCash")}</h2>
<table>
  ${row(t.openingCash, money(r.cash.opening))}
  ${row(t.cashSales, `+${money(r.cash.sales)}`)}
  ${r.cash.refunds ? row(t.cashRefunds, `−${money(r.cash.refunds)}`) : ""}
  ${r.cash.cashIn ? row(t.cashIn, `+${money(r.cash.cashIn)}`) : ""}
  ${r.cash.cashOut ? row(t.cashOut, `−${money(r.cash.cashOut)}`) : ""}
  ${row(t.expectedCash, money(s.expectedCash ?? r.cash.expected), "grand")}
  ${s.countedCash !== null ? row(t.countedCash, money(s.countedCash), "b") : ""}
  ${s.countedCash !== null ? row(diff === 0 ? t.difference : diff > 0 ? t.extra : t.short, signed(diff), "b") : ""}
</table>
${counted ? `<hr><h2>${L("count")}</h2><table>${counted}</table>` : ""}
${
  s.cashEntries.length
    ? `<hr><h2>${L("cashMoves")}</h2><table>${s.cashEntries
        .map((e) => row(`${fmtDateTime(e.at, ctx.locale).split(", ").pop() ?? ""} ${e.reason || (e.amount > 0 ? t.cashIn : t.cashOut)}`, signed(e.amount), "small"))
        .join("")}</table>`
    : ""
}
${s.note ? `<hr><p class="small">${L("notes")}: ${esc(s.note)}</p>` : ""}
<hr>
<p class="c xs">${L("computerGeneratedDoc")}</p>`;
  return page({ title: `${closed ? t.zReport : t.xReport} ${s.register}`, paper: "80mm", locale: ctx.locale, branding: ctx.branding, css, body });
}
