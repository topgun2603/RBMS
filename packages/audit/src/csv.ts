/** Minimal RFC 4180 CSV writer (Excel-friendly: UTF-8 BOM, CRLF, formula-injection guard). */

export const CSV_BOM = "﻿";

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "string") s = FORMULA_START.test(value) ? `'${value}` : value;
  else if (typeof value === "object") s = JSON.stringify(value);
  else s = String(value);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvField(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvField(c.value(row))).join(","));
  return `${CSV_BOM}${lines.join("\r\n")}\r\n`;
}
