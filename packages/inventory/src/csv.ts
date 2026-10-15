/** Minimal RFC 4180 CSV writer for report downloads (Excel-friendly: UTF-8 BOM, CRLF). */

export const CSV_BOM = "﻿";

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/** Text that Excel would treat as a formula gets a leading apostrophe (CSV injection guard). */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "string") s = FORMULA_START.test(value) ? `'${value}` : value;
  else s = String(value);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header row plus one line per row, CRLF-separated, prefixed with a UTF-8 BOM. */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvField(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvField(c.value(row))).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}

/** `attachment; filename="<name>-<from>-<to>.csv"` with unsafe characters removed. */
export function csvDisposition(name: string, from: string, to: string): string {
  const safe = `${name}-${from}-${to}`.replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${safe}.csv"`;
}
