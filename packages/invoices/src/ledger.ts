/** Pure credit-book, reminder and messaging rules (no database). */
import { formatINR } from "@srirealtime/gst";
import { deriveStatus, OPEN_STATUSES } from "./logic";
import type { InvoiceStatus, PaymentMethod } from "./schema";

// ------------------------------------------------------------------ dates ("YYYY-MM-DD", calendar arithmetic in UTC)

const toUtc = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

/** "2026-10-14", 3 → "2026-10-17" (negative n goes back). */
export function addDaysISO(date: string, n: number): string {
  return new Date(toUtc(date) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-04" → "4 Oct 2026"; null → "". */
export function dateText(date: string | null | undefined): string {
  if (!date) return "";
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

// ------------------------------------------------------------------ balances

/** Customer ledger balance: opening + issued bills − payments entered on bills − receipts. + = they owe the shop. */
export function ledgerBalance(p: { opening: number; billed: number; paid: number; received: number; credited?: number }): number {
  return p.opening + p.billed - p.paid - p.received - (p.credited ?? 0);
}

/** True when the customer has a credit limit and the balance (after the bill) goes above it. */
export function creditLimitExceeded(balanceAfter: number, creditLimit: number | null | undefined): boolean {
  return creditLimit !== null && creditLimit !== undefined && balanceAfter > creditLimit;
}

// ------------------------------------------------------------------ receipts: FIFO allocation

export interface OpenBill {
  id: string;
  number: string | null;
  date: string;
  status: InvoiceStatus;
  total: number;
  paid: number;
  /** Credit notes on the bill (paise). */
  credited?: number | null;
  /** Tie-break for bills of the same date (the FY sequence). */
  seq?: number | null;
}

export interface Allocation {
  invoiceId: string;
  number: string | null;
  amount: number;
}

/**
 * Spreads `amount` over the customer's open bills, oldest first (date, then number sequence).
 * Paid, draft and cancelled bills are skipped. Whatever is left becomes advance.
 */
export function allocateFifo(amount: number, bills: readonly OpenBill[]): { allocations: Allocation[]; advance: number } {
  const open = bills
    .filter((b) => OPEN_STATUSES.includes(b.status) && b.total - b.paid - (b.credited ?? 0) > 0)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id),
    );
  let left = Math.max(amount, 0);
  const allocations: Allocation[] = [];
  for (const b of open) {
    if (left <= 0) break;
    const take = Math.min(left, b.total - b.paid - (b.credited ?? 0));
    allocations.push({ invoiceId: b.id, number: b.number, amount: take });
    left -= take;
  }
  return { allocations, advance: left };
}

/** New paid amount and status of a bill after adding (+) or removing (−) money. Paid never drops below 0. */
export function applyPaidDelta(
  inv: { status: InvoiceStatus; total: number; paid: number; credited?: number | null },
  delta: number,
): { paid: number; status: InvoiceStatus } {
  const paid = Math.max(inv.paid + delta, 0);
  return { paid, status: deriveStatus(inv.status, inv.total, paid, inv.credited ?? 0) };
}

/**
 * Undoing a receipt: each allocated bill loses the allocated money. Returns the bills to update
 * (several allocations to one bill are combined).
 */
export function reverseAllocations(
  bills: readonly { id: string; status: InvoiceStatus; total: number; paid: number; credited?: number | null }[],
  allocations: readonly { invoiceId: string; amount: number }[],
): { id: string; paid: number; status: InvoiceStatus }[] {
  const byId = new Map(bills.map((b) => [b.id, { ...b }]));
  const touched: string[] = [];
  for (const a of allocations) {
    const b = byId.get(a.invoiceId);
    if (!b) continue;
    Object.assign(b, applyPaidDelta(b, -a.amount));
    if (!touched.includes(b.id)) touched.push(b.id);
  }
  return touched.map((id) => {
    const b = byId.get(id)!;
    return { id, paid: b.paid, status: b.status };
  });
}

// ------------------------------------------------------------------ ledger (statement)

export type LedgerEntryType = "opening" | "invoice" | "payment" | "receipt" | "cancel" | "credit_note" | "debit_note" | "refund";

export interface LedgerEntry {
  date: string;
  type: LedgerEntryType;
  refId: string | null;
  number: string | null;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface LedgerEvent extends Omit<LedgerEntry, "balance"> {
  type: Exclude<LedgerEntryType, "opening">;
  /** Epoch ms used to order events of the same date. */
  at: number;
}

export interface LedgerSource {
  /** Non-draft bills (cancelled ones included: they show the bill and its cancellation). */
  invoices: readonly {
    id: string;
    number: string | null;
    date: string;
    total: number;
    status: InvoiceStatus;
    at: number;
    /** IST date of cancellation. */
    cancelledOn?: string | null;
    cancelledAt?: number | null;
  }[];
  /** Payments entered on bills (not receipt allocations). */
  payments: readonly {
    id: string;
    invoiceNumber: string | null;
    date: string;
    amount: number;
    method: PaymentMethod;
    reference: string | null;
    online?: boolean;
    at: number;
  }[];
  receipts: readonly {
    id: string;
    date: string;
    amount: number;
    method: PaymentMethod;
    reference: string | null;
    note?: string | null;
    at: number;
  }[];
  /** Issued (not cancelled) credit notes: each one is a credit to the customer. */
  creditNotes?: readonly {
    id: string;
    number: string;
    invoiceNumber: string | null;
    date: string;
    total: number;
    at: number;
  }[];
  /** Issued (not cancelled) debit notes: each one is a debit (the customer owes more). */
  debitNotes?: readonly {
    id: string;
    number: string;
    invoiceNumber: string | null;
    date: string;
    total: number;
    at: number;
  }[];
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

/** Turns bills, payments and receipts into dated debit/credit events. */
export function ledgerEvents(src: LedgerSource): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const inv of src.invoices) {
    if (inv.status === "draft") continue;
    out.push({
      date: inv.date,
      at: inv.at,
      type: "invoice",
      refId: inv.id,
      number: inv.number,
      description: `Invoice ${inv.number ?? ""}`.trim(),
      debit: inv.total,
      credit: 0,
    });
    if (inv.status === "cancelled") {
      out.push({
        date: inv.cancelledOn && inv.cancelledOn > inv.date ? inv.cancelledOn : inv.date,
        at: inv.cancelledAt ?? inv.at + 1,
        type: "cancel",
        refId: inv.id,
        number: inv.number,
        description: `Cancelled invoice ${inv.number ?? ""}`.trim(),
        debit: 0,
        credit: inv.total,
      });
    }
  }
  for (const p of src.payments) {
    if (p.amount < 0) {
      // A refund given back with a credit note: money out to the customer.
      out.push({
        date: p.date,
        at: p.at,
        type: "refund",
        refId: p.id,
        number: p.invoiceNumber,
        description: [`Refund (${METHOD_LABEL[p.method]})`, p.invoiceNumber ? `for ${p.invoiceNumber}` : null, p.reference ? `ref ${p.reference}` : null]
          .filter(Boolean)
          .join(" "),
        debit: -p.amount,
        credit: 0,
      });
      continue;
    }
    const how = p.online ? "Online payment" : `Payment (${METHOD_LABEL[p.method]})`;
    out.push({
      date: p.date,
      at: p.at,
      type: "payment",
      refId: p.id,
      number: p.invoiceNumber,
      description: [how, p.invoiceNumber ? `for ${p.invoiceNumber}` : null, p.reference ? `ref ${p.reference}` : null]
        .filter(Boolean)
        .join(" "),
      debit: 0,
      credit: p.amount,
    });
  }
  for (const r of src.receipts) {
    out.push({
      date: r.date,
      at: r.at,
      type: "receipt",
      refId: r.id,
      number: null,
      description: [`Received (${METHOD_LABEL[r.method]})`, r.reference ? `ref ${r.reference}` : null, r.note || null]
        .filter(Boolean)
        .join(" · "),
      debit: 0,
      credit: r.amount,
    });
  }
  for (const c of src.creditNotes ?? []) {
    out.push({
      date: c.date,
      at: c.at,
      type: "credit_note",
      refId: c.id,
      number: c.number,
      description: [`Credit note ${c.number}`, c.invoiceNumber ? `against ${c.invoiceNumber}` : null].filter(Boolean).join(" "),
      debit: 0,
      credit: c.total,
    });
  }
  for (const d of src.debitNotes ?? []) {
    out.push({
      date: d.date,
      at: d.at,
      type: "debit_note",
      refId: d.id,
      number: d.number,
      description: [`Debit note ${d.number}`, d.invoiceNumber ? `on ${d.invoiceNumber}` : null].filter(Boolean).join(" "),
      debit: d.total,
      credit: 0,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
}

/**
 * Running-balance statement. `openingBalance` is the balance as of `from` (the customer's opening balance plus
 * everything before `from`); entries after `to` are left out. The first entry is always the opening line.
 */
export function buildLedger(
  opening: number,
  events: readonly LedgerEvent[],
  range: { from?: string | null; to?: string | null; openingDate: string },
): { openingBalance: number; entries: LedgerEntry[]; closingBalance: number } {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
  let balance = opening;
  const from = range.from ?? null;
  const to = range.to ?? null;
  for (const e of sorted) {
    if (from && e.date < from) balance += e.debit - e.credit;
  }
  const openingBalance = balance;
  const firstDate = sorted[0]?.date;
  const openingDate = from ?? (firstDate && firstDate < range.openingDate ? firstDate : range.openingDate);
  const entries: LedgerEntry[] = [
    {
      date: openingDate,
      type: "opening",
      refId: null,
      number: null,
      description: "Opening balance",
      debit: Math.max(openingBalance, 0),
      credit: Math.max(-openingBalance, 0),
      balance: openingBalance,
    },
  ];
  for (const e of sorted) {
    if (from && e.date < from) continue;
    if (to && e.date > to) continue;
    balance += e.debit - e.credit;
    const { at: _at, ...rest } = e;
    entries.push({ ...rest, balance });
  }
  return { openingBalance, entries, closingBalance: balance };
}

// ------------------------------------------------------------------ ageing

export const AGEING_KEYS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgeingKey = (typeof AGEING_KEYS)[number];

/** Bucket by days past due. A bill without a due date is due on its invoice date. */
export function ageingKey(bill: { date: string; dueDate: string | null }, asOf: string): AgeingKey {
  const days = daysBetween(bill.dueDate ?? bill.date, asOf);
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export interface AgeingCustomerRow {
  customerId: string | null;
  name: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

const AGEING_FIELD: Record<AgeingKey, keyof Omit<AgeingCustomerRow, "customerId" | "name" | "total">> = {
  current: "current",
  "1-30": "d1_30",
  "31-60": "d31_60",
  "61-90": "d61_90",
  "90+": "d90_plus",
};

/** Receivables ageing from open bill balances as of `asOf`. Walk-in bills are grouped by name. */
export function ageingReport(
  bills: readonly { customerId: string | null; name: string; date: string; dueDate: string | null; balance: number }[],
  asOf: string,
): { buckets: { key: AgeingKey; amount: number; count: number }[]; customers: AgeingCustomerRow[] } {
  const buckets = AGEING_KEYS.map((key) => ({ key, amount: 0, count: 0 }));
  const customers = new Map<string, AgeingCustomerRow>();
  for (const b of bills) {
    if (b.balance <= 0) continue;
    const key = ageingKey(b, asOf);
    const bucket = buckets[AGEING_KEYS.indexOf(key)]!;
    bucket.amount += b.balance;
    bucket.count += 1;
    const ck = b.customerId ?? `walk-in:${b.name.trim().toLowerCase()}`;
    let row = customers.get(ck);
    if (!row) {
      row = { customerId: b.customerId, name: b.name, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 };
      customers.set(ck, row);
    }
    row[AGEING_FIELD[key]] += b.balance;
    row.total += b.balance;
  }
  return {
    buckets,
    customers: [...customers.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}

// ------------------------------------------------------------------ reminders

/**
 * Which reminder step (days after due) falls on `today`, or null. Bills without a due date never get
 * automatic reminders.
 */
export function reminderDayFor(dueDate: string | null, today: string, reminderDays: readonly number[]): number | null {
  if (!dueDate) return null;
  const n = daysBetween(dueDate, today);
  return n >= 0 && reminderDays.includes(n) ? n : null;
}

// ------------------------------------------------------------------ phones and message text

/**
 * An Indian mobile number as E.164 ("+919876543210"), or null when it isn't one.
 * Accepts "98765 43210", "098765-43210", "+91 98765 43210", "919876543210", "00919876543210".
 */
export function toIndianE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!/^\+?[0-9][0-9 ()-]*$/.test(trimmed)) return null;
  let d = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    if (!d.startsWith("91")) return null;
    d = d.slice(2);
  } else if (d.length === 14 && d.startsWith("0091")) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d) ? `+91${d}` : null;
}

/** "+919876543210" → "+91******3210". */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length <= 4) return "*".repeat(d.length);
  const cc = phone.trim().startsWith("+") && d.length > 10 ? d.slice(0, d.length - 10) : "";
  const rest = d.slice(cc.length);
  return `${cc ? `+${cc}` : ""}${"*".repeat(rest.length - 4)}${rest.slice(-4)}`;
}

/** Money for message text: "₹1,234.50" on WhatsApp, "Rs.1,234.50" on SMS (₹ would force a Unicode SMS). */
export function moneyText(paise: number, channel: "whatsapp" | "sms"): string {
  const s = formatINR(paise);
  return channel === "sms" ? s.replace("₹", "Rs.") : s;
}
