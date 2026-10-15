/** Tiny CSV writer for client-side downloads (error rows of an import). RFC 4180 quoting, BOM for Excel. */

export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Guard against formula injection when the file is opened in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(header: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/**
 * Error rows of an import as CSV: Row, Error, then the original cells when the preview still has them.
 * `headers` are the file's column headers.
 */
export function errorRowsCsv(
  errors: readonly { row: number; message: string }[],
  raw: ReadonlyMap<number, readonly string[]>,
  headers: readonly string[],
  labels: { row: string; error: string },
): string {
  const byRow = new Map<number, string[]>();
  for (const e of errors) byRow.set(e.row, [...(byRow.get(e.row) ?? []), e.message]);
  const rows = [...byRow.entries()]
    .sort(([a], [b]) => a - b)
    .map(([row, msgs]) => [row, msgs.join("; "), ...(raw.get(row) ?? headers.map(() => ""))]);
  return toCsv([labels.row, labels.error, ...headers], rows);
}

/** Saves a string as a file through a temporary object URL. */
export function saveText(text: string, fileName: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
