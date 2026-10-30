import { computeLine } from "@rbms/gst";
import { describe, expect, it } from "vitest";
import { allocateToDebitNotes, computeDebitNote, debitCancelProblem, DebitNoteError, debitNotePrefix } from "./debit-notes-calc";
import { debitNoteInputSchema } from "./debit-notes";
import { gstSummary, type GstCreditNote, type GstInvoice } from "./reports";

// A bill line: 10 shirts at ₹500 + 5% (HSN 6205), and one at 12%.
const billLines = [
  computeLine({ description: "Cotton shirt", hsn: "6205", qty: 10, unit: "pcs", rate: 50_000, gstRate: 5 }, false),
  computeLine({ description: "Silk scarf", hsn: "6214", qty: 2, unit: "pcs", rate: 100_000, gstRate: 12 }, false),
];

describe("computeDebitNote", () => {
  it("price revised on a bill line: the extra per unit × the billed qty, GST at the line's rate, intra-state halves", () => {
    const c = computeDebitNote({ invoiceLines: billLines, interState: false, requests: [{ line: 0, qty: 10, rate: 2_000 }] });
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]).toMatchObject({ line: 0, description: "Cotton shirt", hsn: "6205", unit: "pcs", gstRate: 5, taxable: 20_000, cgst: 500, sgst: 500, igst: 0 });
    expect(c.totals).toMatchObject({ taxable: 20_000, cgst: 500, sgst: 500, igst: 0, roundOff: 0 });
    expect(c.total).toBe(21_000);
  });

  it("short-billed quantity plus freight billed later, inter-state: IGST, rounded to the rupee like a bill", () => {
    const c = computeDebitNote({
      invoiceLines: billLines,
      interState: true,
      requests: [
        { line: 1, qty: 1, rate: 100_000 },
        { description: "Freight (Chennai to Bengaluru)", hsn: "9965", qty: 1, rate: 35_050, gstRate: 12 },
      ],
    });
    expect(c.lines.map((l) => [l.description, l.gstRate, l.taxable, l.igst, l.cgst])).toEqual([
      ["Silk scarf", 12, 100_000, 12_000, 0],
      ["Freight (Chennai to Bengaluru)", 12, 35_050, 4_206, 0],
    ]);
    expect(c.lines[1]!.line).toBeUndefined();
    // 1,35,050 + 16,206 = 1,51,256 paise → ₹1,513 (round-off +44).
    expect(c.totals).toMatchObject({ taxable: 135_050, igst: 16_206, roundOff: 44 });
    expect(c.total).toBe(151_300);
  });

  it("keeps the bill line's GST rate, needs a description and rate for a new charge, and real amounts", () => {
    const err = (requests: Parameters<typeof computeDebitNote>[0]["requests"]) => {
      try {
        computeDebitNote({ invoiceLines: billLines, interState: false, requests });
        return null;
      } catch (e) {
        return e instanceof DebitNoteError ? e.code : String(e);
      }
    };
    expect(err([{ line: 0, qty: 1, rate: 100, gstRate: 18 }])).toBe("debit_note_rate_mismatch");
    expect(err([{ line: 5, qty: 1, rate: 100 }])).toBe("debit_note_line");
    expect(err([{ qty: 1, rate: 100, gstRate: 18 }])).toBe("debit_note_description");
    expect(err([{ description: "Packing", qty: 1, rate: 100, gstRate: 7 }])).toBe("debit_note_gst_rate");
    expect(err([{ line: 0, qty: 0, rate: 100 }])).toBe("debit_note_qty");
    expect(err([{ line: 0, qty: 1, rate: 0 }])).toBe("debit_note_rate");
    expect(err([])).toBe("debit_note_empty");
  });

  it("the input schema takes the reasons of s.34(3) and at least one line", () => {
    expect(debitNoteInputSchema.safeParse({ reason: "price_revision", lines: [{ line: 0, qty: 1, rate: 100 }] }).success).toBe(true);
    expect(debitNoteInputSchema.safeParse({ reason: "freight", lines: [] }).success).toBe(false);
    expect(debitNoteInputSchema.safeParse({ reason: "discount", lines: [{ line: 0, qty: 1, rate: 100 }] }).success).toBe(false);
    expect(debitNoteInputSchema.safeParse({ reason: "other", lines: [{ line: 0, qty: 1, rate: 10.5 }] }).success).toBe(false);
  });
});

describe("debit note rules", () => {
  it("prefix follows the bill's series", () => {
    expect(debitNotePrefix(null)).toBe("DN");
    expect(debitNotePrefix("INV")).toBe("DN");
    expect(debitNotePrefix("MDU")).toBe("DNMDU");
  });

  it("cancel only on the day, and only when nothing was received", () => {
    expect(debitCancelProblem({ status: "issued", issuedOn: "2026-10-15", paid: 0 }, "2026-10-15")).toBeNull();
    expect(debitCancelProblem({ status: "issued", issuedOn: "2026-10-14", paid: 0 }, "2026-10-15")).toMatch(/day it was issued/);
    expect(debitCancelProblem({ status: "issued", issuedOn: "2026-10-15", paid: 100 }, "2026-10-15")).toMatch(/received/);
    expect(debitCancelProblem({ status: "cancelled", issuedOn: "2026-10-15", paid: 0 }, "2026-10-15")).toMatch(/already/);
  });

  it("receipt money left after the bills settles open debit notes oldest first", () => {
    const notes = [
      { id: "b", date: "2026-10-20", seq: 2, total: 5_000, paid: 0, status: "issued" },
      { id: "a", date: "2026-10-10", seq: 1, total: 3_000, paid: 1_000, status: "issued" },
      { id: "c", date: "2026-10-05", seq: 3, total: 9_000, paid: 0, status: "cancelled" },
    ];
    expect(allocateToDebitNotes(4_000, notes)).toEqual({ allocations: [{ debitNoteId: "a", amount: 2_000 }, { debitNoteId: "b", amount: 2_000 }], left: 0 });
    expect(allocateToDebitNotes(10_000, notes)).toEqual({ allocations: [{ debitNoteId: "a", amount: 2_000 }, { debitNoteId: "b", amount: 5_000 }], left: 3_000 });
    expect(allocateToDebitNotes(0, notes)).toEqual({ allocations: [], left: 0 });
  });
});

describe("gstSummary with debit notes to customers", () => {
  const REG = "33AAGCB7383J1ZF";
  const bill: GstInvoice = { id: "i1", number: "INV/26-27/0040", customerName: "Meena", customerGstin: REG, placeOfSupply: "33", interState: false, total: 525_000, lines: [billLines[0]!] };
  const walkIn: GstInvoice = { ...bill, id: "i2", number: "INV/26-27/0041", customerGstin: null, customerName: "Walk-in" };
  const c = computeDebitNote({ invoiceLines: billLines, interState: false, requests: [{ line: 0, qty: 10, rate: 2_000 }] });
  const note = (over: Partial<GstCreditNote>): GstCreditNote => ({
    id: "d1",
    number: "DN/26-27/0001",
    date: "2026-10-15",
    invoiceNumber: "INV/26-27/0040",
    invoiceDate: "2026-10-02",
    customerName: "Meena",
    customerGstin: REG,
    placeOfSupply: "33",
    interState: false,
    invoiceTotal: 525_000,
    total: c.total,
    lines: c.lines,
    ...over,
  });

  it("lists the note in CDNR with type D and adds its value and tax to the totals, HSN and GSTR-3B", () => {
    const s = gstSummary([bill], [], [note({})]);
    expect(s.cdnr).toEqual([
      expect.objectContaining({ gstin: REG, noteNumber: "DN/26-27/0001", noteType: "D", invoiceNumber: "INV/26-27/0040", rate: 5, taxable: 20_000, cgst: 500, sgst: 500, igst: 0, noteValue: 21_000 }),
    ]);
    expect(s.totals).toMatchObject({ invoices: 1, creditNotes: 0, debitNotes: 1, taxable: 520_000, cgst: 13_000, sgst: 13_000 });
    expect(s.debitNoteTotals).toMatchObject({ count: 1, taxable: 20_000, total: 21_000 });
    expect(s.gstr3b).toMatchObject({ outwardTaxable: 520_000, cgst: 13_000, sgst: 13_000 });
    expect(s.hsn.find((h) => h.hsn === "6205")).toMatchObject({ qty: 20, taxable: 520_000 });
  });

  it("a note on a small B2C bill is added into B2CS; with a credit note too, each keeps its own sign", () => {
    const d = note({ id: "d2", number: "DN/26-27/0002", customerGstin: null, customerName: "Walk-in", invoiceTotal: walkIn.total });
    const cn = note({ id: "c1", number: "CN/26-27/0001", customerGstin: null, customerName: "Walk-in", total: 10_500, lines: [{ ...c.lines[0]!, taxable: 10_000, cgst: 250, sgst: 250, qty: 5 }] });
    const s = gstSummary([walkIn], [cn], [d]);
    expect(s.cdnr).toEqual([]);
    expect(s.b2cs).toEqual([{ placeOfSupply: "33", rate: 5, taxable: 510_000, cgst: 12_750, sgst: 12_750, igst: 0 }]);
    expect(s.totals).toMatchObject({ creditNotes: 1, debitNotes: 1, total: 525_000 - 10_500 + 21_000 });
  });

  it("CDNUR (type D) for an unregistered buyer of a large inter-state bill", () => {
    const inter = computeDebitNote({ invoiceLines: billLines, interState: true, requests: [{ line: 0, qty: 10, rate: 2_000 }] });
    const d = note({ customerGstin: null, interState: true, placeOfSupply: "29", invoiceTotal: 150_000_00, total: inter.total, lines: inter.lines });
    const s = gstSummary([], [], [d]);
    expect(s.cdnur).toEqual([expect.objectContaining({ noteType: "D", type: "B2CL", placeOfSupply: "29", rate: 5, taxable: 20_000, igst: 1_000, noteValue: 21_000 })]);
  });
});
