import { describe, expect, it } from "vitest";
import { computeCreditNote, CreditNoteError, creditState, type CreditNoteCalcInput, type CreditNoteLineTotals } from "./credit-note";
import { computeInvoice, type LineInput } from "./gst";

const TN = "33";
const KA = "29";

/** An issued invoice's computed lines and total. */
function bill(lines: LineInput[], placeOfSupply = TN) {
  const t = computeInvoice(lines, { sellerState: TN, placeOfSupply });
  return { lines: t.lines, total: t.total, interState: placeOfSupply !== TN };
}

const silk = (qty: number, extra: Partial<LineInput> = {}): LineInput => ({ description: "Silk saree", hsn: "5007", qty, unit: "pcs", rate: 123_456, gstRate: 5, itemId: "i-silk", ...extra });
const cotton = (qty: number): LineInput => ({ description: "Cotton saree", hsn: "5208", qty, unit: "pcs", rate: 59_900, gstRate: 12, itemId: "i-cotton" });

function note(b: ReturnType<typeof bill>, requests: CreditNoteCalcInput["requests"], prior: CreditNoteLineTotals[][] = [], extra: Partial<CreditNoteCalcInput> = {}) {
  const priorLines = prior.flat();
  return computeCreditNote({
    invoiceLines: b.lines,
    invoiceTotal: b.total,
    interState: b.interState,
    priorCreditedTotal: 0,
    prior: priorLines,
    requests,
    allowValue: true,
    restockByDefault: true,
    ...extra,
  });
}

describe("computeCreditNote: quantity returns", () => {
  it("intra-state: CGST and SGST shares of the original line, total rounded to the rupee", () => {
    const b = bill([silk(3)]);
    const l0 = b.lines[0]!;
    const cn = note(b, [{ line: 0, qty: 1 }]);
    const l = cn.lines[0]!;
    expect(l.taxable).toBe(Math.round(l0.taxable / 3));
    expect(l.cgst).toBe(Math.round(l0.cgst / 3));
    expect(l.sgst).toBe(Math.round(l0.sgst / 3));
    expect(l.igst).toBe(0);
    expect(l.kind).toBe("qty");
    expect(l.restock).toBe(true);
    expect(l.amount).toBe(l.taxable);
    const exact = l.taxable + l.cgst + l.sgst;
    expect(cn.total).toBe(Math.round(exact / 100) * 100);
    expect(cn.totals.roundOff).toBe(cn.total - exact);
    expect(cn.totals.taxBreakup).toEqual([{ gstRate: 5, taxable: l.taxable, cgst: l.cgst, sgst: l.sgst, igst: 0 }]);
    expect(cn.completesInvoice).toBe(false);
  });

  it("inter-state: IGST only, with the original split", () => {
    const b = bill([silk(4)], KA);
    const cn = note(b, [{ line: 0, qty: 1 }]);
    const l = cn.lines[0]!;
    expect(l.cgst + l.sgst).toBe(0);
    expect(l.igst).toBe(Math.round(b.lines[0]!.igst / 4));
  });

  it("partial quantities (3 decimals) take the share of the remaining value", () => {
    const b = bill([{ description: "Silk cloth", qty: 2.5, unit: "m", rate: 45_033, gstRate: 12 }]);
    const l0 = b.lines[0]!;
    const cn = note(b, [{ line: 0, qty: 0.75 }]);
    expect(cn.lines[0]!.qty).toBe(0.75);
    expect(cn.lines[0]!.taxable).toBe(Math.round((l0.taxable * 750) / 2500));
    expect(() => note(b, [{ line: 0, qty: 0.0005 }])).toThrow(CreditNoteError);
  });

  it("line discounts are credited in proportion (the share is of the discounted taxable value)", () => {
    const b = bill([silk(3, { discount: 10_001 })]);
    const l0 = b.lines[0]!;
    expect(l0.taxable).toBe(l0.amount - 10_001);
    const cn = note(b, [{ line: 0, qty: 2 }]);
    expect(cn.lines[0]!.taxable).toBe(Math.round((l0.taxable * 2) / 3));
  });

  it("successive partial returns add up to the original line exactly (rounding leftovers go to the last)", () => {
    const b = bill([silk(3, { discount: 1 }), cotton(7)]);
    const first = note(b, [{ line: 0, qty: 1 }, { line: 1, qty: 3 }]);
    const second = note(b, [{ line: 0, qty: 1 }, { line: 1, qty: 3 }], [first.lines], { priorCreditedTotal: first.total });
    const third = note(b, [{ line: 0, qty: 1 }, { line: 1, qty: 1 }], [first.lines, second.lines], { priorCreditedTotal: first.total + second.total });
    for (const i of [0, 1]) {
      const all = [first, second, third].flatMap((n) => n.lines.filter((l) => l.line === i));
      for (const k of ["taxable", "cgst", "sgst", "igst"] as const) expect(all.reduce((s, l) => s + l[k], 0)).toBe(b.lines[i]![k]);
    }
    expect(third.completesInvoice).toBe(true);
    // The note that clears the bill gets "invoice total − earlier notes": the bill nets to zero.
    expect(first.total + second.total + third.total).toBe(b.total);
  });

  it("a full return in one note equals the invoice total", () => {
    const b = bill([silk(2), cotton(1)]);
    const cn = note(b, [{ line: 0, qty: 2 }, { line: 1, qty: 1 }]);
    expect(cn.total).toBe(b.total);
    expect(cn.totals.taxable).toBe(b.lines.reduce((s, l) => s + l.taxable, 0));
  });

  it("refuses more than the returnable quantity, unknown lines and both qty and amount", () => {
    const b = bill([silk(2)]);
    const first = note(b, [{ line: 0, qty: 1 }]);
    expect(() => note(b, [{ line: 0, qty: 2 }], [first.lines])).toThrow(/only 1 pcs can be returned/);
    // Two requests for the same line inside one note count together.
    expect(() => note(b, [{ line: 0, qty: 1 }, { line: 0, qty: 1 }], [first.lines])).toThrow(CreditNoteError);
    expect(() => note(b, [{ line: 3, qty: 1 }])).toThrow(/not on this bill/);
    expect(() => note(b, [{ line: 0, qty: 1, taxable: 100 }])).toThrow(/either a quantity or an amount/);
    expect(() => note(b, [])).toThrow(CreditNoteError);
  });

  it("restock: default from the caller, a line can opt out, lines without an item never restock", () => {
    const b = bill([silk(2), { description: "Stitching", hsn: "998821", qty: 1, rate: 20_000, gstRate: 18 }]);
    const cn = note(b, [{ line: 0, qty: 1, restock: false }, { line: 1, qty: 1 }]);
    expect(cn.lines.map((l) => l.restock)).toEqual([false, false]);
    expect(note(b, [{ line: 0, qty: 1 }], [], { restockByDefault: false }).lines[0]!.restock).toBe(false);
  });
});

describe("computeCreditNote: value corrections", () => {
  it("credits a GST-exclusive amount with GST at the line's rate and split", () => {
    const b = bill([cotton(2)]);
    const cn = note(b, [{ line: 0, taxable: 10_000 }]);
    expect(cn.lines[0]).toMatchObject({ kind: "value", qty: 0, restock: false, taxable: 10_000, cgst: 600, sgst: 600, igst: 0, total: 11_200 });
    const inter = note(bill([cotton(2)], KA), [{ line: 0, taxable: 10_000 }]);
    expect(inter.lines[0]).toMatchObject({ cgst: 0, sgst: 0, igst: 1_200 });
  });

  it("is limited to what is left of the line, and refused for returns", () => {
    const b = bill([cotton(1)]);
    const l0 = b.lines[0]!;
    expect(() => note(b, [{ line: 0, taxable: l0.taxable + 1 }])).toThrow(/at most/);
    expect(() => note(b, [{ line: 0, taxable: 100 }], [], { allowValue: false })).toThrow(/A return credits quantities/);
    // Crediting the whole remaining value takes the remaining tax exactly.
    const all = note(b, [{ line: 0, taxable: l0.taxable }]);
    expect(all.lines[0]).toMatchObject({ taxable: l0.taxable, cgst: l0.cgst, sgst: l0.sgst });
  });

  it("a later return spreads what is left over the remaining quantity", () => {
    const b = bill([cotton(2)]);
    const l0 = b.lines[0]!;
    const fix = note(b, [{ line: 0, taxable: 10_000 }]);
    const ret = note(b, [{ line: 0, qty: 1 }], [fix.lines], { priorCreditedTotal: fix.total });
    expect(ret.lines[0]!.taxable).toBe(Math.round((l0.taxable - 10_000) / 2));
  });
});

describe("creditState", () => {
  it("reports returned, remaining quantity and value per line", () => {
    const b = bill([silk(3), cotton(1)]);
    const first = note(b, [{ line: 0, qty: 2 }]);
    const s = creditState(b.lines, first.lines);
    expect(s[0]).toMatchObject({ qty: 3, returnedQty: 2, remainingQty: 1 });
    expect(s[0]!.remaining.taxable + first.lines[0]!.taxable).toBe(b.lines[0]!.taxable);
    expect(s[1]).toMatchObject({ returnedQty: 0, remainingQty: 1 });
    // A line whose value was fully credited has nothing left to return.
    const fix = note(b, [{ line: 1, taxable: b.lines[1]!.taxable }]);
    expect(creditState(b.lines, fix.lines)[1]!.remainingQty).toBe(0);
  });
});
