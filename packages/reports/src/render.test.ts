import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { csvCell, DATE_FMT, fileSlug, MONEY_FMT, renderReport, reportCsv, reportXlsx, sheetName, type RenderInput } from "./render";

const input: RenderInput = {
  title: "Sales: by month?",
  columns: [
    { key: "date", label: "Date", type: "date", column: "date" },
    { key: "customer", label: "Customer", type: "text", column: "customer" },
    { key: "status", label: "Status", type: "enum", column: "status", options: [{ value: "paid", label: "Paid" }] },
    { key: "qty", label: "Qty", type: "number", column: "qty", aggregatable: true },
    { key: "amount", label: "Amount", type: "money", column: "amount", aggregatable: true },
  ],
  rows: [
    { date: "2026-10-01", customer: "=HYPERLINK(\"x\")", status: "paid", qty: 2, amount: 123450 },
    { date: "2026-10-02", customer: "Raja, Sons", status: "other", qty: 1.5, amount: -500 },
    { date: null, customer: null, status: null, qty: null, amount: null },
  ],
  totals: { count: 3, qty: 3.5, amount: 122950 },
};

describe("csv", () => {
  it("BOM, labels, money in rupees, enum labels, formula-safe text, totals row", () => {
    const csv = reportCsv(input);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1).split("\r\n")).toEqual([
      "Date,Customer,Status,Qty,Amount",
      `2026-10-01,"'=HYPERLINK(""x"")",Paid,2,1234.50`,
      `2026-10-02,"Raja, Sons",other,1.5,-5.00`,
      ",,,,",
      "Total,,,3.5,1229.50",
      "",
    ]);
  });
  it("csvCell", () => {
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell(-1)).toBe("-1");
    expect(csvCell(" a")).toBe('" a"');
  });
  it("no totals row when nothing is summed", () => {
    expect(reportCsv({ ...input, totals: { count: 3 } }).slice(1).split("\r\n")).toHaveLength(5);
  });
});

describe("xlsx", () => {
  it("styled header, formats, values, widths and bold totals", async () => {
    const buf = await reportXlsx(input);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toBe("Sales  by month");
    const header = ws.getRow(1);
    expect(header.getCell(1).value).toBe("Date");
    expect(header.getCell(1).font?.bold).toBe(true);
    expect(header.getCell(1).fill).toMatchObject({ fgColor: { argb: "FF0F766E" } });
    const r2 = ws.getRow(2);
    expect(r2.getCell(1).value).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(r2.getCell(1).numFmt).toBe(DATE_FMT);
    expect(r2.getCell(2).value).toBe('=HYPERLINK("x")'); // a plain string, not a formula
    expect(r2.getCell(2).type).toBe(ExcelJS.ValueType.String);
    expect(r2.getCell(3).value).toBe("Paid");
    expect(r2.getCell(5).value).toBe(1234.5);
    expect(r2.getCell(5).numFmt).toBe(MONEY_FMT);
    expect(r2.getCell(4).numFmt).toBe("#,##0.00#"); // qty has a decimal value
    const total = ws.getRow(5);
    expect(total.getCell(1).value).toBe("Total");
    expect(total.getCell(5).value).toBe(1229.5);
    expect(total.getCell(5).font?.bold).toBe(true);
    for (let c = 1; c <= 5; c++) {
      const w = ws.getColumn(c).width!;
      expect(w).toBeGreaterThanOrEqual(10);
      expect(w).toBeLessThanOrEqual(50);
    }
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("integer number columns use #,##0", async () => {
    const buf = await reportXlsx({ ...input, rows: [{ qty: 2 }, { qty: 3 }], totals: null });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets[0]!.getRow(2).getCell(4).numFmt).toBe("#,##0");
  });
});

describe("files", () => {
  it("names and content types", async () => {
    expect(sheetName("a/b[c]")).toBe("a b c");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
    expect(fileSlug("Sales by Month — ₹")).toBe("sales-by-month");
    const f = await renderReport("csv", input, "2026-10-15");
    expect(f).toMatchObject({ filename: "sales-by-month-2026-10-15.csv", contentType: "text/csv; charset=utf-8" });
    const x = await renderReport("xlsx", input, "2026-10-15");
    expect(x.filename).toBe("sales-by-month-2026-10-15.xlsx");
    expect(x.content.subarray(0, 2).toString()).toBe("PK");
  });
});
