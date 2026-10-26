import { PassThrough, type Readable } from "node:stream";
import ExcelJS from "exceljs";

/** A cell value from exceljs as the text a user would type: dates → YYYY-MM-DD, formulas → result, rich text → plain. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    // exceljs gives date-only cells as UTC midnight.
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(15)));
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((r) => r.text).join("");
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as { result?: ExcelJS.CellValue }).result;
      return result === undefined || (typeof result === "object" && result !== null && "error" in result) ? "" : cellText(result);
    }
    if ("hyperlink" in value && "text" in value) {
      const t = (value as { text: unknown }).text;
      return typeof t === "string" ? t : cellText(t as ExcelJS.CellValue);
    }
    if ("error" in value) return "";
  }
  return String(value);
}

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxError";
  }
}

/** Reads the first worksheet into rows of strings (blank rows skipped; trailing empty cells trimmed). */
export async function readXlsx(data: Buffer | Uint8Array, opts: { maxRows?: number } = {}): Promise<string[][]> {
  return (await readXlsxLines(data, opts)).rows;
}

/** Like readXlsx, plus `lines`: the worksheet row number (as Excel shows it) of each returned row. */
export async function readXlsxLines(data: Buffer | Uint8Array, opts: { maxRows?: number } = {}): Promise<{ rows: string[][]; lines: number[] }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data as unknown as ExcelJS.Buffer);
  } catch {
    throw new XlsxError("This file is not a valid .xlsx workbook");
  }
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], lines: [] };
  const rows: string[][] = [];
  const lines: number[] = [];
  let tooMany = false;
  ws.eachRow({ includeEmpty: false }, (row) => {
    if (tooMany) return;
    const values: string[] = [];
    const count = row.cellCount;
    for (let c = 1; c <= count; c++) values.push(cellText(row.getCell(c).value).trim());
    while (values.length && values[values.length - 1] === "") values.pop();
    if (!values.length) return;
    rows.push(values);
    lines.push(row.number);
    if (opts.maxRows && rows.length > opts.maxRows) tooMany = true;
  });
  if (tooMany) throw new XlsxError(`Too many rows (limit ${(opts.maxRows ?? 1) - 1})`);
  return { rows, lines };
}

export interface SheetColumn {
  header: string;
  width?: number;
  /** Excel number format, e.g. "#,##0.00" or "@" (text). */
  numFmt?: string;
}

export type XlsxValue = string | number | boolean | Date | null | undefined;

/** Strings are always written as string cells (never formulas), so "=..." text can't execute in Excel. */
const safeValue = (v: XlsxValue): ExcelJS.CellValue => (v === undefined ? null : v);

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  row.alignment = { vertical: "middle" };
  row.height = 20;
}

export interface WorkbookInput {
  sheetName?: string;
  columns: SheetColumn[];
  rows: XlsxValue[][];
  /** Optional "Help" sheet rows (first row is the header). */
  help?: string[][];
}

/** Builds an .xlsx in memory: styled, frozen header row, optional Help sheet. */
export async function writeXlsx(input: WorkbookInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "srikit";
  const ws = wb.addWorksheet(input.sheetName ?? "Data", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = input.columns.map((c) => ({ header: c.header, width: c.width ?? Math.min(40, Math.max(12, c.header.length + 4)), style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  styleHeader(ws.getRow(1));
  for (const r of input.rows) ws.addRow(r.map(safeValue));
  if (input.help?.length) {
    const hs = wb.addWorksheet("Help");
    const [head, ...rest] = input.help;
    hs.columns = head!.map((h, i) => ({ header: h, width: i === 0 ? 24 : i === 2 ? 70 : 18 }));
    styleHeader(hs.getRow(1));
    for (const r of rest) hs.addRow(r).alignment = { wrapText: true, vertical: "top" };
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/** Streaming .xlsx writer for exports: returns the readable stream and an async `write`/`end` pair. */
export function xlsxStream(sheetName: string, columns: SheetColumn[]) {
  const stream = new PassThrough();
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
  const ws = wb.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, width: c.width ?? Math.min(40, Math.max(12, c.header.length + 4)), style: c.numFmt ? { numFmt: c.numFmt } : {} }));
  const header = ws.getRow(1);
  styleHeader(header);
  header.commit();
  return {
    stream: stream as Readable,
    write(values: XlsxValue[]) {
      ws.addRow(values.map(safeValue)).commit();
    },
    async end() {
      ws.commit();
      await wb.commit();
    },
  };
}
