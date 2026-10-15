/** Pure expense math: GST inside an amount, ITC eligibility, summaries and the profit report (no database). */
import { isValidGstin } from "@srirealtime/gst";

/** GST contained in a GST-inclusive amount: amount × rate / (100 + rate), rounded to the paisa. */
export function gstFromInclusive(amount: number, rate: number): number {
  if (!amount || !rate || rate <= 0) return 0;
  return Math.round((amount * rate) / (100 + rate));
}

/** The stored GST: the given amount when provided, else computed from the rate. */
export const resolveGst = (amount: number, rate: number, given?: number | null): number =>
  given === undefined || given === null ? gstFromInclusive(amount, rate) : given;

export interface ItcLike {
  gstAmount: number;
  vendorGstin: string | null;
  status?: string;
}

/** Input tax credit of an expense: its GST, only when the vendor GSTIN is valid and the expense isn't cancelled. */
export function itcOf(e: ItcLike): number {
  if (e.status === "cancelled") return 0;
  return isValidGstin(e.vendorGstin) ? e.gstAmount : 0;
}

export interface SummaryExpense extends ItcLike {
  date: string;
  categoryId: string;
  amount: number;
}

export interface SummaryBucket {
  total: number;
  gst: number;
  itc: number;
  count: number;
}

export interface ExpenseSummary extends SummaryBucket {
  byCategory: (SummaryBucket & { categoryId: string; name: string })[];
  byMonth: (SummaryBucket & { month: string })[];
}

const empty = (): SummaryBucket => ({ total: 0, gst: 0, itc: 0, count: 0 });
const add = (b: SummaryBucket, e: SummaryExpense) => {
  b.total += e.amount;
  b.gst += e.gstAmount;
  b.itc += itcOf(e);
  b.count += 1;
};

/** Totals by category (largest first) and by month "YYYY-MM" (oldest first). Cancelled expenses are left out. */
export function summarize(
  rows: readonly SummaryExpense[],
  categories: readonly { id: string; name: string; sort?: number }[],
): ExpenseSummary {
  const total = empty();
  const byCat = new Map<string, SummaryBucket>();
  const byMonth = new Map<string, SummaryBucket>();
  for (const e of rows) {
    if (e.status === "cancelled") continue;
    add(total, e);
    let c = byCat.get(e.categoryId);
    if (!c) byCat.set(e.categoryId, (c = empty()));
    add(c, e);
    const month = e.date.slice(0, 7);
    let m = byMonth.get(month);
    if (!m) byMonth.set(month, (m = empty()));
    add(m, e);
  }
  const names = new Map(categories.map((c) => [c.id, c.name]));
  return {
    ...total,
    byCategory: [...byCat]
      .map(([categoryId, b]) => ({ categoryId, name: names.get(categoryId) ?? "Other", ...b }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    byMonth: [...byMonth].map(([month, b]) => ({ month, ...b })).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export interface GstTotals {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface ProfitReport {
  from: string;
  to: string;
  sales: { taxable: number; tax: number };
  purchases: { taxable: number; itc: number };
  expenses: { total: number; itc: number };
  /** sales.taxable − purchases.taxable */
  grossProfit: number;
  /** grossProfit − (expenses.total − expenses.itc) */
  netProfit: number;
  /** payable = output − itc; negative means credit carried forward. */
  gst: { output: number; itc: number; payable: number };
}

const taxOf = (t: GstTotals) => t.cgst + t.sgst + t.igst;

/** Profit and GST position for a period (all paise). */
export function profitReport(
  from: string,
  to: string,
  sales: GstTotals,
  purchases: GstTotals,
  expenses: { total: number; itc: number },
): ProfitReport {
  const salesTax = taxOf(sales);
  const purchasesItc = taxOf(purchases);
  const grossProfit = sales.taxable - purchases.taxable;
  const netProfit = grossProfit - (expenses.total - expenses.itc);
  const itc = purchasesItc + expenses.itc;
  return {
    from,
    to,
    sales: { taxable: sales.taxable, tax: salesTax },
    purchases: { taxable: purchases.taxable, itc: purchasesItc },
    expenses: { total: expenses.total, itc: expenses.itc },
    grossProfit,
    netProfit,
    gst: { output: salesTax, itc, payable: salesTax - itc },
  };
}

export const ZERO_GST: GstTotals = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
