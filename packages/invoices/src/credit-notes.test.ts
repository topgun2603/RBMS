import { computeCreditNote, computeInvoice, CreditNoteError, gstinCheckChar, type LineInput } from "@srirealtime/gst";
import { describe, expect, it } from "vitest";
import { cancelProblem, creditNotePrefix, settleCreditNote } from "./credit-notes-calc";
import { buildLedger, ledgerEvents } from "./ledger";
import { balanceOf, deriveStatus, paymentProblem } from "./logic";
import { creditNoteSection, gstSummary, type GstCreditNote, type GstInvoice } from "./reports";

const KA_GSTIN = `29AAACR5055K1Z${gstinCheckChar("29AAACR5055K1Z")}`;

describe("settleCreditNote", () => {
  it("only reduces what is owed on an unpaid bill, whatever the refund mode", () => {
    expect(settleCreditNote({ total: 10_000, paid: 0, credited: 0 }, 3_000, "cash", { hasCustomer: false })).toEqual({ refund: 0, toCreditBook: 0, reducesBalance: 3_000 });
    expect(settleCreditNote({ total: 10_000, paid: 0, credited: 0 }, 3_000, "none", { hasCustomer: false })).toEqual({ refund: 0, toCreditBook: 0, reducesBalance: 3_000 });
  });

  it("refunds the part the customer already paid (cash / UPI / card)", () => {
    // ₹100 bill, ₹40 paid: a ₹80 note clears the ₹60 owed and refunds ₹20.
    expect(settleCreditNote({ total: 10_000, paid: 4_000, credited: 0 }, 8_000, "upi", { hasCustomer: false })).toEqual({ refund: 2_000, toCreditBook: 0, reducesBalance: 6_000 });
    expect(settleCreditNote({ total: 10_000, paid: 10_000, credited: 0 }, 3_000, "card", { hasCustomer: false }).refund).toBe(3_000);
    // Earlier notes count as settled too.
    expect(settleCreditNote({ total: 10_000, paid: 7_000, credited: 3_000 }, 2_000, "cash", { hasCustomer: false }).refund).toBe(2_000);
  });

  it("keeps the paid part in the credit book (saved customers only); refuses 'none' on a paid bill", () => {
    expect(settleCreditNote({ total: 10_000, paid: 10_000, credited: 0 }, 3_000, "credit_book", { hasCustomer: true })).toEqual({ refund: 0, toCreditBook: 3_000, reducesBalance: 0 });
    expect(() => settleCreditNote({ total: 10_000, paid: 10_000, credited: 0 }, 3_000, "credit_book", { hasCustomer: false })).toThrow(CreditNoteError);
    expect(() => settleCreditNote({ total: 10_000, paid: 10_000, credited: 0 }, 3_000, "none", { hasCustomer: true })).toThrow(/already paid/);
  });
});

describe("credited bills", () => {
  it("balance and status count credit notes like money", () => {
    expect(balanceOf({ status: "issued", total: 10_000, paid: 2_000, credited: 3_000 })).toBe(5_000);
    expect(deriveStatus("issued", 10_000, 0, 10_000)).toBe("paid");
    expect(deriveStatus("paid", 10_000, 7_000, 0)).toBe("partially_paid");
    expect(deriveStatus("issued", 10_000, 0, 1)).toBe("partially_paid");
    expect(paymentProblem({ status: "partially_paid", total: 10_000, paid: 0, credited: 6_000 }, 5_000)).toMatch(/exceeds the balance of 4000/);
  });

  it("the ledger shows credit notes as credits and refunds as debits", () => {
    const events = ledgerEvents({
      invoices: [{ id: "i1", number: "INV/26-27/0001", date: "2026-10-01", total: 10_000, status: "paid", at: 1 }],
      payments: [
        { id: "p1", invoiceNumber: "INV/26-27/0001", date: "2026-10-01", amount: 10_000, method: "cash", reference: null, at: 2 },
        { id: "p2", invoiceNumber: "INV/26-27/0001", date: "2026-10-02", amount: -3_000, method: "cash", reference: "Refund CN/26-27/0001", at: 4 },
      ],
      receipts: [],
      creditNotes: [{ id: "c1", number: "CN/26-27/0001", invoiceNumber: "INV/26-27/0001", date: "2026-10-02", total: 3_000, at: 3 }],
    });
    expect(events.map((e) => [e.type, e.debit, e.credit])).toEqual([
      ["invoice", 10_000, 0],
      ["payment", 0, 10_000],
      ["credit_note", 0, 3_000],
      ["refund", 3_000, 0],
    ]);
    expect(buildLedger(0, events, { openingDate: "2026-10-01" }).closingBalance).toBe(0);
  });
});

describe("credit note rules", () => {
  it("numbers: CN, or CN + the bill's own prefix", () => {
    expect(creditNotePrefix("INV")).toBe("CN");
    expect(creditNotePrefix(null)).toBe("CN");
    expect(creditNotePrefix("MDU")).toBe("CNMDU");
    expect(creditNotePrefix("ABCDEF")).toBe("CNABCD");
  });

  it("cancel: same IST day, not refunded, not already cancelled", () => {
    expect(cancelProblem({ status: "issued", issuedOn: "2026-10-17", refundAmount: 0 }, "2026-10-17")).toBeNull();
    expect(cancelProblem({ status: "issued", issuedOn: "2026-10-16", refundAmount: 0 }, "2026-10-17")).toMatch(/day it was issued/);
    expect(cancelProblem({ status: "issued", issuedOn: "2026-10-17", refundAmount: 100 }, "2026-10-17")).toMatch(/refunded/);
    expect(cancelProblem({ status: "cancelled", issuedOn: "2026-10-17", refundAmount: 0 }, "2026-10-17")).toMatch(/already/);
  });
});

// ------------------------------------------------------------------ GSTR-1: CDNR / CDNUR and netting

function inv(id: string, opts: { gstin?: string | null; pos: string; lines: LineInput[] }): GstInvoice {
  const t = computeInvoice(opts.lines, { sellerState: "33", placeOfSupply: opts.pos });
  return { id, number: `INV/26-27/${id}`, customerName: "Buyer", customerGstin: opts.gstin ?? null, placeOfSupply: opts.pos, interState: opts.pos !== "33", total: t.total, lines: t.lines };
}

function noteOf(bill: GstInvoice, id: string, requests: { line: number; qty: number }[]): GstCreditNote {
  const c = computeCreditNote({
    invoiceLines: bill.lines as never,
    invoiceTotal: bill.total,
    interState: bill.interState,
    priorCreditedTotal: 0,
    prior: [],
    requests,
    allowValue: false,
    restockByDefault: true,
  });
  return {
    id,
    number: `CN/26-27/${id}`,
    date: "2026-10-20",
    invoiceNumber: bill.number!,
    invoiceDate: "2026-10-05",
    customerName: bill.customerName,
    customerGstin: bill.customerGstin,
    placeOfSupply: bill.placeOfSupply,
    interState: bill.interState,
    invoiceTotal: bill.total,
    total: c.total,
    lines: c.lines,
  };
}

describe("gstSummary with credit notes", () => {
  const saree = (qty: number, rate = 100_000): LineInput => ({ description: "Saree", hsn: "5007", qty, unit: "pcs", rate, gstRate: 5 });
  const b2b = inv("0001", { gstin: KA_GSTIN, pos: "29", lines: [saree(4)] });
  const small = inv("0002", { pos: "33", lines: [saree(3)] });
  const big = inv("0003", { pos: "29", lines: [saree(2, 6_000_000)] }); // ₹1.26 lakh inter-state, unregistered → B2CL

  it("puts notes in CDNR (registered), CDNUR (B2CL bills) or nets them into B2CS", () => {
    expect(creditNoteSection({ customerGstin: KA_GSTIN, interState: true, invoiceTotal: 1 })).toBe("cdnr");
    expect(creditNoteSection({ customerGstin: null, interState: true, invoiceTotal: big.total })).toBe("cdnur");
    expect(creditNoteSection({ customerGstin: null, interState: false, invoiceTotal: 1_000_000_00 })).toBe("b2cs");
  });

  it("CDNR rows per note and rate; B2CS, HSN, rate breakup, 3B and totals are net", () => {
    const n1 = noteOf(b2b, "0001", [{ line: 0, qty: 1 }]);
    const n2 = noteOf(small, "0002", [{ line: 0, qty: 1 }]);
    const n3 = noteOf(big, "0003", [{ line: 0, qty: 1 }]);
    const s = gstSummary([b2b, small, big], [n1, n2, n3]);
    expect(s.cdnr).toEqual([
      {
        gstin: KA_GSTIN,
        name: "Buyer",
        noteNumber: "CN/26-27/0001",
        noteDate: "2026-10-20",
        invoiceNumber: "INV/26-27/0001",
        invoiceDate: "2026-10-05",
        noteType: "C",
        placeOfSupply: "29",
        rate: 5,
        taxable: 100_000,
        cgst: 0,
        sgst: 0,
        igst: 5_000,
        noteValue: n1.total,
      },
    ]);
    expect(s.cdnur).toEqual([
      {
        noteNumber: "CN/26-27/0003",
        noteDate: "2026-10-20",
        invoiceNumber: "INV/26-27/0003",
        invoiceDate: "2026-10-05",
        noteType: "C",
        type: "B2CL",
        placeOfSupply: "29",
        rate: 5,
        taxable: 6_000_000,
        igst: 300_000,
        noteValue: n3.total,
      },
    ]);
    // B2B / B2CL keep the invoices as billed; B2CS is net of the small note.
    expect(s.b2b[0]!.taxable).toBe(400_000);
    expect(s.b2cs).toEqual([{ placeOfSupply: "33", rate: 5, taxable: 200_000, cgst: 5_000, sgst: 5_000, igst: 0 }]);
    const h = s.hsn.find((r) => r.hsn === "5007")!;
    expect(h.qty).toBe(9 - 3);
    expect(h.taxable).toBe(400_000 + 300_000 + 12_000_000 - 100_000 - 100_000 - 6_000_000);
    expect(s.gstr3b.outwardTaxable).toBe(h.taxable);
    expect(s.totals.taxable).toBe(h.taxable);
    expect(s.totals).toMatchObject({ invoices: 3, creditNotes: 3 });
    expect(s.totals.total).toBe(b2b.total + small.total + big.total - n1.total - n2.total - n3.total);
    expect(s.creditNoteTotals).toMatchObject({ count: 3, taxable: 6_200_000, total: n1.total + n2.total + n3.total });
    expect(s.byRate).toEqual([{ gstRate: 5, taxable: h.taxable, cgst: h.cgst, sgst: h.sgst, igst: h.igst }]);
  });
});
