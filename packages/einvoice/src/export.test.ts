import { describe, expect, it } from "vitest";
import { buildGstr1 } from "./gstr1";
import { buildEInvoice, prepareEInvoice, validateEInvoice } from "./nic";
import type { EInvoiceSource } from "./ports";
import { BUYER_TN_GSTIN, invoice, line, SELLER_GSTIN } from "./test-fixtures";

/** An export to a US buyer: no GSTIN, place of supply 96, IGST (with payment) or none (under LUT). */
function exportBill(over: Partial<EInvoiceSource> & { paid?: boolean } = {}): EInvoiceSource {
  const paid = over.paid ?? false;
  const lines = [line("Handloom silk saree", "50072010", 10, "pcs", 832_500, paid ? 5 : 0, true)];
  const b = invoice({ inter: true, lines, ...over });
  return {
    ...b,
    buyer: { name: "Madison Imports LLC", gstin: null, address: "120 Broadway, New York NY 10271", stateCode: "96", phone: null, email: "buy@madison.example" },
    placeOfSupply: "96",
    interState: true,
    supplyType: paid ? "export_wpay" : "export_wopay",
    exportDetails: { shippingBillNo: "7654321", shippingBillDate: "2026-10-16", portCode: "INMAA1", currency: "USD", country: "US" },
  };
}

describe("GSTR-1 with exports and SEZ supplies", () => {
  const lut = exportBill({ id: "e1", number: "INV/26-27/0101", date: "2026-10-15" });
  const wpay = exportBill({ id: "e2", number: "INV/26-27/0102", date: "2026-10-16", paid: true });
  const sezLines = [line("Silk yarn", "5004", 100, "kg", 450_000, 5, true)];
  const sez: EInvoiceSource = { ...invoice({ id: "s1", number: "INV/26-27/0103", date: "2026-10-17", lines: sezLines }), interState: true, supplyType: "sez_wpay" };
  const sezLut: EInvoiceSource = {
    ...invoice({ id: "s2", number: "INV/26-27/0104", date: "2026-10-18", lines: [line("Silk yarn", "5004", 10, "kg", 450_000, 0, true)] }),
    interState: true,
    supplyType: "sez_wopay",
  };
  const note: EInvoiceSource = {
    ...exportBill({ id: "n1", number: "CN/26-27/0001", date: "2026-10-20", docType: "CRN", lines: [line("Handloom silk saree", "50072010", 1, "pcs", 832_500, 0, true)] }),
    precedingDoc: { number: "INV/26-27/0101", date: "2026-10-15", total: 83_25_000 },
  };
  const { json, counts } = buildGstr1([lut, wpay, sez, sezLut, note], { gstin: SELLER_GSTIN, period: "102026" });

  it("keeps exports out of B2B / B2CL / B2CS (they are table 6A)", () => {
    expect(counts.exp).toBe(2);
    expect(json.b2cs).toEqual([]);
    expect(json.b2cl).toEqual([]);
    expect(json.b2b.flatMap((b) => b.inv.map((i) => i.inum))).toEqual(["INV/26-27/0103", "INV/26-27/0104"]);
  });

  it("reports SEZ supplies as B2B SEWP / SEWOP with IGST only, even inside Tamil Nadu", () => {
    const b2b = json.b2b.find((b) => b.ctin === BUYER_TN_GSTIN)!;
    expect(b2b.inv.map((i) => i.inv_typ)).toEqual(["SEWP", "SEWOP"]);
    expect(b2b.inv[0]!.itms[0]!.itm_det).toEqual({ txval: 450000, rt: 5, iamt: 22500, csamt: 0 });
    expect(b2b.inv[0]!.itms[0]!.itm_det.camt).toBeUndefined();
  });

  it("puts a credit note on an export in CDNUR as EXPWOP", () => {
    expect(json.cdnur).toEqual([expect.objectContaining({ typ: "EXPWOP", nt_num: "CN/26-27/0001", pos: "96" })]);
  });

  it("counts export HSN lines in the B2C tab of the HSN summary", () => {
    const hsn = json.hsn as { hsn_b2b: { hsn_sc: string }[]; hsn_b2c: { hsn_sc: string; qty: number }[] };
    expect(hsn.hsn_b2c.find((r) => r.hsn_sc === "50072010")).toBeTruthy();
    expect(hsn.hsn_b2b.map((r) => r.hsn_sc)).toEqual(["5004", "5004"]);
  });
});

describe("e-invoice for an export (NIC ExpDtls)", () => {
  it("builds URP / 96 / 999999 and the export details, and validates", () => {
    const src = exportBill({ date: "2026-10-15" });
    const p = buildEInvoice(src);
    expect(p.TranDtls.SupTyp).toBe("EXPWOP");
    expect(p.BuyerDtls).toMatchObject({ Gstin: "URP", Stcd: "96", Pos: "96", Pin: 999999 });
    expect(p.ExpDtls).toEqual({ RefClm: "N", ShipBNo: "7654321", ShipBDt: "16/10/2026", Port: "INMAA1", ForCur: "USD", CntCode: "US" });
    const r = prepareEInvoice(src, { today: "2026-10-20" });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("claims the IGST refund on an export with payment", () => {
    const p = buildEInvoice(exportBill({ paid: true }));
    expect(p.TranDtls.SupTyp).toBe("EXPWP");
    expect(p.ExpDtls?.RefClm).toBe("Y");
    expect(p.ValDtls.IgstVal).toBeGreaterThan(0);
  });

  it("accepts IGST on an SEZ supply inside the State, refuses CGST / SGST there", () => {
    const sez: EInvoiceSource = { ...invoice({ lines: [line("Silk yarn", "5004", 10, "kg", 450_000, 5, true)] }), interState: true, supplyType: "sez_wpay" };
    const p = buildEInvoice(sez);
    expect(p.TranDtls.SupTyp).toBe("SEZWP");
    expect(validateEInvoice(p, { today: "2026-10-20" }).issues.filter((i) => i.severity === "error")).toEqual([]);
    const wrong = buildEInvoice({ ...invoice(), supplyType: "sez_wpay" });
    expect(validateEInvoice(wrong, { today: "2026-10-20" }).issues.map((i) => i.code)).toContain("cgst_on_inter");
  });
});
