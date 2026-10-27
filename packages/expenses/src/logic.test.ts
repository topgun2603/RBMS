import { gstinCheckChar } from "@srirealtime/gst";
import { describe, expect, it } from "vitest";
import { expensesCsv } from "./csv";
import { gstFromInclusive, itcOf, profitReport, resolveGst, summarize, ZERO_GST } from "./logic";
import { expenseBalance, expenseInput, groupExpenses, reportRange, type ExpenseView } from "./service";

const FIRST14 = "33ABCDE1234F1Z";
const GSTIN = FIRST14 + gstinCheckChar(FIRST14);
const BAD_GSTIN = FIRST14 + (GSTIN.endsWith("0") ? "1" : "0");

describe("GST math", () => {
  it("extracts GST from a GST-inclusive amount", () => {
    expect(gstFromInclusive(11800, 18)).toBe(1800); // ₹118 at 18% → ₹18
    expect(gstFromInclusive(10500, 5)).toBe(500);
    expect(gstFromInclusive(100000, 12)).toBe(10714); // 10714.28 → 10714
    expect(gstFromInclusive(999, 28)).toBe(219); // 218.53 → 219
    expect(gstFromInclusive(10000, 0)).toBe(0);
    expect(gstFromInclusive(10025, 0.25)).toBe(25);
  });

  it("uses a given GST amount instead of computing it", () => {
    expect(resolveGst(11800, 18)).toBe(1800);
    expect(resolveGst(11800, 18, 1700)).toBe(1700);
    expect(resolveGst(11800, 18, 0)).toBe(0);
    expect(resolveGst(11800, 18, null)).toBe(1800);
  });

  it("validates input: GST rates, GSTIN normalised, defaults", () => {
    const parsed = expenseInput.parse({ amount: 11800, gstRate: 18, vendorGstin: ` ${GSTIN.toLowerCase()} `, vendorName: "" });
    expect(parsed).toMatchObject({ gstRate: 18, vendorGstin: GSTIN, vendorName: null, paymentMethod: "cash" });
    expect(expenseInput.safeParse({ amount: 100, gstRate: 7 }).success).toBe(false);
    expect(expenseInput.safeParse({ amount: 0 }).success).toBe(false);
    expect(expenseInput.safeParse({ amount: 10.5 }).success).toBe(false);
    expect(expenseInput.safeParse({ amount: 100, date: "2026-02-30" }).success).toBe(false);
    expect(expenseInput.safeParse({ amount: 100, tenantId: "x" }).success).toBe(false);
  });
});

describe("ITC rule", () => {
  it("counts GST only with a valid vendor GSTIN on a recorded expense", () => {
    expect(itcOf({ gstAmount: 1800, vendorGstin: GSTIN })).toBe(1800);
    expect(itcOf({ gstAmount: 1800, vendorGstin: GSTIN.toLowerCase() })).toBe(1800);
    expect(itcOf({ gstAmount: 1800, vendorGstin: BAD_GSTIN })).toBe(0);
    expect(itcOf({ gstAmount: 1800, vendorGstin: "33ABCDE" })).toBe(0);
    expect(itcOf({ gstAmount: 1800, vendorGstin: null })).toBe(0);
    expect(itcOf({ gstAmount: 1800, vendorGstin: GSTIN, status: "cancelled" })).toBe(0);
  });
});

describe("summary grouping", () => {
  const cats = [
    { id: "rent", name: "Rent" },
    { id: "power", name: "Electricity" },
  ];
  const rows = [
    { date: "2026-09-05", categoryId: "rent", amount: 2_000_000, gstAmount: 305_085, vendorGstin: GSTIN, status: "recorded" },
    { date: "2026-10-05", categoryId: "rent", amount: 2_000_000, gstAmount: 305_085, vendorGstin: null, status: "recorded" },
    { date: "2026-10-10", categoryId: "power", amount: 350_000, gstAmount: 0, vendorGstin: null, status: "recorded" },
    { date: "2026-10-11", categoryId: "power", amount: 999_999, gstAmount: 0, vendorGstin: null, status: "cancelled" },
    { date: "2026-10-12", categoryId: "gone", amount: 10_000, gstAmount: 0, vendorGstin: null, status: "recorded" },
  ];

  it("groups by category (largest first) and month (oldest first), skipping cancelled", () => {
    const s = summarize(rows, cats);
    expect(s).toMatchObject({ total: 4_360_000, gst: 610_170, itc: 305_085, count: 4 });
    expect(s.byCategory).toEqual([
      { categoryId: "rent", name: "Rent", total: 4_000_000, gst: 610_170, itc: 305_085, count: 2 },
      { categoryId: "power", name: "Electricity", total: 350_000, gst: 0, itc: 0, count: 1 },
      { categoryId: "gone", name: "Other", total: 10_000, gst: 0, itc: 0, count: 1 },
    ]);
    expect(s.byMonth).toEqual([
      { month: "2026-09", total: 2_000_000, gst: 305_085, itc: 305_085, count: 1 },
      { month: "2026-10", total: 2_360_000, gst: 305_085, itc: 0, count: 3 },
    ]);
  });

  it("is zero for no rows", () => {
    expect(summarize([], cats)).toEqual({ total: 0, gst: 0, itc: 0, count: 0, byCategory: [], byMonth: [] });
  });
});

describe("profit report", () => {
  it("computes gross, net and GST payable", () => {
    const r = profitReport(
      "2026-10-01",
      "2026-10-31",
      { taxable: 10_00_000_00, cgst: 9_00_000_0, sgst: 9_00_000_0, igst: 2_00_000_0 },
      { taxable: 6_00_000_00, cgst: 5_00_000_0, sgst: 5_00_000_0, igst: 0 },
      { total: 50_000_00, itc: 5_000_00 },
    );
    expect(r.sales).toEqual({ taxable: 100_000_000, tax: 20_000_000 });
    expect(r.purchases).toEqual({ taxable: 60_000_000, itc: 10_000_000 });
    expect(r.grossProfit).toBe(40_000_000);
    expect(r.netProfit).toBe(40_000_000 - (5_000_000 - 500_000));
    expect(r.gst).toEqual({ output: 20_000_000, itc: 10_500_000, payable: 9_500_000 });
  });

  it("goes negative when ITC exceeds output tax, and handles zero ports", () => {
    const r = profitReport("2026-10-01", "2026-10-31", ZERO_GST, { taxable: 1000, cgst: 90, sgst: 90, igst: 0 }, { total: 0, itc: 0 });
    expect(r).toMatchObject({ grossProfit: -1000, netProfit: -1000, gst: { output: 0, itc: 180, payable: -180 } });
  });
});

describe("report range and CSV", () => {
  it("defaults to this month and validates", () => {
    expect(reportRange({}, "2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-10-15" });
    expect(() => reportRange({ from: "2026-10-10", to: "2026-10-01" }, "2026-10-15")).toThrow();
    expect(() => reportRange({ from: "2024-01-01", to: "2026-01-01" }, "2026-10-15")).toThrow();
    expect(() => reportRange({ from: "bad" }, "2026-10-15")).toThrow();
  });

  it("writes rupees and guards formulas", () => {
    const csv = expensesCsv([
      {
        date: "2026-10-05",
        categoryName: "Rent",
        vendorName: "=HYPERLINK()",
        vendorGstin: GSTIN,
        amount: 11800,
        gstRate: 18,
        gstAmount: 1800,
        itc: 1800,
        paymentMethod: "upi",
        reference: null,
        note: "Oct, shop",
        status: "recorded",
      } as unknown as ExpenseView,
    ]);
    const line = csv.split("\r\n")[1];
    expect(line).toBe(`2026-10-05,Rent,'=HYPERLINK(),${GSTIN},118.00,18,18.00,18.00,upi,,"Oct, shop",recorded,Shop-wide,,,`);
  });

  it("shows the branch name and, for credit expenses, paid and balance", () => {
    const csv = expensesCsv(
      [
        {
          date: "2026-10-05",
          categoryName: "Electricity",
          vendorName: "TNEB",
          vendorGstin: null,
          amount: 50000,
          gstRate: 0,
          gstAmount: 0,
          itc: 0,
          paymentMethod: "credit",
          reference: "EB-77",
          note: null,
          status: "recorded",
          branchId: "b1",
          dueDate: "2026-10-20",
          amountPaid: 20000,
          balance: 30000,
        } as unknown as ExpenseView,
      ],
      (id) => (id === "b1" ? "Anna Nagar" : "Shop-wide"),
    );
    expect(csv.split("\r\n")[1]).toBe("2026-10-05,Electricity,TNEB,,500.00,0,0.00,0.00,credit,EB-77,,recorded,Anna Nagar,2026-10-20,200.00,300.00");
  });
});

describe("expense report groups", () => {
  const row = (over: Record<string, unknown>) =>
    ({ date: "2026-10-05", categoryId: "rent", supplierId: null, vendorName: null, vendorGstin: null, branchId: null, amount: 10_000, gstAmount: 0, status: "recorded", paymentMethod: "cash", amountPaid: 0, ...over }) as Parameters<typeof groupExpenses>[0][number];
  const names = { categories: [{ id: "rent", name: "Rent" }, { id: "eb", name: "Electricity" }], branches: [{ id: "b1", name: "Anna Nagar" }] };
  const rows = [
    row({ branchId: "b1", amount: 118_000, gstAmount: 18_000, vendorGstin: GSTIN, supplierId: "s1", vendorName: "Kumar Estates", paymentMethod: "credit", amountPaid: 18_000 }),
    row({ categoryId: "eb", amount: 50_000, vendorName: "TNEB", date: "2026-09-28" }),
    row({ categoryId: "eb", amount: 9_999, status: "draft" }),
    row({ amount: 5_000, status: "cancelled" }),
  ];

  it("by branch: each branch and the shop-wide row; net is after ITC; unpaid only from credit expenses", () => {
    const g = groupExpenses(rows, "branch", names);
    expect(g.rows.map((r) => [r.key, r.label, r.count, r.total, r.itc, r.net, r.unpaid])).toEqual([
      ["b1", "Anna Nagar", 1, 118_000, 18_000, 100_000, 100_000],
      ["", "", 1, 50_000, 0, 50_000, 0],
    ]);
    expect(g.totals).toEqual({ count: 2, total: 168_000, gst: 18_000, itc: 18_000, net: 150_000, unpaid: 100_000 });
  });

  it("by category, supplier (typed-in vendors by name) and month (oldest first)", () => {
    expect(groupExpenses(rows, "category", names).rows.map((r) => [r.label, r.total])).toEqual([["Rent", 118_000], ["Electricity", 50_000]]);
    expect(groupExpenses(rows, "supplier", names).rows.map((r) => [r.key, r.label])).toEqual([["s1", "Kumar Estates"], ["name:tneb", "TNEB"]]);
    expect(groupExpenses(rows, "month", names).rows.map((r) => r.key)).toEqual(["2026-09", "2026-10"]);
  });

  it("only recorded credit expenses owe a balance", () => {
    expect(expenseBalance({ status: "recorded", paymentMethod: "credit", amount: 100, amountPaid: 40 })).toBe(60);
    expect(expenseBalance({ status: "recorded", paymentMethod: "cash", amount: 100, amountPaid: 0 })).toBe(0);
    expect(expenseBalance({ status: "draft", paymentMethod: "credit", amount: 100, amountPaid: 0 })).toBe(0);
  });
});
