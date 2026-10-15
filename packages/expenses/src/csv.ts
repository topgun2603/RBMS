import type { ExpenseView } from "./service";

export type CsvValue = string | number | boolean | null | undefined;

/** Paise → "1234.50" for spreadsheets. */
export const rupees = (paise: number | null | undefined) => ((paise ?? 0) / 100).toFixed(2);

const csvCell = (v: CsvValue): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Spreadsheet formula injection: text starting with = + - @ is shown as text.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a UTF-8 BOM (Excel) and CRLF line ends. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** `attachment; filename="expenses-2026-10-01-2026-10-31.csv"` (name sanitised). */
export function csvDisposition(name: string, from?: string | null, to?: string | null): string {
  const parts = [name, from, to].filter(Boolean).join("-").replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${parts}.csv"`;
}

export function expensesCsv(items: readonly ExpenseView[]): string {
  return toCsv(
    ["Date", "Category", "Vendor", "Vendor GSTIN", "Amount", "GST rate", "GST", "ITC", "Payment method", "Reference", "Note", "Status"],
    items.map((e) => [
      e.date,
      e.categoryName,
      e.vendorName,
      e.vendorGstin,
      rupees(e.amount),
      e.gstRate,
      rupees(e.gstAmount),
      rupees(e.itc),
      e.paymentMethod,
      e.reference,
      e.note,
      e.status,
    ]),
  );
}
