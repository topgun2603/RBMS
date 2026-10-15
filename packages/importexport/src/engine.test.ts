import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { col } from "./columns";
import { autoMap, normalizeHeader, parseRows, resolveMapping } from "./engine";
import { customerColumns, productColumns, stockColumns, validateParty, validateProductRow, validateStockRow, toProductRow } from "./specs";
import { cellText, readXlsx, writeXlsx } from "./xlsx";

describe("mapping", () => {
  it("normalises headers", () => {
    expect(normalizeHeader(" Opening Stock ")).toBe("openingstock");
    expect(normalizeHeader("opening_stock")).toBe("openingstock");
    expect(normalizeHeader("Price (₹)")).toBe("price");
    expect(normalizeHeader("GST %")).toBe("gst");
    expect(normalizeHeader("பெயர்")).toBe("பெயர்");
  });

  it("maps by key, label or alias, case/space-insensitively; unknown headers are ignored", () => {
    const headers = ["PRODUCT NAME", "selling price", "GST Rate", "tax_inclusive", "Colour", "opening-stock"];
    const { mapping, detected } = autoMap(headers, productColumns);
    expect(mapping.name).toBe(0);
    expect(mapping.price).toBe(1);
    expect(mapping.gst).toBe(2);
    expect(mapping.tax_inclusive).toBe(3);
    expect(mapping.opening_stock).toBe(5);
    expect(mapping.sku).toBeNull();
    expect(detected[4]).toEqual({ index: 4, header: "Colour", mappedTo: null });
    expect(detected[0]!.mappedTo).toBe("name");
  });

  it("never maps one header to two columns", () => {
    const cols = [col.text("a", "Qty"), col.text("b", "Quantity", { aliases: ["qty"] })];
    expect(autoMap(["qty"], cols).mapping).toEqual({ a: 0, b: null });
  });

  it("applies user overrides by header text or index, and validates them", () => {
    const headers = ["Item", "Amount"];
    const base = autoMap(headers, productColumns).mapping;
    const m = resolveMapping(headers, productColumns, { price: "amount", sku: null }, base);
    expect(m.price).toBe(1);
    expect(m.sku).toBeNull();
    expect(resolveMapping(headers, productColumns, { price: 1 }, base).price).toBe(1);
    expect(() => resolveMapping(headers, productColumns, { nope: 0 }, base)).toThrow(/Unknown column "nope"/);
    expect(() => resolveMapping(headers, productColumns, { price: "Cost" }, base)).toThrow(/no column "Cost"/);
    expect(() => resolveMapping(headers, productColumns, { price: 7 }, base)).toThrow(/missing file column/);
  });
});

describe("row parsing and validation messages", () => {
  const headers = ["Name", "Price", "GST %", "MRP", "Tax inclusive", "Opening stock", "HSN"];
  const { mapping } = autoMap(headers, productColumns);

  it("parses typed values with defaults", () => {
    const [r] = parseRows([["Silk Saree", "1,234.50", "5%", "1,499", "yes", "2.5", "5007"]], productColumns, mapping, validateProductRow);
    expect(r!.errors).toEqual([]);
    expect(r!.row).toBe(2);
    expect(r!.data).toMatchObject({ name: "Silk Saree", price: 123450, gst: 5, mrp: 149900, tax_inclusive: true, opening_stock: 2.5, hsn: "5007", unit: "pcs", status: "active" });
    expect(toProductRow(r!.data)).toMatchObject({ taxInclusive: true, openingStock: 2.5, unit: "pcs" });
  });

  it("collects one clear message per bad cell, with labels and row numbers", () => {
    const rows = parseRows(
      [
        ["", "abc", "15", "", "maybe", "1.23456", "12"],
        ["Ok", "100", "18", "50", "no", "", ""],
      ],
      productColumns,
      mapping,
      validateProductRow,
    );
    expect(rows[0]!.row).toBe(2);
    expect(rows[0]!.errors).toEqual([
      "Name is required",
      "HSN: HSN/SAC must be 4, 6 or 8 digits",
      "GST %: 15% is not a GST rate (use 0, 0.25, 3, 5, 12, 18 or 28)",
      'Price: "abc" is not an amount',
      'Tax inclusive: "maybe" should be yes or no',
      'Opening stock: "1.23456" has more than 3 decimal places',
    ]);
    expect(rows[1]!.row).toBe(3);
    expect(rows[1]!.errors).toEqual(["MRP can't be less than the price"]);
  });

  it("customers: phone, state names and GSTIN/state consistency", () => {
    const h = ["Customer Name", "Mobile", "State", "GSTIN", "Opening balance"];
    const m = autoMap(h, customerColumns).mapping;
    const rows = parseRows(
      [
        ["Murugan", "98765 43210", "Tamil Nadu", "33AAACR5055K1ZE", "-1,500"],
        ["Kumar", "", "", "33AAACR5055K1ZE", ""],
        ["Ravi", "12", "Kerala", "33AAACR5055K1ZE", ""],
      ],
      customerColumns,
      m,
      validateParty,
    );
    expect(rows[0]!.data).toMatchObject({ phone: "+919876543210", state: "33", gstin: "33AAACR5055K1ZE", opening_balance: -150000 });
    expect(rows[1]!.data.state).toBe("33");
    expect(rows[2]!.errors).toEqual(['Phone: "12" is not a valid 10-digit mobile number']);
    const [mismatch] = parseRows([["Ravi", "", "Kerala", "33AAACR5055K1ZE", ""]], customerColumns, m, validateParty);
    expect(mismatch!.errors).toEqual(["GSTIN is from state 33 (Tamil Nadu) but State is 32 (Kerala)"]);
  });

  it("stock rows need a SKU or barcode", () => {
    const m = autoMap(["SKU", "Barcode", "Qty"], stockColumns).mapping;
    const rows = parseRows([["", "", "5"], ["A1", "", "2.5"]], stockColumns, m, validateStockRow);
    expect(rows[0]!.errors).toEqual(["Give a SKU or a barcode"]);
    expect(rows[1]!.data).toMatchObject({ sku: "A1", qty: 2.5, mode: "set" });
  });
});

describe("xlsx", () => {
  it("round-trips in memory: header style, Help sheet, Tamil, numbers and dates", async () => {
    const buf = await writeXlsx({
      sheetName: "Products",
      columns: [{ header: "Name" }, { header: "Price" }, { header: "Date" }, { header: "Phone" }],
      rows: [
        ["பட்டு சேலை", 1234.5, new Date("2026-10-15T00:00:00Z"), "9876543210"],
        ["=HYPERLINK(\"x\")", 10, null, 9876543210],
      ],
      help: [
        ["Column", "Required"],
        ["Name", "Yes"],
      ],
    });
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    const rows = await readXlsx(buf);
    expect(rows).toEqual([
      ["Name", "Price", "Date", "Phone"],
      ["பட்டு சேலை", "1234.5", "2026-10-15", "9876543210"],
      ['=HYPERLINK("x")', "10", "", "9876543210"],
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Products", "Help"]);
    expect(wb.worksheets[0]!.getRow(1).font?.bold).toBe(true);
    // Text that looks like a formula stays a string cell, not a formula.
    expect(typeof wb.worksheets[0]!.getCell("A3").value).toBe("string");
  });

  it("reads formulas, rich text and hyperlinks as text, and only the first sheet", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("One");
    ws.addRow(["A", "B", "C"]);
    ws.addRow([{ formula: "1+1", result: 2 }, { richText: [{ text: "Ri" }, { text: "ch" }] }, { text: "link", hyperlink: "https://x" }]);
    wb.addWorksheet("Two").addRow(["ignored"]);
    const rows = await readXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(rows).toEqual([["A", "B", "C"], ["2", "Rich", "link"]]);
    expect(cellText(0.1 + 0.2)).toBe("0.3");
  });

  it("enforces the row limit and rejects non-xlsx data", async () => {
    const buf = await writeXlsx({ columns: [{ header: "N" }], rows: Array.from({ length: 30 }, (_, i) => [i]) });
    await expect(readXlsx(buf, { maxRows: 11 })).rejects.toThrow(/Too many rows/);
    await expect(readXlsx(Buffer.from("not a zip"))).rejects.toThrow(/not a valid .xlsx/);
  });
});
