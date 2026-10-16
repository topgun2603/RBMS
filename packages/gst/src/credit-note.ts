/**
 * Credit note GST maths (pure, browser-safe): what is still returnable on each invoice line, and a credit note's lines
 * and totals recomputed from the original invoice lines (same rate, same CGST+SGST / IGST split).
 */
import type { GstRate, LineTotals, TaxBreakupRow, InvoiceTotals } from "./gst";

/** One line of a credit note: a share of an invoice line (returned quantity, or a value-only correction). */
export interface CreditNoteLineTotals extends LineTotals {
  /** Index of the line on the original invoice. */
  line: number;
  /** "qty" = goods coming back (qty > 0); "value" = a price correction / discount only (qty 0, no stock). */
  kind: "qty" | "value";
  /** Whether the returned quantity goes back into stock. */
  restock: boolean;
}

/** Totals of a credit note (an invoice's totals shape, without lines). */
export type CreditNoteTotals = Omit<InvoiceTotals, "lines">;

/** A credit note problem the API turns into a 400 with this code. */
export class CreditNoteError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CreditNoteError";
  }
}

const milli = (q: number) => Math.round(q * 1000);
const fromMilli = (m: number) => m / 1000;
/** Half away from zero. */
const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

interface Amounts {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}
const COMPONENTS = ["taxable", "cgst", "sgst", "igst"] as const;

/** What is left to credit on one invoice line after earlier (issued) credit notes. */
export interface LineCreditState {
  line: number;
  description: string;
  unit: string | null;
  itemId: string | null;
  gstRate: GstRate;
  rate: number;
  /** Quantity billed. */
  qty: number;
  returnedQty: number;
  remainingQty: number;
  /** Line total billed (GST-inclusive). */
  total: number;
  /** Already credited (all earlier notes, value corrections included). */
  credited: Amounts & { total: number };
  /** Still creditable. */
  remaining: Amounts & { total: number };
}

const sumAmounts = (a: Amounts) => a.taxable + a.cgst + a.sgst + a.igst;

/** Per invoice line: billed, already returned / credited, and what is left. `prior` = lines of issued credit notes. */
export function creditState(invoiceLines: readonly LineTotals[], prior: readonly Pick<CreditNoteLineTotals, "line" | "qty" | "taxable" | "cgst" | "sgst" | "igst" | "kind">[]): LineCreditState[] {
  return invoiceLines.map((l, i) => {
    const mine = prior.filter((p) => p.line === i);
    const returnedMilli = mine.filter((p) => p.kind === "qty").reduce((s, p) => s + milli(p.qty), 0);
    const credited: Amounts = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    for (const p of mine) for (const k of COMPONENTS) credited[k] += p[k];
    const remaining: Amounts = {
      taxable: Math.max(l.taxable - credited.taxable, 0),
      cgst: Math.max(l.cgst - credited.cgst, 0),
      sgst: Math.max(l.sgst - credited.sgst, 0),
      igst: Math.max(l.igst - credited.igst, 0),
    };
    const remainingMilli = Math.max(milli(l.qty) - returnedMilli, 0);
    return {
      line: i,
      description: l.description,
      unit: l.unit ?? null,
      itemId: l.itemId ?? null,
      gstRate: l.gstRate,
      rate: l.rate,
      qty: l.qty,
      returnedQty: fromMilli(returnedMilli),
      // A line whose value is fully credited (price corrections) has nothing left to return either.
      remainingQty: sumAmounts(remaining) > 0 ? fromMilli(remainingMilli) : 0,
      total: l.total,
      credited: { ...credited, total: sumAmounts(credited) },
      remaining: { ...remaining, total: sumAmounts(remaining) },
    };
  });
}

export interface CreditLineRequest {
  /** Index of the invoice line. */
  line: number;
  /** Quantity coming back (up to 3 decimals). */
  qty?: number;
  /** Value-only credit: GST-exclusive paise (price correction / discount). */
  taxable?: number;
  /** Put the returned quantity back in stock (default: true for returns of saved items). */
  restock?: boolean;
}

export interface CreditNoteCalcInput {
  invoiceLines: readonly LineTotals[];
  /** Invoice grand total (after round-off). */
  invoiceTotal: number;
  /** The invoice's tax split: IGST (inter-state) or CGST + SGST. */
  interState: boolean;
  /** Sum of the totals of the invoice's issued credit notes. */
  priorCreditedTotal: number;
  prior: readonly Pick<CreditNoteLineTotals, "line" | "qty" | "taxable" | "cgst" | "sgst" | "igst" | "kind">[];
  requests: readonly CreditLineRequest[];
  /** Value-only lines allowed (price correction / discount); false for returns. */
  allowValue: boolean;
  /** Restock returned saved items unless a line says otherwise (true for returns). */
  restockByDefault: boolean;
  /** Round the note's total to the rupee like invoices (default true). */
  roundToRupee?: boolean;
}

export interface CreditNoteCalc {
  lines: CreditNoteLineTotals[];
  totals: CreditNoteTotals;
  total: number;
  /** True when this note credits everything that was left on the invoice. */
  completesInvoice: boolean;
}

/**
 * Builds a credit note's lines and totals from the original invoice lines.
 *
 * Quantity lines take the line's remaining value (taxable, CGST, SGST, IGST separately) in proportion to the quantity
 * against the quantity still returnable; the last return of a line takes exactly what is left, so the notes of a fully
 * returned line add up to the original line to the paisa. Value lines (price correction / discount) credit a
 * GST-exclusive amount and its GST at the line's rate and original split. The total is rounded to the rupee; the note
 * that clears the invoice gets `invoice total − earlier notes`, so a fully credited bill nets to zero.
 */
export function computeCreditNote(input: CreditNoteCalcInput): CreditNoteCalc {
  if (input.requests.length === 0) throw new CreditNoteError("credit_note_empty", "Pick at least one line");
  const state = creditState(input.invoiceLines, input.prior);
  // Running state so two requests for the same line in one note see each other.
  const left = state.map((s) => ({ milli: milli(s.remainingQty), ...s.remaining }));
  const lines: CreditNoteLineTotals[] = [];

  for (const r of input.requests) {
    const orig = input.invoiceLines[r.line];
    const st = state[r.line];
    const rem = left[r.line];
    if (!orig || !st || !rem || !Number.isInteger(r.line)) throw new CreditNoteError("credit_note_line", `Line ${r.line + 1} is not on this bill`);
    const hasQty = r.qty !== undefined && r.qty !== null && r.qty > 0;
    const hasValue = r.taxable !== undefined && r.taxable !== null && r.taxable > 0;
    if (hasQty === hasValue) throw new CreditNoteError("credit_note_line", `Line ${r.line + 1}: give either a quantity or an amount`);
    const bp = Math.round(orig.gstRate * 100);
    let part: Amounts;
    let kind: "qty" | "value";
    let qtyMilli = 0;

    if (hasQty) {
      qtyMilli = milli(r.qty!);
      if (Math.abs(qtyMilli - r.qty! * 1000) > 1e-6) throw new CreditNoteError("credit_note_qty", "Quantity allows up to 3 decimals");
      if (qtyMilli > rem.milli) {
        throw new CreditNoteError(
          "credit_note_qty",
          rem.milli === 0
            ? `${orig.description}: nothing left to return`
            : `${orig.description}: only ${fromMilli(rem.milli)} ${orig.unit ?? ""} can be returned`.trim(),
        );
      }
      kind = "qty";
      if (qtyMilli === rem.milli) part = { taxable: rem.taxable, cgst: rem.cgst, sgst: rem.sgst, igst: rem.igst };
      else {
        part = { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        for (const k of COMPONENTS) part[k] = Math.min(round((rem[k] * qtyMilli) / rem.milli), rem[k]);
      }
    } else {
      if (!input.allowValue) throw new CreditNoteError("credit_note_line", "A return credits quantities; use a price correction or discount for an amount");
      const t = r.taxable!;
      if (!Number.isInteger(t)) throw new CreditNoteError("credit_note_amount", "Amounts are whole paise");
      if (t > rem.taxable) throw new CreditNoteError("credit_note_amount", `${orig.description}: at most ${rem.taxable} paise (before GST) can be credited`);
      kind = "value";
      if (t === rem.taxable) part = { taxable: rem.taxable, cgst: rem.cgst, sgst: rem.sgst, igst: rem.igst };
      else if (input.interState) {
        part = { taxable: t, cgst: 0, sgst: 0, igst: Math.min(round((t * bp) / 10_000), rem.igst) };
      } else {
        const half = round((t * bp) / 20_000);
        part = { taxable: t, cgst: Math.min(half, rem.cgst), sgst: Math.min(half, rem.sgst), igst: 0 };
      }
    }

    const total = sumAmounts(part);
    if (total <= 0) throw new CreditNoteError("credit_note_amount", `${orig.description}: nothing left to credit`);
    rem.milli -= qtyMilli;
    for (const k of COMPONENTS) rem[k] -= part[k];
    const restock = kind === "qty" && Boolean(orig.itemId) && (r.restock ?? input.restockByDefault);
    const line: CreditNoteLineTotals = {
      line: r.line,
      kind,
      restock,
      description: orig.description,
      qty: fromMilli(qtyMilli),
      rate: orig.rate,
      gstRate: orig.gstRate,
      amount: part.taxable,
      discount: 0,
      ...part,
      total,
    };
    if (orig.hsn) line.hsn = orig.hsn;
    if (orig.unit) line.unit = orig.unit;
    if (orig.itemId) line.itemId = orig.itemId;
    lines.push(line);
  }

  const sum = (k: "taxable" | "cgst" | "sgst" | "igst") => lines.reduce((s, l) => s + l[k], 0);
  const taxable = sum("taxable");
  const cgst = sum("cgst");
  const sgst = sum("sgst");
  const igst = sum("igst");
  const exact = taxable + cgst + sgst + igst;
  const completesInvoice = left.every((l) => l.taxable + l.cgst + l.sgst + l.igst <= 0);
  const creditable = Math.max(input.invoiceTotal - input.priorCreditedTotal, 0);
  let total: number;
  if (completesInvoice) total = creditable;
  else {
    total = input.roundToRupee === false ? exact : round(exact / 100) * 100;
    if (total <= 0) total = exact;
    total = Math.min(total, creditable);
  }
  if (total <= 0) throw new CreditNoteError("credit_note_amount", "Nothing is left to credit on this bill");

  const byRate = new Map<GstRate, TaxBreakupRow>();
  for (const l of lines) {
    const row = byRate.get(l.gstRate) ?? { gstRate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    row.taxable += l.taxable;
    row.cgst += l.cgst;
    row.sgst += l.sgst;
    row.igst += l.igst;
    byRate.set(l.gstRate, row);
  }
  const totals: CreditNoteTotals = {
    subtotal: taxable,
    discount: 0,
    taxable,
    cgst,
    sgst,
    igst,
    roundOff: total - exact,
    total,
    taxBreakup: [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate),
  };
  return { lines, totals, total, completesInvoice };
}
