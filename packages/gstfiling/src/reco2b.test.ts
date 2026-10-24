import { gstinCheckChar } from "@srirealtime/gst";
import { describe, expect, it } from "vitest";
import { matchRows, normalizeNumber, parseGstr2bJson, parseGstr2bSheets, type BookDoc, type Row2b } from "./reco2b";

const mk = (f: string) => f + gstinCheckChar(f);
const SUP = mk("33BBBBB1111B1Z");
const SUP2 = mk("29CCCCC2222C1Z");

const portalFile = (wrapped: "single" | "double") => {
  const inner = {
    gstin: mk("33AAAAA0000A1Z"),
    rtnprd: "102026",
    version: "1.0",
    gendt: "14-11-2026",
    data: {
      docdata: {
        b2b: [
          {
            ctin: SUP,
            trdnm: "Sri Traders",
            supfildt: "10-11-2026",
            supprd: "102026",
            inv: [
              { inum: "S008400", typ: "R", dt: "24-10-2026", val: 1180, pos: "33", rev: "N", itcavl: "Y", diffprcnt: 1, items: [{ num: 1, rt: 18, txval: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0 }] },
              { inum: "S008401", typ: "R", dt: "25-10-2026", val: 590, pos: "33", rev: "N", itcavl: "N", rsn: "P", txval: 500, igst: 0, cgst: 45, sgst: 45, cess: 0 },
            ],
          },
        ],
        cdnr: [{ ctin: SUP, trdnm: "Sri Traders", nt: [{ ntnum: "CN1", typ: "C", dt: "27-10-2026", val: 118, pos: "33", rev: "N", itcavl: "Y", items: [{ num: 1, rt: 18, txval: 100, igst: 0, cgst: 9, sgst: 9, cess: 0 }] }] }],
        impg: [{ refdt: "28-10-2026", recdt: "30-10-2026", portcode: "18272A", boenum: "2566282", boedt: "28-10-2026", txval: 10000, igst: 1800, cess: 0 }],
        isd: [{ ctin: SUP2, trdnm: "HO", doclist: [{ doctyp: "ISDI", docnum: "S0080", docdt: "03-10-2026", igst: 50, cgst: 0, sgst: 0, cess: 0, itcelg: "Y" }] }],
      },
    },
  };
  return wrapped === "double" ? { status: 1, data: { data: inner } } : { data: inner };
};

describe("GSTR-2B parsing", () => {
  it.each(["single", "double"] as const)("reads the portal's JSON (%s wrapper): invoices, notes, imports and ISD", (w) => {
    const p = parseGstr2bJson(portalFile(w));
    expect(p.month).toBe("2026-10");
    expect(p.gstin).toBe(mk("33AAAAA0000A1Z"));
    expect(p.rows).toHaveLength(5);
    const first = p.rows[0]!;
    expect(first).toMatchObject({ section: "b2b", supplierGstin: SUP, docNumber: "S008400", docDate: "2026-10-24", docValue: 118000, taxable: 100000, cgst: 9000, sgst: 9000, itcAvailable: true, docKind: "inv" });
    const second = p.rows[1]!;
    expect(second).toMatchObject({ itcAvailable: false, reason: "P", taxable: 50000 });
    expect(p.rows.find((r) => r.docKind === "cn")).toMatchObject({ docNumber: "CN1", taxable: 10000 });
    expect(p.rows.find((r) => r.section === "impg")).toMatchObject({ docNumber: "2566282", igst: 180000 });
    expect(p.rows.find((r) => r.section === "isd")).toMatchObject({ docNumber: "S0080", supplierGstin: SUP2, igst: 5000 });
  });
  it("rejects files that are not a 2B", () => {
    expect(() => parseGstr2bJson({ foo: 1 })).toThrow();
    expect(() => parseGstr2bJson("x")).toThrow();
  });
  it("reads the portal's Excel sheets and folds per-rate rows into one document", () => {
    const header = ["GSTIN of supplier", "Trade/Legal name", "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", "Place of supply", "Supply Attract Reverse Charge", "Rate(%)", "Taxable Value (₹)", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", "ITC Availability", "Reason"];
    const p = parseGstr2bSheets({
      "Read me": [["Goods and Services Tax - GSTR-2B"], ["GSTIN", mk("33AAAAA0000A1Z")]],
      B2B: [["a"], ["b"], header, [SUP, "Sri", "S1", "Regular", "24-10-2026", "1770", "33", "No", "18", "1000", "0", "90", "90", "0", "Yes", ""], [SUP, "Sri", "S1", "Regular", "24-10-2026", "1770", "33", "No", "5", "500", "0", "12.5", "12.5", "0", "Yes", ""]],
    });
    expect(p.gstin).toBe(mk("33AAAAA0000A1Z"));
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ docNumber: "S1", taxable: 150000, cgst: 10250, itcAvailable: true });
  });
});

const row = (over: Partial<Row2b>): Row2b => ({ section: "b2b", supplierGstin: SUP, supplierName: "S", docKind: "inv", docNumber: "INV-42", docDate: "2026-10-05", docValue: 118000, pos: "33", reverseCharge: false, itcAvailable: true, reason: null, taxable: 100000, igst: 0, cgst: 9000, sgst: 9000, cess: 0, ...over });
const book = (id: string, over: Partial<BookDoc> = {}): BookDoc => ({ key: `purchase:${id}`, docType: "purchase", docId: id, gstin: SUP, party: "S", number: "INV-42", date: "2026-10-05", taxable: 100000, tax: { igst: 0, cgst: 9000, sgst: 9000, cess: 0 }, total: 118000, ...over });

describe("number normalisation", () => {
  it("drops separators and leading zeros", () => {
    expect(normalizeNumber("INV/26-27/0042")).toBe("INV262742");
    expect(normalizeNumber("0042")).toBe("42");
    expect(normalizeNumber("inv 42")).toBe("INV42");
  });
});

describe("GSTR-2B matching", () => {
  it("matches exact, fuzzy, amount mismatch and missing", () => {
    const rows = [
      row({ docNumber: "INV-42" }),
      row({ docNumber: "0043", docDate: "2026-10-06", taxable: 200000, cgst: 18000, sgst: 18000 }),
      row({ docNumber: "INV-44", docDate: "2026-10-07", taxable: 300000, cgst: 27000, sgst: 27000 }),
      row({ docNumber: "ZZ-1", supplierGstin: SUP2, taxable: 777, cgst: 0, sgst: 0, igst: 140 }),
    ];
    const docs = [
      book("a"),
      book("b", { number: "INV/26-27/0043", date: "2026-10-06", taxable: 200000, tax: { igst: 0, cgst: 18000, sgst: 18000, cess: 0 } }),
      book("c", { number: "INV-44", date: "2026-10-07", taxable: 290000, tax: { igst: 0, cgst: 26100, sgst: 26100, cess: 0 } }),
      book("d", { number: "ORPHAN", date: "2026-10-09", taxable: 1000000, tax: { igst: 0, cgst: 90000, sgst: 90000, cess: 0 } }),
    ];
    const { matches, missingIn2b } = matchRows(rows, docs);
    expect(matches.map((m) => m.status)).toEqual(["matched", "fuzzy", "amount_mismatch", "missing_in_books"]);
    expect(matches[0]!.doc?.docId).toBe("a");
    expect(matches[1]!.doc?.docId).toBe("b");
    expect(matches[2]!.diff).toHaveProperty("taxable");
    expect(missingIn2b.map((d) => d.docId)).toEqual(["d"]);
  });
  it("tolerates a rupee of rounding and a date a day apart, and matches a typo'd number by amounts", () => {
    const m1 = matchRows([row({ cgst: 9050, sgst: 8950 })], [book("a", { date: "2026-10-06" })]);
    expect(m1.matches[0]!.status).toBe("matched");
    const m2 = matchRows([row({ docNumber: "INV-47" })], [book("a")]);
    expect(m2.matches[0]!.status).toBe("fuzzy");
    expect(m2.matches[0]!.diff).toHaveProperty("number");
  });
  it("uses a book document only once and matches supplier credit notes to debit notes by amounts", () => {
    const m = matchRows([row({}), row({ docNumber: "INV-42" })], [book("a")]);
    expect(m.matches.filter((x) => x.doc).length).toBe(1);
    const cn = matchRows([row({ docKind: "cn", docNumber: "CN-9", taxable: 10000, cgst: 900, sgst: 900, docDate: "2026-10-20" })], [book("n", { docType: "debit_note", key: "debit_note:n", number: "DN-1", date: "2026-10-19", taxable: 10000, tax: { igst: 0, cgst: 900, sgst: 900, cess: 0 } })]);
    expect(cn.matches[0]!.status).toBe("fuzzy");
  });
});
