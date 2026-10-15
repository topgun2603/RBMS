import type { OrderSummary } from "./service";

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

/** CSV with a UTF-8 BOM (Excel) and CRLF line ends, same as invoices' reports. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** `attachment; filename="orders-2026-10-01-2026-10-31.csv"` (name sanitised). */
export function csvDisposition(name: string, from?: string | null, to?: string | null): string {
  const parts = [name, from, to].filter(Boolean).join("-").replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${parts}.csv"`;
}

/** "2026-10-15 11:30" in IST. */
export function istDateTime(d: Date | string): string {
  const t = new Date(new Date(d).getTime() + 330 * 60_000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`;
}

export function ordersCsv(items: readonly OrderSummary[]): string {
  return toCsv(
    ["Order", "Placed (IST)", "Channel", "Customer", "Phone", "Items", "Total", "Paid", "Status", "Payment status", "Payment method"],
    items.map((o) => [
      o.number,
      istDateTime(o.placedAt),
      o.channel,
      o.customerName,
      o.customerPhone,
      o.itemCount,
      rupees(o.total),
      rupees(o.paid),
      o.status,
      o.paymentStatus,
      o.paymentMethod,
    ]),
  );
}
