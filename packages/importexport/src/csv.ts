/** RFC 4180 CSV: parsing (BOM, CRLF/LF/CR, quoted fields with commas, quotes and newlines) and safe writing. */

export class CsvError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "CsvError";
  }
}

export const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/** Picks "," or ";" or tab from the first line (Excel in some locales saves ";"). */
export function detectDelimiter(text: string): "," | ";" | "\t" {
  let firstLine = "";
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    firstLine += inQuotes ? "" : ch;
  }
  const count = (c: string) => firstLine.split(c).length - 1;
  const comma = count(",");
  const semi = count(";");
  const tab = count("\t");
  if (tab > comma && tab > semi) return "\t";
  if (semi > comma) return ";";
  return ",";
}

export interface ParseCsvOptions {
  delimiter?: "," | ";" | "\t" | "auto";
  /** Stop with an error after this many records (header included). */
  maxRows?: number;
}

/**
 * Parses CSV text into rows of strings. Fully blank lines are skipped. Unquoted fields are kept as-is
 * (callers trim). Throws CsvError for an unterminated quoted field or too many rows.
 */
export function parseCsv(input: string, opts: ParseCsvOptions = {}): string[][] {
  const text = stripBom(input);
  const d = !opts.delimiter || opts.delimiter === "auto" ? detectDelimiter(text) : opts.delimiter;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let line = 1;
  let quoted = false;
  let fieldStartLine = 1;
  const n = text.length;

  const endRow = () => {
    row.push(field);
    field = "";
    if (!(row.length === 1 && row[0] === "")) {
      rows.push(row);
      if (opts.maxRows && rows.length > opts.maxRows) throw new CsvError(`Too many rows (limit ${opts.maxRows - 1})`, line);
    }
    row = [];
  };

  while (i < n) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      // Opening quote (leading spaces before it are dropped).
      quoted = true;
      field = "";
      fieldStartLine = line;
      i++;
      continue;
    }
    if (ch === d) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRow();
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      line++;
      continue;
    }
    field += ch;
    i++;
  }
  if (quoted) throw new CsvError(`Unclosed quote starting on line ${fieldStartLine}`, fieldStartLine);
  if (field !== "" || row.length) endRow();
  return rows;
}

// ------------------------------------------------------------------ writing

export type CsvValue = string | number | boolean | null | undefined | Date;

/** One CSV cell; text starting with = + - @ (or tab/CR) is prefixed with ' so spreadsheets never run it as a formula. */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",;\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: readonly CsvValue[]) => `${cells.map(csvCell).join(",")}\r\n`;

/** RFC 4180 with CRLF line ends and a UTF-8 BOM (so Excel shows ₹ and Tamil correctly). */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return `﻿${[headers, ...rows].map(csvLine).join("")}`;
}
