import type { Lang } from "./risk";
import { z } from "zod";
import type { AiRunner } from "../assist/hsn";
import { DATA_RULES, dataBlock, filterClaims } from "../assist/safety";
import { allowedNumbers, checkNumbers, rupees } from "../insights/numbers";
import { r0, r1 } from "./dates";

/**
 * Loan readiness pack: a summary of the shop's own records for a bank or NBFC working-capital application. Every figure is
 * computed in code from reports the shop already has; the light tier writes a neutral cover note around them. Nothing is
 * sent to a lender by the product. Money is paise.
 */

export const LOAN_FEATURE = "loan-pack";


/** What the pack contains. The consent screen lists exactly these, and nothing else is put in the pack. */
export const LOAN_SECTIONS = [
  { key: "sales", en: "Sales by month", ta: "மாதவாரி விற்பனை", descEn: "Total billed each month for the last 12 months (net of credit notes) and the number of bills.", descTa: "கடந்த 12 மாதமும் ஒவ்வொரு மாதமும் பில் செய்த மொத்தம் (கிரெடிட் நோட்டுக்குப் பின்) மற்றும் பில்களின் எண்ணிக்கை." },
  { key: "gst", en: "GST summary by month", ta: "மாதவாரி GST சுருக்கம்", descEn: "Output tax per month from your GST report, and which months you marked GSTR-1 as filed. Download history is not recorded, so it is not shown.", descTa: "உங்கள் GST அறிக்கையின்படி மாதவாரி வெளியீட்டு வரி, எந்த மாதங்களுக்கு GSTR-1 தாக்கல் என்று குறித்தீர்கள் என்பது. பதிவிறக்க வரலாறு பதிவாவதில்லை, எனவே காட்டப்படாது." },
  { key: "margin", en: "Gross margin trend", ta: "மொத்த லாப விகித போக்கு", descEn: "Sales less purchases before tax, as a percentage of sales, by month. It is a rough guide from bills, not audited accounts.", descTa: "வரிக்கு முன் விற்பனையிலிருந்து கொள்முதலைக் கழித்து, விற்பனையின் சதவீதமாக மாதவாரி. பில்களிலிருந்து கணக்கிட்ட தோராய அளவு; தணிக்கை செய்யப்பட்ட கணக்கு அல்ல." },
  { key: "customers", en: "Top customers share", ta: "முன்னணி வாடிக்கையாளர் பங்கு", descEn: "How much of 12 months of sales came from your top 5 customers, as percentages. Names are hidden (Customer 1, 2...) unless you tick the box.", descTa: "12 மாத விற்பனையில் முதல் 5 வாடிக்கையாளர்களின் பங்கு சதவீதமாக. நீங்கள் தேர்வு செய்யாவிட்டால் பெயர்கள் மறைக்கப்படும் (வாடிக்கையாளர் 1, 2...)." },
  { key: "receivables", en: "Receivables ageing", ta: "வர வேண்டிய தொகை வயது", descEn: "Total money customers owe you, by how overdue it is. No customer names or phone numbers.", descTa: "வாடிக்கையாளர்கள் தர வேண்டிய மொத்தத் தொகை, எவ்வளவு தாமதம் என்ற வரிசையில். வாடிக்கையாளர் பெயர், தொலைபேசி எதுவும் இல்லை." },
  { key: "payables", en: "Payables", ta: "செலுத்த வேண்டிய தொகை", descEn: "Total you owe suppliers and how much is overdue. No supplier names.", descTa: "சப்ளையர்களுக்கு நீங்கள் செலுத்த வேண்டிய மொத்தம், தாமதமானது எவ்வளவு. சப்ளையர் பெயர் இல்லை." },
  { key: "stock", en: "Stock value", ta: "இருப்பு மதிப்பு", descEn: "The value of stock on your shelves today at cost.", descTa: "இன்று உங்கள் அலமாரியில் உள்ள இருப்பின் மதிப்பு (கொள்முதல் விலையில்)." },
  { key: "balance", en: "Average daily balance (estimate)", ta: "சராசரி தினசரி இருப்பு (மதிப்பீடு)", descEn: "Estimated from your entered cash and bank balance and the money in and out of the shop. Shown only if you have entered a balance.", descTa: "நீங்கள் உள்ளிட்ட ரொக்கம், வங்கி இருப்பு மற்றும் கடைக்குள் வரும், வெளியே செல்லும் பணத்திலிருந்து மதிப்பிடப்பட்டது. இருப்பு உள்ளிட்டிருந்தால் மட்டுமே காட்டப்படும்." },
] as const;
export type LoanSectionKey = (typeof LOAN_SECTIONS)[number]["key"];

export const LOAN_DISCLAIMER = {
  en: "This summary was made from the shop's own billing records. It has not been audited or certified. It is not a credit decision and does not say a loan will be or should be given.",
  ta: "இந்த சுருக்கம் கடையின் சொந்த பில்லிங் பதிவுகளிலிருந்து தயாரிக்கப்பட்டது. இது தணிக்கை செய்யப்படவோ சான்றளிக்கப்படவோ இல்லை. இது கடன் முடிவு அல்ல; கடன் வழங்கப்படும் அல்லது வழங்க வேண்டும் என்றும் இது கூறவில்லை.",
} as const;

export interface LoanMonthIn {
  /** "YYYY-MM". */
  month: string;
  /** Paise billed incl. GST, net of credit notes. */
  sales: number;
  /** Paise before tax, net of credit notes. */
  taxable: number;
  bills: number;
  /** Output GST in paise. */
  gstOutput: number;
  /** Purchases before tax in paise. */
  purchasesTaxable: number;
  gstr1Filed: boolean;
}
export interface LoanPackInput {
  today: string;
  months: LoanMonthIn[];
  customers: { name: string; total: number; bills: number }[];
  receivables: { buckets: { key: string; amount: number; count: number }[]; total: number; customers: number };
  payables: { total: number; overdue: number } | null;
  stockValue: number | null;
  /** Average daily balance over the 12 months (paise), reconstructed from an entered balance; null when none was entered. */
  averageBalance: number | null;
  /** Average daily money collected (paise), always available. */
  averageDailyCollections: number;
  /** Show real customer names (the owner unticked the mask). */
  showNames: boolean;
}

export interface LoanMonth extends LoanMonthIn {
  /** (taxable sales - purchases) / taxable sales, percent with 1 decimal; null when no sales. */
  marginPct: number | null;
}
export interface LoanPackFacts {
  today: string;
  from: string;
  to: string;
  months: LoanMonth[];
  totals: { sales: number; bills: number; avgMonthly: number; best: { month: string; sales: number } | null; worst: { month: string; sales: number } | null; last6: number; prev6: number; growthPct: number | null; marginPct: number | null; gstOutput: number; gstr1FiledMonths: number };
  concentration: { top: { label: string; total: number; sharePct: number; bills: number }[]; top1SharePct: number; top5SharePct: number; namesShown: boolean; customersTotal: number };
  receivables: LoanPackInput["receivables"] & { over60: number; over60Pct: number | null };
  payables: LoanPackInput["payables"];
  stockValue: number | null;
  balance: { average: number | null; averageDailyCollections: number };
  sections: LoanSectionKey[];
}

const pct1 = (a: number, b: number): number | null => (b > 0 ? r1((a / b) * 100) : null);

export function buildLoanPack(i: LoanPackInput): LoanPackFacts {
  const months: LoanMonth[] = i.months.map((m) => ({ ...m, marginPct: m.taxable > 0 ? r1(((m.taxable - m.purchasesTaxable) / m.taxable) * 100) : null }));
  const sales = months.reduce((a, m) => a + m.sales, 0);
  const taxable = months.reduce((a, m) => a + m.taxable, 0);
  const purch = months.reduce((a, m) => a + m.purchasesTaxable, 0);
  const withSales = months.filter((m) => m.sales > 0);
  const best = withSales.length ? withSales.reduce((a, m) => (m.sales > a.sales ? m : a)) : null;
  const worst = withSales.length ? withSales.reduce((a, m) => (m.sales < a.sales ? m : a)) : null;
  const last6 = months.slice(-6).reduce((a, m) => a + m.sales, 0);
  const prev6 = months.slice(-12, -6).reduce((a, m) => a + m.sales, 0);
  const customersTotal = i.customers.reduce((a, c) => a + c.total, 0);
  const sorted = [...i.customers].sort((a, b) => b.total - a.total).slice(0, 5);
  const share = (n: number) => (sales > 0 ? r1((n / sales) * 100) : 0);
  const over60 = i.receivables.buckets.filter((b) => b.key === "61-90" || b.key === "90+").reduce((a, b) => a + b.amount, 0);
  const sections: LoanSectionKey[] = ["sales", "gst", "margin", "customers", "receivables"];
  if (i.payables) sections.push("payables");
  if (i.stockValue !== null) sections.push("stock");
  if (i.averageBalance !== null) sections.push("balance");
  return {
    today: i.today,
    from: months[0]?.month ?? "",
    to: months.at(-1)?.month ?? "",
    months,
    totals: {
      sales,
      bills: months.reduce((a, m) => a + m.bills, 0),
      avgMonthly: r0(sales / Math.max(1, months.length)),
      best: best ? { month: best.month, sales: best.sales } : null,
      worst: worst ? { month: worst.month, sales: worst.sales } : null,
      last6,
      prev6,
      growthPct: prev6 > 0 ? r1(((last6 - prev6) / prev6) * 100) : null,
      marginPct: taxable > 0 ? r1(((taxable - purch) / taxable) * 100) : null,
      gstOutput: months.reduce((a, m) => a + m.gstOutput, 0),
      gstr1FiledMonths: months.filter((m) => m.gstr1Filed).length,
    },
    concentration: {
      top: sorted.map((c, idx) => ({ label: i.showNames ? c.name : (`Customer ${idx + 1}` as string), total: c.total, sharePct: share(c.total), bills: c.bills })),
      top1SharePct: sorted[0] ? share(sorted[0].total) : 0,
      top5SharePct: share(sorted.reduce((a, c) => a + c.total, 0)),
      namesShown: i.showNames,
      customersTotal: i.customers.length,
    },
    receivables: { ...i.receivables, over60, over60Pct: pct1(over60, i.receivables.total) },
    payables: i.payables,
    stockValue: i.stockValue,
    balance: { average: i.averageBalance, averageDailyCollections: i.averageDailyCollections },
    sections,
  };
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_TA = ["ஜன.", "பிப்.", "மார்.", "ஏப்.", "மே", "ஜூன்", "ஜூலை", "ஆக.", "செப்.", "அக்.", "நவ.", "டிச."];
/** "2026-10" -> "Oct 2026". */
export const monthLabel = (m: string, lang: Lang) => `${(lang === "ta" ? MONTHS_TA : MONTHS_EN)[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

/** The facts sheet the cover note is written from. Names (when shown) are NOT in it: the model never needs them. */
export function loanSheet(f: LoanPackFacts): string {
  const L: string[] = [];
  L.push(`Period: ${monthLabel(f.from, "en")} to ${monthLabel(f.to, "en")} (${f.months.length} months)`);
  L.push(`Total sales: ${rupees(f.totals.sales)} from ${f.totals.bills} bills; about ${rupees(f.totals.avgMonthly)} a month`);
  if (f.totals.best) L.push(`Best month: ${monthLabel(f.totals.best.month, "en")} ${rupees(f.totals.best.sales)}`);
  if (f.totals.worst) L.push(`Lowest month: ${monthLabel(f.totals.worst.month, "en")} ${rupees(f.totals.worst.sales)}`);
  if (f.totals.growthPct !== null) L.push(`Last 6 months ${rupees(f.totals.last6)} against the 6 months before ${rupees(f.totals.prev6)}: ${f.totals.growthPct >= 0 ? "up" : "down"} ${Math.abs(f.totals.growthPct)}%`);
  if (f.totals.marginPct !== null) L.push(`Sales less purchases before tax: ${f.totals.marginPct}% of sales (a rough guide from bills)`);
  L.push(`Output GST over the period: ${rupees(f.totals.gstOutput)}; GSTR-1 marked as filed for ${f.totals.gstr1FiledMonths} of ${f.months.length} months`);
  L.push(`Top customer share of sales: ${f.concentration.top1SharePct}%; top 5 customers: ${f.concentration.top5SharePct}%`);
  L.push(`Receivables: ${rupees(f.receivables.total)} from ${f.receivables.customers} customers${f.receivables.over60Pct !== null ? `; ${f.receivables.over60Pct}% is more than 60 days overdue` : ""}`);
  if (f.payables) L.push(`Payables to suppliers: ${rupees(f.payables.total)}, of which overdue ${rupees(f.payables.overdue)}`);
  if (f.stockValue !== null) L.push(`Stock value at cost: ${rupees(f.stockValue)}`);
  if (f.balance.average !== null) L.push(`Estimated average daily balance: ${rupees(f.balance.average)}`);
  return L.join("\n");
}

export interface CoverNote {
  en: string;
  ta: string;
}

/** The deterministic cover note. Plain, factual, no adjectives that sell. */
export function templateCover(f: LoanPackFacts, shop: string): CoverNote {
  // The shop name is deliberately not used: it is free text, and the PDF header already shows it.
  void shop;
  const name = "The shop";
  const growthEn = f.totals.growthPct === null ? "" : ` Sales in the last 6 months were ${f.totals.growthPct >= 0 ? "up" : "down"} ${Math.abs(f.totals.growthPct)}% on the 6 months before.`;
  const growthTa = f.totals.growthPct === null ? "" : ` கடந்த 6 மாத விற்பனை, அதற்கு முந்தைய 6 மாதத்தை விட ${Math.abs(f.totals.growthPct)}% ${f.totals.growthPct >= 0 ? "அதிகம்" : "குறைவு"}.`;
  const recvEn = ` Customers owe ${rupees(f.receivables.total)}${f.receivables.over60Pct !== null ? `, of which ${f.receivables.over60Pct}% is more than 60 days overdue` : ""}.`;
  const recvTa = ` வாடிக்கையாளர்கள் ${rupees(f.receivables.total)} தர வேண்டும்${f.receivables.over60Pct !== null ? `; அதில் ${f.receivables.over60Pct}% 60 நாளுக்கு மேல் தாமதம்` : ""}.`;
  const en = `${name} prepared this summary from its own billing records for ${monthLabel(f.from, "en")} to ${monthLabel(f.to, "en")}. Total sales were ${rupees(f.totals.sales)} from ${f.totals.bills} bills, about ${rupees(f.totals.avgMonthly)} a month.${growthEn} The top 5 customers account for ${f.concentration.top5SharePct}% of sales.${recvEn} ${LOAN_DISCLAIMER.en}`;
  const ta = `கடை தனது சொந்த பில்லிங் பதிவுகளிலிருந்து ${monthLabel(f.from, "ta")} முதல் ${monthLabel(f.to, "ta")} வரையிலான இந்த சுருக்கத்தைத் தயாரித்தது. மொத்த விற்பனை ${rupees(f.totals.sales)} (${f.totals.bills} பில்கள்), மாதம் சுமார் ${rupees(f.totals.avgMonthly)}.${growthTa} முதல் 5 வாடிக்கையாளர்கள் விற்பனையில் ${f.concentration.top5SharePct}% பங்கு.${recvTa} ${LOAN_DISCLAIMER.ta}`;
  return { en, ta };
}

/** Words a lender-facing note must not use: promises, ratings, advice, hype. */
const FORBIDDEN_EN = [
  "guarantee[sd]?", "assured", "assurance", "risk[- ]free", "no risk", "certain(?:ly)?", "definitely", "will (?:repay|pay back|grow|increase)", "can easily",
  "credit[- ]?worthy", "eligible", "qualif(?:y|ies|ied)", "should (?:be )?(?:approve|grant|lend|sanction)\\w*", "approve[sd]?", "recommend\\w*", "excellent", "outstanding",
  "exceptional", "impressive", "robust", "strong", "stellar", "best[- ]in", "highly profitable", "very profitable", "rapid(?:ly)?", "booming", "thriving", "stable",
  "healthy", "safe", "reliable", "trustworthy", "verified",
];
const FORBIDDEN_TA = ["உத்தரவாத", "உறுதி", "ஆபத்தில்லை", "சிறப்பான", "மிகச் சிறந்த"];
export const FORBIDDEN_COVER = new RegExp(`\\b(?:${FORBIDDEN_EN.join("|")})\\b|${FORBIDDEN_TA.join("|")}`, "i");

export const COVER_SYSTEM = [
  "You write a short, neutral cover note that a small Indian shop owner may attach to a working-capital loan application, from a facts sheet the shop's software already worked out from the shop's own bills. The reader is a bank or finance company officer.",
  "Use ONLY the facts in the sheet. Every number you write (rupee amounts, percentages, counts, months) must be copied exactly from the sheet. Never calculate, round, add, estimate or invent a number, and never mention a figure that is not in the sheet (no profit, turnover forecast, loan amount, collateral or credit score).",
  "Be plain and factual. Do not praise or sell the business: no words like strong, excellent, healthy, stable, robust, growing fast. Never say or imply a guarantee, that repayment is assured, that the shop qualifies, or that the loan should be approved. Do not give a recommendation. Say that it is a summary of the shop's own records, not audited, and not a credit decision.",
  "en: 90 to 140 words, one paragraph, English. ta: the same note in natural Tamil in Tamil script (keep rupee amounts and numbers as given). Refer to 'the shop', never invent its name.",
  DATA_RULES,
].join("\n");

const Out = z.object({ en: z.string(), ta: z.string() });
const OUT_JSON = { type: "object", properties: { en: { type: "string" }, ta: { type: "string" } }, required: ["en", "ta"], additionalProperties: false } as const;

export interface CoverResult extends CoverNote {
  source: "ai" | "template";
  fallbackReason: string | null;
  runId: string | null;
  credits: number;
}

/** Cleans one AI note: filter unsupported claims, forbid hype and promises, and require every number to be in the facts. Null = unusable. */
export function acceptCover(text: string, sheet: string): string | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 40 || t.length > 1400) return null;
  if (FORBIDDEN_COVER.test(t)) return null;
  if (!checkNumbers(t, allowedNumbers(sheet)).ok) return null;
  // No sentence may make a delivery/refund/warranty... claim the sheet does not support.
  const claims = filterClaims(t, sheet);
  if (claims.removed.length) return null;
  return t;
}

export async function writeCover(ai: AiRunner | null, req: { tenantId: string; userId?: string | null; facts: LoanPackFacts; shop: string }): Promise<CoverResult> {
  const tpl = templateCover(req.facts, req.shop);
  const base: CoverResult = { ...tpl, source: "template", fallbackReason: null, runId: null, credits: 0 };
  if (!ai) return base;
  const sheet = loanSheet(req.facts);
  try {
    const r = await ai.run<z.infer<typeof Out>>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: LOAN_FEATURE,
      tier: "light",
      system: COVER_SYSTEM,
      input: { text: dataBlock("loan pack facts", sheet) },
      schema: { name: "loan_cover", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: Out },
      maxTokens: 6000,
    });
    const en = acceptCover(r.output.en, sheet);
    const ta = acceptCover(r.output.ta, sheet);
    if (!en || !ta) return { ...base, runId: r.runId, credits: r.credits, fallbackReason: "checks" };
    // The disclaimer always goes with the note, in the note's language.
    const needs = (t: string, d: string) => (/not (?:been )?audited|not a credit decision|தணிக்கை|கடன் முடிவு/i.test(t) ? t : `${t} ${d}`);
    return { en: needs(en, LOAN_DISCLAIMER.en), ta: needs(ta, LOAN_DISCLAIMER.ta), source: "ai", fallbackReason: null, runId: r.runId, credits: r.credits };
  } catch (e) {
    return { ...base, fallbackReason: (e as { code?: string }).code ?? "ai_failed" };
  }
}
