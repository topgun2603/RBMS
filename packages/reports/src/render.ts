/** CSV and XLSX rendering of a report result (patterns copied from @rbms/importexport). */
import ExcelJS from "exceljs";
import type { PlanColumn, ReportRow } from "./types";

export const REPORT_FORMATS = ["csv", "xlsx"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export interface RenderInput {
  /** Sheet / file title, e.g. "Sales by month". */
  title: string;
  columns: PlanColumn[];
  rows: ReportRow[];
  totals?: ReportRow | null;
}

export interface RenderedFile {
  filename: string;
  contentType: string;
  content: Buffer;
}

export const CONTENT_TYPES: Record<ReportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Rupees with the ₹ sign; negatives in red with a minus. */
export const MONEY_FMT = '"₹"#,##0.00;[Red]-"₹"#,##0.00';
export const DATE_FMT = "dd-mm-yyyy";

const enumLabel = (col: PlanColumn, v: string | number | null) =>
  v === null ? null : (col.options?.find((o) => o.value === v)?.label ?? String(v));

// ------------------------------------------------------------------ CSV

/** `{ num }` is pre-formatted numeric text (money), written as-is. */
type CsvValue = string | number | { num: string } | null | undefined;

/** One CSV cell; text starting with = + - @ (or tab/CR) is prefixed with ' so spreadsheets never run it as a formula. */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return v.num;
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csvLine = (cells: readonly CsvValue[]) => `${cells.map(csvCell).join(",")}\r\n`;

function csvValue(col: PlanColumn, v: string | number | null): CsvValue {
  if (v === null) return null;
  if (col.type === "money") return { num: (Number(v) / 100).toFixed(2) };
  if (col.type === "enum") return enumLabel(col, v);
  return v;
}

/** RFC 4180 with CRLF and a UTF-8 BOM (so Excel shows ₹ and Tamil). Money as rupees with 2 decimals. */
export function reportCsv(input: RenderInput): string {
  const lines = [csvLine(input.columns.map((c) => c.label))];
  for (const r of input.rows) lines.push(csvLine(input.columns.map((c) => csvValue(c, r[c.key] ?? null))));
  const t = totalsCells(input, (c, v) => csvValue(c, v));
  if (t) lines.push(csvLine(t));
  return `﻿${lines.join("")}`;
}

/** The totals row: "Total" in the first column when it has no total of its own; blanks where nothing is summed. */
function totalsCells<T>(input: RenderInput, conv: (c: PlanColumn, v: string | number | null) => T): (T | string | null)[] | null {
  const t = input.totals;
  if (!t) return null;
  const cells: (T | string | null)[] = input.columns.map((c) => (c.key in t && t[c.key] !== undefined ? conv(c, t[c.key] ?? null) : null));
  if (!cells.some((c) => c !== null)) return null;
  if (cells[0] === null) cells[0] = "Total";
  return cells;
}

// ------------------------------------------------------------------ XLSX

/** Excel sheet names: max 31 characters, none of []:*?/\ . */
export const sheetName = (title: string) => title.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Report";

type XlsxValue = string | number | Date | null;

function xlsxValue(col: PlanColumn, v: string | number | null): XlsxValue {
  if (v === null) return null;
  if (col.type === "money") return Number(v) / 100;
  if (col.type === "number") return Number(v);
  if (col.type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${v}T00:00:00Z`) : String(v);
  if (col.type === "enum") return enumLabel(col, v);
  return String(v);
}

function numFmt(col: PlanColumn, rows: ReportRow[]): string | undefined {
  if (col.type === "money") return MONEY_FMT;
  if (col.type === "date") return DATE_FMT;
  if (col.type === "number") {
    const whole = rows.every((r) => r[col.key] === null || r[col.key] === undefined || Number.isInteger(Number(r[col.key])));
    return whole ? "#,##0" : "#,##0.00#";
  }
  return undefined;
}

function displayWidth(col: PlanColumn, v: XlsxValue): number {
  if (v === null) return 0;
  if (v instanceof Date) return 10;
  if (typeof v === "number") return (col.type === "money" ? v.toFixed(2) : String(v)).length + (col.type === "money" ? 5 : 2);
  return v.length;
}

/** A single-sheet workbook: styled frozen header, ₹ / number / date formats, fitted widths, bold totals row. */
export async function reportXlsx(input: RenderInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RBMS";
  const ws = wb.addWorksheet(sheetName(input.title), { views: [{ state: "frozen", ySplit: 1 }] });
  const data = input.rows.map((r) => input.columns.map((c) => xlsxValue(c, r[c.key] ?? null)));
  const totals = totalsCells(input, xlsxValue);

  ws.columns = input.columns.map((c, i) => {
    let w = c.label.length + 2;
    for (const row of data.slice(0, 2000)) w = Math.max(w, displayWidth(c, row[i] ?? null));
    const fmt = numFmt(c, input.rows);
    return { header: c.label, key: c.key, width: Math.min(50, Math.max(10, w + 2)), style: fmt ? { numFmt: fmt } : {} };
  });
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  header.alignment = { vertical: "middle" };
  header.height = 20;
  input.columns.forEach((c, i) => {
    if (c.type === "money" || c.type === "number") header.getCell(i + 1).alignment = { vertical: "middle", horizontal: "right" };
  });

  // Strings are always written as string cells (never formulas), so "=..." text can't execute in Excel.
  for (const r of data) ws.addRow(r);
  if (totals) {
    const row = ws.addRow(totals);
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.border = { top: { style: "thin" } };
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, input.columns.length) } };
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/** File-name safe slug: "Sales by month" → "sales-by-month". */
export const fileSlug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "report";

export async function renderReport(format: ReportFormat, input: RenderInput, stamp: string): Promise<RenderedFile> {
  const filename = `${fileSlug(input.title)}-${stamp}.${format}`;
  const content = format === "csv" ? Buffer.from(reportCsv(input), "utf8") : await reportXlsx(input);
  return { filename, contentType: CONTENT_TYPES[format], content };
}
