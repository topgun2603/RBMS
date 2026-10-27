/**
 * Fixed assets and depreciation (book depreciation, pure). Straight line (SLM) by a yearly rate or a useful life, or
 * written-down value (WDV) by a yearly rate on the value at the start of each financial year. Depreciation runs by
 * days in use: an asset bought in the middle of a year gets that share of the year's charge. It never takes the value
 * below the residual (salvage) value. Income-tax depreciation (block of assets, half rate under 180 days) is not this.
 */
import { financialYearOf } from "./tds-rules";

export interface AssetForDepreciation {
  cost: number;
  salvage: number;
  method: "slm" | "wdv";
  /** Yearly rate in basis points (WDV, or SLM by rate). */
  rate: number | null;
  lifeMonths: number | null;
  inUseFrom: string;
  disposedOn?: string | null;
}

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const max = (a: string, b: string) => (a > b ? a : b);
const min = (a: string, b: string) => (a < b ? a : b);

/** Yearly SLM charge (paise). */
export function slmYearly(a: AssetForDepreciation): number {
  const base = Math.max(0, a.cost - a.salvage);
  if (a.lifeMonths && a.lifeMonths > 0) return (base * 12) / a.lifeMonths;
  return (base * (a.rate ?? 0)) / 10_000;
}

export interface DepreciationPiece {
  from: string;
  to: string;
  fy: string;
  amount: number;
}

/**
 * Depreciation for days `from`..`to` (inclusive), split by financial year. `accumulated` = depreciation charged before
 * `from` (including what was charged before these books); `chargedEarlierInFirstYear` = the part of it charged in the
 * same financial year as `from` (WDV works on the value at the start of the year, so monthly runs add up to the
 * yearly figure). Amounts are whole rupees (paise multiples of 100).
 */
export function depreciationBetween(a: AssetForDepreciation, from: string, to: string, accumulated: number, chargedEarlierInFirstYear = 0): DepreciationPiece[] {
  const start = max(from, a.inUseFrom);
  const end = a.disposedOn ? min(to, addDays(a.disposedOn, -1)) : to;
  if (start > end) return [];
  const out: DepreciationPiece[] = [];
  let acc = accumulated;
  let cursor = start;
  const limit = Math.max(0, a.cost - a.salvage);
  while (cursor <= end && acc < limit) {
    const fy = financialYearOf(cursor);
    const pieceEnd = min(end, fy.to);
    const share = days(cursor, pieceEnd) / days(fy.from, fy.to);
    let amount: number;
    if (a.method === "slm") amount = slmYearly(a) * share;
    else {
      // WDV on the value at the start of this year (or when it came into use). Depreciation charged earlier in the
      // same year is added back so monthly runs add up to the yearly figure.
      const chargedThisYear = out.filter((p) => p.fy === fy.fy).reduce((t, p) => t + p.amount, 0) + (fy.fy === financialYearOf(start).fy ? chargedEarlierInFirstYear : 0);
      const opening = a.cost - (acc - chargedThisYear);
      amount = (opening * (a.rate ?? 0) * share) / 10_000;
    }
    amount = Math.round(amount / 100) * 100;
    amount = Math.min(amount, limit - acc);
    if (amount > 0) out.push({ from: cursor, to: pieceEnd, fy: fy.fy, amount });
    acc += Math.max(0, amount);
    cursor = addDays(pieceEnd, 1);
  }
  return out;
}

/**
 * WDV needs the year's opening value even when a run starts mid-year: the service passes `accumulated` = everything
 * charged before `from`, and for WDV the charge of earlier runs in the same year. This helper gives the yearly
 * figure for the schedule screen: opening value, depreciation for the year, closing value.
 */
export function yearSchedule(a: AssetForDepreciation, fyFrom: string, fyTo: string, accumulatedBeforeYear: number) {
  const opening = Math.max(0, a.cost - accumulatedBeforeYear);
  const pieces = depreciationBetween(a, fyFrom, fyTo, accumulatedBeforeYear);
  const dep = pieces.reduce((t, p) => t + p.amount, 0);
  return { opening, depreciation: dep, closing: opening - dep };
}

/** Selling or scrapping an asset: the gain (+) or loss (-) against its value in the books. */
export function disposalResult(cost: number, accumulated: number, saleAmount: number) {
  const bookValue = cost - accumulated;
  return { bookValue, gain: saleAmount - bookValue };
}

// ------------------------------------------------------------------ year-end close

export interface CloseAccount {
  id: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  group: string;
}

export interface CloseLine {
  accountId: string;
  debit: number;
  credit: number;
  memo?: string;
}

/**
 * The closing journal of a financial year. Every income and expense account's balance for the year (debit - credit)
 * is moved out, the Stock in hand account is brought to the valued closing stock (periodic method) when stock is
 * valued, and the difference - the year's profit - goes to Retained earnings. Returns the lines and the profit.
 */
export function closingLines(
  accounts: readonly CloseAccount[],
  yearNet: ReadonlyMap<string, number>,
  opts: { retainedEarningsId: string; stockAccountId?: string | null; stockAdjustment?: number },
): { lines: CloseLine[]; netProfit: number; stockAdjustment: number } {
  const lines: CloseLine[] = [];
  let nominal = 0;
  for (const a of accounts) {
    if (a.type !== "income" && a.type !== "expense") continue;
    const net = yearNet.get(a.id) ?? 0;
    if (!net) continue;
    nominal += net;
    lines.push(net > 0 ? { accountId: a.id, debit: 0, credit: net, memo: "Closed to retained earnings" } : { accountId: a.id, debit: -net, credit: 0, memo: "Closed to retained earnings" });
  }
  const stockAdj = opts.stockAccountId ? (opts.stockAdjustment ?? 0) : 0;
  if (stockAdj) lines.push(stockAdj > 0 ? { accountId: opts.stockAccountId!, debit: stockAdj, credit: 0, memo: "Closing stock" } : { accountId: opts.stockAccountId!, debit: 0, credit: -stockAdj, memo: "Closing stock" });
  // Income has a credit (negative) net; profit = -(sum of nominal nets) + the stock brought in.
  const netProfit = -nominal + stockAdj;
  if (netProfit) lines.push(netProfit > 0 ? { accountId: opts.retainedEarningsId, debit: 0, credit: netProfit, memo: "Profit for the year" } : { accountId: opts.retainedEarningsId, debit: -netProfit, credit: 0, memo: "Loss for the year" });
  return { lines, netProfit, stockAdjustment: stockAdj };
}
