/** Small shared helpers: money (integer paise), months, quarters and the GST financial year. */

export interface Tax {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}
export interface TaxValue extends Tax {
  taxable: number;
}
export const zeroTax = (): Tax => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
export const zeroValue = (): TaxValue => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
export const addValue = (a: TaxValue, b: Partial<TaxValue>, sign = 1): TaxValue => {
  a.taxable += sign * (b.taxable ?? 0);
  a.igst += sign * (b.igst ?? 0);
  a.cgst += sign * (b.cgst ?? 0);
  a.sgst += sign * (b.sgst ?? 0);
  a.cess += sign * (b.cess ?? 0);
  return a;
};
export const totalTax = (t: Tax) => t.igst + t.cgst + t.sgst + t.cess;

/** Paise to rupees with two decimals, as the portal JSON wants (whole paise only, so no float drift). */
export const rupees = (paise: number): number => Math.round(paise) / 100;
export const roundHalfUp = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const isMonth = (s: string) => MONTH_RE.test(s);

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
export const monthOf = (date: string) => date.slice(0, 7);

/** "2026-10" -> "102026" (the portal's return period). */
export const toFp = (month: string) => `${month.slice(5, 7)}${month.slice(0, 4)}`;
/** "102026" -> "2026-10"; null if malformed. */
export function fromFp(fp: string): string | null {
  const m = /^(0[1-9]|1[0-2])(\d{4})$/.exec(fp);
  return m ? `${m[2]}-${m[1]}` : null;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Start year of the financial year a date falls in (April to March). */
export const fyStartYear = (date: string) => {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? y : y - 1;
};
/** "2026-27". */
export const fyLabel = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
export const fyRange = (startYear: number) => ({ from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` });

/** A quarter of the financial year: Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar. */
export interface Quarter {
  /** "<calendar year of the last month>-Q<n>", e.g. "2026-Q3" = Oct-Dec 2026, "2027-Q4" = Jan-Mar 2027. */
  key: string;
  fy: number;
  q: 1 | 2 | 3 | 4;
  months: [string, string, string];
  from: string;
  to: string;
}
export function quarterOfMonth(month: string): Quarter {
  const start = fyStartYear(`${month}-01`);
  const m = Number(month.slice(5, 7));
  const idxInFy = (m + 8) % 12; // Apr = 0 ... Mar = 11
  const q = (Math.floor(idxInFy / 3) + 1) as 1 | 2 | 3 | 4;
  const firstMonth = addMonths(`${start}-04`, (q - 1) * 3);
  const months: [string, string, string] = [firstMonth, addMonths(firstMonth, 1), addMonths(firstMonth, 2)];
  return { key: `${months[2].slice(0, 4)}-Q${q}`, fy: start, q, months, from: monthRange(months[0]).from, to: monthRange(months[2]).to };
}
export function parseQuarter(key: string): Quarter | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  const q = Number(m[2]);
  const lastMonth = ["06", "09", "12", "03"][q - 1]!;
  return quarterOfMonth(`${m[1]}-${lastMonth}`);
}

export const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** "DD-MM-YYYY" (the portal's date) -> "YYYY-MM-DD"; also accepts "DD/MM/YYYY" and ISO dates. null if unknown. */
export function parsePortalDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Days between two ISO dates (b - a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(header: string[], rows: unknown[][]): string {
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
/** Paise to "1234.50" for spreadsheets. */
export const rupeesText = (p: number) => (p / 100).toFixed(2);
