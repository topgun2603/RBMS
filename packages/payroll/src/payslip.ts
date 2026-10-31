import { formatINR } from "@rbms/gst";
import type { Money, PayMethod } from "./logic";
import type { PayrollRunLine } from "./schema";

/** What a payslip prints: the final payroll line, its month, the payment and the shop. */
export interface PayslipDoc {
  line: Pick<PayrollRunLine, "id" | "employeeId" | "snapshot" | "days" | "basisDays" | "paidDays" | "earnings" | "deductions" | "employer" | "gross" | "totalDeductions" | "roundOff" | "net" | "updatedAt">;
  run: { month: string; periodFrom: string; periodTo: string; finalizedAt: Date | string | null };
  payment: { date: string; method: PayMethod; reference: string | null } | null;
  shop: { name: string; address: string | null };
}

type Locale = "en" | "ta";

const L = {
  en: {
    title: "Payslip",
    for: "Salary for",
    code: "Staff code",
    designation: "Designation",
    joined: "Joined",
    payType: "Pay",
    monthly: "Monthly salary",
    daily: "Daily wage",
    hourly: "Hourly",
    uan: "UAN",
    esi: "ESI number",
    pan: "PAN",
    bank: "Bank account",
    days: "Days",
    periodDays: "Days in month",
    workingDays: "Working days",
    present: "Present",
    halfDays: "Half days",
    paidLeave: "Paid leave",
    lop: "Loss of pay",
    paidDays: "Paid days",
    overtime: "Overtime (hours)",
    earnings: "Earnings",
    deductions: "Deductions",
    amount: "Amount",
    gross: "Gross earnings",
    totalDeductions: "Total deductions",
    roundOff: "Rounded off",
    net: "Net pay",
    employer: "Paid by the employer on top (not deducted)",
    paid: "Paid on",
    notPaid: "Not paid yet",
    via: { cash: "cash", bank: "bank transfer", upi: "UPI" },
    footer: "This is a computer-generated payslip.",
  },
  ta: {
    title: "சம்பளச் சீட்டு",
    for: "சம்பள மாதம்",
    code: "பணியாளர் குறியீடு",
    designation: "பதவி",
    joined: "சேர்ந்த தேதி",
    payType: "சம்பள வகை",
    monthly: "மாதச் சம்பளம்",
    daily: "தினக் கூலி",
    hourly: "மணி நேரக் கூலி",
    uan: "UAN",
    esi: "ESI எண்",
    pan: "PAN",
    bank: "வங்கிக் கணக்கு",
    days: "நாட்கள்",
    periodDays: "மாதத்தின் நாட்கள்",
    workingDays: "வேலை நாட்கள்",
    present: "வருகை",
    halfDays: "அரை நாட்கள்",
    paidLeave: "ஊதியத்துடன் விடுப்பு",
    lop: "சம்பள இழப்பு நாட்கள்",
    paidDays: "சம்பள நாட்கள்",
    overtime: "கூடுதல் நேரம் (மணி)",
    earnings: "வருமானம்",
    deductions: "பிடித்தங்கள்",
    amount: "தொகை",
    gross: "மொத்த வருமானம்",
    totalDeductions: "மொத்தப் பிடித்தம்",
    roundOff: "முழுமையாக்கல்",
    net: "கையில் கிடைக்கும் சம்பளம்",
    employer: "முதலாளி கூடுதலாகச் செலுத்துவது (பிடிக்கப்படவில்லை)",
    paid: "செலுத்திய தேதி",
    notPaid: "இன்னும் செலுத்தவில்லை",
    via: { cash: "ரொக்கம்", bank: "வங்கிப் பரிமாற்றம்", upi: "UPI" },
    footer: "இது கணினி மூலம் உருவாக்கப்பட்ட சம்பளச் சீட்டு.",
  },
} as const;

/** Tamil names of the standard earning / deduction heads (labels typed by the owner print as typed). */
const HEAD_TA: Record<string, string> = {
  basic: "அடிப்படைச் சம்பளம்",
  da: "அகவிலைப்படி",
  hra: "வீட்டு வாடகைப்படி",
  wages: "கூலி",
  extra_days: "விடுமுறை நாள் வேலை",
  overtime: "கூடுதல் நேரம்",
  pf: "வருங்கால வைப்பு நிதி (PF)",
  esi: "ESI",
  pt: "தொழில் வரி",
  tds: "சம்பளத்தில் TDS",
};

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const rs = (p: number) => esc(formatINR(p));

function headLabel(m: Money, locale: Locale): string {
  if (locale !== "ta") return m.label;
  if (m.key.startsWith("advance:")) return "முன்பணம் பிடித்தம்";
  return HEAD_TA[m.key] ?? m.label;
}

function monthLabel(month: string, locale: Locale): string {
  const d = new Date(`${month}-15T12:00:00+05:30`);
  return new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(d);
}

function dateLabel(date: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(`${date}T12:00:00+05:30`));
}

export const PAYSLIP_CSS = `
.slip h1{font-size:15pt;font-weight:700;color:var(--primary);margin:0}
.slip .shop{font-size:11pt;font-weight:600}
.slip .muted{color:#4b5563;font-size:9pt}
.slip .head{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid var(--primary);padding-bottom:8px}
.slip .grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-top:10px;font-size:9.5pt}
.slip .grid div span{color:#6b7280;margin-right:6px}
.slip table{width:100%;border-collapse:collapse;font-size:9.5pt}
.slip th{background:#f3f4f6;text-align:left;padding:5px 6px;font-size:8.5pt;color:#374151}
.slip td{padding:4px 6px;border-bottom:1px solid #f3f4f6}
.slip .r{text-align:right;font-variant-numeric:tabular-nums}
.slip .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px}
.slip tr.total td{border-top:1px solid #9ca3af;font-weight:700}
.slip .days{margin-top:12px}
.slip .days td{width:16.6%}
.slip .net{margin-top:14px;padding:10px 12px;border:1px solid var(--primary);border-radius:6px;display:flex;justify-content:space-between;font-size:13pt;font-weight:700}
.slip .foot{margin-top:18px;font-size:8pt;color:#6b7280}
`;

/** The payslip body; the host wraps it with the documents module's page() (fonts, branding). */
export function payslipBodyHtml(d: PayslipDoc, locale: Locale = "en"): string {
  const t = L[locale];
  const s = d.line.snapshot;
  const days = d.line.days;
  const pay = s.payType === "daily" ? t.daily : s.payType === "hourly" ? t.hourly : t.monthly;
  const rows = (items: readonly Money[]) => items.map((m) => `<tr><td>${esc(headLabel(m, locale))}</td><td class="r">${rs(m.amount)}</td></tr>`).join("");
  const info = [
    [t.code, s.code],
    [t.designation, s.designation],
    [t.joined, s.joinDate ? dateLabel(s.joinDate, locale) : null],
    [t.payType, pay],
    [t.uan, s.uan],
    [t.esi, s.esiNumber],
    [t.pan, s.pan],
    [t.bank, s.accountNumber ? `${s.bankName ?? ""} XXXX${s.accountNumber.slice(-4)}`.trim() : null],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><span>${esc(k)}</span>${esc(v)}</div>`)
    .join("");
  const dayCells = [
    [t.periodDays, days.periodDays],
    [t.workingDays, days.workingDays],
    [t.present, days.present],
    [t.halfDays, days.halfDays],
    [t.paidLeave, days.paidLeave],
    [t.lop, days.lopDays],
    [t.paidDays, d.line.paidDays],
    [t.overtime, Math.round((days.overtimeMinutes / 60) * 10) / 10],
  ];
  const paid = d.payment ? `${t.paid}: ${dateLabel(d.payment.date, locale)} (${t.via[d.payment.method]}${d.payment.reference ? `, ${esc(d.payment.reference)}` : ""})` : t.notPaid;
  const employer = d.line.employer.length
    ? `<p class="muted" style="margin-top:10px">${esc(t.employer)}: ${d.line.employer.map((m) => `${esc(headLabel(m, locale))} ${rs(m.amount)}`).join(" · ")}</p>`
    : "";
  return `<section class="slip">
<div class="head"><div><div class="shop">${esc(d.shop.name)}</div>${d.shop.address ? `<div class="muted">${esc(d.shop.address)}</div>` : ""}</div>
<div style="text-align:right"><h1>${esc(t.title)}</h1><div class="muted">${esc(t.for)}: ${esc(monthLabel(d.run.month, locale))}</div></div></div>
<div style="margin-top:10px;font-size:12pt;font-weight:600">${esc(s.name)}</div>
<div class="grid">${info}</div>
<table class="days"><thead><tr><th colspan="8">${esc(t.days)}</th></tr></thead><tbody><tr>${dayCells.map(([k]) => `<td class="muted">${esc(k)}</td>`).join("")}</tr><tr>${dayCells.map(([, v]) => `<td>${esc(v)}</td>`).join("")}</tr></tbody></table>
<div class="cols">
<table><thead><tr><th>${esc(t.earnings)}</th><th class="r">${esc(t.amount)}</th></tr></thead><tbody>${rows(d.line.earnings)}<tr class="total"><td>${esc(t.gross)}</td><td class="r">${rs(d.line.gross)}</td></tr></tbody></table>
<table><thead><tr><th>${esc(t.deductions)}</th><th class="r">${esc(t.amount)}</th></tr></thead><tbody>${rows(d.line.deductions)}${d.line.roundOff ? `<tr><td>${esc(t.roundOff)}</td><td class="r">${rs(-d.line.roundOff)}</td></tr>` : ""}<tr class="total"><td>${esc(t.totalDeductions)}</td><td class="r">${rs(d.line.totalDeductions - d.line.roundOff)}</td></tr></tbody></table>
</div>
<div class="net"><span>${esc(t.net)}</span><span>${rs(d.line.net)}</span></div>
<p class="muted" style="margin-top:6px">${paid}</p>
${employer}
<p class="foot">${esc(t.footer)}</p>
</section>`;
}

/** "payslip-EMP-001-2026-10.pdf" */
export const payslipFilename = (d: Pick<PayslipDoc, "line" | "run">) => `payslip-${d.line.snapshot.code}-${d.run.month}.pdf`.replace(/[^A-Za-z0-9._-]/g, "_");
