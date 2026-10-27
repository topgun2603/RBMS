/** Pure POS till maths (no database): denomination counts, cash expected in the drawer and the X / Z report. */
import type { DenominationCount, PaymentMethod, TillCashCategory, TillCashEntry } from "./schema";

/** Notes and coins in rupees, largest first. */
export const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

/** Paise in a counted drawer: Σ rupee value × count. Unknown denominations and bad counts are ignored. */
export function countTotal(counts: DenominationCount | null | undefined): number {
  if (!counts) return 0;
  let paise = 0;
  for (const [k, n] of Object.entries(counts)) {
    const d = Number(k);
    if (!(DENOMINATIONS as readonly number[]).includes(d)) continue;
    if (!Number.isInteger(n) || n < 0) continue;
    paise += d * 100 * n;
  }
  return paise;
}

export function cashEntryTotals(entries: readonly Pick<TillCashEntry, "amount">[]): { cashIn: number; cashOut: number } {
  let cashIn = 0;
  let cashOut = 0;
  for (const e of entries) {
    if (e.amount > 0) cashIn += e.amount;
    else cashOut += -e.amount;
  }
  return { cashIn, cashOut };
}

/** Cash that should be in the drawer: opening + cash sales − cash refunds + cash in − cash out. */
export function expectedCash(p: { openingCash: number; cashSales: number; cashRefunds: number; cashIn: number; cashOut: number }): number {
  return p.openingCash + p.cashSales - p.cashRefunds + p.cashIn - p.cashOut;
}

/** Cash in / out by category (the Z report's "pay-in / pay-out" block). Entries without a category read as "other". */
export interface TillCategoryRow {
  category: TillCashCategory;
  cashIn: number;
  cashOut: number;
  count: number;
}

export function cashByCategory(entries: readonly Pick<TillCashEntry, "amount" | "category">[]): TillCategoryRow[] {
  const m = new Map<TillCashCategory, TillCategoryRow>();
  for (const e of entries) {
    if (!e.amount) continue;
    const category = e.category ?? "other";
    const row = m.get(category) ?? { category, cashIn: 0, cashOut: 0, count: 0 };
    if (e.amount > 0) row.cashIn += e.amount;
    else row.cashOut += -e.amount;
    row.count += 1;
    m.set(category, row);
  }
  return [...m.values()].sort((a, b) => b.cashIn + b.cashOut - (a.cashIn + a.cashOut) || a.category.localeCompare(b.category));
}

/** Tax of the till's bills (or returns) at one GST rate. */
export interface TillTaxRow {
  gstRate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface TillMethodRow {
  method: PaymentMethod;
  amount: number;
  count: number;
}

export interface TillReport {
  /** Bills made at this till (not cancelled), their total, and how many were cancelled since. */
  bills: { count: number; total: number; cancelled: number };
  /** Money received at this till, by method. */
  payments: TillMethodRow[];
  /** Money paid back at this till (credit note refunds), by method. */
  refunds: TillMethodRow[];
  creditNotes: { count: number; total: number };
  /** What the till's bills left on customers' accounts (balance still due). */
  onCredit: number;
  collected: number;
  refunded: number;
  cash: {
    opening: number;
    sales: number;
    refunds: number;
    cashIn: number;
    cashOut: number;
    /** Differences found when the drawer was handed over (counted − expected); they stay with the cashier who handed over. */
    handoverAdjust?: number;
    expected: number;
  };
  // Added with the Z numbering (docs/counter-close-display-labels.md); reports frozen before it do not have them.
  /** Cancelled (void) bills of the session and their value. */
  voids?: { count: number; total: number };
  /** Discount given on the session's bills (paise), and on how many bills. */
  discounts?: { total: number; bills: number };
  /** Net tax of the session's bills by GST rate. */
  taxByRate?: TillTaxRow[];
  /** Tax returned with credit notes by GST rate. */
  returnsTaxByRate?: TillTaxRow[];
  /** First and last bill number of the session (null = no numbered bill). */
  billRange?: { from: string | null; to: string | null };
  /** Cash in / out by category. */
  cashByCategory?: TillCategoryRow[];
}

export interface TillReportSource {
  openingCash: number;
  cashEntries: readonly Pick<TillCashEntry, "amount" | "category">[];
  /** Invoice payments tagged with the session (refunds are negative, source "refund"). */
  payments: readonly { method: PaymentMethod; amount: number; source: string }[];
  /** Bills tagged with the session. */
  bills: readonly TillBillSource[];
  /** Issued credit notes tagged with the session. */
  creditNotes: readonly { total: number; taxBreakup?: readonly TillTaxRow[] | null }[];
  /** Differences recorded at cashier handovers. */
  handoverDifferences?: readonly number[];
}

export interface TillBillSource {
  status: string;
  total: number;
  balance: number;
  number?: string | null;
  fy?: string | null;
  seq?: number | null;
  /** Discount on the bill (paise). */
  discount?: number;
  taxBreakup?: readonly TillTaxRow[] | null;
}

const byMethod = (rows: { method: PaymentMethod; amount: number }[]): TillMethodRow[] => {
  const m = new Map<PaymentMethod, TillMethodRow>();
  for (const r of rows) {
    const row = m.get(r.method) ?? { method: r.method, amount: 0, count: 0 };
    row.amount += r.amount;
    row.count += 1;
    m.set(r.method, row);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || a.method.localeCompare(b.method));
};

/** Adds tax rows of the same GST rate together, ordered by rate. */
export function mergeTaxRows(rows: readonly TillTaxRow[]): TillTaxRow[] {
  const m = new Map<number, TillTaxRow>();
  for (const r of rows) {
    const t = m.get(r.gstRate) ?? { gstRate: r.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    t.taxable += r.taxable;
    t.cgst += r.cgst;
    t.sgst += r.sgst;
    t.igst += r.igst;
    m.set(r.gstRate, t);
  }
  return [...m.values()].sort((a, b) => a.gstRate - b.gstRate);
}

/** First and last numbered bill: by financial year and sequence when the bills have them, else by number text. */
export function billRange(bills: readonly Pick<TillBillSource, "number" | "fy" | "seq">[]): { from: string | null; to: string | null } {
  const numbered = bills.filter((b): b is { number: string; fy?: string | null; seq?: number | null } => !!b.number);
  if (numbered.length === 0) return { from: null, to: null };
  const sorted = [...numbered].sort(
    (a, b) => (a.fy ?? "").localeCompare(b.fy ?? "") || (a.seq ?? 0) - (b.seq ?? 0) || a.number.localeCompare(b.number, "en", { numeric: true }),
  );
  return { from: sorted[0]!.number, to: sorted[sorted.length - 1]!.number };
}

/** The X report (running totals) of a session; the Z report is the same frozen at close. */
export function tillReport(src: TillReportSource): TillReport {
  const inRows = src.payments.filter((p) => p.amount > 0 && p.source !== "refund");
  const outRows = src.payments.filter((p) => p.amount < 0).map((p) => ({ method: p.method, amount: -p.amount }));
  const payments = byMethod(inRows);
  const refunds = byMethod(outRows);
  const live = src.bills.filter((b) => b.status !== "cancelled" && b.status !== "draft");
  const { cashIn, cashOut } = cashEntryTotals(src.cashEntries);
  const handoverAdjust = (src.handoverDifferences ?? []).reduce((a, d) => a + d, 0);
  const cancelled = src.bills.filter((b) => b.status === "cancelled");
  const sales = payments.find((p) => p.method === "cash")?.amount ?? 0;
  const cashRefunds = refunds.find((p) => p.method === "cash")?.amount ?? 0;
  return {
    bills: { count: live.length, total: live.reduce((s, b) => s + b.total, 0), cancelled: cancelled.length },
    payments,
    refunds,
    creditNotes: { count: src.creditNotes.length, total: src.creditNotes.reduce((s, c) => s + c.total, 0) },
    onCredit: live.reduce((s, b) => s + Math.max(b.balance, 0), 0),
    collected: payments.reduce((s, p) => s + p.amount, 0),
    refunded: refunds.reduce((s, p) => s + p.amount, 0),
    cash: {
      opening: src.openingCash,
      sales,
      refunds: cashRefunds,
      cashIn,
      cashOut,
      ...(handoverAdjust ? { handoverAdjust } : {}),
      expected: expectedCash({ openingCash: src.openingCash, cashSales: sales, cashRefunds, cashIn, cashOut }) + handoverAdjust,
    },
    voids: { count: cancelled.length, total: cancelled.reduce((s, b) => s + b.total, 0) },
    discounts: { total: live.reduce((s, b) => s + (b.discount ?? 0), 0), bills: live.filter((b) => (b.discount ?? 0) > 0).length },
    taxByRate: mergeTaxRows(live.flatMap((b) => b.taxBreakup ?? [])),
    returnsTaxByRate: mergeTaxRows(src.creditNotes.flatMap((c) => c.taxBreakup ?? [])),
    billRange: billRange(live),
    cashByCategory: cashByCategory(src.cashEntries),
  };
}
