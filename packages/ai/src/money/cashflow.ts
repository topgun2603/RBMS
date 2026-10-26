import type { Lang } from "./risk";
import { z } from "zod";
import type { AiRunner } from "../assist/hsn";
import { DATA_RULES, dataBlock, neutralise } from "../assist/safety";
import { PLAN_FESTIVALS, festivalsAhead, lastYearOf, type PlanFestival } from "../insights/calendar";
import { allowedNumbers, checkNumbers, rupees } from "../insights/numbers";
import { addDays, addMonths, daysBetween, daysInMonth, monthOf, r0, r2, weekdayOf } from "./dates";
import type { RiskBand } from "./risk";

/**
 * Cash-flow forecast, next 30 days, day by day. Everything is arithmetic on the shop's own records (see the assumptions
 * below); the light tier only words the result, and a wording whose numbers are not in the facts is replaced by a template.
 * Money is paise, dates are IST "YYYY-MM-DD".
 */

export const CASHFLOW_FEATURE = "cashflow-forecast";
export const HORIZON_DAYS = 30;
/** Within the horizon, the share of an open bill expected to come in, by the customer's credit band. */
export const COLLECT_RATE: Record<RiskBand, number> = { A: 0.95, B: 0.8, C: 0.55, D: 0.25, new: 0.6 };
/** Days after the due date a customer of this band usually pays, when we have no better figure for them. */
export const DEFAULT_LATE_DAYS: Record<RiskBand, number> = { A: 0, B: 7, C: 21, D: 45, new: 10 };
/** An overdue supplier bill is assumed paid this many days from today. */
export const OVERDUE_SUPPLIER_PAY_DAYS = 7;
export const MAX_UPLIFT = 3;

export interface DueBill {
  customerKey: string;
  customerName: string;
  billId: string;
  number: string | null;
  /** Paise still owed on the bill. */
  balance: number;
  dueDate: string;
  band: RiskBand;
  /** This customer's own average days late (from their payment history); null = use the band default. */
  lateDays: number | null;
}
export interface PayBill {
  billId: string;
  supplierName: string;
  number: string | null;
  balance: number;
  dueDate: string;
}
export interface ExpenseRow {
  date: string;
  category: string;
  vendor: string | null;
  amount: number;
}
export interface OpenPo {
  id: string;
  number: string;
  supplierName: string;
  /** Paise of the order not yet received. */
  remaining: number;
  expectedDate: string | null;
  orderDate: string;
  /** Days the shop usually takes to pay a supplier after receiving (median of its purchases); 0 when unknown. */
  creditDays: number;
}

export interface CashflowInput {
  today: string;
  /** Daily money taken at the counter on the day of the bill (paise), by date; about 14 months back when there is that much history. */
  receipts: Record<string, number>;
  /** The first date the shop has any bill; used to know how much history there is. */
  firstSaleDate: string | null;
  opening: { amount: number | null; source: "entered" | "till" | "none"; asOf: string | null };
  /** Paise; the projected balance below this raises the warning. */
  threshold: number;
  dues: DueBill[];
  payables: PayBill[];
  expenses: ExpenseRow[];
  pos: OpenPo[];
}

export type ItemKind = "collection" | "supplier" | "recurring" | "po";
export interface FlowItem {
  date: string;
  kind: ItemKind;
  label: string;
  /** Always positive; the kind says in or out. */
  amount: number;
  /** For collections: the share of the bill expected, 0 to 1. */
  chance?: number;
  /** The amount trickles in over the whole horizon (a bill already past the date this customer usually pays) instead of landing on `date`. */
  spread?: boolean;
  ref?: string;
}
export interface FlowDay {
  date: string;
  weekday: number;
  salesIn: number;
  collectionsIn: number;
  supplierOut: number;
  recurringOut: number;
  poOut: number;
  festival: string | null;
}
export interface RecurringExpense {
  category: string;
  /** Paise: the typical (median) amount. */
  amount: number;
  dayOfMonth: number;
  months: number;
  nextDate: string;
}
export interface FestivalEffect {
  id: string;
  name: string;
  nameTa: string;
  date: string;
  windowStart: string;
  windowEnd: string;
  /** Last year's sales per day in this window over the weeks before it; null = no usable data last year, no uplift applied. */
  ratio: number | null;
}
export interface Warning {
  date: string;
  balance: number;
  shortBy: number;
  reason: { kind: ItemKind | "none"; label: string; amount: number; date: string };
}
export interface Suggestion {
  kind: "collect" | "delay_po";
  /** The facts the suggestion rests on. */
  dues?: { label: string; amount: number }[];
  duesTotal?: number;
  po?: { number: string; supplier: string; amount: number; date: string; delayDays: number; lowestAfter: number };
}

export interface CashflowFacts {
  today: string;
  horizon: number;
  opening: CashflowInput["opening"];
  balanceKnown: boolean;
  /** Balance at the start of the forecast (what is in hand now), or 0 when unknown. */
  startBalance: number;
  threshold: number;
  days: FlowDay[];
  items: FlowItem[];
  recurring: RecurringExpense[];
  festivals: FestivalEffect[];
  assumptions: {
    weekdayAverage: number[];
    historyDays: number;
    collectRate: Record<RiskBand, number>;
    lateDays: Record<RiskBand, number>;
    overdueSupplierPayDays: number;
  };
  /** Computed at the default assumptions (sales 100%, collection 100%). */
  forecast: { balances: number[]; lowest: { date: string; balance: number }; end: number; totalIn: number; totalOut: number };
  warning: Warning | null;
  suggestions: Suggestion[];
  /** Largest open dues (names are the shop's own customers'). */
  topDues: { label: string; amount: number; band: RiskBand }[];
}

// ------------------------------------------------------------------ pieces

/** Average counter money per weekday over the last 8 weeks (Sunday = 0). Falls back to the overall average with under 14 days of history. */
export function weekdayAverages(receipts: Record<string, number>, today: string, firstSaleDate: string | null): { avg: number[]; historyDays: number } {
  if (!firstSaleDate) return { avg: [0, 0, 0, 0, 0, 0, 0], historyDays: 0 };
  const from = addDays(today, -56);
  const start = firstSaleDate > from ? firstSaleDate : from;
  const days = Math.max(0, daysBetween(start, today));
  const sum = Array(7).fill(0) as number[];
  const cnt = Array(7).fill(0) as number[];
  let total = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    const w = weekdayOf(d);
    const v = receipts[d] ?? 0;
    sum[w]! += v;
    cnt[w]! += 1;
    total += v;
  }
  if (days < 14) {
    const m = days > 0 ? r0(total / days) : 0;
    return { avg: Array(7).fill(m) as number[], historyDays: days };
  }
  return { avg: sum.map((s, i) => (cnt[i]! > 0 ? r0(s / cnt[i]!) : 0)), historyDays: days };
}

const avgOver = (receipts: Record<string, number>, from: string, to: string): { avg: number; days: number } => {
  const n = daysBetween(from, to) + 1;
  if (n <= 0) return { avg: 0, days: 0 };
  let s = 0;
  for (let i = 0; i < n; i++) s += receipts[addDays(from, i)] ?? 0;
  return { avg: s / n, days: n };
};

/** Last year's festival lift from the shop's own counter money, or null when there is not enough data to say. */
export function festivalRatio(receipts: Record<string, number>, fest: PlanFestival, firstSaleDate: string | null): number | null {
  const ly = lastYearOf(fest);
  if (!ly || !firstSaleDate) return null;
  const wFrom = addDays(ly.date, -ly.leadDays);
  const wTo = addDays(ly.date, -1);
  const bFrom = addDays(wFrom, -28);
  const bTo = addDays(wFrom, -1);
  // Needs sales for the whole baseline and window last year.
  if (firstSaleDate > bFrom) return null;
  const win = avgOver(receipts, wFrom, wTo);
  const base = avgOver(receipts, bFrom, bTo);
  if (base.avg <= 0 || win.avg <= 0) return null;
  const ratio = win.avg / base.avg;
  if (!Number.isFinite(ratio) || ratio < 1.15) return null;
  return Math.min(MAX_UPLIFT, r2(ratio));
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Monthly expenses (rent, salary, electricity...), found per category from the month totals: seen in 3 or more of the last 6
 * complete months with a similar total (within 25% of the median) and a similar day of the month. Totals are per category, so
 * a payroll paid to several people is one line and no person or vendor name is needed (or sent anywhere).
 */
export function detectRecurring(rows: ExpenseRow[], today: string): RecurringExpense[] {
  const thisMonth = monthOf(today);
  const from = addMonths(thisMonth, -6) + "-01";
  const byCat = new Map<string, { name: string; months: Map<string, { total: number; days: number[] }> }>();
  for (const r of rows) {
    if (r.date < from || r.date > today || r.amount <= 0) continue;
    const key = r.category.trim().toLowerCase();
    const cat = byCat.get(key) ?? { name: r.category, months: new Map() };
    const m = cat.months.get(monthOf(r.date)) ?? { total: 0, days: [] };
    m.total += r.amount;
    m.days.push(Number(r.date.slice(8, 10)));
    cat.months.set(monthOf(r.date), m);
    byCat.set(key, cat);
  }
  const out: RecurringExpense[] = [];
  for (const cat of byCat.values()) {
    const complete = [...cat.months.entries()].filter(([m]) => m < thisMonth);
    if (complete.length < 3) continue;
    const med = median(complete.map(([, v]) => v.total));
    const good = complete.filter(([, v]) => Math.abs(v.total - med) <= med * 0.25);
    if (good.length < 3) continue;
    const firstDays = good.map(([, v]) => Math.min(...v.days));
    const dom = Math.round(median(firstDays));
    if (Math.max(...firstDays.map((d) => Math.abs(d - dom))) > 6) continue;
    // Next occurrence: this month's day if it is still ahead (less what was already paid this month), else next month.
    const paidNow = cat.months.get(thisMonth)?.total ?? 0;
    let m = thisMonth;
    let next = `${m}-${String(Math.min(dom, daysInMonth(m))).padStart(2, "0")}`;
    let amount = r0(med);
    if (paidNow >= med * 0.75 || next <= today) {
      m = addMonths(thisMonth, 1);
      next = `${m}-${String(Math.min(dom, daysInMonth(m))).padStart(2, "0")}`;
    } else amount = r0(Math.max(0, med - paidNow));
    if (amount <= 0) continue;
    out.push({ category: cat.name, amount, dayOfMonth: dom, months: good.length, nextDate: next });
  }
  return out.sort((a, b) => a.nextDate.localeCompare(b.nextDate) || b.amount - a.amount);
}

/** Expected collection of each open bill: [date, amount, chance]. */
export function collectionPlan(b: DueBill, today: string, horizon: number): { date: string; amount: number }[] {
  const p = COLLECT_RATE[b.band];
  const late = b.lateDays !== null ? Math.max(0, Math.round(b.lateDays)) : DEFAULT_LATE_DAYS[b.band];
  const expect = addDays(b.dueDate, late);
  const end = addDays(today, horizon);
  const expected = b.balance * p;
  if (expect > today) return expect <= end ? [{ date: expect, amount: r0(expected) }] : [];
  // Already past the date they usually pay: it trickles in over the horizon.
  const per = expected / horizon;
  return Array.from({ length: horizon }, (_, i) => ({ date: addDays(today, i + 1), amount: per }));
}

// ------------------------------------------------------------------ the forecast

export interface Adjust {
  /** Percent change of counter sales, e.g. -20 or 15. */
  salesPct?: number;
  /** Collection rate as a percent of the modelled one (100 = as modelled). */
  collectionPct?: number;
}

/** Day-by-day balances from the facts and the two sliders. The browser repeats exactly this sum. */
export function projectBalances(f: Pick<CashflowFacts, "days" | "startBalance">, adj: Adjust = {}): number[] {
  const s = 1 + (adj.salesPct ?? 0) / 100;
  const c = (adj.collectionPct ?? 100) / 100;
  let bal = f.startBalance;
  return f.days.map((d) => {
    bal += d.salesIn * s + d.collectionsIn * c - d.supplierOut - d.recurringOut - d.poOut;
    return r0(bal);
  });
}

export function buildCashflow(input: CashflowInput, horizon = HORIZON_DAYS): CashflowFacts {
  const { today } = input;
  const end = addDays(today, horizon);
  const { avg, historyDays } = weekdayAverages(input.receipts, today, input.firstSaleDate);
  const festAhead = festivalsAhead(today, horizon + 14).map((x) => x.festival);
  // Festivals whose shopping window touches the horizon (including ones that started a few days ago).
  const touching = PLAN_FESTIVALS.filter((f) => {
    const ws = addDays(f.date, -f.leadDays);
    return f.date >= today && ws <= end;
  });
  void festAhead;
  const festivals: FestivalEffect[] = touching.map((f) => ({
    id: f.id,
    name: f.name,
    nameTa: f.nameTa,
    date: f.date,
    windowStart: addDays(f.date, -f.leadDays),
    windowEnd: addDays(f.date, -1),
    ratio: festivalRatio(input.receipts, f, input.firstSaleDate),
  }));

  const days: FlowDay[] = Array.from({ length: horizon }, (_, i) => {
    const date = addDays(today, i + 1);
    const w = weekdayOf(date);
    let sales = avg[w]!;
    let fest: string | null = null;
    for (const f of festivals) {
      if (f.ratio && date >= f.windowStart && date <= f.windowEnd) {
        sales = sales * f.ratio;
        fest = f.id;
      }
    }
    return { date, weekday: w, salesIn: r0(sales), collectionsIn: 0, supplierOut: 0, recurringOut: 0, poOut: 0, festival: fest };
  });
  const at = (d: string) => days[daysBetween(today, d) - 1];
  const items: FlowItem[] = [];

  // Money owed by customers. One line per customer and date in the list (a bill that trickles in is one line, flagged `spread`).
  const collect = new Map<string, FlowItem>();
  for (const b of input.dues) {
    if (b.balance <= 0) continue;
    const plan = collectionPlan(b, today, horizon);
    const p = COLLECT_RATE[b.band];
    const spread = plan.length > 1;
    for (const x of plan) {
      const day = at(x.date);
      if (!day) continue;
      day.collectionsIn += r0(x.amount);
      const key = `${b.customerKey}|${spread ? "spread" : x.date}`;
      const cur = collect.get(key);
      if (cur) cur.amount += r0(x.amount);
      else collect.set(key, { date: spread ? plan[0]!.date : x.date, kind: "collection", label: b.customerName, amount: r0(x.amount), chance: p, ref: b.billId, ...(spread ? { spread: true } : {}) });
    }
  }
  items.push(...[...collect.values()].sort((a, b) => b.amount - a.amount).slice(0, 80));
  // Money the shop owes suppliers.
  for (const b of input.payables) {
    if (b.balance <= 0) continue;
    const date = b.dueDate > today ? b.dueDate : addDays(today, OVERDUE_SUPPLIER_PAY_DAYS);
    const day = at(date);
    if (!day) continue;
    day.supplierOut += b.balance;
    items.push({ date, kind: "supplier", label: b.supplierName, amount: b.balance, ref: b.billId });
  }
  // Monthly expenses.
  const recurring = detectRecurring(input.expenses, today);
  for (const r of recurring) {
    let d = r.nextDate;
    for (let n = 0; n < 3 && d <= end; n++) {
      const day = at(d);
      if (day) {
        day.recurringOut += r.amount;
        items.push({ date: d, kind: "recurring", label: r.category, amount: r.amount });
      }
      const m = addMonths(monthOf(d), 1);
      d = `${m}-${String(Math.min(r.dayOfMonth, daysInMonth(m))).padStart(2, "0")}`;
    }
  }
  // Open purchase orders.
  const poDate = (p: OpenPo) => {
    const arrive = p.expectedDate ?? addDays(p.orderDate, 7);
    const pay = addDays(arrive, p.creditDays);
    return pay > today ? pay : addDays(today, 3);
  };
  for (const p of input.pos) {
    if (p.remaining <= 0) continue;
    const date = poDate(p);
    const day = at(date);
    if (!day) continue;
    day.poOut += p.remaining;
    items.push({ date, kind: "po", label: `${p.number} (${p.supplierName})`, amount: p.remaining, ref: p.id });
  }

  const balanceKnown = input.opening.source !== "none" && input.opening.amount !== null;
  const startBalance = balanceKnown ? input.opening.amount! : 0;
  const base: Pick<CashflowFacts, "days" | "startBalance"> = { days, startBalance };
  const balances = projectBalances(base);
  let low = { date: days[0]!.date, balance: balances[0]! };
  balances.forEach((b, i) => {
    if (b < low.balance) low = { date: days[i]!.date, balance: b };
  });
  const totalIn = days.reduce((a, d) => a + d.salesIn + d.collectionsIn, 0);
  const totalOut = days.reduce((a, d) => a + d.supplierOut + d.recurringOut + d.poOut, 0);

  let warning: Warning | null = null;
  if (balanceKnown) {
    const idx = balances.findIndex((b) => b < input.threshold);
    if (idx >= 0) {
      const date = days[idx]!.date;
      const outs = items.filter((i) => i.kind !== "collection" && i.date <= date).sort((a, b) => b.amount - a.amount);
      const top = outs[0];
      warning = {
        date,
        balance: balances[idx]!,
        shortBy: input.threshold - balances[idx]!,
        reason: top ? { kind: top.kind, label: top.label, amount: top.amount, date: top.date } : { kind: "none", label: "", amount: 0, date },
      };
    }
  }

  // Suggestions.
  const topDues = input.dues
    .filter((d) => d.balance > 0)
    .reduce((m, d) => {
      const cur = m.get(d.customerKey) ?? { label: d.customerName, amount: 0, band: d.band };
      cur.amount += d.balance;
      m.set(d.customerKey, cur);
      return m;
    }, new Map<string, { label: string; amount: number; band: RiskBand }>());
  const topList = [...topDues.values()].sort((a, b) => b.amount - a.amount).slice(0, 3);
  const suggestions: Suggestion[] = [];
  if (topList.length) suggestions.push({ kind: "collect", dues: topList.map((t) => ({ label: t.label, amount: t.amount })), duesTotal: topList.reduce((a, t) => a + t.amount, 0) });
  if (warning) {
    const poItems = items.filter((i) => i.kind === "po" && i.date <= warning!.date).sort((a, b) => b.amount - a.amount);
    const po = poItems[0];
    if (po) {
      const delayDays = 5;
      const shifted = days.map((d) => ({ ...d }));
      const from = shifted[daysBetween(today, po.date) - 1];
      const to = shifted[daysBetween(today, po.date) - 1 + delayDays];
      if (from) from.poOut -= po.amount;
      if (to) to.poOut += po.amount;
      const lowestAfter = Math.min(...projectBalances({ days: shifted, startBalance }));
      if (lowestAfter > low.balance) {
        const num = po.label.split(" (")[0]!;
        const sup = po.label.includes(" (") ? po.label.slice(po.label.indexOf("(") + 1, -1) : "";
        suggestions.push({ kind: "delay_po", po: { number: num, supplier: sup, amount: po.amount, date: po.date, delayDays, lowestAfter } });
      }
    }
  }

  return {
    today,
    horizon,
    opening: input.opening,
    balanceKnown,
    startBalance,
    threshold: input.threshold,
    days,
    items: items.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount),
    recurring,
    festivals,
    assumptions: { weekdayAverage: avg, historyDays, collectRate: COLLECT_RATE, lateDays: DEFAULT_LATE_DAYS, overdueSupplierPayDays: OVERDUE_SUPPLIER_PAY_DAYS },
    forecast: { balances, lowest: low, end: balances[balances.length - 1]!, totalIn, totalOut },
    warning,
    suggestions,
    topDues: topList.map((t) => ({ label: t.label, amount: t.amount, band: t.band })),
  };
}

// ------------------------------------------------------------------ wording


const dShort = (d: string, lang: Lang) => {
  const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MON_TA = ["ஜன.", "பிப்.", "மார்.", "ஏப்.", "மே", "ஜூன்", "ஜூலை", "ஆக.", "செப்.", "அக்.", "நவ.", "டிச."];
  const m = Number(d.slice(5, 7)) - 1;
  return `${Number(d.slice(8, 10))} ${(lang === "ta" ? MON_TA : MON_EN)[m]}`;
};

const KIND_EN: Record<ItemKind | "none", string> = { collection: "collection", supplier: "supplier bill", recurring: "monthly expense", po: "purchase order", none: "" };
const KIND_TA: Record<ItemKind | "none", string> = { collection: "வசூல்", supplier: "சப்ளையர் பில்", recurring: "மாதாந்திர செலவு", po: "கொள்முதல் ஆர்டர்", none: "" };

export interface CashflowText {
  explanation: string;
  suggestions: string[];
}

/** The facts sheet the model writes from (and the only source of numbers it may use). Customer names are the shop's own; no phones. */
export function cashflowSheet(f: CashflowFacts): string {
  const n = (s: string) => neutralise(s).text || s;
  const L: string[] = [];
  L.push(`Forecast: next ${f.horizon} days from ${dShort(f.today, "en")}`);
  L.push(f.balanceKnown ? `Money in hand today: ${rupees(f.startBalance)}` : "Money in hand today: not entered by the owner");
  L.push(`Expected money in: ${rupees(f.forecast.totalIn)}`);
  L.push(`Expected money out: ${rupees(f.forecast.totalOut)}`);
  if (f.balanceKnown) {
    L.push(`Balance after ${f.horizon} days: ${rupees(f.forecast.end)}`);
    L.push(`Lowest balance: ${rupees(f.forecast.lowest.balance)} on ${dShort(f.forecast.lowest.date, "en")}`);
    L.push(`Warning level set by the owner: ${rupees(f.threshold)}`);
  }
  if (f.warning) {
    const w = f.warning;
    L.push(`WARNING: the balance drops below the warning level on ${dShort(w.date, "en")} to ${rupees(w.balance)}, short by ${rupees(w.shortBy)}`);
    if (w.reason.kind !== "none") L.push(`Main reason: ${KIND_EN[w.reason.kind]} ${n(w.reason.label)} of ${rupees(w.reason.amount)} due on ${dShort(w.reason.date, "en")}`);
  } else if (f.balanceKnown) L.push("No dip below the warning level is expected.");
  for (const s of f.suggestions) {
    if (s.kind === "collect" && s.dues) L.push(`Top ${s.dues.length} dues to collect (total ${rupees(s.duesTotal ?? 0)}): ${s.dues.map((d) => `${n(d.label)} ${rupees(d.amount)}`).join("; ")}`);
    if (s.kind === "delay_po" && s.po) L.push(`Option: delay purchase order ${n(s.po.number)} of ${rupees(s.po.amount)} by ${s.po.delayDays} days; the lowest balance would then be ${rupees(s.po.lowestAfter)}`);
  }
  for (const r of f.recurring.slice(0, 4)) L.push(`Monthly expense: ${n(r.category)} about ${rupees(r.amount)} around day ${r.dayOfMonth}`);
  for (const x of f.festivals.filter((x) => x.ratio)) L.push(`Festival: ${x.name} on ${dShort(x.date, "en")}, sales usually ${x.ratio} times normal in its shopping window`);
  return L.join("\n");
}

/** The deterministic wording (en or ta), from the same facts. */
export function templateCashflow(f: CashflowFacts, lang: Lang): CashflowText {
  const ta = lang === "ta";
  const parts: string[] = [];
  if (!f.balanceKnown) {
    parts.push(
      ta
        ? `அடுத்த ${f.horizon} நாளில் ${rupees(f.forecast.totalIn)} வரவும் ${rupees(f.forecast.totalOut)} செலவும் எதிர்பார்க்கப்படுகிறது. உங்கள் கையிருப்புப் பணத்தை உள்ளிட்டால் எச்சரிக்கை காட்டுவோம்.`
        : `Over the next ${f.horizon} days about ${rupees(f.forecast.totalIn)} should come in and ${rupees(f.forecast.totalOut)} should go out. Enter your cash and bank balance to get a warning.`,
    );
  } else {
    parts.push(
      ta
        ? `இன்று கையில் ${rupees(f.startBalance)}. அடுத்த ${f.horizon} நாளில் ${rupees(f.forecast.totalIn)} வரவு, ${rupees(f.forecast.totalOut)} செலவு எதிர்பார்க்கப்படுகிறது; முடிவில் ${rupees(f.forecast.end)}.`
        : `You have ${rupees(f.startBalance)} today. Over the next ${f.horizon} days about ${rupees(f.forecast.totalIn)} should come in and ${rupees(f.forecast.totalOut)} go out, leaving ${rupees(f.forecast.end)}.`,
    );
    if (f.warning) {
      const w = f.warning;
      const why =
        w.reason.kind === "none"
          ? ""
          : ta
            ? ` முக்கிய காரணம்: ${KIND_TA[w.reason.kind]} ${w.reason.label} ${rupees(w.reason.amount)} (${dShort(w.reason.date, "ta")}).`
            : ` Main reason: ${KIND_EN[w.reason.kind]} ${w.reason.label} of ${rupees(w.reason.amount)} on ${dShort(w.reason.date, "en")}.`;
      parts.push(
        ta
          ? `${dShort(w.date, "ta")} அன்று இருப்பு ${rupees(w.balance)} ஆகக் குறைந்து, எச்சரிக்கை அளவை விட ${rupees(w.shortBy)} குறைவாக இருக்கும்.${why}`
          : `On ${dShort(w.date, "en")} the balance is expected to fall to ${rupees(w.balance)}, ${rupees(w.shortBy)} below your warning level.${why}`,
      );
    } else parts.push(ta ? "எச்சரிக்கை அளவுக்குக் கீழே இருப்பு குறையாது." : "The balance is not expected to fall below your warning level.");
  }
  const sug: string[] = [];
  for (const s of f.suggestions) {
    if (s.kind === "collect" && s.dues?.length) {
      const names = s.dues.map((d) => d.label).join(", ");
      sug.push(ta ? `முதல் ${s.dues.length} நிலுவைகளிலிருந்து ${rupees(s.duesTotal ?? 0)} வசூலிக்கவும்: ${names}.` : `Collect ${rupees(s.duesTotal ?? 0)} from the top ${s.dues.length} dues: ${names}.`);
    }
    if (s.kind === "delay_po" && s.po) {
      sug.push(
        ta
          ? `ஆர்டர் ${s.po.number} (${rupees(s.po.amount)}) ஐ ${s.po.delayDays} நாள் தள்ளிப்போட்டால் குறைந்த இருப்பு ${rupees(s.po.lowestAfter)} ஆகும்.`
          : `Delay order ${s.po.number} (${rupees(s.po.amount)}) by ${s.po.delayDays} days and the lowest balance becomes ${rupees(s.po.lowestAfter)}.`,
      );
    }
  }
  return { explanation: parts.join(" "), suggestions: sug.slice(0, 2) };
}

export const CASHFLOW_SYSTEM = [
  "You write a short note for a small Indian shop owner about their next 30 days of cash, from a facts sheet the shop's software already worked out (a forecast, not a promise).",
  "Use ONLY the facts in the sheet. Every number you write (rupee amounts, days, dates, times) must be copied exactly from the sheet. Never calculate, round, add or invent a number. If something is not in the sheet, leave it out. Do not give financial, legal or tax advice, do not promise any outcome and do not tell the owner to borrow money.",
  "explanation: 2 to 4 short sentences (at most 70 words): where the balance is heading, and if there is a warning, the date and the main reason. Say 'about' or 'expected' for forecast figures.",
  "suggestions: at most 2 short suggestions (each at most 25 words), only from the 'Top dues' and 'Option' lines of the sheet (collect money from the named dues, or delay the named purchase order). If the sheet has no such line, return an empty list.",
  "Write in the requested language: en = simple English, ta = natural spoken Tamil in Tamil script. Keep customer, supplier and order names as given. Rupee amounts keep the ₹ sign and the same digits.",
  DATA_RULES,
].join("\n");

const Out = z.object({ explanation: z.string(), suggestions: z.array(z.string()).max(3) });
const OUT_JSON = {
  type: "object",
  properties: { explanation: { type: "string" }, suggestions: { type: "array", items: { type: "string" } } },
  required: ["explanation", "suggestions"],
  additionalProperties: false,
} as const;

export interface CashflowWords extends CashflowText {
  source: "ai" | "template";
  fallbackReason: string | null;
  runId: string | null;
  credits: number;
}

/** AI wording when allowed; numbers must all be in the sheet, else the template. */
export async function writeCashflow(ai: AiRunner | null, req: { tenantId: string; userId?: string | null; facts: CashflowFacts; lang: Lang }): Promise<CashflowWords> {
  const tpl = templateCashflow(req.facts, req.lang);
  const base = { ...tpl, source: "template" as const, fallbackReason: null as string | null, runId: null as string | null, credits: 0 };
  if (!ai) return base;
  const sheet = cashflowSheet(req.facts);
  try {
    const r = await ai.run<z.infer<typeof Out>>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: CASHFLOW_FEATURE,
      tier: "light",
      system: CASHFLOW_SYSTEM,
      input: { text: `Language: ${req.lang}\n${dataBlock("cash-flow facts", sheet)}` },
      schema: { name: "cashflow_words", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: Out },
      maxTokens: 4000,
    });
    const allowed = allowedNumbers(sheet);
    const explanation = r.output.explanation.replace(/\s+/g, " ").trim();
    const sugg = r.output.suggestions.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 2);
    const all = [explanation, ...sugg].join(" ");
    if (!explanation || explanation.length > 600 || sugg.some((s) => s.length > 300)) return { ...base, runId: r.runId, credits: r.credits, fallbackReason: "length" };
    if (!checkNumbers(all, allowed).ok) return { ...base, runId: r.runId, credits: r.credits, fallbackReason: "numbers" };
    // A suggestion must exist in the facts: no collect/delay line without its source.
    const hasCollect = req.facts.suggestions.some((s) => s.kind === "collect");
    const hasPo = req.facts.suggestions.some((s) => s.kind === "delay_po");
    const okSug = sugg.filter((s) => (/delay|தள்ளி|ஒத்தி/i.test(s) ? hasPo : true) && (/collect|வசூல்/i.test(s) ? hasCollect : true));
    return { explanation, suggestions: okSug, source: "ai", fallbackReason: null, runId: r.runId, credits: r.credits };
  } catch (e) {
    return { ...base, fallbackReason: (e as { code?: string }).code ?? "ai_failed" };
  }
}

