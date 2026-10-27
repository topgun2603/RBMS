/**
 * Debit notes to customers (CGST Act s.34(3)): the pure maths and rules (no database). A note raises the value of an
 * issued bill: a price revised upwards or quantity short-billed on one of its lines, or a charge billed later
 * (freight, packing ...). GST is charged line by line at the line's rate, with the bill's tax split (CGST+SGST or IGST),
 * like a bill (docs/expenses-debit-notes.md).
 */
import { computeInvoice, DEFAULT_INVOICE_PREFIX, isGstRate, sanitizePrefix, type GstRate, type LineInput, type LineTotals } from "@srirealtime/gst";
import type { SalesDebitNoteLine, SalesDebitNoteTotals } from "./schema-debit-notes";

/** A problem the API turns into a 400 with this code. */
export class DebitNoteError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DebitNoteError";
  }
}

/**
 * One line asked for. With `line` (index of a bill line) the description, HSN, unit and GST rate come from that line:
 * `qty` × `rate` is the extra value (price revised: the billed qty × the rise per unit; short-billed: the missing qty
 * × the price). Without `line` it is a new charge and needs a description and a GST rate.
 */
export interface DebitLineRequest {
  line?: number;
  description?: string;
  hsn?: string;
  unit?: string;
  qty: number;
  /** Paise per unit, GST-exclusive. */
  rate: number;
  gstRate?: number;
}

export interface DebitNoteCalc {
  lines: SalesDebitNoteLine[];
  totals: SalesDebitNoteTotals;
  total: number;
}

/**
 * Lines and totals of a debit note on a bill with `invoiceLines` and the bill's tax split (`interState`). The grand
 * total is rounded to the rupee like a bill.
 */
export function computeDebitNote(args: {
  invoiceLines: readonly Pick<LineTotals, "description" | "hsn" | "unit" | "gstRate" | "itemId" | "unitFactor" | "baseUnit">[];
  interState: boolean;
  requests: readonly DebitLineRequest[];
}): DebitNoteCalc {
  if (args.requests.length === 0) throw new DebitNoteError("debit_note_empty", "Add at least one line");
  const inputs: (LineInput & { line?: number })[] = args.requests.map((r, i) => {
    if (!(r.qty > 0) || !Number.isFinite(r.qty)) throw new DebitNoteError("debit_note_qty", `Line ${i + 1}: enter a quantity above 0`);
    if (!Number.isInteger(r.rate) || r.rate <= 0) throw new DebitNoteError("debit_note_rate", `Line ${i + 1}: enter an amount above 0`);
    if (r.line !== undefined) {
      const src = args.invoiceLines[r.line];
      if (!src) throw new DebitNoteError("debit_note_line", `Line ${i + 1}: that line is not on the bill`);
      if (r.gstRate !== undefined && r.gstRate !== src.gstRate) {
        throw new DebitNoteError("debit_note_rate_mismatch", `Line ${i + 1}: GST on a bill line stays at the bill's rate (${src.gstRate}%)`);
      }
      const out: LineInput & { line?: number } = { line: r.line, description: r.description?.trim() || src.description, qty: r.qty, rate: r.rate, gstRate: src.gstRate };
      const hsn = r.hsn ?? src.hsn;
      if (hsn) out.hsn = hsn;
      const unit = r.unit ?? src.unit;
      if (unit) out.unit = unit;
      if (src.itemId) out.itemId = src.itemId;
      return out;
    }
    const description = r.description?.trim();
    if (!description) throw new DebitNoteError("debit_note_description", `Line ${i + 1}: say what the charge is for`);
    if (r.gstRate === undefined || !isGstRate(r.gstRate)) throw new DebitNoteError("debit_note_gst_rate", `Line ${i + 1}: choose the GST rate`);
    const out: LineInput & { line?: number } = { description, qty: r.qty, rate: r.rate, gstRate: r.gstRate as GstRate };
    if (r.hsn) out.hsn = r.hsn;
    if (r.unit) out.unit = r.unit;
    return out;
  });
  // The bill's tax split is kept whatever the states say now (an SEZ bill is IGST inside the state too).
  const totals = computeInvoice(inputs, { sellerState: "seller", placeOfSupply: args.interState ? "elsewhere" : "seller" });
  const lines: SalesDebitNoteLine[] = totals.lines.map((l, i) => (inputs[i]!.line !== undefined ? { ...l, line: inputs[i]!.line } : l));
  const { lines: _l, ...rest } = totals;
  return { lines, totals: rest, total: totals.total };
}

/** Number prefix of debit notes: "DN", or "DN" + the bill's own prefix when it isn't the default ("MDU" → "DNMDU"). */
export function debitNotePrefix(invoicePrefix: string | null | undefined): string {
  const p = sanitizePrefix(invoicePrefix);
  if (p === DEFAULT_INVOICE_PREFIX) return "DN";
  return sanitizePrefix(`DN${p}`);
}

/** A note may be cancelled on the IST day it was issued, and only when nothing was received against it. */
export function debitCancelProblem(note: { status: string; issuedOn: string; paid: number }, today: string): string | null {
  if (note.status === "cancelled") return "This debit note is already cancelled";
  if (note.issuedOn !== today) return "A debit note can only be cancelled on the day it was issued";
  if (note.paid > 0) return "Money was received against this debit note; delete that receipt first";
  return null;
}

/** Spreads `amount` over open debit notes, oldest first. Returns the parts and what is left. */
export function allocateToDebitNotes(
  amount: number,
  notes: readonly { id: string; date: string; seq: number; total: number; paid: number; status: string }[],
): { allocations: { debitNoteId: string; amount: number }[]; left: number } {
  let left = Math.max(0, Math.trunc(amount));
  const allocations: { debitNoteId: string; amount: number }[] = [];
  const open = notes.filter((n) => n.status === "issued" && n.total - n.paid > 0).sort((a, b) => a.date.localeCompare(b.date) || a.seq - b.seq || a.id.localeCompare(b.id));
  for (const n of open) {
    if (left <= 0) break;
    const take = Math.min(left, n.total - n.paid);
    allocations.push({ debitNoteId: n.id, amount: take });
    left -= take;
  }
  return { allocations, left };
}
