/** Pure invoice rules shared by the service (no database). */
import {
  DEFAULT_INVOICE_PREFIX,
  isValidGstin,
  sanitizePrefix,
  stateFromGstin,
  taxableOfInclusive,
  gstRateForInclusive,
  type LineInput,
  type LineTotals,
} from "./calc";
import { DEFAULT_REMINDER_DAYS, SELLER_FIELDS, type SellerProfile } from "./ports";
import type { InvoiceStatus } from "./schema";

/**
 * Status after a payment or credit note change. Drafts and cancelled invoices keep their status. `credited` (credit
 * notes) settles the bill like money does: a fully returned bill is "paid" (nothing is owed).
 */
export function deriveStatus(current: InvoiceStatus, total: number, paid: number, credited = 0): InvoiceStatus {
  if (current === "draft" || current === "cancelled") return current;
  if (paid + credited >= total) return "paid";
  if (paid + credited > 0) return "partially_paid";
  return "issued";
}

/** Amount still owed: total − paid − credited. Cancelled invoices owe nothing. */
export function balanceOf(inv: { status: InvoiceStatus; total: number; paid: number; credited?: number | null }): number {
  if (inv.status === "cancelled") return 0;
  return Math.max(inv.total - inv.paid - (inv.credited ?? 0), 0);
}

/** Statuses that count towards a customer's outstanding amount. */
export const OPEN_STATUSES: readonly InvoiceStatus[] = ["issued", "partially_paid"];

export function isOverdue(
  inv: { status: InvoiceStatus; total: number; paid: number; credited?: number | null; dueDate: string | null },
  today: string,
): boolean {
  if (inv.status === "draft" || inv.status === "cancelled") return false;
  if (!inv.dueDate) return false;
  return inv.dueDate < today && balanceOf(inv) > 0;
}

/** Sum of balances of issued / partially paid invoices. */
export function outstandingOf(list: { status: InvoiceStatus; total: number; paid: number; credited?: number | null }[]): number {
  return list.reduce((s, inv) => (OPEN_STATUSES.includes(inv.status) ? s + balanceOf(inv) : s), 0);
}

/** Whether a payment of `amount` may be recorded. Returns an error message, or null when allowed. */
export function paymentProblem(
  inv: { status: InvoiceStatus; total: number; paid: number; credited?: number | null },
  amount: number,
): string | null {
  if (!OPEN_STATUSES.includes(inv.status)) {
    if (inv.status === "paid") return "This invoice is already fully paid";
    if (inv.status === "cancelled") return "Payments can't be recorded on a cancelled invoice";
    return "Issue the invoice before recording payments";
  }
  if (amount > balanceOf(inv)) return `Payment exceeds the balance of ${balanceOf(inv)} paise`;
  return null;
}

const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

/** Whole days 0–365, unique, ascending; anything unusable falls back to the default [1, 7, 15]. */
export function normalizeReminderDays(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_REMINDER_DAYS];
  const days = raw
    .map((d) => (typeof d === "string" && d.trim() !== "" ? Number(d) : d))
    .filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0 && d <= 365);
  return [...new Set(days)].sort((a, b) => a - b);
}

const flag = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/** Fills a possibly partial seller profile with nulls/defaults and defaults the invoice prefix. */
export function normalizeSeller(raw: Partial<SellerProfile> | null | undefined): SellerProfile {
  const out = {} as SellerProfile;
  for (const k of SELLER_FIELDS) out[k] = clean(raw?.[k]);
  out.autoReminders = flag(raw?.autoReminders, false);
  out.reminderDays = raw?.reminderDays === undefined || raw?.reminderDays === null ? [...DEFAULT_REMINDER_DAYS] : normalizeReminderDays(raw.reminderDays);
  out.sendPaymentReceipts = flag(raw?.sendPaymentReceipts, true);
  out.invoicePrefix = sanitizePrefix(out.invoicePrefix ?? DEFAULT_INVOICE_PREFIX);
  if (out.gstin) out.gstin = out.gstin.toUpperCase();
  // Composition taxpayers (set by GST filing settings, not by the billing profile): only carried when on, so old snapshots stay as they were.
  if (raw?.taxScheme === "composition") {
    out.taxScheme = "composition";
    out.compositionFrom = typeof raw.compositionFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.compositionFrom) ? raw.compositionFrom : null;
  }
  if (out.stateCode && /^\d{1,2}$/.test(out.stateCode)) out.stateCode = out.stateCode.padStart(2, "0");
  // A GSTIN carries the state; use it when the profile doesn't say.
  if (!out.stateCode && out.gstin && isValidGstin(out.gstin)) out.stateCode = stateFromGstin(out.gstin);
  return out;
}

/**
 * True when a bill dated `date` is a bill of supply of a composition taxable person: no tax is charged on it
 * (Section 10(4) and Rule 49 CGST). Bills dated before the scheme started are untouched.
 */
export function isCompositionBill(seller: Pick<SellerProfile, "taxScheme" | "compositionFrom"> | null | undefined, date: string): boolean {
  return seller?.taxScheme === "composition" && (!seller.compositionFrom || date >= seller.compositionFrom);
}

/** The same lines at 0% GST (a composition bill): the price charged stays; no tax is added on top of it. */
export function withoutTax<T extends { gstRate: number; gstRule?: unknown }>(lines: T[]): T[] {
  return lines.map((l) => ({ ...l, gstRate: 0, gstRule: null }));
}

/** First day of the IST month of `today` and of the next month, as "YYYY-MM-DD". */
export function monthRange(today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: `${today.slice(0, 7)}-01`, to: next };
}

/**
 * Splits `total` (integer paise) across `weights` proportionally, largest remainder first (ties: earlier entry).
 * Shares are integers summing exactly to `total`; a share never exceeds its weight when `total <= sum(weights)`.
 */
export function allocateProportional(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((s, w) => s + Math.max(w, 0), 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * Math.max(w, 0)) / sum);
  const shares = exact.map(Math.floor);
  let left = total - shares.reduce((s, v) => s + v, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .filter((o) => (weights[o.i] ?? 0) > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left -= 1) shares[order[k]!.i]! += 1;
  return shares;
}

export interface BillDiscountOptions {
  /** Throw a RangeError when the discount is more than the bill's line totals (default true); false caps it. */
  strict?: boolean;
}

const lineInputOf = (l: LineTotals): LineInput => {
  const out: LineInput = { description: l.description, qty: l.qty, rate: l.rate, gstRate: l.gstRate };
  if (l.hsn) out.hsn = l.hsn;
  if (l.unit) out.unit = l.unit;
  if (l.discount) out.discount = l.discount;
  if (l.itemId) out.itemId = l.itemId;
  if (l.inclusiveTotal !== undefined && l.inclusiveTotal !== null) out.inclusiveTotal = l.inclusiveTotal;
  if (l.serials?.length) out.serials = [...l.serials];
  if (l.gstRule) out.gstRule = l.gstRule;
  if (l.batchId) out.batchId = l.batchId;
  if (l.batchNo) out.batchNo = l.batchNo;
  if (l.mfgDate) out.mfgDate = l.mfgDate;
  if (l.expiry) out.expiry = l.expiry;
  return out;
};

/**
 * Applies a bill-level, GST-inclusive discount (e.g. a loyalty points redemption) to computed lines.
 *
 * A loyalty redemption is a discount given at the time of supply and shown on the invoice, so under Sec 15(3)(a) of
 * the CGST Act it is excluded from the value of supply: it reduces the taxable value of every line pro-rata by value
 * (each line's share of the bill total) and GST is recomputed on the reduced charge.
 *
 * `discount` (paise) is split across the lines in proportion to their totals (largest remainder, integers, the shares
 * sum exactly to `discount`, no line goes below zero). Each discounted line becomes an `inclusiveTotal` line charging
 * `total − share`, with its `discount` raised by the taxable value it lost so `amount` stays the original amount.
 * Lines with a zero share are returned unchanged. Recompute with `computeInvoice`: the exact (pre round-off) total
 * drops by exactly `discount`, so a whole-rupee discount leaves the round-off unchanged and the new grand total is
 * the old one minus `discount`.
 */
export function applyBillDiscount(lines: readonly LineTotals[], discount: number, opts: BillDiscountOptions = {}): LineInput[] {
  if (!Number.isInteger(discount) || discount < 0) throw new RangeError("The discount must be whole paise, zero or more");
  const available = lines.reduce((s, l) => s + Math.max(l.total, 0), 0);
  let d = discount;
  if (d > available) {
    if (opts.strict !== false) throw new RangeError("The discount is more than the bill");
    d = available;
  }
  const shares = allocateProportional(d, lines.map((l) => l.total));
  return lines.map((l, i) => {
    const share = shares[i] ?? 0;
    const base = lineInputOf(l);
    if (share <= 0) return base;
    const inclusiveTotal = l.total - share;
    // A price-band line is re-banded on what is now charged (the discount lowers its value of supply).
    const lost = l.taxable - taxableOfInclusive(inclusiveTotal, l.gstRule ? gstRateForInclusive(l.gstRule, inclusiveTotal, l.qty).rate : l.gstRate);
    return { ...base, discount: (l.discount ?? 0) + Math.max(lost, 0), inclusiveTotal };
  });
}
