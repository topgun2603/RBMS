import { allowedNumbers, checkNumbers, rupees } from "../insights/numbers";
import { DATA_RULES } from "../assist/safety";
import type { AiRunner } from "../assist/hsn";
import { z } from "zod";
import { addDays, clamp, daysBetween, r0, r1 } from "./dates";

/**
 * Credit risk score for a credit customer. Computed in code ONLY from the shop's own record with that customer: bills,
 * payments, the credit limit the owner set, and cheque bounces when the shop has them. No name, phone, address, religion,
 * caste, gender or place is an input, so none can influence the result (the input type has no such field).
 *
 * Money is paise. Dates are IST "YYYY-MM-DD".
 */

export const RISK_FEATURE = "credit-risk";
export type RiskBand = "A" | "B" | "C" | "D" | "new";
export type Lang = "en" | "ta";

/** A bill with no due date is treated as due this many days after it was made. */
export const DEFAULT_TERMS_DAYS = 15;
/** Paid up to this many days after the due date still counts as on time. */
export const GRACE_DAYS = 3;
/** Fewer credit bills or less time than this and we do not score ("not enough history"). */
export const MIN_CREDIT_BILLS = 3;
export const MIN_TENURE_DAYS = 30;

export interface RiskPayment {
  date: string;
  /** Paise, positive. */
  amount: number;
}
export interface RiskBill {
  id: string;
  date: string;
  dueDate: string | null;
  total: number;
  /** Credit notes on the bill. */
  credited: number;
  payments: RiskPayment[];
}
export interface RiskInput {
  today: string;
  bills: RiskBill[];
  /** Paise the owner set as this customer's limit; null = none. */
  creditLimit: number | null;
  /** Paise the customer owed before the shop started using the app (0 or more). */
  openingBalance?: number;
  /** Bounced cheques recorded for this customer; null/undefined = the shop does not record them. */
  chequeBounces?: number | null;
}

export interface LatenessBucket {
  key: "on_time" | "d1_7" | "d8_15" | "d16_30" | "d31_plus";
  amount: number;
  share: number;
}

export interface RiskMetrics {
  creditBills: number;
  firstBillDate: string | null;
  tenureDays: number;
  /** Paise billed (net of credit notes) in the last 90 days, per 30 days. */
  monthlyPurchase: number;
  settledAmount: number;
  /** Share (0 to 1) of settled money paid by the due date plus grace. null = nothing settled yet. */
  onTimeShare: number | null;
  /** Average days late of the late payments, by amount. */
  avgDaysLate: number | null;
  maxDaysLate: number | null;
  /** Average days from the bill to the money, by amount. */
  avgDaysToPay: number | null;
  lateness: LatenessBucket[];
  openAmount: number;
  overdueAmount: number;
  oldestOverdueDays: number;
  /** Open + opening balance over the limit (0 to more than 1); null without a limit. */
  utilisation: number | null;
  balanceNow: number;
  balance90: number;
  trend: "rising" | "steady" | "falling";
  /** Share of settled bills that were paid in three or more instalments. */
  instalmentShare: number | null;
  chequeBounces: number | null;
}

export type FactorKey =
  | "not_enough_history"
  | "on_time"
  | "late_payer"
  | "often_late"
  | "overdue_now"
  | "long_overdue"
  | "no_overdue"
  | "over_limit"
  | "near_limit"
  | "low_use_of_limit"
  | "dues_rising"
  | "dues_falling"
  | "instalments"
  | "long_relationship"
  | "short_relationship"
  | "cheque_bounced"
  | "no_limit";

export interface RiskFactor {
  key: FactorKey;
  tone: "good" | "bad" | "neutral";
  /** How much this moved the score (points lost for bad, points earned for good). */
  weight: number;
  en: string;
  ta: string;
}

export interface SuggestedLimit {
  /** Paise; null when there is not enough history. */
  amount: number | null;
  current: number | null;
  action: "raise" | "lower" | "keep" | "none";
  basis: { monthlyPurchase: number; avgDaysToPay: number | null; multiplier: number; band: RiskBand };
  en: string;
  ta: string;
}

export interface RiskResult {
  band: RiskBand;
  /** 0 to 100; null when there is not enough history. */
  score: number | null;
  enough: boolean;
  factors: RiskFactor[];
  limit: SuggestedLimit;
  metrics: RiskMetrics;
  /** Shown to the owner next to the band: rule-based, never a lender decision. */
  hint: { en: string; ta: string } | null;
}

interface Piece {
  amount: number;
  daysLate: number;
  daysToPay: number;
}

const dueOf = (b: Pick<RiskBill, "date" | "dueDate">) => b.dueDate ?? addDays(b.date, DEFAULT_TERMS_DAYS);

/** Splits one bill into the money settled later (with how late) and what is still open. */
export function settleBill(b: RiskBill): { credit: number; pieces: Piece[]; open: number; payments: number; net: number } {
  const net = Math.max(0, b.total - b.credited);
  const sorted = [...b.payments].filter((p) => p.amount > 0).sort((x, y) => x.date.localeCompare(y.date));
  const upfront = sorted.filter((p) => p.date <= b.date).reduce((a, p) => a + p.amount, 0);
  const credit = Math.max(0, net - upfront);
  const pieces: Piece[] = [];
  let left = credit;
  const due = dueOf(b);
  for (const p of sorted.filter((x) => x.date > b.date)) {
    if (left <= 0) break;
    const take = Math.min(left, p.amount);
    pieces.push({ amount: take, daysLate: daysBetween(due, p.date), daysToPay: daysBetween(b.date, p.date) });
    left -= take;
  }
  return { credit, pieces, open: left, payments: sorted.filter((x) => x.date > b.date).length, net };
}

/** Money still owed on the bill at the end of `asOf` (payments after that date not counted). */
function outstandingAt(b: RiskBill, asOf: string): number {
  if (b.date > asOf) return 0;
  const net = Math.max(0, b.total - b.credited);
  const paid = b.payments.filter((p) => p.date <= asOf).reduce((a, p) => a + p.amount, 0);
  return Math.max(0, net - paid);
}

export function riskMetrics(input: RiskInput): RiskMetrics {
  const { today } = input;
  const bills = input.bills.filter((b) => b.date <= today);
  let creditBills = 0;
  let first: string | null = null;
  let settled = 0;
  let onTime = 0;
  let lateAmt = 0;
  let lateDaysWeighted = 0;
  let toPayWeighted = 0;
  let maxLate: number | null = null;
  let openAmount = 0;
  let overdueAmount = 0;
  let oldestOverdue = 0;
  let settledBills = 0;
  let instalmentBills = 0;
  const buckets = { on_time: 0, d1_7: 0, d8_15: 0, d16_30: 0, d31_plus: 0 };

  for (const b of bills) {
    if (!first || b.date < first) first = b.date;
    const s = settleBill(b);
    if (s.credit > 0) creditBills += 1;
    for (const p of s.pieces) {
      settled += p.amount;
      toPayWeighted += p.amount * p.daysToPay;
      if (p.daysLate <= GRACE_DAYS) {
        onTime += p.amount;
        buckets.on_time += p.amount;
      } else {
        lateAmt += p.amount;
        lateDaysWeighted += p.amount * p.daysLate;
        maxLate = Math.max(maxLate ?? 0, p.daysLate);
        if (p.daysLate <= 7) buckets.d1_7 += p.amount;
        else if (p.daysLate <= 15) buckets.d8_15 += p.amount;
        else if (p.daysLate <= 30) buckets.d16_30 += p.amount;
        else buckets.d31_plus += p.amount;
      }
    }
    if (s.credit > 0 && s.open <= 0) {
      settledBills += 1;
      if (s.payments >= 3) instalmentBills += 1;
    }
    if (s.open > 0) {
      openAmount += s.open;
      const late = daysBetween(dueOf(b), today);
      if (late > 0) {
        overdueAmount += s.open;
        oldestOverdue = Math.max(oldestOverdue, late);
      }
    }
  }

  const opening = Math.max(0, input.openingBalance ?? 0);
  const tenureDays = first ? Math.max(0, daysBetween(first, today)) : 0;
  const since90 = addDays(today, -90);
  const billed90 = bills.filter((b) => b.date > since90).reduce((a, b) => a + Math.max(0, b.total - b.credited), 0);
  const monthlyPurchase = r0(billed90 / clamp(Math.min(tenureDays, 90) / 30, 1, 3));
  const balanceNow = bills.reduce((a, b) => a + outstandingAt(b, today), 0);
  const balance90 = bills.reduce((a, b) => a + outstandingAt(b, since90), 0);
  const delta = balanceNow - balance90;
  const trend: RiskMetrics["trend"] = monthlyPurchase <= 0 ? "steady" : delta / monthlyPurchase >= 0.5 ? "rising" : delta / monthlyPurchase <= -0.5 ? "falling" : "steady";
  const share = (n: number) => (settled > 0 ? n / settled : 0);

  return {
    creditBills,
    firstBillDate: first,
    tenureDays,
    monthlyPurchase,
    settledAmount: settled,
    onTimeShare: settled > 0 ? onTime / settled : null,
    avgDaysLate: lateAmt > 0 ? r1(lateDaysWeighted / lateAmt) : settled > 0 ? 0 : null,
    maxDaysLate: maxLate,
    avgDaysToPay: settled > 0 ? r1(toPayWeighted / settled) : null,
    lateness: [
      { key: "on_time", amount: buckets.on_time, share: share(buckets.on_time) },
      { key: "d1_7", amount: buckets.d1_7, share: share(buckets.d1_7) },
      { key: "d8_15", amount: buckets.d8_15, share: share(buckets.d8_15) },
      { key: "d16_30", amount: buckets.d16_30, share: share(buckets.d16_30) },
      { key: "d31_plus", amount: buckets.d31_plus, share: share(buckets.d31_plus) },
    ],
    openAmount,
    overdueAmount,
    oldestOverdueDays: oldestOverdue,
    utilisation: input.creditLimit && input.creditLimit > 0 ? (openAmount + opening) / input.creditLimit : null,
    balanceNow,
    balance90,
    trend,
    instalmentShare: settledBills > 0 ? instalmentBills / settledBills : null,
    chequeBounces: input.chequeBounces ?? null,
  };
}

const pc = (x: number) => Math.round(x * 100);

interface Part {
  max: number;
  got: number;
}

/** The score parts. Each is points out of its maximum; they add up to at most 100. */
export function scoreParts(m: RiskMetrics): Record<"punctuality" | "overdue" | "limit" | "trend" | "instalments" | "history", Part> {
  // Punctuality (50): share of money paid on time (36) + how late the late money was (14). Nothing settled yet = half marks.
  const punctuality: Part =
    m.onTimeShare === null
      ? { max: 50, got: 25 }
      : { max: 50, got: m.onTimeShare * 36 + 14 * (1 - Math.min(1, (m.avgDaysLate ?? 0) / 45)) };

  // Overdue now (20): by age of the oldest overdue bill, then by how big the overdue amount is next to a month's buying.
  let base = 20;
  if (m.overdueAmount > 0) {
    const d = m.oldestOverdueDays;
    base = d <= 7 ? 16 : d <= 30 ? 11 : d <= 60 ? 6 : d <= 90 ? 2 : 0;
    if (m.monthlyPurchase > 0) base *= m.overdueAmount <= m.monthlyPurchase ? 1 : m.overdueAmount <= 2 * m.monthlyPurchase ? 0.75 : 0.5;
  }
  const overdue: Part = { max: 20, got: base };

  // Use of the limit (8). No limit set = neutral.
  const u = m.utilisation;
  const limit: Part = { max: 8, got: u === null ? 5 : u <= 0.5 ? 8 : u <= 0.8 ? 6.5 : u <= 1 ? 4 : 0 };

  // Dues over 90 days (7).
  const trend: Part = { max: 7, got: m.trend === "rising" ? 1.5 : m.trend === "falling" ? 7 : m.balanceNow === 0 ? 7 : 5 };

  // Paying in many small instalments (5).
  const instalments: Part = { max: 5, got: m.instalmentShare === null ? 3 : 5 * (1 - m.instalmentShare) };

  // Bills and tenure (10).
  const history: Part = { max: 10, got: (Math.min(m.creditBills, 10) / 10) * 6 + (Math.min(m.tenureDays, 365) / 365) * 4 };
  return { punctuality, overdue, limit, trend, instalments, history };
}

export const bandOf = (score: number): Exclude<RiskBand, "new"> => (score >= 80 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D");

const BAND_MULT: Record<Exclude<RiskBand, "new">, number> = { A: 1.5, B: 1.2, C: 0.8, D: 0.4 };
const ROUND_TO = 50_000; // Rs 500

/** The limit rule: a month's buying, stretched by how slowly they pay, scaled by the band. A "D" is held at what they already owe. */
export function suggestLimit(m: RiskMetrics, band: RiskBand, current: number | null): SuggestedLimit {
  const none = (en: string, ta: string): SuggestedLimit => ({ amount: null, current, action: "none", basis: { monthlyPurchase: m.monthlyPurchase, avgDaysToPay: m.avgDaysToPay, multiplier: 0, band }, en, ta });
  if (band === "new") return none("Not enough history to suggest a limit yet.", "வரம்பு பரிந்துரைக்கப் போதிய வரலாறு இன்னும் இல்லை.");
  if (m.monthlyPurchase <= 0) return none("No recent buying to base a limit on.", "வரம்புக்கு அடிப்படையாக சமீபத்திய வாங்குதல் இல்லை.");
  const months = Math.max(1, (m.avgDaysToPay ?? 30) / 30);
  const mult = BAND_MULT[band];
  let raw = m.monthlyPurchase * months * mult;
  if (band === "D") raw = Math.min(raw, m.openAmount);
  const amount = Math.max(0, Math.round(raw / ROUND_TO) * ROUND_TO);
  let action: SuggestedLimit["action"] = "keep";
  if (current === null) action = "raise";
  else if (amount > current * 1.15) action = "raise";
  else if (amount < current * 0.85) action = "lower";
  const money = rupees(amount);
  const en =
    band === "D" && amount <= m.openAmount
      ? `Suggested limit ${money}: hold new credit until the overdue amount is cleared.`
      : `Suggested limit ${money}: about ${r1(months * mult)} months of their usual buying, based on how fast they pay.`;
  const ta =
    band === "D" && amount <= m.openAmount
      ? `பரிந்துரைக்கப்படும் வரம்பு ${money}: நிலுவை தீரும் வரை புதிய கடன் வேண்டாம்.`
      : `பரிந்துரைக்கப்படும் வரம்பு ${money}: அவர்கள் பணம் செலுத்தும் வேகத்தின் அடிப்படையில், வழக்கமான வாங்குதலின் சுமார் ${r1(months * mult)} மாதம்.`;
  return { amount, current, action, basis: { monthlyPurchase: m.monthlyPurchase, avgDaysToPay: m.avgDaysToPay, multiplier: r1(months * mult), band }, en, ta };
}

function factorsOf(m: RiskMetrics, parts: ReturnType<typeof scoreParts>, enough: boolean): RiskFactor[] {
  const f: RiskFactor[] = [];
  const add = (key: FactorKey, tone: RiskFactor["tone"], weight: number, en: string, ta: string) => f.push({ key, tone, weight: r1(weight), en, ta });
  const lost = (p: Part) => p.max - p.got;

  if (!enough) add("not_enough_history", "neutral", 0, `Only ${m.creditBills} credit ${m.creditBills === 1 ? "bill" : "bills"} over ${m.tenureDays} days: not enough history to score.`, `${m.tenureDays} நாளில் ${m.creditBills} கடன் பில் மட்டுமே: மதிப்பிடப் போதிய வரலாறு இல்லை.`);

  if (m.onTimeShare !== null) {
    const on = pc(m.onTimeShare);
    if (m.onTimeShare >= 0.85) add("on_time", "good", parts.punctuality.got, `Pays on time: ${on}% of the money came by the due date.`, `சரியான நேரத்தில் செலுத்துகிறார்: ${on}% தொகை கெடு தேதிக்குள் வந்தது.`);
    else if (m.onTimeShare >= 0.5) add("late_payer", "bad", lost(parts.punctuality), `Often pays late: only ${on}% of the money came by the due date, late payments were ${m.avgDaysLate ?? 0} days late on average.`, `அடிக்கடி தாமதம்: ${on}% தொகை மட்டுமே கெடுவுக்குள் வந்தது; தாமதங்கள் சராசரியாக ${m.avgDaysLate ?? 0} நாள்.`);
    else add("often_late", "bad", lost(parts.punctuality), `Usually pays late: only ${on}% of the money came by the due date, late payments were ${m.avgDaysLate ?? 0} days late on average.`, `பெரும்பாலும் தாமதம்: ${on}% தொகை மட்டுமே கெடுவுக்குள் வந்தது; தாமதங்கள் சராசரியாக ${m.avgDaysLate ?? 0} நாள்.`);
  }
  if (m.overdueAmount > 0) {
    const amt = rupees(m.overdueAmount);
    if (m.oldestOverdueDays > 60) add("long_overdue", "bad", lost(parts.overdue), `${amt} is overdue, the oldest bill by ${m.oldestOverdueDays} days.`, `${amt} நிலுவை, பழைய பில் ${m.oldestOverdueDays} நாள் தாமதம்.`);
    else add("overdue_now", "bad", lost(parts.overdue), `${amt} is overdue now, the oldest bill by ${m.oldestOverdueDays} days.`, `${amt} இப்போது நிலுவை, பழைய பில் ${m.oldestOverdueDays} நாள் தாமதம்.`);
  } else if (m.creditBills > 0) add("no_overdue", "good", parts.overdue.got, "Nothing is overdue right now.", "இப்போது நிலுவை எதுவும் இல்லை.");

  if (m.utilisation !== null) {
    const u = pc(m.utilisation);
    if (m.utilisation > 1) add("over_limit", "bad", lost(parts.limit), `Owes ${u}% of the credit limit, which is over it.`, `கடன் வரம்பில் ${u}% நிலுவை, வரம்பைத் தாண்டியுள்ளது.`);
    else if (m.utilisation > 0.8) add("near_limit", "bad", lost(parts.limit), `Using ${u}% of the credit limit.`, `கடன் வரம்பில் ${u}% பயன்படுத்தியுள்ளார்.`);
    else if (m.utilisation <= 0.5) add("low_use_of_limit", "good", parts.limit.got, `Uses only ${u}% of the credit limit.`, `கடன் வரம்பில் ${u}% மட்டுமே பயன்படுத்துகிறார்.`);
  } else if (m.openAmount > 0) add("no_limit", "neutral", 0, "No credit limit is set for this customer.", "இந்த வாடிக்கையாளருக்கு கடன் வரம்பு அமைக்கப்படவில்லை.");

  if (m.trend === "rising") add("dues_rising", "bad", lost(parts.trend), `Dues went up from ${rupees(m.balance90)} to ${rupees(m.balanceNow)} in 90 days.`, `90 நாளில் நிலுவை ${rupees(m.balance90)}-இலிருந்து ${rupees(m.balanceNow)} ஆக உயர்ந்தது.`);
  else if (m.trend === "falling") add("dues_falling", "good", parts.trend.got, `Dues came down from ${rupees(m.balance90)} to ${rupees(m.balanceNow)} in 90 days.`, `90 நாளில் நிலுவை ${rupees(m.balance90)}-இலிருந்து ${rupees(m.balanceNow)} ஆகக் குறைந்தது.`);

  if (m.instalmentShare !== null && m.instalmentShare >= 0.4) add("instalments", "bad", lost(parts.instalments), `${pc(m.instalmentShare)}% of settled bills were paid in 3 or more small instalments.`, `தீர்க்கப்பட்ட பில்களில் ${pc(m.instalmentShare)}% மூன்று அல்லது அதற்கு மேற்பட்ட சிறு தவணைகளில் செலுத்தப்பட்டது.`);
  if (m.chequeBounces && m.chequeBounces > 0) add("cheque_bounced", "bad", Math.min(20, m.chequeBounces * 10), `${m.chequeBounces} cheque ${m.chequeBounces === 1 ? "bounce" : "bounces"} on record.`, `${m.chequeBounces} காசோலை திரும்பியது பதிவாகியுள்ளது.`);

  if (enough && m.creditBills >= 10 && m.tenureDays >= 180) add("long_relationship", "good", parts.history.got, `${m.creditBills} credit bills over ${m.tenureDays} days.`, `${m.tenureDays} நாளில் ${m.creditBills} கடன் பில்கள்.`);
  else if (enough && m.creditBills < 5) add("short_relationship", "neutral", lost(parts.history), `Only ${m.creditBills} credit bills so far.`, `இதுவரை ${m.creditBills} கடன் பில்கள் மட்டுமே.`);
  return f;
}

/** The three factors to show: the biggest problems first, then the biggest strengths, so a "D" is never explained by its good points. */
export function topFactors(all: RiskFactor[], band: RiskBand): RiskFactor[] {
  const bad = all.filter((x) => x.tone === "bad").sort((a, b) => b.weight - a.weight);
  const good = all.filter((x) => x.tone === "good").sort((a, b) => b.weight - a.weight);
  const neutral = all.filter((x) => x.tone === "neutral");
  // A real concern (a bounced cheque, a long overdue) is always shown, even on a good customer.
  const good2 = band === "A" || band === "B" ? [...bad.filter((x) => x.weight >= 5).slice(0, 1), ...good, ...bad.filter((x) => x.weight < 5), ...bad.filter((x) => x.weight >= 5).slice(1)] : [...bad, ...good];
  const lead = neutral.filter((x) => x.key === "not_enough_history");
  return [...lead, ...good2, ...neutral.filter((x) => x.key !== "not_enough_history")].slice(0, 3);
}

export function scoreCredit(input: RiskInput): RiskResult {
  const m = riskMetrics(input);
  const enough = m.creditBills >= MIN_CREDIT_BILLS && m.tenureDays >= MIN_TENURE_DAYS;
  const parts = scoreParts(m);
  const factors = factorsOf(m, parts, enough);
  if (!enough) {
    const top = topFactors(factors, "new");
    return { band: "new", score: null, enough: false, factors: top, limit: suggestLimit(m, "new", input.creditLimit), metrics: m, hint: m.overdueAmount > 0 ? { en: `Not scored yet, but ${rupees(m.overdueAmount)} is overdue.`, ta: `இன்னும் மதிப்பிடப்படவில்லை, ஆனால் ${rupees(m.overdueAmount)} நிலுவை உள்ளது.` } : null };
  }
  let score = Object.values(parts).reduce((a, p) => a + p.got, 0);
  if (m.chequeBounces && m.chequeBounces > 0) score -= Math.min(20, m.chequeBounces * 10);
  score = clamp(Math.round(score), 0, 100);
  let band = bandOf(score);
  // Hard rules: a bill long overdue caps the band whatever the history was.
  if (m.overdueAmount > 0 && m.oldestOverdueDays > 90) band = "D";
  else if (m.overdueAmount > 0 && m.oldestOverdueDays > 60 && (band === "A" || band === "B")) band = "C";
  const limit = suggestLimit(m, band, input.creditLimit);
  const hint =
    band === "D"
      ? { en: "Before giving more credit: this customer has a high risk of late payment. Think about taking part payment first.", ta: "மேலும் கடன் கொடுக்கும் முன்: இந்த வாடிக்கையாளர் தாமதமாகச் செலுத்தும் அபாயம் அதிகம். முதலில் ஒரு பகுதி பணம் வாங்குவதைப் பரிசீலியுங்கள்." }
      : null;
  return { band, score, enough: true, factors: topFactors(factors, band), limit, metrics: m, hint };
}

// ------------------------------------------------------------------ optional one-line explanation (light tier, number-checked)

const BAND_WORDS: Record<RiskBand, string> = { A: "low risk", B: "fairly low risk", C: "medium risk", D: "high risk", new: "not enough history" };

/** The facts sheet: only aggregate numbers, never the customer's name, phone or anything personal. */
export function riskSheet(r: RiskResult): string {
  const m = r.metrics;
  const L = [`Band: ${r.band} (${BAND_WORDS[r.band]})`];
  if (r.score !== null) L.push(`Score: ${r.score} out of 100`);
  L.push(...r.factors.map((x, i) => `Factor ${i + 1}: ${x.en}`));
  if (r.limit.amount !== null) L.push(`Suggested credit limit: ${rupees(r.limit.amount)}`);
  if (m.openAmount > 0) L.push(`Open dues: ${rupees(m.openAmount)}`);
  return L.join("\n");
}

export const RISK_SYSTEM = [
  "You write ONE short, plain sentence for a small Indian shop owner that explains why a credit customer got a risk band, from a facts sheet the shop's software already worked out from that customer's own payment record.",
  "Use only the facts in the sheet. Every number you write must be copied exactly from the sheet. Never calculate, round or invent a number. Talk about payment behaviour only (paying on time or late, overdue amount, credit limit, trend of dues). Never mention or guess the customer's name, community, religion, caste, gender, age, place or any personal trait. Do not recommend refusing service to anyone; this is advice for the owner to weigh, and the decision is theirs.",
  "At most 35 words. Plain text, no markdown. Write in the requested language: en = simple English, ta = natural spoken Tamil in Tamil script.",
  DATA_RULES,
].join("\n");

const Out = z.object({ line: z.string() });
const OUT_JSON = { type: "object", properties: { line: { type: "string" } }, required: ["line"], additionalProperties: false } as const;

/** Words an explanation must never contain: personal attributes are not inputs, and the text must not guess them either. */
// Tamil has no word boundary in JS regex: a Tamil word counts only when no other Tamil letter touches it (so "தாமதம்", delay, is not "மதம்", religion).
export const PROTECTED_WORDS =
  /\b(?:caste|religion|religious|hindu|muslim|christian|sikh|community|gender|male|female|woman|women|man|men|boy|girl|age|old|young|race|ethnic\w*|nationality|migrant|native|locality|neighbou?rhood|area|village|surname)\b|(?<![\u0B80-\u0BFF])(?:சாதி|மதம்|இந்து|முஸ்லிம்|கிறிஸ்தவ(?:ர்)?|பெண்|ஆண்|வயது|இனம்|ஊர்)(?:கள்|களை|களுக்கு|ஐ|ஆல்|இன்|உடைய)?(?![\u0B80-\u0BFF])/i;

export interface RiskLine {
  text: string;
  source: "ai" | "template";
  runId: string | null;
  credits: number;
  fallbackReason: string | null;
}

export function templateLine(r: RiskResult, lang: Lang): string {
  const ta = lang === "ta";
  if (r.band === "new") return r.factors[0] ? (ta ? r.factors[0].ta : r.factors[0].en) : ta ? "போதிய வரலாறு இல்லை." : "Not enough history.";
  const head = ta ? `தரம் ${r.band} (${r.score}/100).` : `Band ${r.band} (${r.score} out of 100).`;
  return [head, ...r.factors.slice(0, 2).map((f) => (ta ? f.ta : f.en))].join(" ");
}

/** One light-tier sentence. Kept only when every number is in the facts and no personal attribute is named; else the template. */
export async function explainRisk(ai: AiRunner | null, req: { tenantId: string; userId?: string | null; result: RiskResult; lang: Lang }): Promise<RiskLine> {
  const template = templateLine(req.result, req.lang);
  if (req.result.band === "new" || !ai) return { text: template, source: "template", runId: null, credits: 0, fallbackReason: null };
  const sheet = riskSheet(req.result);
  try {
    const r = await ai.run<z.infer<typeof Out>>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: RISK_FEATURE,
      tier: "light",
      system: RISK_SYSTEM,
      input: { text: `Language: ${req.lang}\n${sheet}` },
      schema: { name: "risk_line", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: Out },
      maxTokens: 2500,
    });
    const text = r.output.line.replace(/\s+/g, " ").trim();
    if (!text || text.length > 400) return { text: template, source: "template", runId: r.runId, credits: r.credits, fallbackReason: "length" };
    if (!checkNumbers(text, allowedNumbers(sheet)).ok) return { text: template, source: "template", runId: r.runId, credits: r.credits, fallbackReason: "numbers" };
    if (PROTECTED_WORDS.test(text)) return { text: template, source: "template", runId: r.runId, credits: r.credits, fallbackReason: "attributes" };
    return { text, source: "ai", runId: r.runId, credits: r.credits, fallbackReason: null };
  } catch (e) {
    return { text: template, source: "template", runId: null, credits: 0, fallbackReason: (e as { code?: string }).code ?? "ai_failed" };
  }
}
