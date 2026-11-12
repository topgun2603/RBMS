import { describe, expect, it } from "vitest";
import { docRangeCount, effectiveStatus, fyLabel, fyOptions, fyStartYear, gstr1Params, addMonths, defaultMonth, isMonthKey, isQuarterKey, monthOfPeriod, monthOptions, monthRange, monthsOfPeriod, parseQuarter, quarterOfMonth, quarterOfPeriod, quarterOptions, schemeOf, taxTotal } from "./gst";
import { gstFromInclusive, itcFor } from "./expenses";
import { sideAmount } from "./accounting";
import { projectBalances } from "./ai-money";
import { permissionMatches } from "./access";

describe("GST period keys", () => {
  it("accepts only real months and quarters", () => {
    expect(isMonthKey("2026-04")).toBe(true);
    expect(isMonthKey("2026-13")).toBe(false);
    expect(isMonthKey("2026-00")).toBe(false);
    expect(isMonthKey("2026-4")).toBe(false);
    expect(isMonthKey(null)).toBe(false);
    expect(isQuarterKey("2027-Q4")).toBe(true);
    expect(isQuarterKey("2027-Q5")).toBe(false);
    expect(isQuarterKey("2027-q1")).toBe(false);
  });

  it("moves months across year ends in both directions", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-03", -15)).toBe("2024-12");
    expect(addMonths("2026-05", 0)).toBe("2026-05");
  });

  it("gives the first and last day of a month, leap years included", () => {
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });

  it("finds the financial year, which starts in April", () => {
    expect(fyStartYear("2026-04-01")).toBe(2026);
    expect(fyStartYear("2027-03-31")).toBe(2026);
    expect(fyLabel(2026)).toBe("2026-27");
    expect(fyLabel(2099)).toBe("2099-00");
    expect(fyOptions("2027-02-01", 3)).toEqual([2026, 2025, 2024]);
  });

  it("numbers quarters from April and names Jan to Mar by the calendar year it ends in", () => {
    expect(quarterOfMonth("2026-04")).toEqual({ key: "2026-Q1", fy: 2026, q: 1, months: ["2026-04", "2026-05", "2026-06"], from: "2026-04-01", to: "2026-06-30" });
    expect(quarterOfMonth("2026-12").key).toBe("2026-Q3");
    const q4 = quarterOfMonth("2027-01");
    expect(q4).toMatchObject({ key: "2027-Q4", fy: 2026, q: 4, months: ["2027-01", "2027-02", "2027-03"], from: "2027-01-01", to: "2027-03-31" });
    expect(parseQuarter("2027-Q4")).toEqual(q4);
    expect(parseQuarter("2026-Q2")?.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(parseQuarter("2026-Q5")).toBeNull();
    expect(parseQuarter("2026-06")).toBeNull();
  });

  it("maps a period to the month, quarter or months the tabs need", () => {
    expect(monthOfPeriod("2027-Q4")).toBe("2027-03");
    expect(monthOfPeriod("2026-11")).toBe("2026-11");
    expect(quarterOfPeriod("2026-11")).toBe("2026-Q3");
    expect(quarterOfPeriod("2026-Q1")).toBe("2026-Q1");
    expect(monthsOfPeriod("2026-Q3")).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(monthsOfPeriod("2026-11")).toEqual(["2026-11"]);
  });

  it("offers last month first for returns, and newest-first pickers", () => {
    expect(defaultMonth("2026-01-15")).toBe("2025-12");
    expect(defaultMonth("2026-11-05")).toBe("2026-10");
    expect(monthOptions("2026-11-05", 3)).toEqual(["2026-11", "2026-10", "2026-09"]);
    expect(quarterOptions("2026-11-05", 3)).toEqual(["2026-Q3", "2026-Q2", "2026-Q1"]);
    expect(quarterOptions("2027-01-05", 2)).toEqual(["2027-Q4", "2026-Q3"]);
  });

  it("builds the GSTR-1 query: MMYYYY for a month, the key for a quarter", () => {
    expect(gstr1Params("2026-10")).toEqual({ period: "102026" });
    expect(gstr1Params("2027-Q4")).toEqual({ quarter: "2027-Q4" });
  });
});

describe("GST small helpers", () => {
  it("adds up all four taxes", () => {
    expect(taxTotal({ igst: 100, cgst: 50, sgst: 50, cess: 7 })).toBe(207);
  });

  it("names the scheme, composition beating QRMP", () => {
    expect(schemeOf({ composition: true, qrmp: true })).toBe("composition");
    expect(schemeOf({ composition: false, qrmp: true })).toBe("qrmp");
    expect(schemeOf({ composition: false, qrmp: false })).toBe("regular");
    expect(schemeOf(undefined)).toBe("regular");
  });

  it("lets the owner's accept or ignore decision override the 2B match status", () => {
    expect(effectiveStatus({ status: "missing_in_books", action: "accept" })).toBe("accepted");
    expect(effectiveStatus({ status: "matched", action: "ignore" })).toBe("ignored");
    expect(effectiveStatus({ status: "fuzzy", action: null })).toBe("fuzzy");
  });

  it("counts document ranges in Table 13", () => {
    expect(docRangeCount({ doc_issue: { doc_det: [{ docs: [1, 2] }, { docs: [3] }, {}] } })).toBe(3);
    expect(docRangeCount({})).toBe(0);
  });
});

describe("expense GST and ITC", () => {
  it("takes the GST out of a GST-inclusive amount to the paisa", () => {
    expect(gstFromInclusive(11_800, 18)).toBe(1800);
    // 10000 x 5 / 105 = 476.19
    expect(gstFromInclusive(10_000, 5)).toBe(476);
    expect(gstFromInclusive(0, 18)).toBe(0);
    expect(gstFromInclusive(11_800, 0)).toBe(0);
    expect(gstFromInclusive(11_800, -5)).toBe(0);
  });

  it("claims input credit only with a valid vendor GSTIN", () => {
    expect(itcFor(1800, "33AAACR5055K1ZE")).toBe(1800);
    // Wrong check character.
    expect(itcFor(1800, "33AAACR5055K1Z8")).toBe(0);
    expect(itcFor(1800, "")).toBe(0);
    expect(itcFor(1800, null)).toBe(0);
  });
});

describe("ledger and cash-flow sums", () => {
  it("shows a debit-positive net as Dr, a negative one as Cr and zero as neither", () => {
    expect(sideAmount(5000)).toEqual({ amount: 5000, side: "dr" });
    expect(sideAmount(-5000)).toEqual({ amount: 5000, side: "cr" });
    expect(sideAmount(0)).toEqual({ amount: 0, side: "" });
  });

  it("projects the cash balance day by day with the sales and collection sliders", () => {
    const f = {
      startBalance: 100_000,
      days: [
        { date: "d1", salesIn: 50_000, collectionsIn: 20_000, supplierOut: 30_000, recurringOut: 5_000, poOut: 0 },
        { date: "d2", salesIn: 10_000, collectionsIn: 0, supplierOut: 0, recurringOut: 0, poOut: 40_000 },
      ],
    };
    // No change: 100000 + 50000 + 20000 - 30000 - 5000 = 135000; then + 10000 - 40000 = 105000.
    expect(projectBalances(f as never, { salesPct: 0, collectionPct: 100 })).toEqual([135_000, 105_000]);
    // Sales -20%, collections 50%: 100000 + 40000 + 10000 - 35000 = 115000; then + 8000 - 40000 = 83000.
    expect(projectBalances(f as never, { salesPct: -20, collectionPct: 50 })).toEqual([115_000, 83_000]);
  });
});

describe("permission patterns", () => {
  it("matches the star, exact keys, module wildcards and action wildcards", () => {
    expect(permissionMatches("*", "invoices.create")).toBe(true);
    expect(permissionMatches("invoices.create", "invoices.create")).toBe(true);
    expect(permissionMatches("invoices.create", "invoices.delete")).toBe(false);
    expect(permissionMatches("invoices.*", "invoices.create")).toBe(true);
    expect(permissionMatches("invoices.*", "expenses.create")).toBe(false);
    expect(permissionMatches("*.view", "reports.view")).toBe(true);
    expect(permissionMatches("*.view", "reports.edit")).toBe(false);
    // A longer or shorter key is not the same permission.
    expect(permissionMatches("reports.view", "reports.view.all")).toBe(false);
    expect(permissionMatches("reports.*.all", "reports.view")).toBe(false);
  });
});
