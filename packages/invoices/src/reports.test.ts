import { computeInvoice, gstinCheckChar, type LineInput } from "@srirealtime/gst";
import { describe, expect, it } from "vitest";
import {
  csvBuilders,
  csvDisposition,
  dateList,
  gstSection,
  gstSummary,
  rangeProblem,
  rupees,
  toCsv,
  trendRange,
  zeroFillTrend,
  type GstInvoice,
} from "./reports";

const TN_GSTIN = "33AAACR5055K1ZE";
const KA_GSTIN = `29AAACR5055K1Z${gstinCheckChar("29AAACR5055K1Z")}`;

function inv(id: string, opts: { gstin?: string | null; pos: string; lines: LineInput[]; name?: string }): GstInvoice {
  const t = computeInvoice(opts.lines, { sellerState: "33", placeOfSupply: opts.pos });
  return {
    id,
    number: `INV/26-27/${id}`,
    customerName: opts.name ?? "Buyer",
    customerGstin: opts.gstin ?? null,
    placeOfSupply: opts.pos,
    interState: opts.pos !== "33",
    total: t.total,
    lines: t.lines,
  };
}

describe("gstSection", () => {
  it("is B2B with a valid GSTIN, B2CL for big inter-state unregistered bills, else B2CS", () => {
    expect(gstSection({ customerGstin: TN_GSTIN, interState: false, total: 100 })).toBe("b2b");
    expect(gstSection({ customerGstin: KA_GSTIN, interState: true, total: 50_000_000 })).toBe("b2b");
    expect(gstSection({ customerGstin: null, interState: true, total: 100_000_01 })).toBe("b2cl");
    expect(gstSection({ customerGstin: null, interState: true, total: 100_000_00 })).toBe("b2cs");
    expect(gstSection({ customerGstin: null, interState: false, total: 500_000_00 })).toBe("b2cs");
    // A malformed GSTIN counts as unregistered.
    expect(gstSection({ customerGstin: "33AAACR5055K1Z8", interState: true, total: 200_000_00 })).toBe("b2cl");
  });
});

describe("gstSummary", () => {
  const saree: LineInput = { description: "Silk saree", hsn: "5007", qty: 2, unit: "pcs", rate: 500_000, gstRate: 5 };
  const blouse: LineInput = { description: "Blouse piece", hsn: "5007", qty: 1.5, unit: "m", rate: 20_000, gstRate: 5 };
  const rice: LineInput = { description: "Rice", hsn: "1006", qty: 10, unit: "kg", rate: 6_000, gstRate: 0 };
  const big: LineInput = { description: "Gold-zari saree", hsn: "5007", qty: 1, unit: "pcs", rate: 15_000_000, gstRate: 5 };

  const invoices = [
    inv("1", { gstin: TN_GSTIN, pos: "33", lines: [saree, rice], name: "Ravi Traders" }),
    inv("2", { gstin: TN_GSTIN.toLowerCase(), pos: "33", lines: [blouse], name: "Ravi Traders (branch)" }),
    inv("3", { gstin: KA_GSTIN, pos: "29", lines: [saree] }),
    inv("4", { pos: "29", lines: [big] }),
    inv("5", { pos: "29", lines: [blouse] }),
    inv("6", { pos: "33", lines: [saree, blouse, rice] }),
  ];
  const s = gstSummary(invoices);

  it("groups B2B by GSTIN", () => {
    expect(s.b2b.map((r) => [r.gstin, r.name, r.invoices])).toEqual([
      [KA_GSTIN, "Buyer", 1],
      [TN_GSTIN, "Ravi Traders", 2],
    ]);
    const tn = s.b2b.find((r) => r.gstin === TN_GSTIN)!;
    expect(tn.taxable).toBe(1_000_000 + 60_000 + 30_000);
    expect(tn.cgst).toBe(25_000 + 750);
    expect(tn.igst).toBe(0);
    expect(tn.total).toBe(invoices[0]!.total + invoices[1]!.total);
  });

  it("puts big inter-state unregistered bills in B2CL and the rest in B2CS by place of supply and rate", () => {
    expect(s.b2cl).toEqual([{ placeOfSupply: "29", rate: 5, taxable: 15_000_000, igst: 750_000 }]);
    expect(s.b2cs).toEqual([
      { placeOfSupply: "29", rate: 5, taxable: 30_000, cgst: 0, sgst: 0, igst: 1_500 },
      { placeOfSupply: "33", rate: 0, taxable: 60_000, cgst: 0, sgst: 0, igst: 0 },
      { placeOfSupply: "33", rate: 5, taxable: 1_030_000, cgst: 25_750, sgst: 25_750, igst: 0 },
    ]);
  });

  it("aggregates HSN by code, unit and rate", () => {
    expect(s.hsn.map((h) => [h.hsn, h.unit, h.rate, h.qty, h.taxable])).toEqual([
      ["1006", "kg", 0, 20, 120_000],
      ["5007", "m", 5, 4.5, 90_000],
      ["5007", "pcs", 5, 7, 18_000_000],
    ]);
    const m = s.hsn.find((h) => h.unit === "m")!;
    expect(m.description).toBe("Blouse piece");
    expect(m.total).toBe(m.taxable + m.cgst + m.sgst + m.igst);
  });

  it("has a rate breakup, GSTR-3B totals and grand totals that agree", () => {
    expect(s.byRate.map((r) => r.gstRate)).toEqual([0, 5]);
    const taxable = s.byRate.reduce((a, r) => a + r.taxable, 0);
    expect(s.totals.taxable).toBe(taxable);
    expect(s.gstr3b.nilRated).toBe(120_000);
    expect(s.gstr3b.outwardTaxable + s.gstr3b.nilRated).toBe(taxable);
    expect(s.gstr3b.igst).toBe(s.totals.igst);
    expect(s.gstr3b.cgst).toBe(s.gstr3b.sgst);
    expect(s.totals.invoices).toBe(6);
    expect(s.totals.total).toBe(invoices.reduce((a, i) => a + i.total, 0));
    // Every rupee of taxable value lands in exactly one of B2B / B2CL / B2CS.
    const sections =
      s.b2b.reduce((a, r) => a + r.taxable, 0) + s.b2cl.reduce((a, r) => a + r.taxable, 0) + s.b2cs.reduce((a, r) => a + r.taxable, 0);
    expect(sections).toBe(taxable);
  });

  it("handles an empty period", () => {
    expect(gstSummary([])).toMatchObject({ b2b: [], hsn: [], totals: { invoices: 0, total: 0 } });
  });
});

describe("trend", () => {
  it("lists dates inclusively", () => {
    expect(dateList("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(dateList("2026-03-02", "2026-03-01")).toEqual([]);
  });
  it("ends today in IST", () => {
    expect(trendRange("2026-10-14", 14)).toEqual({ from: "2026-10-01", to: "2026-10-14" });
    expect(trendRange("2026-10-14", 1)).toEqual({ from: "2026-10-14", to: "2026-10-14" });
  });
  it("zero-fills and merges collected rows", () => {
    const items = zeroFillTrend(
      "2026-10-12",
      "2026-10-14",
      [{ date: "2026-10-13", amount: 5000, count: 2 }],
      [
        { date: "2026-10-12", amount: 100 },
        { date: "2026-10-12", amount: 50 },
        { date: "2026-10-01", amount: 999 },
      ],
    );
    expect(items).toEqual([
      { date: "2026-10-12", invoiced: 0, collected: 150, count: 0 },
      { date: "2026-10-13", invoiced: 5000, collected: 0, count: 2 },
      { date: "2026-10-14", invoiced: 0, collected: 0, count: 0 },
    ]);
  });
});

describe("rangeProblem", () => {
  it("allows up to one year and a day", () => {
    expect(rangeProblem("2026-04-01", "2026-04-01")).toBeNull();
    expect(rangeProblem("2025-04-01", "2026-04-01")).toBeNull();
    expect(rangeProblem("2024-04-01", "2025-04-02")).toBeNull(); // leap year: 366 days
    expect(rangeProblem("2025-04-01", "2026-04-03")).toMatch(/one year/);
    expect(rangeProblem("2026-04-02", "2026-04-01")).toMatch(/on or after/);
  });
});

describe("CSV", () => {
  it("quotes, uses CRLF and starts with a BOM", () => {
    const csv = toCsv(["Name", "Note", "Amount"], [
      ["Ravi, Sons", 'He said "hi"', 12.5],
      ["Line\nbreak", null, 0],
      ["தமிழ்", "=SUM(A1)", -3],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Name,Note,Amount",
      '"Ravi, Sons","He said ""hi""",12.5',
      '"Line\nbreak",,0',
      "தமிழ்,'=SUM(A1),-3",
      "",
    ]);
  });
  it("formats rupees and file names", () => {
    expect(rupees(123456)).toBe("1234.56");
    expect(rupees(-5)).toBe("-0.05");
    expect(csvDisposition("sales-register", "2026-04-01", "2026-04-30")).toBe('attachment; filename="sales-register-2026-04-01-2026-04-30.csv"');
    expect(csvDisposition("ageing", "2026-10-14")).toBe('attachment; filename="ageing-2026-10-14.csv"');
  });
  it("builds report CSVs", () => {
    const csv = csvBuilders.payments([
      { date: "2026-10-01", number: "INV/26-27/0001", customer: "Ravi", method: "upi", amount: 150000, reference: "UTR9", source: "bill" },
    ]);
    expect(csv).toContain("Date,Invoice,Customer,Method,Amount,Reference,Source\r\n2026-10-01,INV/26-27/0001,Ravi,upi,1500.00,UTR9,bill\r\n");
    const s = gstSummary([inv("1", { pos: "33", lines: [{ description: "Rice", hsn: "1006", qty: 1, unit: "kg", rate: 100, gstRate: 0 }] })]);
    expect(csvBuilders.gst(s, "hsn")).toContain("1006,Rice,kg,0,1,1.00,0.00,0.00,0.00,1.00");
    expect(csvBuilders.gst(s, "b2b").split("\r\n")).toHaveLength(2);
  });
});
