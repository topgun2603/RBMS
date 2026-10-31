import { gstinCheckChar } from "@rbms/gst";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type GstConfig } from "./config";
import { advanceTax, buildAdvances, buildNil } from "./gstr1x";
import { buildGstr3b, classifyLine, gstr3bJson, setOff, type Gstr3bInput } from "./gstr3b";
import { decideItc, expenseDoc, purchaseDoc, returnDoc, rule37Candidates, type DocFlagSrc } from "./itc";
import type { PurchaseReturnSrc, PurchaseSrc, SalesDocSrc, SalesLineSrc } from "./ports";
import { addValue, monthRange, roundHalfUp, rupees, rupeesText, totalTax, zeroValue } from "./util";

// Hand-checkable figures in paise; each comment shows the sum.

const mk = (first14: string) => first14 + gstinCheckChar(first14);
const SELLER = mk("33AAAAA0000A1Z");
const SUPPLIER = mk("33BBBBB1111B1Z");
const BUYER29 = mk("29DDDDD3333D1Z");
const cfg = (over: Partial<GstConfig> = {}): GstConfig => ({ ...DEFAULT_CONFIG, ...over });

/** A sales line with tax at `rate` (intra-state CGST = SGST, or IGST). */
const ln = (taxable: number, rate: number, inter = false, hsn = "1905"): SalesLineSrc => {
  const tax = Math.round((taxable * rate) / 100);
  return { description: "Item", hsn, unit: "pcs", qty: 1, gstRate: rate, taxable, cgst: inter ? 0 : tax / 2, sgst: inter ? 0 : tax / 2, igst: inter ? tax : 0 };
};
function doc(id: string, date: string, lines: SalesLineSrc[], over: Partial<SalesDocSrc> = {}): SalesDocSrc {
  const inter = over.interState ?? false;
  const s = (k: "taxable" | "cgst" | "sgst" | "igst") => lines.reduce((a, l) => a + l[k], 0);
  return {
    id,
    number: `INV/${id}`,
    status: "issued",
    date,
    docType: "INV",
    seller: { gstin: SELLER, stateCode: "33" },
    buyer: { name: "Buyer", gstin: null, stateCode: inter ? "29" : "33" },
    placeOfSupply: inter ? "29" : "33",
    interState: inter,
    lines,
    totals: { taxable: s("taxable"), cgst: s("cgst"), sgst: s("sgst"), igst: s("igst"), roundOff: 0, total: s("taxable") + s("cgst") + s("sgst") + s("igst") },
    ...over,
  };
}
const purchase = (id: string, over: Partial<PurchaseSrc> = {}): PurchaseSrc => ({
  id,
  billNumber: `B-${id}`,
  date: "2026-10-05",
  status: "recorded",
  imported: false,
  supplierId: "s1",
  supplierName: "Supplier",
  supplierGstin: SUPPLIER,
  supplierState: "33",
  placeOfSupply: "33",
  interState: false,
  lines: [{ description: "Goods", hsn: "1905", qty: 1, gstRate: 18, taxable: 100_000, cgst: 9_000, sgst: 9_000, igst: 0 }],
  taxable: 100_000,
  cgst: 9_000,
  sgst: 9_000,
  igst: 0,
  total: 118_000,
  amountPaid: 0,
  dueDate: null,
  ...over,
});
const flag = (over: Partial<DocFlagSrc>): DocFlagSrc => ({
  docType: "purchase",
  docId: "p1",
  itcStatus: null,
  itcClass: null,
  reversalReason: null,
  reason: null,
  claimMonth: null,
  reversalMonth: null,
  rcm: false,
  rcmCategory: null,
  rcmRate: null,
  rcmTaxable: null,
  rcmImport: false,
  rcmPaidOn: null,
  rcmPaidAmount: null,
  rcmChallan: null,
  note: null,
  ...over,
});
const ctx = { compositionOn: () => false, shopState: "33" };
const base: Gstr3bInput = { month: "2026-10", gstin: SELLER, shopState: "33", config: cfg(), sales: [], decisions: [], purchases: [], returns: [], adjustments: [] };

describe("GSTR-3B outward supplies", () => {
  it("puts exports and SEZ supplies in 3.1(b) with their IGST counted as output tax", () => {
    const r = buildGstr3b({
      ...base,
      sales: [
        // Export with IGST paid: ₹1,000 @ 18% = ₹180.
        doc("e1", "2026-10-02", [ln(100_000, 18, true)], { interState: true, placeOfSupply: "96", supplyType: "export_wpay" }),
        // SEZ under LUT: ₹500 at 0%.
        doc("s1", "2026-10-03", [ln(50_000, 0, true)], { interState: true, supplyType: "sez_wopay" }),
      ],
    });
    expect(r.cells["3.1b"]).toMatchObject({ taxable: 150_000, igst: 18_000 });
    expect(r.cells["3.1a"].taxable).toBe(0);
    expect(r.cells["3.1c"].taxable).toBe(0);
    expect(r.outputTax.igst).toBe(18_000);
    // Exports are never 3.2 (supplies to unregistered persons in other States).
    expect(r.unregByPos).toEqual([]);
  });

  it("splits 0% lines into nil / exempt (3.1c) and non-GST (3.1e) by HSN rule, value only", () => {
    const config = cfg({ zeroRateRules: [{ hsnPrefix: "2710", class: "nongst" }, { hsnPrefix: "0401", class: "exempt" }] });
    const r = buildGstr3b({ ...base, config, sales: [doc("a", "2026-10-02", [ln(10_000, 0, false, "27101990"), ln(20_000, 0, false, "0401"), ln(30_000, 0)])] });
    expect(r.cells["3.1e"]).toMatchObject({ taxable: 10_000, cgst: 0, sgst: 0, igst: 0 });
    expect(r.cells["3.1c"]).toMatchObject({ taxable: 50_000, cgst: 0, sgst: 0 });
    expect(classifyLine({ placeOfSupply: "33" }, { gstRate: 0, hsn: "27101990" }, config)).toBe("nongst");
    expect(classifyLine({ placeOfSupply: "33" }, { gstRate: 0, hsn: "0401" }, config)).toBe("exempt");
    expect(classifyLine({ placeOfSupply: "33" }, { gstRate: 0, hsn: "1006" }, config)).toBe("nil");
    expect(classifyLine({ placeOfSupply: "96" }, { gstRate: 18, hsn: "1006" }, config)).toBe("zero");
  });

  it("3.2 holds only inter-State supplies to unregistered buyers, net of their credit notes", () => {
    const r = buildGstr3b({
      ...base,
      sales: [
        // Unregistered, Karnataka: ₹2,000 @ 12% = ₹240 IGST.
        doc("u1", "2026-10-02", [ln(200_000, 12, true)], { interState: true }),
        // Registered Karnataka buyer: B2B, not 3.2.
        doc("r1", "2026-10-03", [ln(100_000, 18, true)], { interState: true, buyer: { name: "B", gstin: BUYER29, stateCode: "29" } }),
        // Credit note to the unregistered buyer: ₹500 @ 12% = ₹60 back.
        doc("c1", "2026-10-09", [ln(50_000, 12, true)], { interState: true, docType: "CRN" }),
      ],
    });
    expect(r.unregByPos).toEqual([{ pos: "29", taxable: 150_000, igst: 18_000 }]);
    // 3.1(a) has everything taxable: 2000 + 1000 − 500 = ₹2,500; IGST 240 + 180 − 60 = ₹360.
    expect(r.cells["3.1a"]).toMatchObject({ taxable: 250_000, igst: 36_000 });
    expect(gstr3bJson(r).inter_sup.unreg_details).toEqual([{ pos: "29", txval: 1_500, iamt: 180 }]);
  });

  it("leaves out drafts, cancelled bills, bills outside the month and unknown document types", () => {
    const r = buildGstr3b({
      ...base,
      sales: [
        doc("ok", "2026-10-31", [ln(10_000, 18)]),
        doc("dr", "2026-10-10", [ln(99_999, 18)], { status: "draft" }),
        doc("nn", "2026-10-10", [ln(99_999, 18)], { number: null }),
        doc("cx", "2026-10-10", [ln(99_999, 18)], { status: "cancelled" }),
        doc("nov", "2026-11-01", [ln(99_999, 18)]),
        doc("sep", "2026-09-30", [ln(99_999, 18)]),
        doc("odd", "2026-10-10", [ln(99_999, 18)], { docType: "XYZ" as never }),
      ],
    });
    expect(r.cells["3.1a"]).toMatchObject({ taxable: 10_000, cgst: 900, sgst: 900 });
    expect(r.counts.invoices).toBe(1);
  });

  it("counts a composition shop's bills from the scheme date as nothing", () => {
    const config = cfg({ composition: true, compositionFrom: "2026-10-16" });
    const r = buildGstr3b({ ...base, config, sales: [doc("a", "2026-10-15", [ln(10_000, 18)]), doc("b", "2026-10-16", [ln(20_000, 18)])] });
    // Opting in mid-month: the return still applies for the regular half.
    expect(r.applicable).toBe(true);
    expect(r.cells["3.1a"].taxable).toBe(10_000);
  });
});

describe("GSTR-3B inward supplies and cash payable", () => {
  it("reverses the credit of a supplier debit note in 4(B)(2) only when the bill's credit was claimed", () => {
    const ret = (id: string): PurchaseReturnSrc => ({
      id,
      number: `DN-${id}`,
      date: "2026-10-20",
      status: "issued",
      imported: false,
      purchaseId: "p1",
      billNumber: "B-p1",
      supplierId: "s1",
      supplierName: "Supplier",
      supplierGstin: SUPPLIER,
      // ₹200 of goods back: ₹18 + ₹18 of credit to give up.
      taxable: 20_000,
      cgst: 1_800,
      sgst: 1_800,
      igst: 0,
      total: 23_600,
    });
    const r = buildGstr3b({ ...base, returns: [{ doc: returnDoc(ret("d1")), claimed: true }, { doc: returnDoc(ret("d2")), claimed: false }] });
    expect(r.cells["4B2"]).toMatchObject({ taxable: 20_000, cgst: 1_800, sgst: 1_800 });
    expect(r.contributions.filter((c) => c.cell === "4B2").map((c) => c.number)).toEqual(["DN-d1"]);
    expect(r.itcNet).toEqual({ igst: 0, cgst: -1_800, sgst: -1_800, cess: 0 });
  });

  it("cash payable = output tax left after credit + reverse charge + interest + late fee", () => {
    const r = buildGstr3b({
      ...base,
      // Output: ₹10,000 @ 18% = ₹900 + ₹900.
      sales: [doc("a", "2026-10-02", [ln(1_000_000, 18)])],
      decisions: [
        // Credit: ₹1,000 @ 18% = ₹90 + ₹90.
        decideItc(purchaseDoc(purchase("p1"), null), ctx),
        // Reverse charge on ₹1,000 of transport @ 5% = ₹25 + ₹25, paid in October.
        decideItc(
          expenseDoc({ id: "e1", date: "2026-10-12", status: "recorded", categoryName: "Transport", amount: 100_000, gstRate: 0, gstAmount: 0, vendorName: "Lorry", vendorGstin: null, reference: null }, "33", flag({ docType: "expense", docId: "e1", rcm: true, rcmRate: 5, rcmPaidOn: "2026-10-20", rcmPaidAmount: 5_000 })),
          ctx,
        ),
      ],
      adjustments: [
        { id: "i", month: "2026-10", kind: "interest", taxable: 0, igst: 0, cgst: 300, sgst: 300, cess: 0, note: null },
        { id: "l", month: "2026-10", kind: "late_fee", taxable: 0, igst: 0, cgst: 2_500, sgst: 2_500, cess: 0, note: null },
        { id: "z", month: "2026-10", kind: "not_a_kind", taxable: 0, igst: 99_999, cgst: 0, sgst: 0, cess: 0, note: null },
        { id: "y", month: "2026-09", kind: "interest", taxable: 0, igst: 99_999, cgst: 0, sgst: 0, cess: 0, note: null },
      ],
    });
    // Credit = 9000 + 2500 (RCM paid) per head = 11,500; output 90,000 per head → cash 78,500 per head.
    expect(r.itcNet).toMatchObject({ cgst: 11_500, sgst: 11_500 });
    expect(r.setOff.cash).toEqual({ igst: 0, cgst: 78_500, sgst: 78_500, cess: 0 });
    expect(r.rcmTax).toMatchObject({ cgst: 2_500, sgst: 2_500 });
    // 157,000 + RCM 5,000 + interest 600 + late fee 5,000.
    expect(r.cashPayable).toBe(157_000 + 5_000 + 600 + 5_000);
    expect(r.counts.adjustments).toBe(2);
  });

  it("splits reverse-charge tax by the supplier's state: IGST from another State, odd paisa to CGST", () => {
    // ₹1,001 @ 5% = 50.05 → ₹50.05 rounds to 5005 paise… intra: CGST 2503, SGST 2502.
    const intra = decideItc(
      expenseDoc({ id: "e1", date: "2026-10-12", status: "recorded", categoryName: "Legal", amount: 100_100, gstRate: 0, gstAmount: 0, vendorName: "Advocate", vendorGstin: null, reference: null }, "33", flag({ docType: "expense", docId: "e1", rcm: true, rcmRate: 5 })),
      ctx,
    );
    expect(intra.rcm?.tax).toEqual({ igst: 0, cgst: 2_503, sgst: 2_502, cess: 0 });
    const inter = decideItc(purchaseDoc(purchase("p9", { supplierState: "29", supplierGstin: mk("29BBBBB1111B1Z"), interState: true }), flag({ docId: "p9", rcm: true, rcmRate: 5 })), ctx);
    // ₹1,000 @ 5% = ₹50 IGST.
    expect(inter.rcm?.tax).toEqual({ igst: 5_000, cgst: 0, sgst: 0, cess: 0 });
    // Unpaid reverse charge: liability in the month, no credit yet.
    expect(inter.claimMonth).toBeNull();
    const r = buildGstr3b({ ...base, decisions: [inter] });
    expect(r.cells["3.1d"].igst).toBe(5_000);
    expect(r.cells["4A3"].igst).toBe(0);
  });

  // BUG: expected claimMonth null (credit only once the reverse-charge tax is fully paid), got "2026-10": a partial
  // payment (₹10 of ₹50) still takes the whole ₹50 credit in 4(A)(3). See itc.ts decideItc (claim = rcm.paidOn ? …).
  it.fails("takes reverse-charge credit only once the tax is fully paid", () => {
    const d = decideItc(purchaseDoc(purchase("p9"), flag({ docId: "p9", rcm: true, rcmRate: 5, rcmPaidOn: "2026-10-20", rcmPaidAmount: 1_000 })), ctx);
    expect(d.rcm?.paid).toBe(false);
    expect(d.claimMonth).toBeNull();
  });

  it("Rule 37: credit on the unpaid share of a bill past 180 days", () => {
    // ₹1,180 bill, ₹590 paid → half the ₹90 + ₹90 credit (₹45 + ₹45) must be paid back.
    const d = decideItc(purchaseDoc(purchase("p1", { date: "2026-04-01", amountPaid: 59_000 }), null), ctx);
    expect(rule37Candidates([d], "2026-09-28")).toEqual([]); // day 180
    const [c] = rule37Candidates([d], "2026-09-29"); // day 181
    expect(c).toMatchObject({ unpaid: 59_000, days: 181, credit: { igst: 0, cgst: 4_500, sgst: 4_500, cess: 0 } });
  });
});

describe("set-off of output tax (Section 49 / Rule 88A)", () => {
  it("uses cess credit only for cess", () => {
    const so = setOff({ igst: 0, cgst: 0, sgst: 0, cess: 100 }, { igst: 500, cgst: 500, sgst: 500, cess: 40 });
    expect(so.cash).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 60 });
    expect(so.carry).toEqual({ igst: 500, cgst: 500, sgst: 500, cess: 0 });
  });

  it("never lets CGST credit pay SGST (or the other way round)", () => {
    const so = setOff({ igst: 0, cgst: 0, sgst: 100, cess: 0 }, { igst: 0, cgst: 100, sgst: 0, cess: 0 });
    expect(so.cash.sgst).toBe(100);
    expect(so.carry.cgst).toBe(100);
  });

  it("treats negative liabilities and credits as nothing", () => {
    const so = setOff({ igst: -100, cgst: 50, sgst: 50, cess: 0 }, { igst: -20, cgst: 20, sgst: 80, cess: 0 });
    expect(so.cash).toEqual({ igst: 0, cgst: 30, sgst: 0, cess: 0 });
    expect(so.carry).toEqual({ igst: 0, cgst: 0, sgst: 30, cess: 0 });
  });

  it("everything used + cash = liability, and used + carry = credit, head by head", () => {
    const L = { igst: 1_234, cgst: 5_000, sgst: 777, cess: 10 };
    const C = { igst: 3_000, cgst: 100, sgst: 4_000, cess: 3 };
    const so = setOff(L, C);
    for (const h of ["igst", "cgst", "sgst", "cess"] as const) {
      const paidWithCredit = Object.values(so.used[h]).reduce((a, b) => a + b, 0);
      expect(paidWithCredit + so.cash[h]).toBe(L[h]);
      const creditUsed = (["igst", "cgst", "sgst", "cess"] as const).reduce((a, l) => a + so.used[l][h], 0);
      expect(creditUsed + so.carry[h]).toBe(C[h]);
    }
  });

  // BUG: expected cash 0, got SGST ₹100 in cash with ₹100 CGST credit carried forward. Rule 88A lets IGST credit pay
  // CGST and SGST "in any order and in any proportion"; setOff() spends all IGST credit on CGST first, so the SGST
  // liability goes to cash while the CGST credit is left unused.
  it.fails("spends IGST credit so that no cash is paid while usable credit is left", () => {
    const so = setOff({ igst: 0, cgst: 100, sgst: 100, cess: 0 }, { igst: 100, cgst: 100, sgst: 0, cess: 0 });
    expect(totalTax(so.cash)).toBe(0);
  });
});

describe("GSTR-1 Table 8 and advances", () => {
  it("Table 8 nets credit notes and splits by inter / intra and registered / unregistered", () => {
    const sales = [
      doc("a", "2026-10-02", [ln(50_000, 0)]),
      doc("b", "2026-10-03", [ln(30_000, 0, true)], { interState: true, buyer: { name: "B", gstin: BUYER29, stateCode: "29" } }),
      doc("c", "2026-10-04", [ln(10_000, 0)], { docType: "CRN" }),
    ];
    const { inv, paise } = buildNil(sales, cfg(), monthRange("2026-10"));
    expect(paise.INTRAB2C).toEqual({ nil: 40_000, exempt: 0, nongst: 0 });
    expect(paise.INTRB2B).toEqual({ nil: 30_000, exempt: 0, nongst: 0 });
    expect(inv.find((r) => r.sply_ty === "INTRAB2C")).toMatchObject({ nil_amt: 400 });
  });

  it("advance tax is inside the gross amount: ₹1,180 at 18% holds ₹180", () => {
    expect(advanceTax(118_000, 18)).toBe(18_000);
    // ₹1,050 at 5% holds ₹50; ₹100 at 12% holds 10.714… → 1071 paise.
    expect(advanceTax(105_000, 5)).toBe(5_000);
    expect(advanceTax(10_000, 12)).toBe(1_071);
    expect(advanceTax(10_000, 0)).toBe(0);
  });

  it("advances by place of supply: IGST for another State, CGST takes the odd paisa inside the State", () => {
    const rows = [
      { month: "2026-10", kind: "received" as const, pos: "29", rate: 18, amount: 118_000, cess: 0 },
      { month: "2026-10", kind: "received" as const, pos: "33", rate: 12, amount: 10_000, cess: 0 },
      { month: "2026-10", kind: "adjusted" as const, pos: "33", rate: 12, amount: 99_999, cess: 0 },
    ];
    expect(buildAdvances(rows, "received", "33")).toEqual([
      { pos: "29", sply_ty: "INTER", itms: [{ rt: 18, ad_amt: 1_180, iamt: 180, csamt: 0 }] },
      // 1071 paise → CGST 536, SGST 535.
      { pos: "33", sply_ty: "INTRA", itms: [{ rt: 12, ad_amt: 100, camt: 5.36, samt: 5.35, csamt: 0 }] },
    ]);
  });
});

describe("money helpers", () => {
  it("paise ↔ rupees and half-away-from-zero rounding", () => {
    expect(rupees(123_456)).toBe(1_234.56);
    expect(rupees(-5)).toBe(-0.05);
    expect(rupeesText(5)).toBe("0.05");
    expect(rupeesText(100_000)).toBe("1000.00");
    expect([roundHalfUp(2.5), roundHalfUp(-2.5), roundHalfUp(2.49)]).toEqual([3, -3, 2]);
  });

  it("adds tax values with a sign", () => {
    const v = addValue(zeroValue(), { taxable: 100, cgst: 9, sgst: 9 });
    addValue(v, { taxable: 30, cgst: 3 }, -1);
    expect(v).toEqual({ taxable: 70, igst: 0, cgst: 6, sgst: 9, cess: 0 });
    expect(totalTax(v)).toBe(15);
  });

  it("month ranges know leap years", () => {
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2027-02").to).toBe("2027-02-28");
    expect(monthRange("2026-12").to).toBe("2026-12-31");
  });
});
