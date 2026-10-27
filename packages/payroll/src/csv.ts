import type { RunView, SheetRow } from "./service";

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

/** `attachment; filename="payroll-register-2026-10.csv"` (name sanitised). */
export function csvDisposition(name: string): string {
  return `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}.csv"`;
}

const amountOf = (items: readonly { key: string; amount: number }[], pred: (k: string) => boolean) => items.filter((m) => pred(m.key)).reduce((t, m) => t + m.amount, 0);

/** Payroll register: one row per person with days, every earning and deduction head, employer cost, net and payment. */
export function registerCsv(run: RunView): string {
  const headers = [
    "Code",
    "Name",
    "Designation",
    "Pay type",
    "Days in month",
    "Paid days",
    "LOP days",
    "Overtime hours",
    "Basic / wages",
    "DA",
    "HRA",
    "Allowances",
    "Overtime",
    "Other earnings",
    "Gross",
    "PF (employee)",
    "ESI (employee)",
    "Professional tax",
    "TDS",
    "Advance recovery",
    "Other deductions",
    "Total deductions",
    "Round off",
    "Net pay",
    "PF (employer)",
    "ESI (employer)",
    "Cost to shop",
    "Pay method",
    "Paid on",
  ];
  const rows = run.lines.map((l) => {
    const e = l.earnings;
    const d = l.deductions;
    const er = l.employer;
    return [
      l.snapshot.code,
      l.snapshot.name,
      l.snapshot.designation,
      l.snapshot.payType,
      l.days.periodDays,
      l.paidDays,
      l.days.lopDays,
      Math.round((l.days.overtimeMinutes / 60) * 100) / 100,
      rupees(amountOf(e, (k) => k === "basic" || k === "wages")),
      rupees(amountOf(e, (k) => k === "da")),
      rupees(amountOf(e, (k) => k === "hra")),
      rupees(amountOf(e, (k) => k.startsWith("allowance:"))),
      rupees(amountOf(e, (k) => k === "overtime")),
      rupees(amountOf(e, (k) => k === "extra_days" || k.startsWith("extra:"))),
      rupees(l.gross),
      rupees(amountOf(d, (k) => k === "pf")),
      rupees(amountOf(d, (k) => k === "esi")),
      rupees(amountOf(d, (k) => k === "pt")),
      rupees(amountOf(d, (k) => k === "tds")),
      rupees(amountOf(d, (k) => k.startsWith("advance:"))),
      rupees(amountOf(d, (k) => k.startsWith("other:"))),
      rupees(l.totalDeductions),
      rupees(l.roundOff),
      rupees(l.net),
      rupees(amountOf(er, (k) => k === "pf")),
      rupees(amountOf(er, (k) => k === "esi")),
      rupees(l.gross + amountOf(er, () => true)),
      l.payment?.method ?? l.snapshot.payMethod,
      l.payment?.date ?? "",
    ];
  });
  const t = run.totals;
  if (t) {
    rows.push([
      "",
      "Total",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      rupees(t.overtime),
      "",
      rupees(t.gross),
      rupees(t.pfEmployee),
      rupees(t.esiEmployee),
      rupees(t.pt),
      rupees(t.tds),
      rupees(t.advance),
      rupees(t.other),
      rupees(t.deductions),
      rupees(t.roundOff),
      rupees(t.net),
      rupees(t.pfEmployer),
      rupees(t.esiEmployer),
      rupees(t.employerCost),
      "",
      "",
    ]);
  }
  return toCsv(headers, rows);
}

/**
 * Bank transfer sheet: the people paid by bank transfer who are not marked paid yet, with account, IFSC and amount.
 * Most banks' bulk-payment uploads take these columns (rearrange to your bank's template). Open the account column as text.
 */
export function bankSheetCsv(run: RunView, narration: string): string {
  const rows = run.lines
    .filter((l) => l.snapshot.payMethod === "bank" && !l.payment && l.net > 0)
    .map((l) => [l.snapshot.name, l.snapshot.accountNumber, l.snapshot.ifsc, l.snapshot.bankName, rupees(l.net), narration, l.snapshot.code]);
  return toCsv(["Beneficiary name", "Account number", "IFSC", "Bank", "Amount", "Narration", "Staff code"], rows);
}

/** The month sheet: a column per day (P, A, H, leave code, WO, HO) and the totals payroll uses. */
export function attendanceCsv(sheet: { dates: string[]; rows: SheetRow[] }): string {
  const headers = ["Code", "Name", ...sheet.dates.map((d) => d.slice(8)), "Present", "Half days", "Paid leave", "Unpaid leave", "Absent", "Weekly offs", "Holidays", "LOP days", "Late days", "Overtime hours"];
  const rows = sheet.rows.map((r) => [
    r.employee.code,
    r.employee.name,
    ...r.cells.map((c) => c.code),
    r.counts.present,
    r.counts.halfDays,
    r.counts.paidLeave,
    r.counts.unpaidLeave,
    r.counts.absent,
    r.counts.weekOffs,
    r.counts.holidays,
    r.counts.lopDays,
    r.counts.lateDays,
    Math.round((r.counts.overtimeMinutes / 60) * 100) / 100,
  ]);
  return toCsv(headers, rows);
}
