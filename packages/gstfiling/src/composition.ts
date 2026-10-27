import { compositionOn, COMPOSITION_RATES, type GstConfig } from "./config";
import type { ItcDecision } from "./itc";
import type { SalesDocSrc } from "./ports";
import { fyLabel, fyRange, parseQuarter, quarterOfMonth, type Quarter, type Tax } from "./util";

/**
 * Composition scheme (Section 10 CGST Act, rules 3-7 CGST Rules). A composition taxpayer
 * - issues a Bill of Supply and charges no tax, writing "composition taxable person, not eligible to collect tax on
 *   supplies" on it (Rule 49 and Section 31(3)(c));
 * - pays tax of a percent of its turnover in the State: 1% traders and manufacturers, 5% restaurants, 6% other
 *   service providers (Rule 7 and the notifications under Section 10(2A));
 * - takes no input tax credit (Section 10(4)) and may not make inter-State supplies of goods or supply through an
 *   e-commerce operator (Section 10(2)(a)-(d));
 * - files CMP-08 every quarter (payment, due the 18th after the quarter) and GSTR-4 every year (due 30 April);
 * - pays reverse-charge tax on its inward supplies at the normal rates, in cash.
 */

export interface CompositionQuarter {
  quarter: string;
  from: string;
  to: string;
  rate: number;
  /** Turnover in paise: bills of supply less credit notes (cancelled bills left out). */
  turnover: number;
  /** Of which inter-State (not allowed for goods). */
  interStateTurnover: number;
  /** Composition tax on the turnover. */
  tax: { cgst: number; sgst: number; total: number };
  /** Reverse-charge tax on inward supplies: payable in cash at the normal rates. */
  rcm: { taxable: number; tax: Tax };
  invoices: number;
  creditNotes: number;
  /** Bills not issued as a bill of supply (a tax invoice dated after the composition start). */
  taxCharged: { count: number; tax: number };
}

export function buildCmp08(quarterKey: string, sales: readonly SalesDocSrc[], decisions: readonly ItcDecision[], config: GstConfig): CompositionQuarter | null {
  const q = parseQuarter(quarterKey);
  if (!q) return null;
  const rate = COMPOSITION_RATES[config.compositionType];
  let turnover = 0;
  let inter = 0;
  let invoices = 0;
  let creditNotes = 0;
  const taxCharged = { count: 0, tax: 0 };
  for (const d of sales) {
    if (!d.number || d.status === "draft" || d.status === "cancelled" || d.date < q.from || d.date > q.to) continue;
    if (!compositionOn(config, d.date)) continue;
    const note = d.docType === "CRN";
    if (d.docType && d.docType !== "INV" && !note && d.docType !== "DBN") continue;
    const sign = note ? -1 : 1;
    // A composition bill has no tax; if one was issued with tax anyway, the value still counts and the tax is flagged.
    turnover += sign * d.totals.taxable;
    if (d.interState) inter += sign * d.totals.taxable;
    const t = d.totals.cgst + d.totals.sgst + d.totals.igst;
    if (t > 0 && !note) {
      taxCharged.count += 1;
      taxCharged.tax += t;
    }
    if (note) creditNotes += 1;
    else invoices += 1;
  }
  const total = Math.round((Math.max(turnover, 0) * rate) / 100);
  const cgst = Math.floor(total / 2);
  const rcmTax: Tax = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  let rcmTaxable = 0;
  for (const d of decisions) {
    if (!d.rcm || d.doc.date < q.from || d.doc.date > q.to) continue;
    rcmTaxable += d.rcm.taxable;
    rcmTax.igst += d.rcm.tax.igst;
    rcmTax.cgst += d.rcm.tax.cgst;
    rcmTax.sgst += d.rcm.tax.sgst;
  }
  return {
    quarter: quarterKey,
    from: q.from,
    to: q.to,
    rate,
    turnover,
    interStateTurnover: inter,
    tax: { cgst: total - cgst, sgst: cgst, total },
    rcm: { taxable: rcmTaxable, tax: rcmTax },
    invoices,
    creditNotes,
    taxCharged,
  };
}

export interface Gstr4Annual {
  fy: string;
  from: string;
  to: string;
  quarters: CompositionQuarter[];
  /** Aggregate: turnover and composition tax of the year. */
  turnover: number;
  tax: number;
  /** Inward supplies for Table 4: from registered suppliers (other than reverse charge), reverse charge from registered / unregistered, imports. */
  inward: { registered: number; rcmRegistered: number; rcmUnregistered: number; imports: number };
  /** Tax paid by challan against the year (CMP-08 payments). */
  paid: number;
}

/** The yearly figures for GSTR-4 (composition taxpayer's annual return): sums of the four CMP-08 quarters and the inward supplies. */
export function buildGstr4(fyStart: number, quarters: readonly CompositionQuarter[], inward: Gstr4Annual["inward"], paid: number): Gstr4Annual {
  const r = fyRange(fyStart);
  return {
    fy: fyLabel(fyStart),
    from: r.from,
    to: r.to,
    quarters: [...quarters],
    turnover: quarters.reduce((s, q) => s + q.turnover, 0),
    tax: quarters.reduce((s, q) => s + q.tax.total, 0),
    inward,
    paid,
  };
}

/** The quarters (keys) of a financial year in order. */
export function quartersOfFy(fyStart: number): Quarter[] {
  return [0, 3, 6, 9].map((n) => quarterOfMonth(`${fyStart + Math.floor((3 + n) / 12)}-${String(((3 + n) % 12) + 1).padStart(2, "0")}`));
}

/** Turnover limit for composition: 1.5 crore for goods (75 lakh in special-category States), 50 lakh for services (paise). */
export const COMPOSITION_LIMITS = { goods: 150_00_000_00, services: 50_00_000_00 };

/**
 * The invoice engine's view of the scheme: from `compositionFrom` on a new bill is a bill of supply with no tax. Old
 * bills are never touched. Returns the fields to put on the seller snapshot of a bill dated `date`.
 */
export function sellerScheme(config: Pick<GstConfig, "composition" | "compositionFrom">, date: string): "composition" | "regular" {
  return compositionOn(config, date) ? "composition" : "regular";
}

export const BILL_OF_SUPPLY_NOTE = "Composition taxable person, not eligible to collect tax on supplies.";
