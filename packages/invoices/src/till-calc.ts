/** Pure POS till maths (no database): denomination counts, cash expected in the drawer and the X / Z report. */
import type { DenominationCount, PaymentMethod, TillCashEntry } from "./schema";

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
  cash: { opening: number; sales: number; refunds: number; cashIn: number; cashOut: number; expected: number };
}

export interface TillReportSource {
  openingCash: number;
  cashEntries: readonly Pick<TillCashEntry, "amount">[];
  /** Invoice payments tagged with the session (refunds are negative, source "refund"). */
  payments: readonly { method: PaymentMethod; amount: number; source: string }[];
  /** Bills tagged with the session. */
  bills: readonly { status: string; total: number; balance: number }[];
  /** Issued credit notes tagged with the session. */
  creditNotes: readonly { total: number }[];
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

/** The X report (running totals) of a session; the Z report is the same frozen at close. */
export function tillReport(src: TillReportSource): TillReport {
  const inRows = src.payments.filter((p) => p.amount > 0 && p.source !== "refund");
  const outRows = src.payments.filter((p) => p.amount < 0).map((p) => ({ method: p.method, amount: -p.amount }));
  const payments = byMethod(inRows);
  const refunds = byMethod(outRows);
  const live = src.bills.filter((b) => b.status !== "cancelled" && b.status !== "draft");
  const { cashIn, cashOut } = cashEntryTotals(src.cashEntries);
  const sales = payments.find((p) => p.method === "cash")?.amount ?? 0;
  const cashRefunds = refunds.find((p) => p.method === "cash")?.amount ?? 0;
  return {
    bills: { count: live.length, total: live.reduce((s, b) => s + b.total, 0), cancelled: src.bills.filter((b) => b.status === "cancelled").length },
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
      expected: expectedCash({ openingCash: src.openingCash, cashSales: sales, cashRefunds, cashIn, cashOut }),
    },
  };
}
