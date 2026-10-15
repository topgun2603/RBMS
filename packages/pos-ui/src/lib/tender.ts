/**
 * Split tender: cash (with change), UPI, card and credit (left on the customer's account). All amounts in paise.
 * Only cash can be over-tendered; UPI/card/credit together may not exceed the bill (no change from them).
 */

export interface Tenders {
  /** Cash handed over (may be more than due: change is given back). */
  cash: number;
  upi: number;
  card: number;
  /** Left unpaid on the customer's account (credit book). */
  credit: number;
}

export const EMPTY_TENDERS: Tenders = { cash: 0, upi: 0, card: 0, credit: 0 };

export type TenderProblem =
  /** Not enough money yet. */
  | "short"
  /** UPI + card + credit are more than the bill. */
  | "overNonCash"
  /** UPI amount entered but not confirmed as received. */
  | "upiUnconfirmed"
  /** Credit needs a saved customer. */
  | "creditNeedsCustomer"
  /** Credit book feature off. */
  | "creditUnavailable"
  | "nothingToPay";

export interface Settlement {
  payable: number;
  /** UPI + card. */
  nonCash: number;
  /** Cash kept for the bill (tendered − change). */
  cashApplied: number;
  change: number;
  /** Still to collect. */
  remaining: number;
  credit: number;
  /** Money received now (cash applied + UPI + card). */
  received: number;
  problems: TenderProblem[];
  ok: boolean;
}

export interface SettleContext {
  upiConfirmed?: boolean;
  hasCustomer?: boolean;
  creditAllowed?: boolean;
}

const nonNeg = (n: number) => Math.max(Math.round(n || 0), 0);

export function settle(payable: number, t: Tenders, ctx: SettleContext = {}): Settlement {
  const due = nonNeg(payable);
  const cash = nonNeg(t.cash);
  const upi = nonNeg(t.upi);
  const card = nonNeg(t.card);
  const credit = nonNeg(t.credit);
  const nonCash = upi + card;
  const problems: TenderProblem[] = [];
  if (due === 0) problems.push("nothingToPay");
  if (nonCash + credit > due) problems.push("overNonCash");
  const cashDue = Math.max(due - nonCash - credit, 0);
  const cashApplied = Math.min(cash, cashDue);
  const change = Math.max(cash - cashDue, 0);
  const remaining = Math.max(cashDue - cashApplied, 0);
  if (remaining > 0) problems.push("short");
  if (upi > 0 && !ctx.upiConfirmed) problems.push("upiUnconfirmed");
  if (credit > 0 && ctx.creditAllowed === false) problems.push("creditUnavailable");
  if (credit > 0 && !ctx.hasCustomer) problems.push("creditNeedsCustomer");
  return { payable: due, nonCash, cashApplied, change, remaining, credit, received: cashApplied + nonCash, problems, ok: problems.length === 0 };
}

/** The payments to record on the bill, in order. Cash is the applied amount (change already given back). */
export function paymentsFor(s: Settlement, t: Tenders, refs: { upi?: string; card?: string } = {}) {
  const out: { method: "cash" | "upi" | "card"; amount: number; reference?: string }[] = [];
  if (nonNeg(t.upi) > 0) out.push({ method: "upi", amount: nonNeg(t.upi), ...(refs.upi?.trim() ? { reference: refs.upi.trim() } : {}) });
  if (nonNeg(t.card) > 0) out.push({ method: "card", amount: nonNeg(t.card), ...(refs.card?.trim() ? { reference: refs.card.trim() } : {}) });
  if (s.cashApplied > 0) out.push({ method: "cash", amount: s.cashApplied });
  return out;
}

/**
 * Fits the planned payments to the issued bill's real balance (the server is the final word on the total): each
 * payment is capped at what is still due, cash last; anything beyond is dropped.
 */
export function fitPayments<P extends { amount: number }>(planned: readonly P[], balance: number): P[] {
  let left = nonNeg(balance);
  const out: P[] = [];
  for (const p of planned) {
    if (left <= 0) break;
    const amount = Math.min(nonNeg(p.amount), left);
    if (amount > 0) out.push({ ...p, amount });
    left -= amount;
  }
  return out;
}

/** Rupee notes and coins for the cash count, largest first. */
export const DENOMINATIONS = [2000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;
export type Denomination = (typeof DENOMINATIONS)[number];
export type DenominationCounts = Partial<Record<Denomination, number>>;

/** Total of a cash count in paise. Negative or fractional counts are ignored (floored at 0). */
export function countTotal(counts: DenominationCounts): number {
  return DENOMINATIONS.reduce((s, d) => s + Math.max(Math.floor(counts[d] ?? 0), 0) * d * 100, 0);
}

/**
 * Quick cash buttons for an amount due: the exact amount, then the next round amounts a customer is likely to hand
 * over (next ₹10, ₹50, ₹100, ₹500, ₹2000 above it), unique, ascending, at most `max`.
 */
export function quickNotes(due: number, max = 5): number[] {
  const d = nonNeg(due);
  if (d === 0) return [];
  const out = new Set<number>([d]);
  for (const step of [1000, 5000, 10000, 50000, 200000]) {
    const up = Math.ceil(d / step) * step;
    if (up > d) out.add(up);
  }
  return [...out].sort((a, b) => a - b).slice(0, max);
}
