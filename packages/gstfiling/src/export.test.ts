import { gstinCheckChar } from "@rbms/gst";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "./config";
import { buildExp, buildNil } from "./gstr1x";
import { classifyLine } from "./gstr3b";
import type { SalesDocSrc, SalesLineSrc } from "./ports";

const SELLER = "33AAAAA0000A1Z" + gstinCheckChar("33AAAAA0000A1Z");
const SEZ_BUYER = "33EEEEE4444E1Z" + gstinCheckChar("33EEEEE4444E1Z");
const range = { from: "2026-10-01", to: "2026-10-31" };
const line = (taxable: number, rate: number): SalesLineSrc => ({ description: "Saree", hsn: "5007", unit: "pcs", qty: 1, gstRate: rate, taxable, cgst: 0, sgst: 0, igst: Math.round((taxable * rate) / 100) });
const doc = (number: string, lines: SalesLineSrc[], over: Partial<SalesDocSrc> = {}): SalesDocSrc => {
  const taxable = lines.reduce((s, l) => s + l.taxable, 0);
  const igst = lines.reduce((s, l) => s + l.igst, 0);
  return {
    id: number,
    number,
    status: "issued",
    date: "2026-10-12",
    docType: "INV",
    seller: { gstin: SELLER, stateCode: "33" },
    buyer: { name: "Madison Imports LLC", gstin: null, stateCode: "96" },
    placeOfSupply: "96",
    interState: true,
    lines,
    totals: { taxable, cgst: 0, sgst: 0, igst, roundOff: 0, total: taxable + igst },
    ...over,
  };
};

describe("GSTR-1 table 6A from export supply types", () => {
  it("files WOPAY / WPAY from the supply type with the shipping bill and port", () => {
    const lut = doc("EX/1", [line(8_325_000, 0)], { supplyType: "export_wopay", exportDetails: { shippingBillNo: "7654321", shippingBillDate: "2026-10-16", portCode: "INMAA1" } });
    const paid = doc("EX/2", [line(1_000_000, 5)], { supplyType: "export_wpay" });
    const sez = doc("SZ/1", [line(500_000, 5)], { supplyType: "sez_wpay", buyer: { name: "SEZ unit", gstin: SEZ_BUYER, stateCode: "33" }, placeOfSupply: "33" });
    const exp = buildExp([lut, paid, sez], range);
    expect(exp.map((b) => b.exp_typ)).toEqual(["WPAY", "WOPAY"]);
    expect(exp[1]!.inv[0]).toEqual({
      inum: "EX/1",
      idt: "12-10-2026",
      val: 83250,
      sbpcode: "INMAA1",
      sbnum: "7654321",
      sbdt: "16-10-2026",
      itms: [{ txval: 83250, rt: 0, iamt: 0, csamt: 0 }],
    });
    expect(exp[0]!.inv[0]).toMatchObject({ inum: "EX/2", itms: [{ txval: 10000, rt: 5, iamt: 500, csamt: 0 }] });
  });

  it("counts SEZ and export supplies as zero-rated (3.1(b)), never as nil-rated in table 8", () => {
    const sez = doc("SZ/2", [line(500_000, 0)], { supplyType: "sez_wopay", buyer: { name: "SEZ unit", gstin: SEZ_BUYER, stateCode: "33" }, placeOfSupply: "33" });
    expect(classifyLine(sez, sez.lines[0]!, DEFAULT_CONFIG)).toBe("zero");
    expect(buildNil([sez, doc("EX/3", [line(100_000, 0)], { supplyType: "export_wopay" })], DEFAULT_CONFIG, range).inv).toEqual([]);
  });
});
