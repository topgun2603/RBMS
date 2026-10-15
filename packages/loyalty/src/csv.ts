export type CsvValue = string | number | boolean | null | undefined;

/** Paise → "1234.50" for spreadsheets. */
export const rupees = (paise: number | null | undefined) => ((paise ?? 0) / 100).toFixed(2);

const csvCell = (v: CsvValue): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Spreadsheet formula injection: text starting with = + - @ is shown as text (phones "+91…" included, on purpose:
  // Excel would otherwise read them as a formula/number).
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV with a UTF-8 BOM (Excel) and CRLF line ends, same as orders and invoices. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** "2026-10-15 11:30" in IST. */
export function istDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const t = new Date(new Date(d).getTime() + 330 * 60_000).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`;
}

export interface MemberCsvRow {
  memberKey: string;
  name: string | null;
  tier: string;
  pointsBalance: number;
  pointsValue: number;
  lifetimeSpend: number;
  joinedAt: Date;
  lastActivityAt: Date | null;
}

export function membersCsv(items: readonly MemberCsvRow[]): string {
  return toCsv(
    ["Mobile", "Name", "Tier", "Points", "Points value (Rs)", "Lifetime spend (Rs)", "Joined (IST)", "Last activity (IST)"],
    items.map((m) => [
      m.memberKey,
      m.name,
      m.tier,
      m.pointsBalance,
      rupees(m.pointsValue),
      rupees(m.lifetimeSpend),
      istDateTime(m.joinedAt),
      istDateTime(m.lastActivityAt),
    ]),
  );
}

export const csvDisposition = (name: string) => `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}.csv"`;
