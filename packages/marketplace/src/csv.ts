/** Minimal RFC 4180 CSV with a UTF-8 BOM (Excel opens Tamil names correctly). Formula-looking cells are prefixed with '. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** Paise → "1234.50". */
export const rupees = (paise: number) => (paise / 100).toFixed(2);

export const csvDisposition = (name: string) => `attachment; filename="${name}.csv"`;
