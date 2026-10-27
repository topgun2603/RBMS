import type { ExpenseReport, ExpenseView } from "./service";

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

export function expensesCsv(items: readonly ExpenseView[], branchName: (id: string | null) => string = (id) => (id ? id : "Shop-wide")): string {
  return toCsv(
    ["Date", "Category", "Vendor", "Vendor GSTIN", "Amount", "GST rate", "GST", "ITC", "Payment method", "Reference", "Note", "Status", "Branch", "Due date", "Paid", "Balance"],
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
      branchName(e.branchId),
      e.dueDate,
      e.paymentMethod === "credit" ? rupees(e.amountPaid) : "",
      e.paymentMethod === "credit" ? rupees(e.balance) : "",
    ]),
  );
}

const GROUP_HEAD: Record<ExpenseReport["groupBy"], string> = { category: "Category", supplier: "Supplier", branch: "Branch", month: "Month" };
const NONE_LABEL: Record<ExpenseReport["groupBy"], string> = { category: "Other", supplier: "No supplier", branch: "Shop-wide", month: "" };

/** The expense report (by category / supplier / branch / month) with a total row. */
export function expenseReportCsv(r: ExpenseReport): string {
  return toCsv(
    [GROUP_HEAD[r.groupBy], "Expenses", "Amount", "GST", "ITC", "Net of ITC", "Unpaid"],
    [
      ...r.rows.map((x) => [x.label || NONE_LABEL[r.groupBy], x.count, rupees(x.total), rupees(x.gst), rupees(x.itc), rupees(x.net), rupees(x.unpaid)]),
      ["Total", r.totals.count, rupees(r.totals.total), rupees(r.totals.gst), rupees(r.totals.itc), rupees(r.totals.net), rupees(r.totals.unpaid)],
    ],
  );
}
