import { esc, fmtDate, fmtDateTime, money, page } from "../html";
import { labels, type LabelKey, type Labels } from "../labels";
import type { Paper, RenderContext, TillDocData } from "../types";

const METHOD: Record<string, LabelKey> = {
  cash: "methodCash",
  upi: "methodUpi",
  card: "methodCard",
  bank: "methodBank",
  cheque: "methodCheque",
  other: "methodOther",
};
const CATEGORY: Record<string, LabelKey> = {
  petty_expense: "catPettyExpense",
  owner_drawing: "catOwnerDrawing",
  change_float: "catChangeFloat",
  other: "catOther",
};
const methodLabel = (m: string, t: Labels) => (METHOD[m] ? t[METHOD[m]!] : m);
const categoryLabel = (c: string | undefined, t: Labels) => t[CATEGORY[c ?? "other"] ?? "catOther"];
const signed = (paise: number) => `${paise > 0 ? "+" : paise < 0 ? "−" : ""}${money(Math.abs(paise))}`;

/** Paper-specific page rules: 58 / 80 mm rolls are narrow single columns, A4 is a normal page. */
const PAPER_CSS: Partial<Record<Paper, string>> = {
  "80mm": "body{font-size:8.5pt;line-height:1.3;width:74mm}.c h1{font-size:11pt;font-weight:700}",
  "58mm": "body{font-size:7.5pt;line-height:1.25;width:54mm}.c h1{font-size:10pt;font-weight:700}",
  A4: "body{font-size:10pt;line-height:1.4;max-width:170mm;margin:0 auto}.c h1{font-size:16pt;font-weight:700}",
};

/**
 * The X report (an open session: running totals, nothing reset) or the Z report (a closed one, numbered Z1, Z2 ... per
 * register) of a POS till: sales, returns, discounts, voids, tax by GST rate, bill number range, takings by payment
 * mode, pay-in / pay-out by category, drawer handovers, cash expected against counted with the difference, its reason
 * and the manager who approved it. 58 mm and 80 mm rolls, or A4.
 */
export function renderTillReport(s: TillDocData, ctx: RenderContext, paper: Paper = "80mm"): string {
  const t = labels(ctx.locale);
  const L = (k: LabelKey) => esc(t[k]);
  const r = s.report;
  const closed = s.status === "closed";
  const brand = ctx.branding.appName || s.seller.legalName || "";
  const row = (label: string, value: string, cls = "") => `<tr class="${cls}"><td>${esc(label)}</td><td class="r num">${esc(value)}</td></tr>`;
  const css = `
${PAPER_CSS[paper] ?? PAPER_CSS["80mm"]}
h2{font-size:1.05em;font-weight:700;margin-top:4px}
hr{border:0;border-top:1px dashed #000;margin:4px 0}
td{padding:1px 0;vertical-align:top}
.grand td{font-size:1.2em;font-weight:700;border-top:1px solid #000;padding-top:3px}
.sign{margin-top:22px}.sign td{border-top:1px solid #000;padding-top:2px;width:48%}
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
  const title = closed ? `${t.zReport}${s.zNumber ? ` · Z${s.zNumber}` : ""}` : t.xReport;
  const returnsTotal = r.creditNotes.total;
  const range = r.billRange?.from ? (r.billRange.to && r.billRange.to !== r.billRange.from ? `${r.billRange.from} – ${r.billRange.to}` : r.billRange.from) : "";
  const taxRows = (rows: NonNullable<typeof r.taxByRate>) =>
    rows
      .map((x) => {
        const tax = x.cgst + x.sgst + x.igst;
        return row(`GST ${x.gstRate}% · ${money(x.taxable)}`, money(tax), "small");
      })
      .join("");
  const cats = (r.cashByCategory ?? [])
    .map((c) => row(`${categoryLabel(c.category, t)} · ${c.count}`, `${c.cashIn ? `+${money(c.cashIn)}` : ""}${c.cashIn && c.cashOut ? " " : ""}${c.cashOut ? `−${money(c.cashOut)}` : ""}`))
    .join("");
  const handovers = (s.handovers ?? [])
    .map(
      (h) =>
        row(`${fmtDateTime(h.at, ctx.locale).split(", ").pop() ?? ""} ${h.fromName ?? "?"} → ${h.toName}`, signed(h.difference), "small") +
        `<tr class="small"><td colspan="2" class="muted">${esc(t.countedCash)} ${esc(money(h.counted))} / ${esc(t.expectedCash)} ${esc(money(h.expected))}${h.note ? ` · ${esc(h.note)}` : ""}${h.approvedByName ? ` · ${esc(t.approvedBy)} ${esc(h.approvedByName)}` : ""}</td></tr>`,
    )
    .join("");
  const body = `
<div class="c">
  <h1>${esc(brand)}</h1>
  ${s.seller.gstin ? `<p class="small">GSTIN: ${esc(s.seller.gstin)}</p>` : ""}
  <p class="b" style="margin-top:3px">${esc(title)}</p>
</div>
<hr>
<table>
  ${row(t.register, s.register + (s.branchName ? ` · ${s.branchName}` : ""))}
  ${closed && s.zNumber ? row(t.zNo, `Z${s.zNumber}`, "b") : ""}
  ${row(t.date, fmtDate(s.date, ctx.locale))}
  ${row(t.opened, `${fmtDateTime(s.openedAt, ctx.locale)}${s.openedByName ? ` ${t.by} ${s.openedByName}` : ""}`)}
  ${s.closedAt ? row(t.closed, `${fmtDateTime(s.closedAt, ctx.locale)}${s.closedByName ? ` ${t.by} ${s.closedByName}` : ""}`) : row(t.cashier, s.cashierName ?? s.openedByName ?? "—")}
  ${range ? row(t.billRange, range) : ""}
</table>
<hr>
<h2>${L("sales")}</h2>
<table>
  ${row(t.bills, `${r.bills.count} · ${money(r.bills.total)}`)}
  ${r.discounts && r.discounts.total ? row(`${t.discountsGiven} · ${r.discounts.bills}`, `−${money(r.discounts.total)}`) : ""}
  ${r.creditNotes.count ? row(t.creditNotes, `${r.creditNotes.count} · −${money(returnsTotal)}`) : ""}
  ${r.voids && r.voids.count ? row(`${t.voidBills} · ${r.voids.count}`, money(r.voids.total)) : r.bills.cancelled ? row(t.cancelledBills, String(r.bills.cancelled)) : ""}
  ${r.creditNotes.count ? row(t.netSales, money(r.bills.total - returnsTotal), "b") : ""}
  ${r.onCredit ? row(t.onCredit, money(r.onCredit)) : ""}
</table>
${
  r.taxByRate?.length
    ? `<hr><h2>${L("taxByRate")}</h2><table>${taxRows(r.taxByRate)}</table>${
        r.returnsTaxByRate?.length ? `<p class="small muted" style="margin-top:2px">${L("returnsTax")}</p><table>${taxRows(r.returnsTaxByRate)}</table>` : ""
      }`
    : ""
}
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
  ${r.cash.handoverAdjust ? row(t.handoverAdjust, signed(r.cash.handoverAdjust)) : ""}
  ${row(t.expectedCash, money(s.expectedCash ?? r.cash.expected), "grand")}
  ${s.countedCash !== null ? row(t.countedCash, money(s.countedCash), "b") : ""}
  ${s.countedCash !== null ? row(diff === 0 ? t.difference : diff > 0 ? t.extra : t.short, signed(diff), "b") : ""}
</table>
${s.differenceReason ? `<p class="small">${L("reason")}: ${esc(s.differenceReason)}</p>` : ""}
${s.closeApprovedByName ? `<p class="small">${L("approvedBy")}: ${esc(s.closeApprovedByName)}</p>` : ""}
${counted ? `<hr><h2>${L("count")}</h2><table>${counted}</table>` : ""}
${cats ? `<hr><h2>${L("cashCategories")}</h2><table>${cats}</table>` : ""}
${
  s.cashEntries.length
    ? `<hr><h2>${L("cashMoves")}</h2><table>${s.cashEntries
        .map((e) => row(`${fmtDateTime(e.at, ctx.locale).split(", ").pop() ?? ""} ${categoryLabel(e.category, t)}${e.reason ? `: ${e.reason}` : ""}`, signed(e.amount), "small"))
        .join("")}</table>`
    : ""
}
${handovers ? `<hr><h2>${L("handovers")}</h2><table>${handovers}</table>` : ""}
${s.note ? `<hr><p class="small">${L("notes")}: ${esc(s.note)}</p>` : ""}
${closed ? `<table class="sign"><tr><td class="c small">${L("cashierSign")}</td><td style="border:0"></td><td class="c small">${L("managerSign")}</td></tr></table>` : ""}
<hr>
<p class="c xs">${closed ? L("zFinal") : L("xFinal")}</p>
<p class="c xs">${L("computerGeneratedDoc")}</p>`;
  return page({ title: `${title} ${s.register}`, paper, locale: ctx.locale, branding: ctx.branding, css, body });
}
