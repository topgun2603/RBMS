import { aiMoney } from "@srirealtime/ai";
import { esc, fmtDate, money, page, type DocLocale, type RenderContext } from "@srirealtime/documents";

/**
 * The printable loan readiness summary (A4). Every figure comes from the stored `LoanPackFacts`; the cover note is the one
 * the owner saw (AI-written and number-checked, or the template). No sign-in, name or phone of a customer appears unless the
 * owner unticked the name mask when making the pack.
 */

const { LOAN_DISCLAIMER, LOAN_SECTIONS, monthLabel } = aiMoney;
type CoverNote = aiMoney.CoverNote;
type LoanPackFacts = aiMoney.LoanPackFacts;

export interface LoanPackDoc {
  id: string;
  createdAt: string;
  shopName: string;
  showNames: boolean;
  facts: LoanPackFacts;
  cover: CoverNote & { source: "ai" | "template" };
}

const T = {
  en: {
    title: "Business summary for a loan application",
    prepared: "Prepared on",
    period: "Period",
    note: "Cover note",
    sales: "Sales by month",
    month: "Month",
    sold: "Sales (incl. GST)",
    bills: "Bills",
    gst: "Output GST",
    filed: "GSTR-1 marked filed",
    margin: "Sales less purchases",
    yes: "Yes",
    no: "No",
    totals: "At a glance",
    total12: "Total sales",
    avg: "Average a month",
    growth: "Last 6 months against the 6 before",
    marginAll: "Sales less purchases, before tax (rough guide from bills)",
    best: "Best month",
    lowest: "Lowest month",
    gstTotal: "Output GST in the period",
    filedMonths: "Months GSTR-1 marked as filed",
    customers: "Top customers share of sales",
    names: "Customer",
    share: "Share of sales",
    amount: "Amount",
    top1: "Largest customer",
    top5: "Top 5 customers together",
    receivables: "Receivables (money customers owe)",
    bucket: "Overdue by",
    count: "Bills",
    current: "Not yet due",
    d1: "1 to 30 days",
    d31: "31 to 60 days",
    d61: "61 to 90 days",
    d90: "Over 90 days",
    totalLine: "Total",
    over60: "More than 60 days overdue",
    payables: "Payables (money owed to suppliers)",
    overdue: "of which overdue",
    stock: "Stock value (at cost)",
    balance: "Estimated average daily balance",
    balNote: "Estimated from the cash and bank balance the owner entered and the money in and out of the shop.",
    collections: "Average daily money collected",
    footer: "Made from the shop's own billing records. Nothing has been sent to any lender.",
    unit: "Amounts in rupees.",
  },
  ta: {
    title: "கடன் விண்ணப்பத்துக்கான வணிகச் சுருக்கம்",
    prepared: "தயாரித்த தேதி",
    period: "காலம்",
    note: "முன்னுரைக் குறிப்பு",
    sales: "மாதவாரி விற்பனை",
    month: "மாதம்",
    sold: "விற்பனை (GST உட்பட)",
    bills: "பில்கள்",
    gst: "வெளியீட்டு GST",
    filed: "GSTR-1 தாக்கல் என்று குறிக்கப்பட்டது",
    margin: "விற்பனை − கொள்முதல்",
    yes: "ஆம்",
    no: "இல்லை",
    totals: "ஒரு பார்வையில்",
    total12: "மொத்த விற்பனை",
    avg: "மாதச் சராசரி",
    growth: "கடந்த 6 மாதம் vs அதற்கு முந்தைய 6 மாதம்",
    marginAll: "வரிக்கு முன் விற்பனை − கொள்முதல் (பில்களிலிருந்து தோராய அளவு)",
    best: "சிறந்த மாதம்",
    lowest: "குறைந்த மாதம்",
    gstTotal: "காலத்தில் வெளியீட்டு GST",
    filedMonths: "GSTR-1 தாக்கல் என்று குறித்த மாதங்கள்",
    customers: "முன்னணி வாடிக்கையாளர்களின் விற்பனைப் பங்கு",
    names: "வாடிக்கையாளர்",
    share: "விற்பனைப் பங்கு",
    amount: "தொகை",
    top1: "மிகப் பெரிய வாடிக்கையாளர்",
    top5: "முதல் 5 வாடிக்கையாளர்கள் சேர்த்து",
    receivables: "வர வேண்டிய தொகை (வாடிக்கையாளர்கள் தர வேண்டியது)",
    bucket: "தாமதம்",
    count: "பில்கள்",
    current: "இன்னும் கெடு வரவில்லை",
    d1: "1 முதல் 30 நாள்",
    d31: "31 முதல் 60 நாள்",
    d61: "61 முதல் 90 நாள்",
    d90: "90 நாளுக்கு மேல்",
    totalLine: "மொத்தம்",
    over60: "60 நாளுக்கு மேல் தாமதம்",
    payables: "செலுத்த வேண்டிய தொகை (சப்ளையர்களுக்கு)",
    overdue: "அதில் தாமதமானது",
    stock: "இருப்பு மதிப்பு (கொள்முதல் விலையில்)",
    balance: "மதிப்பிடப்பட்ட சராசரி தினசரி இருப்பு",
    balNote: "உரிமையாளர் உள்ளிட்ட ரொக்கம், வங்கி இருப்பு மற்றும் கடைக்குள் வரும், வெளியே செல்லும் பணத்திலிருந்து மதிப்பிடப்பட்டது.",
    collections: "சராசரி தினசரி வசூல்",
    footer: "கடையின் சொந்த பில்லிங் பதிவுகளிலிருந்து தயாரிக்கப்பட்டது. எந்தக் கடன் வழங்குநருக்கும் எதுவும் அனுப்பப்படவில்லை.",
    unit: "தொகைகள் ரூபாயில்.",
  },
} as const;

const CSS = `
.head{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #e5e7eb;padding-bottom:10px}
.head .shop{font-size:15pt;font-weight:700}
.head h1{font-size:12pt;font-weight:600;color:var(--primary);margin-top:2px}
.meta{font-size:8.5pt;color:#4b5563;text-align:right}
h2{font-size:10pt;font-weight:700;margin:14px 0 5px;color:#111827;border-bottom:1px solid #e5e7eb;padding-bottom:2px}
.note{font-size:9.5pt;line-height:1.5;margin-top:8px;padding:8px 10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px}
.disc{font-size:8.5pt;margin-top:8px;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;color:#374151}
table.t{width:100%;border-collapse:collapse;font-size:8.5pt}
table.t th{background:#f3f4f6;text-align:left;padding:4px;border-bottom:1px solid #e5e7eb;font-size:8pt;color:#4b5563}
table.t td{padding:3px 4px;border-bottom:1px solid #f3f4f6}
.r{text-align:right}.num{font-variant-numeric:tabular-nums}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:3px 18px;font-size:9pt}
.kv div{display:flex;justify-content:space-between;border-bottom:1px dotted #e5e7eb;padding:2px 0}
.foot{margin-top:14px;text-align:center;font-size:7.5pt;color:#6b7280}
.bars{width:100%;height:90px}
`;

const bucketLabel = (k: string, t: (typeof T)["en"] | (typeof T)["ta"]) => (k === "current" ? t.current : k === "1-30" ? t.d1 : k === "31-60" ? t.d31 : k === "61-90" ? t.d61 : t.d90);

function bars(f: LoanPackFacts): string {
  const max = Math.max(1, ...f.months.map((m) => m.sales));
  const w = 520;
  const h = 80;
  const bw = w / f.months.length;
  const rects = f.months
    .map((m, i) => {
      const bh = Math.max(1, (m.sales / max) * (h - 14));
      return `<rect x="${(i * bw + 2).toFixed(1)}" y="${(h - 12 - bh).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${bh.toFixed(1)}" fill="var(--primary)" opacity="0.85"/><text x="${(i * bw + bw / 2).toFixed(1)}" y="${h - 2}" font-size="6" text-anchor="middle" fill="#6b7280">${esc(m.month.slice(5))}</text>`;
    })
    .join("");
  return `<svg class="bars" viewBox="0 0 ${w} ${h}" role="img" aria-label="Sales by month">${rects}</svg>`;
}

export function renderLoanPack(d: LoanPackDoc, ctx: RenderContext): string {
  const locale: DocLocale = ctx.locale;
  const t = T[locale === "ta" ? "ta" : "en"];
  const f = d.facts;
  const lang = locale === "ta" ? "ta" : "en";
  const logo = ctx.branding.logoUrl && /^(https:\/\/|data:image\/)/.test(ctx.branding.logoUrl) ? ctx.branding.logoUrl : null;
  const pct = (n: number | null) => (n === null ? "-" : `${n}%`);
  const note = d.cover[lang];

  const monthRows = f.months
    .map(
      (m) =>
        `<tr><td>${esc(monthLabel(m.month, lang))}</td><td class="r num">${esc(money(m.sales))}</td><td class="r num">${m.bills}</td><td class="r num">${esc(money(m.gstOutput))}</td><td>${m.gstr1Filed ? t.yes : t.no}</td><td class="r num">${esc(pct(m.marginPct))}</td></tr>`,
    )
    .join("");
  const custRows = f.concentration.top.map((c, i) => `<tr><td>${esc(c.label)}</td><td class="r num">${esc(money(c.total))}</td><td class="r num">${c.sharePct}%</td></tr>`).join("");
  const ageRows = f.receivables.buckets.map((b) => `<tr><td>${esc(bucketLabel(b.key, t))}</td><td class="r num">${b.count}</td><td class="r num">${esc(money(b.amount))}</td></tr>`).join("");
  const has = (k: string) => f.sections.includes(k as never);

  const body = `
<header class="head">
  <div>
    <div class="brand" style="display:flex;align-items:center;gap:8px">${logo ? `<img src="${esc(logo)}" alt="" style="max-height:38px;max-width:110px">` : ""}<span class="shop">${esc(d.shopName || ctx.branding.appName || "")}</span></div>
    <h1>${esc(t.title)}</h1>
  </div>
  <div class="meta">${esc(t.prepared)}: ${esc(fmtDate(d.createdAt.slice(0, 10), locale))}<br>${esc(t.period)}: ${esc(monthLabel(f.from, lang))} - ${esc(monthLabel(f.to, lang))}<br>${esc(t.unit)}</div>
</header>

<h2>${esc(t.note)}</h2>
<div class="note">${esc(note)}</div>
<div class="disc">${esc(LOAN_DISCLAIMER[lang])}</div>

<h2>${esc(t.totals)}</h2>
<div class="kv">
  <div><span>${esc(t.total12)}</span><b class="num">${esc(money(f.totals.sales))}</b></div>
  <div><span>${esc(t.avg)}</span><b class="num">${esc(money(f.totals.avgMonthly))}</b></div>
  <div><span>${esc(t.growth)}</span><b class="num">${esc(pct(f.totals.growthPct))}</b></div>
  <div><span>${esc(t.marginAll)}</span><b class="num">${esc(pct(f.totals.marginPct))}</b></div>
  ${f.totals.best ? `<div><span>${esc(t.best)}</span><b>${esc(monthLabel(f.totals.best.month, lang))} · ${esc(money(f.totals.best.sales))}</b></div>` : ""}
  ${f.totals.worst ? `<div><span>${esc(t.lowest)}</span><b>${esc(monthLabel(f.totals.worst.month, lang))} · ${esc(money(f.totals.worst.sales))}</b></div>` : ""}
  <div><span>${esc(t.gstTotal)}</span><b class="num">${esc(money(f.totals.gstOutput))}</b></div>
  <div><span>${esc(t.filedMonths)}</span><b class="num">${f.totals.gstr1FiledMonths} / ${f.months.length}</b></div>
</div>

<h2>${esc(t.sales)}</h2>
${bars(f)}
<table class="t"><thead><tr><th>${esc(t.month)}</th><th class="r">${esc(t.sold)}</th><th class="r">${esc(t.bills)}</th><th class="r">${esc(t.gst)}</th><th>${esc(t.filed)}</th><th class="r">${esc(t.margin)}</th></tr></thead><tbody>${monthRows}</tbody></table>

${
  has("customers") && f.concentration.top.length
    ? `<h2>${esc(t.customers)}</h2>
<div class="kv"><div><span>${esc(t.top1)}</span><b class="num">${f.concentration.top1SharePct}%</b></div><div><span>${esc(t.top5)}</span><b class="num">${f.concentration.top5SharePct}%</b></div></div>
<table class="t" style="margin-top:6px"><thead><tr><th>${esc(t.names)}</th><th class="r">${esc(t.amount)}</th><th class="r">${esc(t.share)}</th></tr></thead><tbody>${custRows}</tbody></table>`
    : ""
}

<h2>${esc(t.receivables)}</h2>
<table class="t"><thead><tr><th>${esc(t.bucket)}</th><th class="r">${esc(t.count)}</th><th class="r">${esc(t.amount)}</th></tr></thead><tbody>${ageRows}<tr><td><b>${esc(t.totalLine)}</b></td><td></td><td class="r num"><b>${esc(money(f.receivables.total))}</b></td></tr></tbody></table>
${f.receivables.over60Pct !== null ? `<div class="kv" style="margin-top:4px"><div><span>${esc(t.over60)}</span><b class="num">${f.receivables.over60Pct}%</b></div></div>` : ""}

<div class="kv" style="margin-top:12px">
  ${f.payables ? `<div><span>${esc(t.payables)}</span><b class="num">${esc(money(f.payables.total))}</b></div><div><span>${esc(t.overdue)}</span><b class="num">${esc(money(f.payables.overdue))}</b></div>` : ""}
  ${f.stockValue !== null ? `<div><span>${esc(t.stock)}</span><b class="num">${esc(money(f.stockValue))}</b></div>` : ""}
  ${f.balance.average !== null ? `<div><span>${esc(t.balance)}</span><b class="num">${esc(money(f.balance.average))}</b></div>` : ""}
  <div><span>${esc(t.collections)}</span><b class="num">${esc(money(f.balance.averageDailyCollections))}</b></div>
</div>
${f.balance.average !== null ? `<p style="font-size:7.5pt;color:#6b7280;margin-top:3px">${esc(t.balNote)}</p>` : ""}

<h2>${esc(LOAN_SECTIONS.length ? (locale === "ta" ? "இந்த சுருக்கத்தில் உள்ளவை" : "What this summary contains") : "")}</h2>
<p style="font-size:8.5pt">${esc(LOAN_SECTIONS.filter((s) => has(s.key)).map((s) => (locale === "ta" ? s.ta : s.en)).join(" · "))}</p>
<div class="foot">${esc(t.footer)}</div>`;

  return page({ title: t.title, paper: "A4", locale, branding: ctx.branding, css: CSS, body });
}
