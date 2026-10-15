import { describe, expect, it } from "vitest";
import { buildEInvoice, nicPhone, prepareEInvoice, splitAddress, validateEInvoice, validateSource, type EInvoicePayload } from "./nic";
import { BUYER_KA_GSTIN, BUYER_TN_GSTIN, gstin, invoice, line, SELLER_GSTIN } from "./test-fixtures";
import { toUqc } from "./units";

const TODAY = "2026-10-15";
const ok = (p: EInvoicePayload, opts = {}) => validateEInvoice(p, { today: TODAY, ...opts });
const codes = (p: EInvoicePayload, opts = {}) => ok(p, opts).issues.filter((i) => i.severity === "error").map((i) => i.code);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const INTRA_JSON = {
  Version: "1.1",
  TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
  DocDtls: { Typ: "INV", No: "INV/26-27/0042", Dt: "14/10/2026" },
  SellerDtls: {
    Gstin: SELLER_GSTIN,
    LglNm: "Sri Lakshmi Textiles Private Limited",
    TrdNm: "Lakshmi Silks",
    Addr1: "12, North Car Street, Near Big Temple",
    Loc: "Thanjavur",
    Pin: 613001,
    Stcd: "33",
    Ph: "9876543210",
    Em: "accounts@lakshmisilks.in",
  },
  BuyerDtls: {
    Gstin: BUYER_TN_GSTIN,
    LglNm: "Kumar Garments",
    Pos: "33",
    Addr1: "7, Gandhi Road",
    Loc: "Kumbakonam",
    Pin: 612001,
    Stcd: "33",
    Ph: "9443012345",
    Em: "kumar.garments@example.com",
  },
  ItemList: [
    {
      SlNo: "1", PrdDesc: "Cotton saree", IsServc: "N", HsnCd: "5208", Qty: 2, Unit: "NOS", UnitPrice: 1250, TotAmt: 2500,
      Discount: 100, AssAmt: 2400, GstRt: 5, IgstAmt: 0, CgstAmt: 60, SgstAmt: 60, CesRt: 0, CesAmt: 0, TotItemVal: 2520,
    },
    {
      SlNo: "2", PrdDesc: "Silk blouse material", IsServc: "N", HsnCd: "50072010", Qty: 1.5, Unit: "MTR", UnitPrice: 450.33,
      TotAmt: 675.5, Discount: 0, AssAmt: 675.5, GstRt: 12, IgstAmt: 0, CgstAmt: 40.53, SgstAmt: 40.53, CesRt: 0, CesAmt: 0,
      TotItemVal: 756.56,
    },
  ],
  ValDtls: { AssVal: 3075.5, CgstVal: 100.53, SgstVal: 100.53, IgstVal: 0, CesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: 0.44, TotInvVal: 3277 },
};

describe("buildEInvoice", () => {
  it("builds the exact NIC v1.1 JSON for an intra-state 2-line B2B bill", () => {
    const p = buildEInvoice(invoice());
    expect(p).toEqual(INTRA_JSON);
    expect(ok(p)).toEqual({ ok: true, issues: [] });
  });

  it("builds IGST for an inter-state bill", () => {
    const p = buildEInvoice(invoice({ inter: true }));
    expect(p.BuyerDtls).toEqual({
      Gstin: BUYER_KA_GSTIN,
      LglNm: "Bengaluru Fabrics LLP",
      Pos: "29",
      Addr1: "45, 2nd Cross, Chickpet, Bengaluru",
      Loc: "Bengaluru",
      Pin: 560053,
      Stcd: "29",
      Ph: "8022345678",
    });
    expect(p.ItemList.map((i) => [i.IgstAmt, i.CgstAmt, i.SgstAmt, i.TotItemVal])).toEqual([
      [120, 0, 0, 2520],
      [81.06, 0, 0, 756.56],
    ]);
    expect(p.ValDtls).toEqual({ AssVal: 3075.5, CgstVal: 0, SgstVal: 0, IgstVal: 201.06, CesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: 0.44, TotInvVal: 3277 });
    expect(ok(p).ok).toBe(true);
  });

  it("marks SAC 99xx lines as services", () => {
    const p = buildEInvoice(invoice({ lines: [line("Stitching charges", "998821", 1, "job", 50_000, 18, false)] }));
    expect(p.ItemList[0]).toMatchObject({ IsServc: "Y", HsnCd: "998821", Unit: "OTH", CgstAmt: 45, SgstAmt: 45 });
    expect(ok(p).ok).toBe(true);
  });

  it("adds RefDtls for credit notes and keeps doc type", () => {
    const p = buildEInvoice(invoice({ docType: "CRN", number: "CN/26-27/0001", precedingDoc: { number: "INV/26-27/0042", date: "2026-10-14" } }));
    expect(p.DocDtls.Typ).toBe("CRN");
    expect(p.RefDtls).toEqual({ PrecDocDtls: [{ InvNo: "INV/26-27/0042", InvDt: "14/10/2026" }] });
    expect(buildEInvoice(invoice()).RefDtls).toBeUndefined();
  });

  it("reverse charge sets RegRev Y; other charges go to OthChrg", () => {
    const base = invoice();
    const p = buildEInvoice({ ...base, otherCharges: 5_000, totals: { ...base.totals, roundOff: -6, total: base.totals.total - 44 + 5_000 - 6 + 0 } }, { reverseCharge: true });
    expect(p.TranDtls.RegRev).toBe("Y");
    expect(p.ValDtls.OthChrg).toBe(50);
  });

  it("handles a GST-inclusive line whose CGST/SGST differ by a paisa", () => {
    // ₹999 MRP at 5%: taxable 95143, tax 4757 → CGST 2379, SGST 2378
    const l = { description: "Towel", hsn: "6302", qty: 1, unit: "pcs", rate: 95_143, discount: 0, gstRate: 5, amount: 95_143, taxable: 95_143, cgst: 2_379, sgst: 2_378, igst: 0, total: 99_900 };
    const p = buildEInvoice(invoice({ lines: [l], totals: { taxable: 95_143, cgst: 2_379, sgst: 2_378, igst: 0, roundOff: 0, total: 99_900 } }));
    expect(p.ItemList[0]).toMatchObject({ CgstAmt: 23.79, SgstAmt: 23.78, TotItemVal: 999 });
    expect(ok(p).ok).toBe(true);
  });
});

describe("validateEInvoice", () => {
  const base = () => clone(INTRA_JSON) as EInvoicePayload;

  it("requires a valid buyer GSTIN different from the seller", () => {
    const p = base();
    p.BuyerDtls.Gstin = "33AACCK5678L1ZX";
    expect(codes(p)).toContain("gstin_invalid");
    const q = base();
    q.BuyerDtls.Gstin = SELLER_GSTIN;
    expect(codes(q)).toContain("buyer_is_seller");
    const u = base();
    u.BuyerDtls.Gstin = "URP";
    expect(codes(u)).toEqual(expect.arrayContaining(["gstin_invalid", "buyer_unregistered"]));
  });

  it("checks state codes against GSTINs and the place of supply", () => {
    const p = base();
    p.BuyerDtls.Stcd = "29";
    expect(codes(p)).toContain("state_gstin_mismatch");
    const q = base();
    q.BuyerDtls.Pos = "25";
    expect(codes(q)).toContain("place_of_supply");
  });

  it("requires HSN of 4, 6 or 8 digits (configurable minimum)", () => {
    const p = base();
    p.ItemList[0]!.HsnCd = "";
    expect(codes(p)).toContain("hsn_missing");
    p.ItemList[0]!.HsnCd = "52081";
    expect(codes(p)).toContain("hsn_format");
    p.ItemList[0]!.HsnCd = "5208";
    expect(codes(p, { minHsnDigits: 6 })).toContain("hsn_length");
    p.ItemList[0]!.HsnCd = "520811";
    expect(codes(p, { minHsnDigits: 6 })).toEqual([]);
  });

  it("IsServc must follow the SAC 99 rule", () => {
    const p = base();
    p.ItemList[0]!.IsServc = "Y";
    expect(codes(p)).toContain("service_flag");
  });

  it("charges IGST only on inter-state supplies", () => {
    const p = base();
    p.ItemList[0]!.IgstAmt = 120;
    p.ItemList[0]!.CgstAmt = 0;
    p.ItemList[0]!.SgstAmt = 0;
    expect(codes(p)).toContain("igst_on_intra");

    const inter = clone(buildEInvoice(invoice({ inter: true })));
    inter.ItemList[1]!.CgstAmt = 40.53;
    inter.ItemList[1]!.SgstAmt = 40.53;
    inter.ItemList[1]!.IgstAmt = 0;
    expect(codes(inter)).toEqual(expect.arrayContaining(["cgst_on_inter", "igst_amount"]));
  });

  it("checks tax amounts against the rate within ₹1", () => {
    const p = base();
    p.ItemList[0]!.CgstAmt = 60.99;
    p.ItemList[0]!.TotItemVal = 2520.99;
    p.ValDtls.CgstVal = 101.52;
    p.ValDtls.TotInvVal = 3277.99;
    expect(codes(p)).toEqual([]);
    p.ItemList[0]!.CgstAmt = 61.5;
    expect(codes(p)).toContain("cgst_amount");
  });

  it("reconciles item amounts", () => {
    const p = base();
    p.ItemList[0]!.TotAmt = 2600;
    expect(codes(p)).toEqual(expect.arrayContaining(["total_amount", "assessable"]));
    const q = base();
    q.ItemList[1]!.TotItemVal = 760;
    expect(codes(q)).toContain("item_value");
    const r = base();
    r.ItemList[0]!.Discount = 3000;
    expect(codes(r)).toContain("discount");
    const g = base();
    g.ItemList[0]!.GstRt = 9;
    expect(codes(g)).toContain("gst_rate");
  });

  it("reconciles invoice totals within ₹1 tolerance", () => {
    const p = base();
    p.ValDtls.TotInvVal = 3277.9; // 0.9 off: allowed
    expect(codes(p)).toEqual([]);
    p.ValDtls.TotInvVal = 3278.5;
    expect(codes(p)).toEqual(expect.arrayContaining(["invoice_value", "invoice_value_items"]));
    const q = base();
    q.ValDtls.AssVal = 3080;
    expect(codes(q)).toContain("total_assessable");
    const r = base();
    r.ValDtls.RndOffAmt = 120;
    expect(codes(r)).toContain("round_off");
    const s = base();
    s.ValDtls.IgstVal = 5;
    expect(codes(s)).toEqual(expect.arrayContaining(["total_igst", "igst_on_intra"]));
  });

  it("tolerance is configurable", () => {
    const p = base();
    p.ValDtls.TotInvVal = 3277.5;
    expect(codes(p, { toleranceRupees: 0.1 })).toContain("invoice_value");
  });

  it("enforces the 30-day window (configurable / off) and no future dates", () => {
    const p = base();
    p.DocDtls.Dt = "14/09/2026"; // 31 days before 15 Oct
    expect(codes(p)).toContain("doc_date_too_old");
    expect(codes(p, { maxAgeDays: 45 })).toEqual([]);
    expect(codes(p, { maxAgeDays: null })).toEqual([]);
    p.DocDtls.Dt = "15/09/2026"; // exactly 30 days
    expect(codes(p)).toEqual([]);
    p.DocDtls.Dt = "16/10/2026";
    expect(codes(p)).toContain("doc_date_future");
    p.DocDtls.Dt = "2026-10-14";
    expect(codes(p)).toContain("doc_date");
  });

  it("validates the document number", () => {
    const p = base();
    p.DocDtls.No = "INV/2026-27/000042";
    expect(codes(p)).toContain("doc_no_length");
    p.DocDtls.No = "0042";
    expect(codes(p)).toContain("doc_no_format");
    p.DocDtls.No = "INV 42";
    expect(codes(p)).toContain("doc_no_format");
    p.DocDtls.No = "";
    expect(codes(p)).toContain("doc_no_missing");
  });

  it("validates party fields", () => {
    const p = base();
    p.SellerDtls.Pin = 61300;
    p.SellerDtls.Loc = "Ab";
    p.SellerDtls.LglNm = "AB";
    p.SellerDtls.Addr1 = "";
    p.SellerDtls.Ph = "123";
    p.SellerDtls.Em = "bad";
    expect(codes(p)).toEqual(expect.arrayContaining(["pincode", "location", "legal_name", "address", "phone", "email"]));
  });

  it("only B2B is supported, other supply types are known but rejected", () => {
    const p = base();
    p.TranDtls.SupTyp = "EXPWP";
    expect(codes(p)).toEqual(["supply_type_unsupported"]);
    (p.TranDtls as { SupTyp: string }).SupTyp = "XYZ";
    expect(codes(p)).toEqual(["supply_type"]);
  });

  it("needs at least one line and unique serials", () => {
    const p = base();
    p.ItemList[1]!.SlNo = "1";
    expect(codes(p)).toContain("serial_duplicate");
    const q = base();
    q.ItemList = [];
    expect(codes(q)).toContain("no_items");
  });

  it("warns (not errors) on very short descriptions", () => {
    const p = base();
    p.ItemList[0]!.PrdDesc = "Tv";
    const r = ok(p);
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([expect.objectContaining({ code: "description_short", severity: "warning" })]);
  });
});

describe("validateSource / prepareEInvoice", () => {
  it("refuses drafts, cancelled bills and missing buyer GSTIN", () => {
    expect(validateSource(invoice({ status: "draft" })).map((i) => i.code)).toContain("draft");
    expect(validateSource(invoice({ status: "cancelled" })).map((i) => i.code)).toContain("cancelled");
    const b = invoice();
    expect(validateSource({ ...b, buyer: { ...b.buyer, gstin: null } }).map((i) => i.code)).toContain("buyer_gstin_missing");
  });

  it("detects an inter-state flag that contradicts the states", () => {
    const b = invoice();
    expect(validateSource({ ...b, interState: true }).map((i) => i.code)).toContain("inter_state_flag");
  });

  it("detects bill totals that do not match their lines", () => {
    const b = invoice();
    expect(validateSource({ ...b, totals: { ...b.totals, taxable: b.totals.taxable + 500 } }).map((i) => i.code)).toContain("totals_mismatch");
  });

  it("prepare = build + both validations", () => {
    const r = prepareEInvoice(invoice(), { today: TODAY });
    expect(r.ok).toBe(true);
    expect(r.payload).toEqual(INTRA_JSON);
    const bad = prepareEInvoice(invoice({ date: "2026-08-01" }), { today: TODAY });
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.code)).toContain("doc_date_too_old");
  });

  it("a missing pincode is reported (Pin 0)", () => {
    const b = invoice();
    const p = buildEInvoice({ ...b, buyer: { ...b.buyer, address: "7, Gandhi Road", city: "Kumbakonam", pincode: null } });
    expect(p.BuyerDtls.Pin).toBe(0);
    expect(codes(p)).toContain("pincode");
  });
});

describe("helpers", () => {
  it("splits addresses into Addr1/Addr2/Loc/Pin", () => {
    expect(splitAddress("No 5, Anna Salai, Chennai 600002", null, null)).toEqual({ addr1: "No 5, Anna Salai, Chennai", addr2: null, loc: "Chennai", pin: 600002 });
    expect(splitAddress("Plot 9\nSIDCO Estate", "Coimbatore", "641021")).toEqual({ addr1: "Plot 9, SIDCO Estate", addr2: null, loc: "Coimbatore", pin: 641021 });
    const long = `${"A".repeat(60)}, ${"B".repeat(60)}, ${"C".repeat(20)}`;
    const s = splitAddress(long, "Madurai", "625001");
    expect(s.addr1).toBe("A".repeat(60));
    expect(s.addr2).toBe(`${"B".repeat(60)}, ${"C".repeat(20)}`);
    expect(splitAddress(null, "Salem", null)).toEqual({ addr1: "Salem", addr2: null, loc: "Salem", pin: null });
  });

  it("normalises phone numbers", () => {
    expect(nicPhone("+91 98765 43210")).toBe("9876543210");
    expect(nicPhone("09876543210")).toBe("9876543210");
    expect(nicPhone("0431-2414141")).toBe("4312414141");
    expect(nicPhone("123")).toBeNull();
    expect(nicPhone(null)).toBeNull();
  });

  it("maps units to UQC", () => {
    expect(["pcs", "m", "kg", "l", "bag", "box", "Nos", "g", "ml", "dozen", "pair", "set", "sqft", "ltr", "MTR", "PCS", "xyz", ""].map(toUqc)).toEqual([
      "NOS", "MTR", "KGS", "LTR", "BAG", "BOX", "NOS", "GMS", "MLT", "DOZ", "PRS", "SET", "SQF", "LTR", "MTR", "NOS", "OTH", "OTH",
    ]);
  });

  it("fixture GSTINs are valid", () => {
    expect(gstin("33AABCS1234K1Z")).toBe(SELLER_GSTIN);
  });
});
