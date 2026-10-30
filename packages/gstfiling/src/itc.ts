import { isValidGstin, normalizeGstin, stateFromGstin } from "@rbms/gst";
import type { ExpenseSrc, PurchaseReturnSrc, PurchaseSrc } from "./ports";
import { addDays, daysBetween, fyStartYear, monthOf, type Tax } from "./util";

/**
 * Input tax credit (ITC) per purchase bill and expense: whether it can be claimed, in which month, and what is owed on
 * reverse charge. Pure functions over plain data (rules in docs/gst-filing.md):
 * - Section 16(1)-(2): credit only for business use, on a tax invoice of a registered supplier, once the supplier has
 *   reported it (checked with the GSTR-2B reconciliation, not here).
 * - Section 16(4): not later than 30 November after the financial year of the bill; the October return is the last one
 *   that is filed by then.
 * - Section 17(5): blocked credits (motor vehicles for people, food and beverages, club fees, personal use ...).
 * - Section 17(1)-(2), rules 38, 42, 43: partial credit, exempt supplies, capital goods: the owner types the reversal.
 * - Second proviso to Section 16(2) and rule 37: reverse credit when the supplier is not paid within 180 days.
 * - Section 9(3)/(4), 5(3)/(4) IGST: reverse charge; the buyer pays the tax in cash and takes credit from the month of payment.
 */

export type ItcStatusKey = "eligible" | "ineligible" | "blocked" | "reversal";
export type ItcClassKey = "oth" | "impg" | "imps" | "isd";
export type ItcDocType = "purchase" | "expense" | "debit_note";

export interface DocFlagSrc {
  docType: "purchase" | "expense";
  docId: string;
  itcStatus: ItcStatusKey | null;
  itcClass: ItcClassKey | null;
  reversalReason: "rule37" | "rule38" | "rule42" | "rule43" | "section17_5" | "other" | null;
  reason: string | null;
  claimMonth: string | null;
  reversalMonth: string | null;
  rcm: boolean;
  rcmCategory: string | null;
  rcmRate: number | null;
  rcmTaxable: number | null;
  rcmImport: boolean;
  rcmPaidOn: string | null;
  rcmPaidAmount: number | null;
  rcmChallan: string | null;
  note: string | null;
}

/** A purchase bill, expense or supplier debit note reduced to what ITC needs. */
export interface ItcDoc {
  key: string;
  docType: ItcDocType;
  docId: string;
  number: string;
  date: string;
  party: string;
  gstin: string | null;
  /** Two-digit state of the supplier (from the GSTIN or the bill). */
  partyState: string | null;
  interState: boolean;
  /** Paise. */
  taxable: number;
  tax: Tax;
  /** Rate of the document's biggest line (percent), for reverse charge. */
  rate: number;
  total: number;
  /** Purchases only. */
  amountPaid: number | null;
  /** Debit notes: the bill it returns. */
  billNumber?: string | null;
  flag: DocFlagSrc | null;
}

export function purchaseDoc(p: PurchaseSrc, flag: DocFlagSrc | null): ItcDoc {
  const biggest = [...p.lines].sort((a, b) => b.taxable - a.taxable)[0];
  return {
    key: `purchase:${p.id}`,
    docType: "purchase",
    docId: p.id,
    number: p.billNumber,
    date: p.date,
    party: p.supplierName,
    gstin: p.supplierGstin ? normalizeGstin(p.supplierGstin) : null,
    partyState: p.supplierState ?? stateFromGstin(p.supplierGstin),
    interState: p.interState,
    taxable: p.taxable,
    tax: { igst: p.igst, cgst: p.cgst, sgst: p.sgst, cess: 0 },
    rate: biggest?.gstRate ?? 0,
    total: p.total,
    amountPaid: p.amountPaid,
    flag,
  };
}

/** The GST on an expense is split like the accounting module: IGST when the vendor's GSTIN is from another state. */
export function expenseDoc(e: ExpenseSrc, shopState: string | null, flag: DocFlagSrc | null): ItcDoc {
  const vendorState = stateFromGstin(e.vendorGstin);
  const inter = !!vendorState && !!shopState && vendorState !== shopState;
  const gst = e.gstAmount;
  const half = Math.floor(gst / 2);
  return {
    key: `expense:${e.id}`,
    docType: "expense",
    docId: e.id,
    number: e.reference?.trim() || e.categoryName,
    date: e.date,
    party: e.vendorName?.trim() || e.categoryName,
    gstin: e.vendorGstin ? normalizeGstin(e.vendorGstin) : null,
    partyState: vendorState,
    interState: inter,
    taxable: Math.max(e.amount - gst, 0),
    tax: inter ? { igst: gst, cgst: 0, sgst: 0, cess: 0 } : { igst: 0, cgst: gst - half, sgst: half, cess: 0 },
    rate: e.gstRate,
    total: e.amount,
    amountPaid: null,
    flag,
  };
}

export function returnDoc(r: PurchaseReturnSrc): ItcDoc {
  return {
    key: `debit_note:${r.id}`,
    docType: "debit_note",
    docId: r.id,
    number: r.number,
    date: r.date,
    party: r.supplierName,
    gstin: r.supplierGstin ? normalizeGstin(r.supplierGstin) : null,
    partyState: stateFromGstin(r.supplierGstin),
    interState: r.igst > 0,
    taxable: r.taxable,
    tax: { igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: 0 },
    rate: 0,
    total: r.total,
    amountPaid: null,
    billNumber: r.billNumber,
    flag: null,
  };
}

export type ItcReason =
  | "ok"
  | "no_gstin"
  | "no_tax"
  | "composition"
  | "owner_ineligible"
  | "owner_blocked"
  | "owner_reversal"
  | "lapsed_16_4"
  | "rcm_unpaid"
  | "rcm_paid";

export interface ItcDecision {
  key: string;
  doc: ItcDoc;
  status: ItcStatusKey;
  /** Where the status comes from. */
  source: "default" | "owner";
  reason: ItcReason;
  class: ItcClassKey;
  /** The credit on the document (what the supplier charged) in paise. */
  tax: Tax;
  /** The month the credit is taken, or null when none is taken (ineligible / blocked / waiting for payment). */
  claimMonth: string | null;
  /** The month a reversal is reported, when status is "reversal". */
  reversalMonth: string | null;
  /** Credit lapsed under Section 16(4) when claimed in `lapsedMonth` (the month it was meant to be claimed). */
  lapsed: boolean;
  lapsedMonth: string | null;
  rcm: RcmLiability | null;
  reversalReason: DocFlagSrc["reversalReason"];
}

export interface RcmLiability {
  category: string | null;
  isImport: boolean;
  rate: number;
  taxable: number;
  tax: Tax;
  /** Month the liability is reported in 3.1(d): the document's month. */
  month: string;
  paidOn: string | null;
  paidAmount: number | null;
  /** Total tax due (igst + cgst + sgst + cess). */
  due: number;
  paid: boolean;
}

/** The last month whose GSTR-3B can claim a bill of the given date: October after the financial year (Section 16(4)). */
export const lastClaimMonth = (billDate: string) => `${fyStartYear(billDate) + 1}-10`;

export interface ItcContext {
  /** Composition taxpayer on this date. */
  compositionOn: (date: string) => boolean;
  /** Shop state, for reverse-charge tax splits. */
  shopState: string | null;
}

/** The reverse-charge tax on a document. */
export function rcmLiability(doc: ItcDoc, ctx: ItcContext): RcmLiability | null {
  const f = doc.flag;
  if (!f?.rcm) return null;
  const taxable = f.rcmTaxable ?? doc.taxable;
  const rate = f.rcmRate ?? doc.rate;
  const total = Math.round((taxable * rate) / 100);
  const inter = f.rcmImport || doc.interState || (!!doc.partyState && !!ctx.shopState && doc.partyState !== ctx.shopState);
  const half = Math.floor(total / 2);
  const tax: Tax = inter ? { igst: total, cgst: 0, sgst: 0, cess: 0 } : { igst: 0, cgst: total - half, sgst: half, cess: 0 };
  return {
    category: f.rcmCategory,
    isImport: f.rcmImport,
    rate,
    taxable,
    tax,
    month: monthOf(doc.date),
    paidOn: f.rcmPaidOn,
    paidAmount: f.rcmPaidAmount,
    due: total,
    paid: !!f.rcmPaidOn && (f.rcmPaidAmount ?? total) >= total,
  };
}

/** Decides the credit of one document. Cancelled documents are never passed. */
export function decideItc(doc: ItcDoc, ctx: ItcContext): ItcDecision {
  const f = doc.flag;
  const cls: ItcClassKey = f?.itcClass ?? "oth";
  const base = { key: doc.key, doc, class: cls, tax: doc.tax, reversalMonth: null as string | null, lapsed: false, lapsedMonth: null as string | null, rcm: null as RcmLiability | null, reversalReason: f?.reversalReason ?? null };
  const hasTax = doc.tax.igst + doc.tax.cgst + doc.tax.sgst + doc.tax.cess > 0;

  // Reverse charge: the credit is the self-assessed tax, taken from the month it is paid.
  const rcm = rcmLiability(doc, ctx);
  if (rcm) {
    const klass: ItcClassKey = rcm.isImport ? "imps" : "oth";
    const eligibleByOwner = f?.itcStatus !== "ineligible" && f?.itcStatus !== "blocked";
    const comp = ctx.compositionOn(doc.date);
    if (comp || !eligibleByOwner) {
      return { ...base, class: klass, tax: rcm.tax, status: f?.itcStatus === "blocked" ? "blocked" : "ineligible", source: comp ? "default" : "owner", reason: comp ? "composition" : f?.itcStatus === "blocked" ? "owner_blocked" : "owner_ineligible", claimMonth: null, rcm };
    }
    const claim = rcm.paidOn ? (f?.claimMonth ?? monthOf(rcm.paidOn)) : null;
    const lapsed = !!claim && claim > lastClaimMonth(doc.date);
    return { ...base, class: klass, tax: rcm.tax, status: "eligible", source: "default", reason: rcm.paid ? "rcm_paid" : "rcm_unpaid", claimMonth: lapsed ? null : claim, lapsed, lapsedMonth: lapsed ? claim : null, rcm };
  }

  if (ctx.compositionOn(doc.date)) {
    return { ...base, status: "ineligible", source: "default", reason: "composition", claimMonth: null };
  }
  if (f?.itcStatus === "blocked") return { ...base, status: "blocked", source: "owner", reason: "owner_blocked", claimMonth: null };
  if (f?.itcStatus === "ineligible") return { ...base, status: "ineligible", source: "owner", reason: "owner_ineligible", claimMonth: null };

  if (!hasTax) return { ...base, status: "ineligible", source: "default", reason: "no_tax", claimMonth: null };
  const needsGstin = cls === "oth" || cls === "isd";
  if (needsGstin && !isValidGstin(doc.gstin)) return { ...base, status: "ineligible", source: "default", reason: "no_gstin", claimMonth: null };

  const claim = f?.claimMonth ?? monthOf(doc.date);
  const lapsed = claim > lastClaimMonth(doc.date);
  if (lapsed) return { ...base, status: "eligible", source: f?.itcStatus ? "owner" : "default", reason: "lapsed_16_4", claimMonth: null, lapsed: true, lapsedMonth: claim };
  if (f?.itcStatus === "reversal") {
    return { ...base, status: "reversal", source: "owner", reason: "owner_reversal", claimMonth: claim, reversalMonth: f.reversalMonth ?? claim };
  }
  return { ...base, status: "eligible", source: f?.itcStatus ? "owner" : "default", reason: "ok", claimMonth: claim };
}

/**
 * Rule 37: credit on a bill not paid to the supplier within 180 days of the bill date must be paid back (with interest)
 * and can be taken again when paid. Returns the unpaid share of the credit for bills past 180 days on `asOf`.
 */
export function rule37Candidates(decisions: readonly ItcDecision[], asOf: string): { decision: ItcDecision; unpaid: number; days: number; credit: Tax }[] {
  const out: { decision: ItcDecision; unpaid: number; days: number; credit: Tax }[] = [];
  for (const d of decisions) {
    if (d.doc.docType !== "purchase" || d.rcm || (d.status !== "eligible" && d.status !== "reversal")) continue;
    if (d.status === "reversal" && d.reversalReason === "rule37") continue;
    const days = daysBetween(d.doc.date, asOf);
    if (days <= 180 || !d.doc.total) continue;
    const unpaid = Math.max(d.doc.total - (d.doc.amountPaid ?? 0), 0);
    if (unpaid <= 0) continue;
    const share = unpaid / d.doc.total;
    const credit: Tax = {
      igst: Math.round(d.tax.igst * share),
      cgst: Math.round(d.tax.cgst * share),
      sgst: Math.round(d.tax.sgst * share),
      cess: Math.round(d.tax.cess * share),
    };
    if (credit.igst + credit.cgst + credit.sgst + credit.cess > 0) out.push({ decision: d, unpaid, days, credit });
  }
  return out;
}

/** Date after which a bill's credit is past 180 days. */
export const rule37Date = (billDate: string) => addDays(billDate, 180);
