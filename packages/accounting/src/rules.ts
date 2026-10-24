/**
 * Posting rules: pure functions from a source document (ports.ts) to journal postings. No database, no clock.
 *
 * Every business fact is its own posting keyed by (sourceType, sourceId); a posting never changes once made. A later
 * fact (a cancellation, a reversed supplier payment) is a second posting that mirrors the first (`*_cancel`,
 * `*_reversal`). If a document's content changes after posting (an edited expense) the engine reverses the old
 * version and posts the new one.
 */
import { createHash } from "node:crypto";
import { isValidGstin } from "@srirealtime/gst";
import { SYS } from "./chart";
import type {
  CreditNoteSrc,
  DebitNoteSrc,
  ExpenseSrc,
  InvoicePaymentSrc,
  InvoiceSrc,
  OpeningParty,
  PurchaseSrc,
  GstPaymentSrc,
  ReceiptSrc,
  StockAdjustmentSrc,
  SupplierPaymentSrc,
  TillSrc,
} from "./ports";
import type { ImportedMode, PartyType } from "./schema";

export type AccountRef = { key: string } | { method: string } | { expenseCategory: { id: string; name: string } } | { id: string };

export interface DraftLine {
  account: AccountRef;
  debit: number;
  credit: number;
  party?: { type: PartyType; id: string | null };
  memo?: string;
}

export interface Posting {
  sourceType: string;
  sourceId: string;
  /** The document's date (the engine moves it past a locked period). */
  date: string;
  narration: string;
  reference?: string | null;
  lines: DraftLine[];
}

export interface RuleOptions {
  importedBills: ImportedMode;
  /** The shop's GST state code (expense ITC split). */
  shopState?: string | null;
  /** Post valued stock adjustments (the shop's `valueStock` setting; default true). */
  valueStock?: boolean;
}

// ------------------------------------------------------------------ line helpers

const key = (k: string): AccountRef => ({ key: k });

/** A debit of `n`; a negative `n` is a credit. Zero lines are dropped later. */
const dr = (account: AccountRef, n: number, party?: DraftLine["party"]): DraftLine =>
  n >= 0 ? { account, debit: n, credit: 0, party } : { account, debit: 0, credit: -n, party };
const cr = (account: AccountRef, n: number, party?: DraftLine["party"]): DraftLine =>
  n >= 0 ? { account, debit: 0, credit: n, party } : { account, debit: -n, credit: 0, party };

const nonZero = (lines: DraftLine[]) => lines.filter((l) => l.debit !== 0 || l.credit !== 0);

/** The same lines with debits and credits swapped (a reversal / cancellation). */
export const mirror = (lines: readonly DraftLine[]): DraftLine[] => lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));

export const totalOf = (lines: readonly DraftLine[]) => ({
  debit: lines.reduce((s, l) => s + l.debit, 0),
  credit: lines.reduce((s, l) => s + l.credit, 0),
});
export const isBalanced = (lines: readonly DraftLine[]) => {
  const t = totalOf(lines);
  return t.debit === t.credit && t.debit > 0;
};

const outTax = (d: { cgst: number; sgst: number; igst: number }): DraftLine[] => [
  cr(key(SYS.gstOutCgst), d.cgst),
  cr(key(SYS.gstOutSgst), d.sgst),
  cr(key(SYS.gstOutIgst), d.igst),
];
const inTax = (d: { cgst: number; sgst: number; igst: number }): DraftLine[] => [
  dr(key(SYS.gstInCgst), d.cgst),
  dr(key(SYS.gstInSgst), d.sgst),
  dr(key(SYS.gstInIgst), d.igst),
];
const party = (type: PartyType, id: string | null): DraftLine["party"] => ({ type, id });
const later = (date: string, other: string | null | undefined) => (other && other > date ? other : date);
const money = (method: string): AccountRef => ({ method });

// ------------------------------------------------------------------ sales side

/** Customer owes `total`; sales (before GST) and output GST are earned. Discount and round-off in their own accounts. */
function billLines(
  salesKey: string,
  f: { total: number; discount: number; roundOff: number; cgst: number; sgst: number; igst: number },
  who: DraftLine["party"],
): DraftLine[] {
  const tax = f.cgst + f.sgst + f.igst;
  return nonZero([
    dr(key(SYS.debtors), f.total, who),
    dr(key(SYS.discountAllowed), f.discount),
    cr(key(salesKey), f.total + f.discount - tax - f.roundOff),
    ...outTax(f),
    cr(key(SYS.roundOff), f.roundOff),
  ]);
}

const inScope = (imported: boolean, mode: ImportedMode) => mode === "post" || !imported;

export function invoicePostings(inv: InvoiceSrc, o: RuleOptions): Posting[] {
  if (!inScope(inv.imported, o.importedBills)) return [];
  const who = party("customer", inv.customerId);
  const lines = billLines(SYS.sales, inv, who);
  const label = `Invoice ${inv.number ?? ""}`.trim();
  const out: Posting[] = [{ sourceType: "invoice", sourceId: inv.id, date: inv.date, narration: `${label} - ${inv.customerName}`, reference: inv.number, lines }];
  if (inv.status === "cancelled") {
    out.push({
      sourceType: "invoice_cancel",
      sourceId: inv.id,
      date: later(inv.date, inv.cancelledOn),
      narration: `Cancelled ${label} - ${inv.customerName}`,
      reference: inv.number,
      lines: mirror(lines),
    });
  }
  return out;
}

export function invoicePaymentPostings(p: InvoicePaymentSrc, o: RuleOptions): Posting[] {
  if (p.receiptId || p.amount === 0 || !inScope(p.imported, o.importedBills)) return [];
  const who = party("customer", p.customerId);
  const refund = p.amount < 0;
  const amt = Math.abs(p.amount);
  const lines = refund ? [dr(key(SYS.debtors), amt, who), cr(money(p.method), amt)] : [dr(money(p.method), amt), cr(key(SYS.debtors), amt, who)];
  const what = refund ? "Refund" : "Payment";
  return [
    {
      sourceType: "invoice_payment",
      sourceId: p.id,
      date: p.date,
      narration: `${what} (${p.method})${p.invoiceNumber ? ` for ${p.invoiceNumber}` : ""} - ${p.customerName}`,
      reference: p.invoiceNumber,
      lines,
    },
  ];
}

export function receiptPostings(r: ReceiptSrc): Posting[] {
  if (r.amount === 0) return [];
  return [
    {
      sourceType: "customer_receipt",
      sourceId: r.id,
      date: r.date,
      narration: `Received from ${r.customerName} (${r.method})`,
      reference: r.reference,
      lines: [dr(money(r.method), r.amount), cr(key(SYS.debtors), r.amount, party("customer", r.customerId))],
    },
  ];
}

export function creditNotePostings(c: CreditNoteSrc, o: RuleOptions): Posting[] {
  if (c.status !== "issued" || c.invoiceCancelled || !inScope(c.invoiceImported, o.importedBills)) return [];
  const who = party("customer", c.customerId);
  // Same shape as a bill, in the other direction, against Sales returns.
  const lines = mirror(billLines(SYS.salesReturns, { ...c, discount: 0 }, who));
  return [
    {
      sourceType: "credit_note",
      sourceId: c.id,
      date: c.date,
      narration: `Credit note ${c.number}${c.invoiceNumber ? ` against ${c.invoiceNumber}` : ""} - ${c.customerName}`,
      reference: c.number,
      lines,
    },
  ];
}

// ------------------------------------------------------------------ purchase side

function purchaseLines(
  purchasesKey: string,
  f: { total: number; roundOff: number; cgst: number; sgst: number; igst: number },
  who: DraftLine["party"],
): DraftLine[] {
  const tax = f.cgst + f.sgst + f.igst;
  return nonZero([cr(key(SYS.creditors), f.total, who), dr(key(purchasesKey), f.total - tax - f.roundOff), ...inTax(f), dr(key(SYS.roundOff), f.roundOff)]);
}

export function purchasePostings(p: PurchaseSrc, o: RuleOptions): Posting[] {
  if (!inScope(p.imported, o.importedBills)) return [];
  const who = party("supplier", p.supplierId);
  const lines = purchaseLines(SYS.purchases, p, who);
  const out: Posting[] = [
    { sourceType: "purchase", sourceId: p.id, date: p.date, narration: `Purchase bill ${p.billNumber} - ${p.supplierName}`, reference: p.billNumber, lines },
  ];
  if (p.status === "cancelled") {
    out.push({
      sourceType: "purchase_cancel",
      sourceId: p.id,
      date: later(p.date, p.cancelledOn),
      narration: `Cancelled purchase bill ${p.billNumber} - ${p.supplierName}`,
      reference: p.billNumber,
      lines: mirror(lines),
    });
  }
  return out;
}

export function supplierPaymentPostings(p: SupplierPaymentSrc, o: RuleOptions): Posting[] {
  if (p.amount === 0 || !inScope(p.purchaseImported, o.importedBills)) return [];
  const who = party("supplier", p.supplierId);
  const refund = p.kind === "refund";
  const lines = refund ? [dr(money(p.mode), p.amount), cr(key(SYS.creditors), p.amount, who)] : [dr(key(SYS.creditors), p.amount, who), cr(money(p.mode), p.amount)];
  const what = refund ? "Refund received from" : "Paid to";
  const base: Posting = {
    sourceType: "supplier_payment",
    sourceId: p.id,
    date: p.date,
    narration: `${what} ${p.supplierName} (${p.mode})${p.purchaseBill ? ` for ${p.purchaseBill}` : ""}`,
    lines,
  };
  if (!p.reversedOn) return [base];
  return [
    base,
    { ...base, sourceType: "supplier_payment_reversal", date: later(p.date, p.reversedOn), narration: `Reversed: ${base.narration}`, lines: mirror(lines) },
  ];
}

export function debitNotePostings(d: DebitNoteSrc, o: RuleOptions): Posting[] {
  if (!inScope(d.purchaseImported, o.importedBills)) return [];
  const who = party("supplier", d.supplierId);
  // A purchase bill in the other direction, against Purchase returns.
  const lines = mirror(purchaseLines(SYS.purchaseReturns, d, who));
  const out: Posting[] = [
    { sourceType: "debit_note", sourceId: d.id, date: d.date, narration: `Debit note ${d.number} - ${d.supplierName}`, reference: d.number, lines },
  ];
  if (d.status === "cancelled") {
    out.push({
      sourceType: "debit_note_cancel",
      sourceId: d.id,
      date: later(d.date, d.cancelledOn),
      narration: `Cancelled debit note ${d.number} - ${d.supplierName}`,
      reference: d.number,
      lines: mirror(lines),
    });
  }
  return out;
}

// ------------------------------------------------------------------ expenses and the till

/** Splits input credit into CGST+SGST (same state) or IGST (vendor GSTIN from another state). */
export function itcSplit(itc: number, vendorGstin: string | null, shopState: string | null | undefined) {
  const vendorState = vendorGstin && isValidGstin(vendorGstin) ? vendorGstin.slice(0, 2) : null;
  if (vendorState && shopState && vendorState !== shopState) return { cgst: 0, sgst: 0, igst: itc };
  const sgst = Math.floor(itc / 2);
  return { cgst: itc - sgst, sgst, igst: 0 };
}

export function expensePostings(e: ExpenseSrc, o: RuleOptions): Posting[] {
  if (e.amount <= 0) return [];
  const itc = Math.min(Math.max(e.itc, 0), e.amount);
  const lines = nonZero([
    dr({ expenseCategory: { id: e.categoryId, name: e.categoryName } }, e.amount - itc),
    ...inTax(itcSplit(itc, e.vendorGstin, o.shopState)),
    cr(money(e.paymentMethod), e.amount),
  ]);
  const what = `Expense - ${e.categoryName}${e.vendorName ? ` - ${e.vendorName}` : ""}`;
  const out: Posting[] = [{ sourceType: "expense", sourceId: e.id, date: e.date, narration: what, lines }];
  if (e.status === "cancelled") {
    out.push({ sourceType: "expense_cancel", sourceId: e.id, date: later(e.date, e.cancelledOn), narration: `Cancelled: ${what}`, lines: mirror(lines) });
  }
  return out;
}

/**
 * Composition tax paid by challan: an expense (a composition taxable person collects no GST, so there is no output tax
 * to settle and no input credit), paid from the money account of the payment method.
 */
export function gstPaymentPostings(p: GstPaymentSrc): Posting[] {
  if (p.amount <= 0) return [];
  const lines = [dr(key(SYS.compositionTax), p.amount), cr(money(p.mode), p.amount)];
  const what = `Composition tax paid for ${p.period}`;
  const out: Posting[] = [{ sourceType: "gst_payment", sourceId: p.id, date: p.date, narration: what, lines }];
  if (p.status === "cancelled") out.push({ sourceType: "gst_payment_cancel", sourceId: p.id, date: later(p.date, p.cancelledOn), narration: `Cancelled: ${what}`, lines: mirror(lines) });
  return out;
}

export function tillPostings(t: TillSrc): Posting[] {
  const out: Posting[] = [];
  if (t.status === "closed" && t.closedOn && t.difference) {
    const d = t.difference;
    out.push({
      sourceType: "till_difference",
      sourceId: t.id,
      date: t.closedOn,
      narration: `${d > 0 ? "Cash excess" : "Cash short"} when closing ${t.register}`,
      lines: d > 0 ? [dr(key(SYS.cash), d), cr(key(SYS.cashShortExcess), d)] : [dr(key(SYS.cashShortExcess), -d), cr(key(SYS.cash), -d)],
    });
  }
  for (const c of t.cashEntries) {
    if (!c.amount) continue;
    const a = Math.abs(c.amount);
    out.push({
      sourceType: "till_cash",
      sourceId: `${t.id}:${c.id}`,
      date: c.on,
      narration: `${c.amount > 0 ? "Cash put in" : "Cash taken out"} of ${t.register}${c.reason ? `: ${c.reason}` : ""}`,
      lines: c.amount > 0 ? [dr(key(SYS.cash), a), cr(key(SYS.tillClearing), a)] : [dr(key(SYS.tillClearing), a), cr(key(SYS.cash), a)],
    });
  }
  return out;
}

/** Stock added by hand: debit Stock in hand against opening equity (opening stock) or stock gains; write-offs the other way. */
export function stockAdjustmentPostings(s: StockAdjustmentSrc): Posting[] {
  if (!s.value) return [];
  const v = Math.abs(s.value);
  const other = s.reason === "opening" ? SYS.openingEquity : SYS.stockAdjustment;
  const what = s.reason === "opening" ? "Opening stock" : s.value > 0 ? "Stock added" : "Stock written off";
  return [
    {
      sourceType: "stock_adjustment",
      sourceId: s.id,
      date: s.date,
      narration: `${what}${s.itemName ? ` - ${s.itemName}` : ""}`,
      lines: s.value > 0 ? [dr(key(SYS.stock), v), cr(key(other), v)] : [dr(key(other), v), cr(key(SYS.stock), v)],
    },
  ];
}

// ------------------------------------------------------------------ opening balances

/** Customer and supplier opening balances in one journal, balanced against Opening balance equity. */
export function openingPartiesPosting(customers: readonly OpeningParty[], suppliers: readonly OpeningParty[], date: string): Posting[] {
  const lines: DraftLine[] = [];
  for (const c of customers) if (c.opening) lines.push(dr(key(SYS.debtors), c.opening, party("customer", c.id)));
  for (const s of suppliers) if (s.opening) lines.push(cr(key(SYS.creditors), s.opening, party("supplier", s.id)));
  return withOpeningPlug("opening_parties", "customers and suppliers", lines, date);
}

/** The opening balances typed on accounts, in one journal balanced against Opening balance equity. */
export function accountOpeningPosting(accounts: readonly { id: string; openingBalance: number }[], date: string): Posting[] {
  const lines: DraftLine[] = [];
  for (const a of accounts) if (a.openingBalance) lines.push(dr({ id: a.id }, a.openingBalance));
  return withOpeningPlug("account_opening", "accounts", lines, date);
}

function withOpeningPlug(sourceType: string, what: string, lines: DraftLine[], date: string): Posting[] {
  const real = nonZero(lines);
  if (real.length === 0) return [];
  const t = totalOf(real);
  const diff = t.debit - t.credit;
  const all = nonZero([...real, cr(key(SYS.openingEquity), diff)]);
  return [{ sourceType, sourceId: "all", date, narration: `Opening balances of ${what}`, lines: all }];
}

// ------------------------------------------------------------------ identity

/** What a version of a posting was built from (date, narration and lines). Equal hash = nothing to do. */
export function postingHash(p: Pick<Posting, "date" | "narration" | "lines">): string {
  const body = JSON.stringify([
    p.date,
    p.narration,
    p.lines.map((l) => [l.account, l.debit, l.credit, l.party?.type ?? null, l.party?.id ?? null]),
  ]);
  return createHash("sha256").update(body).digest("hex").slice(0, 32);
}

/** The first date on or after `date` that is not in a locked period. */
export function effectiveDate(date: string, lockedThrough: string | null | undefined): { date: string; late: boolean } {
  if (lockedThrough && date <= lockedThrough) {
    const d = new Date(`${lockedThrough}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return { date: d.toISOString().slice(0, 10), late: true };
  }
  return { date, late: false };
}

/** Which source types the engine owns, in the order they are posted. */
export const SOURCE_TYPES = [
  "account_opening",
  "opening_parties",
  "invoice",
  "invoice_cancel",
  "invoice_payment",
  "customer_receipt",
  "credit_note",
  "purchase",
  "purchase_cancel",
  "supplier_payment",
  "supplier_payment_reversal",
  "debit_note",
  "debit_note_cancel",
  "expense",
  "expense_cancel",
  "till_difference",
  "till_cash",
  "stock_adjustment",
  "gst_payment",
  "gst_payment_cancel",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Plain-language names for the day book. */
export const SOURCE_LABELS: Readonly<Record<SourceType, string>> = {
  account_opening: "Opening balances",
  opening_parties: "Opening balances",
  invoice: "Sales bill",
  invoice_cancel: "Sales bill cancelled",
  invoice_payment: "Payment on a bill",
  customer_receipt: "Customer receipt",
  credit_note: "Credit note (sales return)",
  purchase: "Purchase bill",
  purchase_cancel: "Purchase bill cancelled",
  supplier_payment: "Supplier payment",
  supplier_payment_reversal: "Supplier payment reversed",
  debit_note: "Debit note (purchase return)",
  debit_note_cancel: "Debit note cancelled",
  expense: "Expense",
  expense_cancel: "Expense cancelled",
  till_difference: "Till cash difference",
  till_cash: "Till cash in/out",
  stock_adjustment: "Stock added or written off",
  gst_payment: "Composition tax paid",
  gst_payment_cancel: "Composition tax payment cancelled",
};
