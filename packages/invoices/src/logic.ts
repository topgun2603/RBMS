/** Pure invoice rules shared by the service (no database). */
import { DEFAULT_INVOICE_PREFIX, isValidGstin, sanitizePrefix, stateFromGstin } from "./calc";
import { DEFAULT_REMINDER_DAYS, SELLER_FIELDS, type SellerProfile } from "./ports";
import type { InvoiceStatus } from "./schema";

/** Status after a payment change. Drafts and cancelled invoices keep their status. */
export function deriveStatus(current: InvoiceStatus, total: number, paid: number): InvoiceStatus {
  if (current === "draft" || current === "cancelled") return current;
  if (paid >= total) return "paid";
  if (paid > 0) return "partially_paid";
  return "issued";
}

/** Amount still owed. Cancelled invoices owe nothing. */
export function balanceOf(inv: { status: InvoiceStatus; total: number; paid: number }): number {
  if (inv.status === "cancelled") return 0;
  return Math.max(inv.total - inv.paid, 0);
}

/** Statuses that count towards a customer's outstanding amount. */
export const OPEN_STATUSES: readonly InvoiceStatus[] = ["issued", "partially_paid"];

export function isOverdue(
  inv: { status: InvoiceStatus; total: number; paid: number; dueDate: string | null },
  today: string,
): boolean {
  if (inv.status === "draft" || inv.status === "cancelled") return false;
  if (!inv.dueDate) return false;
  return inv.dueDate < today && balanceOf(inv) > 0;
}

/** Sum of balances of issued / partially paid invoices. */
export function outstandingOf(list: { status: InvoiceStatus; total: number; paid: number }[]): number {
  return list.reduce((s, inv) => (OPEN_STATUSES.includes(inv.status) ? s + balanceOf(inv) : s), 0);
}

/** Whether a payment of `amount` may be recorded. Returns an error message, or null when allowed. */
export function paymentProblem(inv: { status: InvoiceStatus; total: number; paid: number }, amount: number): string | null {
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
  if (out.stateCode && /^\d{1,2}$/.test(out.stateCode)) out.stateCode = out.stateCode.padStart(2, "0");
  // A GSTIN carries the state; use it when the profile doesn't say.
  if (!out.stateCode && out.gstin && isValidGstin(out.gstin)) out.stateCode = stateFromGstin(out.gstin);
  return out;
}

/** First day of the IST month of `today` and of the next month, as "YYYY-MM-DD". */
export function monthRange(today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from: `${today.slice(0, 7)}-01`, to: next };
}
