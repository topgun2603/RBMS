import { describe, expect, it } from "vitest";
import { financialYearLong, fromNicDate, isValidGstin, roundTo, rupees, toGstr1Date, toNicDate, toPaise } from "./gst";
import { B2CL_THRESHOLD_PAISE, gstr1Section, isExportDoc, noteSection, withIgstPaid } from "./gstr1";
import { buildEInvoice, validateEInvoice, type EInvoicePayload } from "./nic";
import { BUYER_KA_GSTIN, gstin, invoice, line, SELLER_GSTIN } from "./test-fixtures";

const TODAY = "2026-10-15";
const errors = (p: EInvoicePayload, opts = {}) =>
  validateEInvoice(p, { today: TODAY, ...opts })
    .issues.filter((i) => i.severity === "error")
    .map((i) => i.code);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("paise ↔ rupees for the NIC JSON", () => {
  it("converts both ways without float drift", () => {
    expect(rupees(123_456)).toBe(1_234.56);
    expect(toPaise(1_234.56)).toBe(123_456);
    // 0.1 + 0.2 = 0.30000000000000004 rupees is still 30 paise.
    expect(toPaise(0.1 + 0.2)).toBe(30);
    // Two-decimal rupee figures that are not exact in binary still land on their paisa.
    expect(toPaise(1_234.57)).toBe(123_457);
    expect(toPaise(40.53 + 40.53)).toBe(8_106);
    expect(toPaise(-0.07)).toBe(-7);
    // Quantities keep 3 decimals.
    expect(roundTo(1.5004, 3)).toBe(1.5);
    expect(roundTo(-2.0006, 3)).toBe(-2.001);
  });

  it("dates and the financial year", () => {
    expect(toNicDate("2026-04-01")).toBe("01/04/2026");
    expect(toGstr1Date("2026-04-01")).toBe("01-04-2026");
    expect(fromNicDate("31/02/2026")).toBeNull();
    expect(fromNicDate("29/02/2028")).toBe("2028-02-29");
    expect(financialYearLong("2026-03-31")).toBe("2025-26");
    expect(financialYearLong("2026-04-01")).toBe("2026-27");
    expect(financialYearLong("2099-04-01")).toBe("2099-00");
    expect(() => toNicDate("15-10-2026")).toThrow(RangeError);
  });

  it("GSTIN check character", () => {
    expect(isValidGstin(SELLER_GSTIN)).toBe(true);
    expect(isValidGstin(SELLER_GSTIN.toLowerCase())).toBe(true);
    const wrong = SELLER_GSTIN.slice(0, 14) + (SELLER_GSTIN.endsWith("A") ? "B" : "A");
    expect(isValidGstin(wrong)).toBe(false);
    expect(isValidGstin(null)).toBe(false);
  });
});

describe("GSTR-1 section by buyer and value", () => {
  const bill = (over: { gstin?: string | null; inter?: boolean; total?: number }) => ({
    buyer: { name: "B", gstin: over.gstin ?? null, stateCode: "29" },
    seller: { name: "S", gstin: SELLER_GSTIN, stateCode: "33" },
    interState: over.inter ?? true,
    totals: { taxable: 0, cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: over.total ?? 0 },
  });

  it("B2B for a registered buyer, whatever the value", () => {
    expect(gstr1Section(bill({ gstin: BUYER_KA_GSTIN, total: 100 }) as never)).toBe("b2b");
  });

  it("B2CL only above ₹1,00,000 inter-State to an unregistered buyer; exactly ₹1,00,000 is B2CS", () => {
    expect(B2CL_THRESHOLD_PAISE).toBe(1_00_000_00);
    expect(gstr1Section(bill({ total: 1_00_000_00 }) as never)).toBe("b2cs");
    expect(gstr1Section(bill({ total: 1_00_000_01 }) as never)).toBe("b2cl");
    expect(gstr1Section(bill({ total: 5_00_000_00, inter: false }) as never)).toBe("b2cs");
  });

  it("a buyer GSTIN equal to the seller's or invalid counts as unregistered", () => {
    expect(gstr1Section(bill({ gstin: SELLER_GSTIN, total: 2_00_000_00 }) as never)).toBe("b2cl");
    expect(gstr1Section(bill({ gstin: "29AAAAA0000A1ZZ", total: 100 }) as never)).toBe("b2cs");
  });

  it("a credit note follows the size of its original bill, not its own", () => {
    const small = { ...bill({ total: 10_000_00 }), precedingDoc: { number: "INV/1", date: "2026-10-01", total: 1_50_000_00 } };
    expect(noteSection(small as never)).toBe("cdnur");
    const unknown = { ...bill({ total: 10_000_00 }), precedingDoc: null };
    expect(noteSection(unknown as never)).toBe("b2cs");
    expect(noteSection({ ...bill({ gstin: BUYER_KA_GSTIN }), precedingDoc: null } as never)).toBe("cdnr");
  });

  it("exports and IGST payment flags", () => {
    expect(isExportDoc({ supplyType: null, placeOfSupply: "96" })).toBe(true);
    expect(isExportDoc({ supplyType: "sez_wpay", placeOfSupply: "96" })).toBe(false);
    expect(isExportDoc({ supplyType: "export_wopay", placeOfSupply: "29" })).toBe(true);
    const t = (igst: number) => ({ taxable: 0, cgst: 0, sgst: 0, igst, roundOff: 0, total: 0 });
    expect(withIgstPaid({ supplyType: "export_wopay", totals: t(100) })).toBe(false);
    expect(withIgstPaid({ supplyType: null, totals: t(100) })).toBe(true);
    expect(withIgstPaid({ supplyType: null, totals: t(0) })).toBe(false);
  });
});

describe("e-invoice payload money checks", () => {
  // 2 sarees @ ₹1,250 less ₹100 discount = ₹2,400 @ 5% → ₹60 + ₹60; 1.5 m @ ₹450.33 = ₹675.50 @ 12% → ₹40.53 + ₹40.53.
  const intra = buildEInvoice(invoice());
  const inter = buildEInvoice(invoice({ inter: true }));

  it("builds totals that are the sum of the lines and validate clean", () => {
    expect(intra.ValDtls).toMatchObject({ AssVal: 3_075.5, CgstVal: 100.53, SgstVal: 100.53, IgstVal: 0, RndOffAmt: 0.44, TotInvVal: 3_277 });
    expect(errors(intra)).toEqual([]);
    // Inter-State: IGST 120 + 81.06 = ₹201.06; total 3276.56 → ₹3,277 (round-off 0.44).
    expect(inter.ValDtls).toMatchObject({ AssVal: 3_075.5, CgstVal: 0, SgstVal: 0, IgstVal: 201.06, TotInvVal: 3_277 });
    expect(errors(inter)).toEqual([]);
  });

  it("marks reverse charge on the payload", () => {
    expect(buildEInvoice(invoice(), { reverseCharge: true }).TranDtls.RegRev).toBe("Y");
    expect(intra.TranDtls.RegRev).toBe("N");
  });

  it("refuses IGST inside the State and CGST/SGST across States", () => {
    const p = clone(intra);
    p.ItemList[0]!.IgstAmt = 120;
    expect(errors(p)).toContain("igst_on_intra");
    const q = clone(inter);
    q.ItemList[0]!.CgstAmt = 60;
    expect(errors(q)).toContain("cgst_on_inter");
  });

  it("catches a line tax off by more than the ₹1 tolerance, and accepts it within", () => {
    const p = clone(intra);
    p.ItemList[0]!.CgstAmt = 61; // ₹60 expected, off by exactly ₹1: accepted
    p.ItemList[0]!.TotItemVal = 2_521;
    p.ValDtls.CgstVal = 101.53;
    p.ValDtls.TotInvVal = 3_278;
    expect(errors(p)).toEqual([]);
    p.ItemList[0]!.CgstAmt = 61.01; // ₹1.01 off
    expect(errors(p)).toContain("cgst_amount");
    expect(errors(clone(p), { toleranceRupees: 0 })).toContain("cgst_amount");
  });

  it("checks TotAmt = Qty × UnitPrice and AssAmt = TotAmt − Discount", () => {
    const p = clone(intra);
    p.ItemList[0]!.TotAmt = 2_600;
    expect(errors(p)).toEqual(expect.arrayContaining(["total_amount", "assessable"]));
    const q = clone(intra);
    q.ItemList[0]!.Discount = 3_000;
    expect(errors(q)).toContain("discount");
  });

  it("checks the invoice totals against the lines", () => {
    const p = clone(intra);
    p.ValDtls.AssVal = 3_000;
    expect(errors(p)).toEqual(expect.arrayContaining(["total_assessable", "invoice_value"]));
    const q = clone(intra);
    q.ValDtls.TotInvVal = 3_300;
    expect(errors(q)).toEqual(expect.arrayContaining(["invoice_value", "invoice_value_items"]));
    const r = clone(intra);
    r.ValDtls.RndOffAmt = 100;
    expect(errors(r)).toContain("round_off");
  });

  it("refuses rates NIC does not know and negative amounts", () => {
    const p = clone(intra);
    p.ItemList[0]!.GstRt = 15;
    expect(errors(p)).toContain("gst_rate");
    const q = clone(intra);
    q.ItemList[0]!.Discount = -1;
    expect(errors(q)).toContain("amount");
  });

  it("a 0% line validates with no tax", () => {
    const zero = buildEInvoice(invoice({ lines: [line("Rice", "1006", 10, "kg", 5_000, 0, false)] }));
    expect(zero.ValDtls).toMatchObject({ AssVal: 500, CgstVal: 0, SgstVal: 0, TotInvVal: 500 });
    expect(errors(zero)).toEqual([]);
  });

  it("a credit note carries the original bill in RefDtls", () => {
    const p = buildEInvoice(invoice({ docType: "CRN", number: "CN/26-27/0001", precedingDoc: { number: "INV/26-27/0042", date: "2026-10-01" } }));
    expect(p.DocDtls.Typ).toBe("CRN");
    expect(p.RefDtls).toEqual({ PrecDocDtls: [{ InvNo: "INV/26-27/0042", InvDt: "01/10/2026" }] });
    expect(errors(p)).toEqual([]);
    const bad = clone(p);
    bad.RefDtls!.PrecDocDtls[0]!.InvDt = "2026-10-01";
    expect(errors(bad)).toContain("ref_doc_date");
  });

  it("buyer must be registered and in the state of its GSTIN", () => {
    const p = clone(intra);
    p.BuyerDtls.Gstin = gstin("29AAFCB9012M1Z");
    expect(errors(p)).toContain("state_gstin_mismatch");
  });
});
