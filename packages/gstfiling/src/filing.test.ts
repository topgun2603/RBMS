import { gstinCheckChar } from "@srirealtime/gst";
import { describe, expect, it } from "vitest";
import { filingCalendar } from "./calendar";
import { buildCmp08, buildGstr4, quartersOfFy } from "./composition";
import { DEFAULT_CONFIG, compositionOn, qrmpOn, zeroClassOf, type GstConfig } from "./config";
import { buildAdvances, buildDocIssue, buildExp, buildNil, validateGstr1, advanceTax } from "./gstr1x";
import { buildGstr3b, gstr3bJson, setOff } from "./gstr3b";
import { decideItc, expenseDoc, lastClaimMonth, purchaseDoc, rcmLiability, rule37Candidates, type DocFlagSrc } from "./itc";
import type { ExpenseSrc, PurchaseSrc, SalesDocSrc, SalesLineSrc } from "./ports";
import { addMonths, fromFp, fyLabel, parsePortalDate, parseQuarter, quarterOfMonth, toFp } from "./util";

const mk = (first14: string) => first14 + gstinCheckChar(first14);
const SELLER = mk("33AAAAA0000A1Z");
const SUPPLIER = mk("33BBBBB1111B1Z");
const VENDOR29 = mk("29CCCCC2222C1Z");
const VENDOR33 = mk("33CCCCC2222C1Z");
const BUYER29 = mk("29DDDDD3333D1Z");
const cfg = (over: Partial<GstConfig> = {}): GstConfig => ({ ...DEFAULT_CONFIG, ...over });
const line = (taxable: number, rate: number, inter = false, hsn = "1905", over: Partial<SalesLineSrc> = {}): SalesLineSrc => {
  const tax = Math.round((taxable * rate) / 100);
  return { description: "Item", hsn, unit: "pcs", qty: 1, gstRate: rate, taxable, cgst: inter ? 0 : Math.ceil(tax / 2), sgst: inter ? 0 : Math.floor(tax / 2), igst: inter ? tax : 0, ...over };
};
function sale(id: string, number: string, date: string, lines: SalesLineSrc[], over: Partial<SalesDocSrc> = {}): SalesDocSrc {
  const inter = over.interState ?? false;
  const taxable = lines.reduce((s, l) => s + l.taxable, 0);
  const cgst = lines.reduce((s, l) => s + l.cgst, 0);
  const sgst = lines.reduce((s, l) => s + l.sgst, 0);
  const igst = lines.reduce((s, l) => s + l.igst, 0);
  return {
    id,
    number,
    status: "issued",
    date,
    docType: "INV",
    seller: { gstin: SELLER, stateCode: "33" },
    buyer: { name: "Buyer", gstin: null, stateCode: inter ? "29" : "33" },
    placeOfSupply: inter ? "29" : "33",
    interState: inter,
    lines,
    totals: { taxable, cgst, sgst, igst, roundOff: 0, total: taxable + cgst + sgst + igst },
    ...over,
  };
}
function purchase(id: string, over: Partial<PurchaseSrc> = {}): PurchaseSrc {
  const taxable = over.taxable ?? 100000;
  const cgst = over.cgst ?? 9000;
  const sgst = over.sgst ?? 9000;
  const igst = over.igst ?? 0;
  return {
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
    interState: igst > 0,
    lines: [{ description: "Goods", hsn: "1905", qty: 1, gstRate: 18, taxable, cgst, sgst, igst }],
    taxable,
    cgst,
    sgst,
    igst,
    total: taxable + cgst + sgst + igst,
    amountPaid: 0,
    dueDate: null,
    ...over,
  };
}
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
const ctx = (config = cfg()) => ({ compositionOn: (d: string) => compositionOn(config, d), shopState: "33" });

describe("periods", () => {
  it("maps months and quarters of the financial year", () => {
    expect(toFp("2026-10")).toBe("102026");
    expect(fromFp("102026")).toBe("2026-10");
    expect(fromFp("132026")).toBeNull();
    expect(quarterOfMonth("2026-10").key).toBe("2026-Q3");
    expect(quarterOfMonth("2026-10").months).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(quarterOfMonth("2027-02").key).toBe("2027-Q4");
    expect(quarterOfMonth("2027-02").from).toBe("2027-01-01");
    expect(quarterOfMonth("2026-04").key).toBe("2026-Q1");
    expect(parseQuarter("2027-Q4")?.months).toEqual(["2027-01", "2027-02", "2027-03"]);
    expect(parseQuarter("2026-Q1")?.from).toBe("2026-04-01");
    expect(parseQuarter("2026-Q5")).toBeNull();
    expect(fyLabel(2026)).toBe("2026-27");
    expect(addMonths("2026-11", 3)).toBe("2027-02");
  });
  it("reads the portal's date formats", () => {
    expect(parsePortalDate("05-10-2026")).toBe("2026-10-05");
    expect(parsePortalDate("5/10/2026")).toBe("2026-10-05");
    expect(parsePortalDate("2026-10-05T00:00:00Z")).toBe("2026-10-05");
    expect(parsePortalDate("garbage")).toBeNull();
  });
});

describe("config rules", () => {
  it("applies composition and QRMP from their dates only", () => {
    const c = cfg({ composition: true, compositionFrom: "2026-10-01", qrmp: true, qrmpFrom: "2026-07-01" });
    expect(compositionOn(c, "2026-09-30")).toBe(false);
    expect(compositionOn(c, "2026-10-01")).toBe(true);
    expect(qrmpOn(c, "2026-06")).toBe(false);
    expect(qrmpOn(c, "2026-07")).toBe(true);
    expect(compositionOn(cfg(), "2026-10-01")).toBe(false);
  });
  it("classifies 0% lines by HSN rule, longest prefix first, else the shop default", () => {
    const c = cfg({ zeroRateClass: "nil", zeroRateRules: [{ hsnPrefix: "04", class: "exempt" }, { hsnPrefix: "0402", class: "nongst" }] });
    expect(zeroClassOf(c, "04011000")).toBe("exempt");
    expect(zeroClassOf(c, "0402")).toBe("nongst");
    expect(zeroClassOf(c, "1905")).toBe("nil");
    expect(zeroClassOf(c, null)).toBe("nil");
  });
});

describe("input tax credit decisions", () => {
  it("allows credit on a bill from a registered supplier with tax, by default, in the bill's month", () => {
    const d = decideItc(purchaseDoc(purchase("p1"), null), ctx());
    expect(d.status).toBe("eligible");
    expect(d.claimMonth).toBe("2026-10");
    expect(d.reason).toBe("ok");
  });
  it("refuses credit without a valid supplier GSTIN or without tax", () => {
    expect(decideItc(purchaseDoc(purchase("p1", { supplierGstin: null }), null), ctx()).reason).toBe("no_gstin");
    expect(decideItc(purchaseDoc(purchase("p1", { supplierGstin: SUPPLIER.slice(0, 14) + (SUPPLIER[14] === "0" ? "1" : "0") }), null), ctx()).reason).toBe("no_gstin");
    expect(decideItc(purchaseDoc(purchase("p1", { cgst: 0, sgst: 0 }), null), ctx()).reason).toBe("no_tax");
  });
  it("blocks all credit for a composition shop", () => {
    const c = cfg({ composition: true, compositionFrom: "2026-10-01" });
    const d = decideItc(purchaseDoc(purchase("p1"), null), ctx(c));
    expect(d.status).toBe("ineligible");
    expect(d.reason).toBe("composition");
    expect(decideItc(purchaseDoc(purchase("p1", { date: "2026-09-10" }), null), ctx(c)).status).toBe("eligible");
  });
  it("follows the owner: blocked 17(5), ineligible, reversal, and a later claim month", () => {
    expect(decideItc(purchaseDoc(purchase("p1"), flag({ itcStatus: "blocked" })), ctx()).status).toBe("blocked");
    expect(decideItc(purchaseDoc(purchase("p1"), flag({ itcStatus: "ineligible" })), ctx()).claimMonth).toBeNull();
    const rev = decideItc(purchaseDoc(purchase("p1"), flag({ itcStatus: "reversal", reversalReason: "rule42", reversalMonth: "2026-11" })), ctx());
    expect(rev.status).toBe("reversal");
    expect(rev.reversalMonth).toBe("2026-11");
    expect(decideItc(purchaseDoc(purchase("p1"), flag({ claimMonth: "2026-12" })), ctx()).claimMonth).toBe("2026-12");
  });
  it("lapses credit claimed after the October return following the year (Section 16(4))", () => {
    expect(lastClaimMonth("2026-10-05")).toBe("2027-10");
    expect(lastClaimMonth("2027-02-05")).toBe("2027-10");
    const late = decideItc(purchaseDoc(purchase("p1"), flag({ claimMonth: "2027-11" })), ctx());
    expect(late.lapsed).toBe(true);
    expect(late.claimMonth).toBeNull();
    expect(late.lapsedMonth).toBe("2027-11");
  });
  it("splits an expense's GST by the vendor's state", () => {
    const e: ExpenseSrc = { id: "e1", date: "2026-10-03", status: "recorded", categoryName: "Repairs", amount: 118000, gstRate: 18, gstAmount: 18000, vendorName: "V", vendorGstin: VENDOR29, reference: "R-1" };
    const doc = expenseDoc(e, "33", null);
    expect(doc.tax.igst).toBe(18000);
    expect(doc.taxable).toBe(100000);
    const intra = expenseDoc({ ...e, vendorGstin: VENDOR33 }, "33", null);
    expect(intra.tax.cgst + intra.tax.sgst).toBe(18000);
  });
  it("computes reverse charge tax, takes credit only from the month it is paid", () => {
    const e: ExpenseSrc = { id: "e2", date: "2026-10-12", status: "recorded", categoryName: "Transport", amount: 5000000, gstRate: 0, gstAmount: 0, vendorName: "Lorry", vendorGstin: null, reference: null };
    const base = flag({ docType: "expense", docId: "e2", rcm: true, rcmCategory: "gta", rcmRate: 5 });
    const unpaid = decideItc(expenseDoc(e, "33", base), ctx());
    expect(unpaid.rcm?.due).toBe(250000);
    expect(unpaid.rcm?.tax.cgst).toBe(125000);
    expect(unpaid.rcm?.tax.sgst).toBe(125000);
    expect(unpaid.claimMonth).toBeNull();
    expect(unpaid.reason).toBe("rcm_unpaid");
    const paid = decideItc(expenseDoc(e, "33", { ...base, rcmPaidOn: "2026-11-18", rcmPaidAmount: 250000 }), ctx());
    expect(paid.claimMonth).toBe("2026-11");
    expect(paid.rcm?.paid).toBe(true);
    const imp = rcmLiability(expenseDoc(e, "33", { ...base, rcmImport: true, rcmRate: 18 }), ctx());
    expect(imp?.tax.igst).toBe(900000);
    expect(imp?.tax.cgst).toBe(0);
  });
  it("finds credit past 180 days unpaid (Rule 37)", () => {
    const d = decideItc(purchaseDoc(purchase("p1", { date: "2026-01-01", amountPaid: 59000 }), null), ctx());
    const found = rule37Candidates([d], "2026-10-01");
    expect(found).toHaveLength(1);
    expect(found[0]!.unpaid).toBe(59000);
    expect(found[0]!.credit.cgst).toBe(4500);
    expect(rule37Candidates([d], "2026-03-01")).toHaveLength(0);
  });
});

describe("GSTR-3B", () => {
  const base = {
    month: "2026-10",
    gstin: SELLER,
    shopState: "33",
    config: cfg(),
    sales: [] as SalesDocSrc[],
    decisions: [] as ReturnType<typeof decideItc>[],
    purchases: [] as { id: string; billNumber: string; date: string; supplierName: string; interState: boolean; lines: { gstRate: number; taxable: number }[] }[],
    returns: [],
    adjustments: [],
  };
  it("sums outward supplies net of credit notes and puts 0% lines in 3.1(c) and unregistered inter-State in 3.2", () => {
    const sales = [
      sale("a", "INV/26-27/0001", "2026-10-02", [line(100000, 18), line(50000, 0)]),
      sale("b", "INV/26-27/0002", "2026-10-03", [line(200000, 12, true)], { interState: true }),
      sale("c", "INV/26-27/0003", "2026-10-04", [line(1000, 18)], { status: "cancelled" }),
      sale("n", "CN/26-27/0001", "2026-10-09", [line(10000, 18)], { docType: "CRN" }),
      sale("x", "INV/26-27/0009", "2026-09-30", [line(999999, 18)]),
    ];
    const r = buildGstr3b({ ...base, sales });
    expect(r.cells["3.1a"].taxable).toBe(100000 + 200000 - 10000);
    expect(r.cells["3.1a"].igst).toBe(24000);
    expect(r.cells["3.1a"].cgst).toBe(9000 - 900);
    expect(r.cells["3.1c"].taxable).toBe(50000);
    expect(r.unregByPos).toEqual([{ pos: "29", taxable: 200000, igst: 24000 }]);
    expect(r.counts).toMatchObject({ invoices: 2, creditNotes: 1 });
    const json = gstr3bJson(r);
    expect(json.ret_period).toBe("102026");
    expect(json.sup_details.osup_det.txval).toBe(2900);
    expect(json.sup_details.osup_nil_exmp.txval).toBe(500);
    expect(json.inter_sup.unreg_details).toEqual([{ pos: "29", txval: 2000, iamt: 240 }]);
    expect(json.itc_elg.itc_avl.map((x) => x.ty)).toEqual(["IMPG", "IMPS", "ISRC", "ISD", "OTH"]);
  });
  it("adds debit notes to customers to 3.1(a) (and 3.2 for unregistered inter-State), counted on their own", () => {
    const sales = [
      sale("a", "INV/26-27/0001", "2026-10-02", [line(100000, 18)]),
      sale("n", "CN/26-27/0001", "2026-10-09", [line(10000, 18)], { docType: "CRN" }),
      sale("d", "DN/26-27/0001", "2026-10-15", [line(20000, 18)], { docType: "DBN" }),
      sale("u", "DN/26-27/0002", "2026-10-16", [line(5000, 12, true)], { docType: "DBN", interState: true }),
      sale("z", "DN/26-27/0003", "2026-10-17", [line(7000, 18)], { docType: "DBN", status: "cancelled" }),
    ];
    const r = buildGstr3b({ ...base, sales });
    expect(r.cells["3.1a"].taxable).toBe(100000 - 10000 + 20000 + 5000);
    expect(r.cells["3.1a"].cgst).toBe(9000 - 900 + 1800);
    expect(r.cells["3.1a"].igst).toBe(600);
    expect(r.unregByPos).toEqual([{ pos: "29", taxable: 5000, igst: 600 }]);
    expect(r.counts).toMatchObject({ invoices: 1, creditNotes: 1, debitNotes: 2 });
    expect(r.contributions.filter((c) => c.docType === "sales_debit_note").map((c) => [c.number, c.cell, c.taxable])).toEqual([
      ["DN/26-27/0001", "3.1a", 20000],
      ["DN/26-27/0002", "3.1a", 5000],
      ["DN/26-27/0002", "3.2", 5000],
    ]);
  });
  it("keeps every cell reconcilable to its documents", () => {
    const sales = [sale("a", "INV/1", "2026-10-02", [line(100000, 18)]), sale("b", "INV/2", "2026-10-03", [line(50000, 18)])];
    const r = buildGstr3b({ ...base, sales });
    const rows = r.contributions.filter((c) => c.cell === "3.1a");
    expect(rows.map((x) => x.number)).toEqual(["INV/1", "INV/2"]);
    expect(rows.reduce((s, x) => s + x.taxable, 0)).toBe(r.cells["3.1a"].taxable);
  });
  it("claims credit in its month, reports reversals and reverse charge, and nets 4(C)", () => {
    const decisions = [
      decideItc(purchaseDoc(purchase("p1"), null), ctx()),
      decideItc(purchaseDoc(purchase("p2", { taxable: 50000, cgst: 4500, sgst: 4500 }), flag({ docId: "p2", itcStatus: "reversal", reversalReason: "rule42" })), ctx()),
      decideItc(purchaseDoc(purchase("p3"), flag({ docId: "p3", itcStatus: "blocked" })), ctx()),
      decideItc(
        expenseDoc({ id: "e2", date: "2026-10-12", status: "recorded", categoryName: "Transport", amount: 100000, gstRate: 0, gstAmount: 0, vendorName: "Lorry", vendorGstin: null, reference: null }, "33", flag({ docType: "expense", docId: "e2", rcm: true, rcmRate: 5, rcmPaidOn: "2026-10-20", rcmPaidAmount: 5000 })),
        ctx(),
      ),
    ];
    const r = buildGstr3b({ ...base, decisions });
    expect(r.cells["4A5"].cgst).toBe(9000 + 4500);
    expect(r.cells["4B1"].cgst).toBe(4500);
    expect(r.cells["3.1d"].taxable).toBe(100000);
    expect(r.cells["3.1d"].cgst + r.cells["3.1d"].sgst).toBe(5000);
    expect(r.cells["4A3"].cgst + r.cells["4A3"].sgst).toBe(5000);
    expect(r.itcNet.cgst).toBe(9000 + 4500 - 4500 + 2500);
  });
  it("covers a whole quarter for QRMP and shows lapsed credit in 4(D)(2)", () => {
    const decisions = [
      decideItc(purchaseDoc(purchase("p1", { date: "2026-10-05" }), null), ctx()),
      decideItc(purchaseDoc(purchase("p2", { date: "2026-12-05" }), null), ctx()),
      decideItc(purchaseDoc(purchase("p3", { date: "2025-11-05" }), flag({ docId: "p3", claimMonth: "2026-12" })), ctx()),
    ];
    const r = buildGstr3b({ ...base, month: "2026-12", months: ["2026-10", "2026-11", "2026-12"], decisions });
    expect(r.fp).toBe("122026");
    expect(r.cells["4A5"].cgst).toBe(18000);
    expect(r.cells["4D2"].cgst).toBe(9000);
  });
  it("lists Table 5 inward 0% purchases and owner-typed figures, and is not applicable for a composition month", () => {
    const r = buildGstr3b({
      ...base,
      purchases: [{ id: "p9", billNumber: "X", date: "2026-10-07", supplierName: "S", interState: false, lines: [{ gstRate: 0, taxable: 7000 }, { gstRate: 5, taxable: 1000 }] }],
      adjustments: [{ id: "a1", month: "2026-10", kind: "interest", taxable: 0, igst: 0, cgst: 120, sgst: 120, cess: 0, note: null }, { id: "a2", month: "2026-10", kind: "itc_rev_other", taxable: 0, igst: 0, cgst: 50, sgst: 0, cess: 0, note: "x" }],
    });
    expect(r.cells["5.exempt.intra"].taxable).toBe(7000);
    expect(r.cells["5.1.interest"].cgst).toBe(120);
    expect(r.cells["4B2"].cgst).toBe(50);
    expect(buildGstr3b({ ...base, config: cfg({ composition: true, compositionFrom: "2026-04-01" }) }).applicable).toBe(false);
  });
  it("pays output tax with credit in the order of Rule 88A and leaves the rest in cash", () => {
    const so = setOff({ igst: 100, cgst: 200, sgst: 200, cess: 0 }, { igst: 150, cgst: 80, sgst: 300, cess: 0 });
    expect(so.used.igst.igst).toBe(100);
    expect(so.used.cgst.igst).toBe(50);
    expect(so.used.cgst.cgst).toBe(80);
    expect(so.cash).toEqual({ igst: 0, cgst: 70, sgst: 0, cess: 0 });
    expect(so.carry.sgst).toBe(100);
    const iFirst = setOff({ igst: 100, cgst: 0, sgst: 0, cess: 0 }, { igst: 0, cgst: 60, sgst: 60, cess: 0 });
    expect(iFirst.cash.igst).toBe(0);
    expect(iFirst.carry).toEqual({ igst: 0, cgst: 0, sgst: 20, cess: 0 });
    expect(setOff({ igst: 0, cgst: 50, sgst: 0, cess: 0 }, { igst: 0, cgst: 0, sgst: 100, cess: 0 }).cash.cgst).toBe(50);
  });
});

describe("GSTR-1 extra tables", () => {
  const range = { from: "2026-10-01", to: "2026-10-31" };
  it("builds Table 8 from 0% lines by supply type, net of credit notes", () => {
    const registered = { name: "Reg", gstin: BUYER29, stateCode: "29" };
    const sales = [
      sale("a", "INV/1", "2026-10-02", [line(100000, 0, false, "0402"), line(5000, 0, false, "9999")], { buyer: { ...registered, stateCode: "33" } }),
      sale("b", "INV/2", "2026-10-03", [line(30000, 0, true)], { interState: true }),
      sale("n", "CN/1", "2026-10-04", [line(10000, 0, true)], { docType: "CRN", interState: true }),
    ];
    const cfgx = cfg({ zeroRateRules: [{ hsnPrefix: "04", class: "exempt" }, { hsnPrefix: "99", class: "nongst" }] });
    const nil = buildNil(sales, cfgx, range);
    expect(nil.inv).toEqual([
      { sply_ty: "INTRB2C", expt_amt: 0, nil_amt: 200, ngsup_amt: 0 },
      { sply_ty: "INTRAB2B", expt_amt: 1000, nil_amt: 0, ngsup_amt: 50 },
    ]);
  });
  it("builds Table 6A exports with and without payment of IGST", () => {
    const wp = sale("e1", "EX/1", "2026-10-02", [line(100000, 18, true)], { placeOfSupply: "96", interState: true });
    const wop = sale("e2", "EX/2", "2026-10-03", [line(50000, 0, true)], { placeOfSupply: "96", interState: true });
    const exp = buildExp([wp, wop, sale("n", "INV/1", "2026-10-02", [line(1000, 18)])], range);
    expect(exp.map((b) => b.exp_typ)).toEqual(["WPAY", "WOPAY"]);
    expect(exp[0]!.inv[0]).toMatchObject({ inum: "EX/1", idt: "02-10-2026", val: 1180, itms: [{ txval: 1000, rt: 18, iamt: 180, csamt: 0 }] });
  });
  it("builds advances (Table 11) as tax-inclusive amounts split by supply type", () => {
    expect(advanceTax(118000, 18)).toBe(18000);
    const rows = [
      { month: "2026-10", kind: "received" as const, pos: "33", rate: 18, amount: 118000, cess: 0 },
      { month: "2026-10", kind: "received" as const, pos: "29", rate: 18, amount: 118000, cess: 0 },
      { month: "2026-10", kind: "adjusted" as const, pos: "33", rate: 18, amount: 59000, cess: 0 },
    ];
    const at = buildAdvances(rows, "received", "33");
    expect(at).toEqual([
      { pos: "29", sply_ty: "INTER", itms: [{ rt: 18, ad_amt: 1180, iamt: 180, csamt: 0 }] },
      { pos: "33", sply_ty: "INTRA", itms: [{ rt: 18, ad_amt: 1180, camt: 90, samt: 90, csamt: 0 }] },
    ]);
    expect(buildAdvances(rows, "adjusted", "33")[0]!.itms[0]).toMatchObject({ ad_amt: 590, camt: 45, samt: 45 });
  });
  it("counts cancelled bills and voided offline numbers in Table 13 and reports gaps", () => {
    const sales = [
      sale("1", "INV/26-27/0001", "2026-10-01", [line(1000, 18)]),
      sale("2", "INV/26-27/0002", "2026-10-02", [line(1000, 18)], { status: "cancelled" }),
      sale("5", "INV/26-27/0005", "2026-10-05", [line(1000, 18)]),
      sale("n", "CN/26-27/0001", "2026-10-06", [line(100, 18)], { docType: "CRN" }),
    ];
    const voided = [
      { number: "INV/26-27/0003", prefix: "INV", seq: 3, date: "2026-10-04", reason: "unused" },
      { number: "INV/26-27/0005", prefix: "INV", seq: 5, date: "2026-10-05", reason: "unused" },
    ];
    const r = buildDocIssue(sales, voided, range);
    const inv = r.doc_det.find((d) => d.doc_typ === "Invoices for outward supply")!;
    expect(inv.docs[0]).toEqual({ num: 1, from: "INV/26-27/0001", to: "INV/26-27/0005", totnum: 4, cancel: 2, net_issue: 2 });
    expect(r.voidedCounted).toBe(1);
    expect(r.gaps).toEqual([{ series: "INV/26-27/", missing: ["INV/26-27/0004"] }]);
    expect(r.doc_det.find((d) => d.doc_num === 5)!.docs[0]!.net_issue).toBe(1);
  });
  it("lists debit notes to customers in Table 13 as doc type 4 and adds them to Table 8 rows", () => {
    const sales = [
      sale("1", "INV/26-27/0001", "2026-10-01", [line(1000, 0)]),
      sale("d1", "DN/26-27/0001", "2026-10-06", [line(300, 0)], { docType: "DBN" }),
      sale("d2", "DN/26-27/0002", "2026-10-07", [line(100, 18)], { docType: "DBN", status: "cancelled" }),
    ];
    const r = buildDocIssue(sales, [], range);
    expect(r.doc_det.map((d) => [d.doc_num, d.doc_typ])).toEqual([
      [1, "Invoices for outward supply"],
      [4, "Debit Note"],
    ]);
    expect(r.doc_det[1]!.docs[0]).toEqual({ num: 1, from: "DN/26-27/0001", to: "DN/26-27/0002", totnum: 2, cancel: 1, net_issue: 1 });
    const nil = buildNil(sales, cfg(), range);
    expect(nil.inv.find((x) => x.sply_ty === "INTRAB2C")?.nil_amt).toBe(13);
  });
  it("validates what would be wrong in the file", () => {
    const bad = [
      sale("a", "INV/1", "2026-10-02", [{ ...line(100000, 18), hsn: "" }], { buyer: { name: "Acme", gstin: "29XXXXX0000X1Z0", stateCode: "29" } }),
      sale("b", "INV/1", "2026-10-03", [{ ...line(1000, 18), hsn: "19" }], { seller: { gstin: null, stateCode: "33" } }),
      sale("c", "INV/3", "2026-10-03", [{ ...line(1000, 18), igst: 0, cgst: 0, sgst: 0 }]),
    ];
    const issues = validateGstr1(bad, { gstin: null, range, config: cfg() });
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("hsn_missing");
    expect(codes).toContain("buyer_gstin_invalid");
    expect(codes).toContain("seller_gstin_missing");
    expect(codes).toContain("hsn_short");
    expect(codes).toContain("duplicate_number");
    expect(codes).toContain("tax_mismatch");
    expect(validateGstr1([], { gstin: SELLER, range, config: cfg() }).map((i) => i.code)).toEqual(["no_documents"]);
  });
});

describe("composition", () => {
  const c = cfg({ composition: true, compositionFrom: "2026-10-01", compositionType: "trader" });
  it("charges the scheme rate on the quarter's turnover less credit notes, and counts reverse charge at normal rates", () => {
    const sales = [
      sale("a", "BOS/1", "2026-10-02", [line(1000000, 0)]),
      sale("b", "BOS/2", "2026-11-02", [line(500000, 0)]),
      sale("n", "CN/1", "2026-11-05", [line(100000, 0)], { docType: "CRN" }),
      sale("x", "INV/old", "2026-09-30", [line(999999, 18)]),
      sale("t", "BOS/3", "2026-12-02", [line(10000, 18)]),
    ];
    const dec = [
      decideItc(
        expenseDoc({ id: "e", date: "2026-11-10", status: "recorded", categoryName: "Transport", amount: 100000, gstRate: 0, gstAmount: 0, vendorName: "L", vendorGstin: null, reference: null }, "33", flag({ docType: "expense", docId: "e", rcm: true, rcmRate: 5 })),
        ctx(c),
      ),
    ];
    const q = buildCmp08("2026-Q3", sales, dec, c)!;
    expect(q.turnover).toBe(1000000 + 500000 - 100000 + 10000);
    expect(q.rate).toBe(1);
    expect(q.tax.total).toBe(Math.round(1410000 / 100));
    expect(q.tax.cgst + q.tax.sgst).toBe(q.tax.total);
    expect(q.taxCharged.count).toBe(1);
    expect(q.rcm.tax.cgst + q.rcm.tax.sgst).toBe(5000);
    expect(buildCmp08("2026-Q3", [], [], cfg({ composition: true, compositionFrom: "2026-10-01", compositionType: "restaurant" }))!.rate).toBe(5);
    expect(buildCmp08("2026-Q3", [], [], cfg({ composition: true, compositionFrom: "2026-10-01", compositionType: "services" }))!.rate).toBe(6);
    expect(buildCmp08("bad", [], [], c)).toBeNull();
  });
  it("sums the four quarters for GSTR-4", () => {
    const qs = quartersOfFy(2026);
    expect(qs.map((q) => q.key)).toEqual(["2026-Q1", "2026-Q2", "2026-Q3", "2027-Q4"]);
    const parts = qs.map((q) => buildCmp08(q.key, [], [], c)!);
    const a = buildGstr4(2026, parts, { registered: 5, rcmRegistered: 0, rcmUnregistered: 0, imports: 0 }, 0);
    expect(a.fy).toBe("2026-27");
    expect(a.quarters).toHaveLength(4);
  });
});

describe("filing calendar", () => {
  it("lists monthly, QRMP and composition due dates with filed marks", () => {
    const monthly = filingCalendar("2026-11-12", cfg(), "33", [{ returnType: "gstr1", period: "2026-10", filedOn: "2026-11-10" }]);
    const g1 = monthly.find((i) => i.returnType === "gstr1" && i.period === "2026-10")!;
    expect(g1.dueDate).toBe("2026-11-11");
    expect(g1.status).toBe("filed");
    const g3 = monthly.find((i) => i.returnType === "gstr3b" && i.period === "2026-10")!;
    expect(g3.dueDate).toBe("2026-11-20");
    expect(g3.status).toBe("upcoming");
    const late = filingCalendar("2026-11-25", cfg(), "33", []).find((i) => i.returnType === "gstr3b" && i.period === "2026-10")!;
    expect(late.status).toBe("overdue");
    const q = filingCalendar("2027-01-10", cfg({ qrmp: true, qrmpFrom: "2026-04-01" }), "33", []);
    expect(q.find((i) => i.returnType === "gstr1" && i.period === "2026-Q3")?.dueDate).toBe("2027-01-13");
    expect(q.find((i) => i.returnType === "gstr3b" && i.period === "2026-Q3")?.dueDate).toBe("2027-01-22");
    expect(filingCalendar("2027-01-10", cfg({ qrmp: true, qrmpFrom: "2026-04-01" }), "07", []).find((i) => i.returnType === "gstr3b" && i.period === "2026-Q3")?.dueDate).toBe("2027-01-24");
    expect(q.find((i) => i.returnType === "pmt06")).toBeTruthy();
    const comp = filingCalendar("2027-01-10", cfg({ composition: true, compositionFrom: "2026-04-01" }), "33", []);
    expect(comp.find((i) => i.returnType === "cmp08" && i.period === "2026-Q3")?.dueDate).toBe("2027-01-18");
    expect(comp.some((i) => i.returnType === "gstr1" || i.returnType === "gstr3b")).toBe(false);
    const annual = filingCalendar("2027-04-10", cfg({ composition: true, compositionFrom: "2026-04-01" }), "33", []);
    expect(annual.find((i) => i.returnType === "gstr4")?.dueDate).toBe("2027-04-30");
  });
});
