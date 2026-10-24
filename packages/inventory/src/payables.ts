/**
 * Pure supplier-payables rules (no database): balances, oldest-first allocation, ageing buckets, the supplier
 * statement, landed-cost apportioning and purchase order progress. Money is whole paise throughout.
 */

export const AGEING_BUCKETS = ["b0_30", "b31_60", "b61_90", "b90plus"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** What is still to pay on a bill: total less goods returned less money paid (negative = the supplier owes us). */
export const purchaseBalance = (p: { total: number; returnedAmount: number; amountPaid: number }): number =>
  p.total - p.returnedAmount - p.amountPaid;

export interface DueBill {
  id: string;
  /** Still to pay, paise (only bills with a positive balance are paid). */
  balance: number;
  /** Bill date, YYYY-MM-DD (oldest first). */
  date: string;
  createdAt?: number;
}

export interface Allocation {
  id: string;
  amount: number;
}

/**
 * Splits a lump payment over bills, oldest first (bill date, then entry time, then id). Returns the parts and what is
 * left over (an advance / on-account amount). Bills with no positive balance are skipped.
 */
export function allocateOldestFirst(amount: number, bills: readonly DueBill[]): { allocations: Allocation[]; remainder: number } {
  let left = Math.max(0, Math.trunc(amount));
  const sorted = [...bills]
    .filter((b) => b.balance > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.id < b.id ? -1 : 1)));
  const allocations: Allocation[] = [];
  for (const b of sorted) {
    if (left <= 0) break;
    const part = Math.min(left, b.balance);
    allocations.push({ id: b.id, amount: part });
    left -= part;
  }
  return { allocations, remainder: left };
}

/** Problem with chosen allocations (null = fine): duplicates, non-positive parts, more than a bill's balance or the payment. */
export function allocationProblem(amount: number, chosen: readonly Allocation[], balances: ReadonlyMap<string, number>): string | null {
  const seen = new Set<string>();
  let sum = 0;
  for (const a of chosen) {
    if (seen.has(a.id)) return "A bill is listed twice";
    seen.add(a.id);
    if (!Number.isInteger(a.amount) || a.amount <= 0) return "Each part must be more than 0";
    const bal = balances.get(a.id);
    if (bal === undefined) return "A chosen bill was not found";
    if (a.amount > bal) return "A part is more than what is due on that bill";
    sum += a.amount;
  }
  if (sum > amount) return "The parts add up to more than the payment";
  return null;
}

const DAY = 86_400_000;
const dayNumber = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from);

/** 0-30 (also not yet due), 31-60, 61-90, over 90 days past the due date (the bill date when there is no due date). */
export function ageBucket(days: number): AgeingBucket {
  if (days <= 30) return "b0_30";
  if (days <= 60) return "b31_60";
  if (days <= 90) return "b61_90";
  return "b90plus";
}

export interface AgeingBill {
  supplierId: string | null;
  supplierName: string;
  date: string;
  dueDate: string | null;
  balance: number;
}
export interface AgeingSupplier {
  supplierId: string | null;
  name: string;
  /** Unsettled opening balance (counted in 90+ when positive). */
  opening: number;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b90plus: number;
  /** Credit: advances and bills overpaid / returned (money the supplier owes us), paise, positive number. */
  advance: number;
  /** Net payable = sum of buckets + opening - advance. */
  total: number;
  /** Portion of the buckets past their due date. */
  overdue: number;
}

export interface AgeingReport {
  asOf: string;
  rows: AgeingSupplier[];
  totals: Omit<AgeingSupplier, "supplierId" | "name">;
}

const blank = (supplierId: string | null, name: string): AgeingSupplier => ({
  supplierId,
  name,
  opening: 0,
  b0_30: 0,
  b31_60: 0,
  b61_90: 0,
  b90plus: 0,
  advance: 0,
  total: 0,
  overdue: 0,
});

/**
 * Payables ageing as of a date. `openings` is each supplier's unsettled opening balance (opening less on-account
 * payments; negative = advance). Bills with a negative balance are credits. Rows with nothing owed or credited are left out.
 */
export function buildAgeing(
  asOf: string,
  bills: readonly AgeingBill[],
  openings: readonly { supplierId: string; name: string; unsettled: number }[] = [],
): AgeingReport {
  const map = new Map<string, AgeingSupplier>();
  const rowOf = (id: string | null, name: string) => {
    const key = id ?? `name:${name}`;
    let r = map.get(key);
    if (!r) map.set(key, (r = blank(id, name)));
    return r;
  };
  for (const o of openings) {
    const r = rowOf(o.supplierId, o.name);
    if (o.unsettled > 0) r.opening += o.unsettled;
    else if (o.unsettled < 0) r.advance += -o.unsettled;
  }
  for (const b of bills) {
    if (b.balance === 0) continue;
    const r = rowOf(b.supplierId, b.supplierName);
    if (b.balance < 0) {
      r.advance += -b.balance;
      continue;
    }
    const ref = b.dueDate ?? b.date;
    const days = daysBetween(ref, asOf);
    r[ageBucket(days)] += b.balance;
    if (days > 0) r.overdue += b.balance;
  }
  const rows = [...map.values()];
  for (const r of rows) {
    // An unsettled opening balance is the oldest debt of all.
    r.overdue += r.opening;
    r.total = r.opening + r.b0_30 + r.b31_60 + r.b61_90 + r.b90plus - r.advance;
  }
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const { supplierId: _s, name: _n, ...zero } = blank(null, "");
  const totals = rows.reduce(
    (t, r) => ({
      opening: t.opening + r.opening,
      b0_30: t.b0_30 + r.b0_30,
      b31_60: t.b31_60 + r.b31_60,
      b61_90: t.b61_90 + r.b61_90,
      b90plus: t.b90plus + r.b90plus,
      advance: t.advance + r.advance,
      total: t.total + r.total,
      overdue: t.overdue + r.overdue,
    }),
    zero,
  );
  return { asOf, rows: rows.filter((r) => r.total !== 0 || r.advance !== 0), totals };
}

export const STATEMENT_TYPES = ["opening", "purchase", "debit_note", "payment", "refund"] as const;
export type StatementType = (typeof STATEMENT_TYPES)[number];

/** One movement on a supplier's account. `credit` = we owe more (bill, refund received); `debit` = we owe less (payment, return). */
export interface LedgerEvent {
  date: string;
  /** Tie-breaker within a day (epoch ms of entry). */
  at: number;
  type: StatementType;
  ref: string;
  description: string;
  credit: number;
  debit: number;
  /** The id of the source row (purchase / debit note / payment). */
  id?: string;
}
export interface StatementRow extends LedgerEvent {
  balance: number;
}
export interface Statement {
  from: string | null;
  to: string | null;
  openingBalance: number;
  rows: StatementRow[];
  totalCredit: number;
  totalDebit: number;
  closingBalance: number;
}

const ORDER: Record<StatementType, number> = { opening: 0, purchase: 1, refund: 2, debit_note: 3, payment: 4 };

/**
 * Date-wise statement with a running balance (positive = payable). Events before `from` roll into the opening
 * balance of the period; the supplier's own opening balance is the first event when it falls in the range.
 */
export function buildStatement(events: readonly LedgerEvent[], range: { from?: string | null; to?: string | null } = {}): Statement {
  const from = range.from || null;
  const to = range.to || null;
  const sorted = [...events].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : ORDER[a.type] - ORDER[b.type] || a.at - b.at));
  let opening = 0;
  let running = 0;
  let totalCredit = 0;
  let totalDebit = 0;
  const rows: StatementRow[] = [];
  for (const e of sorted) {
    if (to && e.date > to) continue;
    if (from && e.date < from) {
      opening += e.credit - e.debit;
      running = opening;
      continue;
    }
    running += e.credit - e.debit;
    totalCredit += e.credit;
    totalDebit += e.debit;
    rows.push({ ...e, balance: running });
  }
  return { from, to, openingBalance: opening, rows, totalCredit, totalDebit, closingBalance: running };
}

/**
 * Splits `total` paise across weights (taxable values) by largest remainder, so the parts add up exactly.
 * Zero weights get nothing; with no positive weight the result is all zeros.
 */
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (Math.max(0, w) * total) / sum);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((s, n) => s + n, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .filter((o) => (weights[o.i] ?? 0) > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length) {
    out[order[k]!.i]! += 1;
    left -= 1;
  }
  return out;
}

/** Purchase order progress from the lines' ordered and received quantities. */
export function poProgress(lines: readonly { qty: number; received: number }[]): "sent_or_draft" | "partially_received" | "received" {
  const anyReceived = lines.some((l) => l.received > 0);
  if (!anyReceived) return "sent_or_draft";
  const allDone = lines.every((l) => l.received + 1e-9 >= l.qty);
  return allDone ? "received" : "partially_received";
}

/** Quantity of a line not yet received, 3-decimal safe. */
export const poRemaining = (l: { qty: number; received: number }): number => Math.max(0, Math.round((l.qty - l.received) * 1000) / 1000);

/** The discount of a returned share of a line: proportional, rounded. */
export const returnedDiscount = (discount: number, lineQty: number, returnQty: number): number =>
  lineQty > 0 ? Math.round((discount * returnQty) / lineQty) : 0;

/** Amount of `total` the supplier paid back in money cannot exceed the debit note total or what we have paid. */
export function maxRefund(dnTotal: number, amountPaid: number): number {
  return Math.max(0, Math.min(dnTotal, amountPaid));
}
