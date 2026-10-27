import { describe, expect, it } from "vitest";
import { buildGstr1, gstr1Section, periodRange, splitDocNumber } from "./gstr1";
import { BUYER_KA_GSTIN, BUYER_TN_GSTIN, invoice, line, SELLER_GSTIN } from "./test-fixtures";
import type { EInvoiceSource } from "./ports";

const b2c = (over: Partial<EInvoiceSource> & { inter?: boolean } = {}) => {
  const b = invoice(over);
  return { ...b, buyer: { ...b.buyer, gstin: null, name: "Walk-in" } };
};

describe("periodRange", () => {
  it("parses MMYYYY", () => {
    expect(periodRange("102026")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("022028")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("132026")).toBeNull();
    expect(periodRange("2026-10")).toBeNull();
  });
});

describe("gstr1Section", () => {
  it("b2b with a valid buyer GSTIN, b2cl above ₹1 lakh inter-state, else b2cs", () => {
    expect(gstr1Section(invoice())).toBe("b2b");
    expect(gstr1Section(b2c({ inter: true }))).toBe("b2cs");
    const big = b2c({ inter: true, lines: [line("Gold zari saree", "5007", 1, "pcs", 150_000_00, 5, true)] });
    expect(gstr1Section(big)).toBe("b2cl");
    const bigIntra = b2c({ lines: [line("Gold zari saree", "5007", 1, "pcs", 150_000_00, 5, false)] });
    expect(gstr1Section(bigIntra)).toBe("b2cs");
  });
});

describe("splitDocNumber", () => {
  it("splits the trailing sequence", () => {
    expect(splitDocNumber("INV/26-27/0042")).toEqual({ series: "INV/26-27/", seq: 42 });
    expect(splitDocNumber("ABC")).toEqual({ series: "ABC", seq: null });
  });
});

describe("buildGstr1", () => {
  const invoices: EInvoiceSource[] = [
    invoice({ id: "1", number: "INV/26-27/0040", date: "2026-10-02" }),
    invoice({ id: "2", number: "INV/26-27/0041", date: "2026-10-05", inter: true }),
    invoice({ id: "3", number: "INV/26-27/0043", date: "2026-10-09" }),
    { ...b2c({ id: "4", number: "INV/26-27/0044", date: "2026-10-10" }) },
    { ...b2c({ id: "5", number: "INV/26-27/0045", date: "2026-10-11", inter: true }) },
    {
      ...b2c({ id: "6", number: "INV/26-27/0046", date: "2026-10-12", inter: true, lines: [line("Gold zari saree", "5007", 1, "pcs", 150_000_00, 5, true)] }),
    },
    { ...invoice({ id: "7", number: "INV/26-27/0042", date: "2026-10-06" }), status: "cancelled" },
    { ...invoice({ id: "8", number: null, date: "2026-10-06" }), status: "draft" },
    invoice({ id: "9", number: "INV/26-27/0039", date: "2026-09-30" }),
    invoice({ id: "10", number: "DN/26-27/0001", date: "2026-10-13", docType: "DBN" }),
  ];
  const { json, warnings, counts } = buildGstr1(invoices, { gstin: SELLER_GSTIN.toLowerCase(), period: "102026" });

  it("header", () => {
    expect(json.gstin).toBe(SELLER_GSTIN);
    expect(json.fp).toBe("102026");
    expect(counts).toEqual({ b2b: 3, b2cl: 1, b2cs: 2, cdnr: 0, cdnur: 0, cancelled: 1, skipped: 2 });
    expect(warnings).toEqual([expect.stringContaining("INV/26-27/0039"), expect.stringContaining("DN/26-27/0001")]);
  });

  it("b2b groups invoices by buyer GSTIN with per-rate items", () => {
    expect(json.b2b.map((b) => b.ctin)).toEqual([BUYER_KA_GSTIN, BUYER_TN_GSTIN].sort());
    const tn = json.b2b.find((b) => b.ctin === BUYER_TN_GSTIN)!;
    expect(tn.inv.map((i) => i.inum)).toEqual(["INV/26-27/0040", "INV/26-27/0043"]);
    expect(tn.inv[0]).toEqual({
      inum: "INV/26-27/0040",
      idt: "02-10-2026",
      val: 3277,
      pos: "33",
      rchrg: "N",
      inv_typ: "R",
      itms: [
        { num: 1, itm_det: { txval: 2400, rt: 5, camt: 60, samt: 60, csamt: 0 } },
        { num: 2, itm_det: { txval: 675.5, rt: 12, camt: 40.53, samt: 40.53, csamt: 0 } },
      ],
    });
    const ka = json.b2b.find((b) => b.ctin === BUYER_KA_GSTIN)!;
    expect(ka.inv[0]!.pos).toBe("29");
    expect(ka.inv[0]!.itms).toEqual([
      { num: 1, itm_det: { txval: 2400, rt: 5, iamt: 120, csamt: 0 } },
      { num: 2, itm_det: { txval: 675.5, rt: 12, iamt: 81.06, csamt: 0 } },
    ]);
  });

  it("b2cl lists large inter-state B2C invoices by place of supply", () => {
    expect(json.b2cl).toEqual([
      {
        pos: "29",
        inv: [{ inum: "INV/26-27/0046", idt: "12-10-2026", val: 157500, itms: [{ num: 1, itm_det: { txval: 150000, rt: 5, iamt: 7500, csamt: 0 } }] }],
      },
    ]);
  });

  it("b2cs aggregates by supply type, place of supply and rate", () => {
    expect(json.b2cs).toEqual([
      { sply_ty: "INTER", rt: 5, typ: "OE", pos: "29", txval: 2400, iamt: 120, csamt: 0 },
      { sply_ty: "INTER", rt: 12, typ: "OE", pos: "29", txval: 675.5, iamt: 81.06, csamt: 0 },
      { sply_ty: "INTRA", rt: 5, typ: "OE", pos: "33", txval: 2400, camt: 60, samt: 60, csamt: 0 },
      { sply_ty: "INTRA", rt: 12, typ: "OE", pos: "33", txval: 675.5, camt: 40.53, samt: 40.53, csamt: 0 },
    ]);
  });

  it("hsn is split into B2B and B2C tabs, keyed by HSN + UQC + rate", () => {
    if (!("hsn_b2b" in json.hsn)) throw new Error("expected split layout");
    expect(json.hsn.hsn_b2b).toEqual([
      { num: 1, hsn_sc: "50072010", desc: "Silk blouse material", uqc: "MTR", qty: 4.5, rt: 12, txval: 2026.5, iamt: 81.06, camt: 81.06, samt: 81.06, csamt: 0 },
      { num: 2, hsn_sc: "5208", desc: "Cotton saree", uqc: "NOS", qty: 6, rt: 5, txval: 7200, iamt: 120, camt: 120, samt: 120, csamt: 0 },
    ]);
    expect(json.hsn.hsn_b2c.map((r) => [r.hsn_sc, r.qty, r.txval])).toEqual([
      ["5007", 1, 150000],
      ["50072010", 3, 1351],
      ["5208", 4, 4800],
    ]);
  });

  it("legacy layout merges both tabs into data", () => {
    const legacy = buildGstr1(invoices, { gstin: SELLER_GSTIN, period: "102026", hsnLayout: "legacy" }).json.hsn;
    if (!("data" in legacy)) throw new Error("expected legacy layout");
    expect(legacy.data.map((r) => [r.hsn_sc, r.qty, r.txval])).toEqual([
      ["5007", 1, 150000],
      ["50072010", 7.5, 3377.5],
      ["5208", 10, 12000],
    ]);
  });

  it("doc_issue counts numbered bills including cancelled ones", () => {
    expect(json.doc_issue).toEqual({
      doc_det: [
        {
          doc_num: 1,
          doc_typ: "Invoices for outward supply",
          docs: [{ num: 1, from: "INV/26-27/0040", to: "INV/26-27/0046", totnum: 7, cancel: 1, net_issue: 6 }],
        },
      ],
    });
  });

  it("service lines report UQC NA with zero quantity", () => {
    const r = buildGstr1([invoice({ lines: [line("Stitching", "998821", 3, "job", 10_000, 5, false)] })], { gstin: SELLER_GSTIN, period: "102026" });
    if (!("hsn_b2b" in r.json.hsn)) throw new Error("layout");
    expect(r.json.hsn.hsn_b2b[0]).toMatchObject({ hsn_sc: "998821", uqc: "NA", qty: 0, txval: 300 });
  });

  it("skips bills of another GSTIN and rejects a bad period", () => {
    const r = buildGstr1([invoice()], { gstin: BUYER_KA_GSTIN, period: "102026" });
    expect(r.json.b2b).toEqual([]);
    expect(r.counts.skipped).toBe(1);
    expect(() => buildGstr1([], { gstin: SELLER_GSTIN, period: "2026" })).toThrow(RangeError);
  });

  it("an empty month still yields a valid skeleton", () => {
    const r = buildGstr1([], { gstin: SELLER_GSTIN, period: "112026" });
    expect(r.json).toEqual({
      gstin: SELLER_GSTIN,
      fp: "112026",
      b2b: [],
      b2cl: [],
      b2cs: [],
      cdnr: [],
      cdnur: [],
      hsn: { hsn_b2b: [], hsn_b2c: [] },
      doc_issue: { doc_det: [] },
    });
  });
});

describe("buildGstr1: credit notes", () => {
  const note = (over: Partial<EInvoiceSource> & { inter?: boolean } = {}): EInvoiceSource => ({
    ...invoice({ lines: [line("Cotton saree", "5208", 1, "pcs", 125_000, 5, over.inter ?? false)], ...over }),
    docType: "CRN",
    precedingDoc: { number: "INV/26-27/0040", date: "2026-10-02", total: 2_00_000 },
  });
  const bill = invoice({ id: "b1", number: "INV/26-27/0040", date: "2026-10-02" });

  it("CDNR: a note to a registered buyer, per rate, with the note value", () => {
    const r = buildGstr1([bill, note({ id: "n1", number: "CN/26-27/0001", date: "2026-10-13" })], { gstin: SELLER_GSTIN, period: "102026" });
    expect(r.counts).toMatchObject({ b2b: 1, cdnr: 1, cdnur: 0, skipped: 0 });
    expect(r.json.cdnr).toEqual([
      {
        ctin: BUYER_TN_GSTIN,
        nt: [
          {
            ntty: "C",
            nt_num: "CN/26-27/0001",
            nt_dt: "13-10-2026",
            pos: "33",
            rchrg: "N",
            inv_typ: "R",
            val: 1313,
            itms: [{ num: 1, itm_det: { txval: 1250, rt: 5, camt: 31.25, samt: 31.25, csamt: 0 } }],
          },
        ],
      },
    ]);
    // HSN B2B is net of the note: 2 sarees billed (₹2,400 after discount), 1 returned (₹1,250).
    if (!("hsn_b2b" in r.json.hsn)) throw new Error("layout");
    expect(r.json.hsn.hsn_b2b.find((h) => h.hsn_sc === "5208")).toMatchObject({ qty: 1, txval: 1150 });
    expect(r.json.doc_issue.doc_det.map((d) => [d.doc_num, d.doc_typ, d.docs[0]!.totnum])).toEqual([
      [1, "Invoices for outward supply", 1],
      [5, "Credit Note", 1],
    ]);
  });

  it("CDNUR for a note on a large inter-state B2C bill; small B2C notes are netted into B2CS", () => {
    const walkIn = (n: EInvoiceSource): EInvoiceSource => ({ ...n, buyer: { ...n.buyer, gstin: null, name: "Walk-in" } });
    const big = walkIn(note({ id: "n2", number: "CN/26-27/0002", date: "2026-10-14", inter: true }));
    big.precedingDoc = { number: "INV/26-27/0046", date: "2026-10-12", total: 157_500_00 };
    const small = walkIn(note({ id: "n3", number: "CN/26-27/0003", date: "2026-10-14" }));
    small.precedingDoc = { number: "INV/26-27/0044", date: "2026-10-10", total: 3_277_00 };
    const sale = walkIn(invoice({ id: "b2", number: "INV/26-27/0044", date: "2026-10-10" }));
    const r = buildGstr1([sale, big, small], { gstin: SELLER_GSTIN, period: "102026" });
    expect(r.counts).toMatchObject({ cdnur: 1, cdnr: 0, b2cs: 2 });
    expect(r.json.cdnur).toEqual([
      {
        typ: "B2CL",
        ntty: "C",
        nt_num: "CN/26-27/0002",
        nt_dt: "14-10-2026",
        pos: "29",
        val: 1313,
        itms: [{ num: 1, itm_det: { txval: 1250, rt: 5, iamt: 62.5, csamt: 0 } }],
      },
    ]);
    // B2CS intra 5%: the bill's ₹2,400 less the small note's ₹1,250.
    expect(r.json.b2cs.find((b) => b.sply_ty === "INTRA" && b.rt === 5)).toMatchObject({ txval: 1150, camt: 28.75, samt: 28.75 });
  });
});

describe("buildGstr1 for a quarter (QRMP)", () => {
  const all: EInvoiceSource[] = [
    invoice({ id: "1", number: "INV/26-27/0040", date: "2026-10-02" }),
    invoice({ id: "2", number: "INV/26-27/0041", date: "2026-11-20" }),
    invoice({ id: "3", number: "INV/26-27/0042", date: "2026-12-31" }),
    invoice({ id: "4", number: "INV/26-27/0043", date: "2027-01-02" }),
  ];
  it("takes every bill of the range and names the file by the quarter's last month", () => {
    const r = buildGstr1(all, { gstin: SELLER_GSTIN, period: "122026", range: { from: "2026-10-01", to: "2026-12-31" } });
    expect(r.json.fp).toBe("122026");
    expect(r.counts.b2b).toBe(3);
    expect(r.warnings.some((w) => w.includes("INV/26-27/0043"))).toBe(true);
    // Without the range only the month counts, as before.
    expect(buildGstr1(all, { gstin: SELLER_GSTIN, period: "122026" }).counts.b2b).toBe(1);
  });
});

describe("HSN summary of alternate-unit lines (docs/price-lists-units.md)", () => {
  it("counts boxes in the item's base unit so one HSN keeps one UQC", () => {
    const boxes = { ...line("Soap", "3401", 2, "box", 60000, 18, false), unitFactor: 12, baseUnit: "pcs" };
    const pieces = line("Soap", "3401", 5, "pcs", 5000, 18, false);
    const { json } = buildGstr1([invoice({ id: "u1", number: "INV/26-27/0100", date: "2026-10-02", lines: [boxes, pieces] })], { gstin: SELLER_GSTIN, period: "102026" });
    if (!("hsn_b2b" in json.hsn)) throw new Error("expected split layout");
    expect(json.hsn.hsn_b2b.map((r) => [r.hsn_sc, r.uqc, r.qty])).toEqual([["3401", "NOS", 29]]);
  });
});
