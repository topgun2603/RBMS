import type { SerialStatus } from "./schema";

/** Serial numbers are stored upper case without whitespace: " 35 2099 001761481 " → "352099001761481". */
export function normaliseSerial(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

/** Luhn (mod 10) check over a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** An IMEI: exactly 15 digits whose last digit is the Luhn check digit. */
export function isValidImei(value: string): boolean {
  const v = normaliseSerial(value);
  return /^\d{15}$/.test(v) && luhnValid(v);
}

/** Letters, digits and - / . only, 3–40 characters (after normalising). */
export const SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9\-/.]{2,39}$/;

export type SerialProblem = "empty" | "format" | "imei_check" | "duplicate_in_batch" | "same_as_imei1";

/** Why one serial can't be taken (format and IMEI check only; the database check is separate). Luhn only for 15 digits. */
export function serialProblem(serial: string): SerialProblem | null {
  if (!serial) return "empty";
  if (!SERIAL_PATTERN.test(serial)) return "format";
  if (/^\d{15}$/.test(serial) && !luhnValid(serial)) return "imei_check";
  return null;
}

export interface SerialRow {
  serial: string;
  serial2?: string | null;
}

export interface RowProblem {
  index: number;
  field: "serial" | "serial2";
  value: string;
  code: SerialProblem | "exists";
}

/**
 * Normalises a batch of units and lists every problem by row: bad format, a 15-digit IMEI failing the check digit, a
 * serial repeated in the batch (in either column) or IMEI 2 equal to IMEI 1.
 */
export function checkSerialRows(rows: SerialRow[]): { rows: { serial: string; serial2: string | null }[]; problems: RowProblem[] } {
  const out = rows.map((r) => ({ serial: normaliseSerial(r.serial ?? ""), serial2: r.serial2 ? normaliseSerial(r.serial2) || null : null }));
  const problems: RowProblem[] = [];
  const seen = new Map<string, number>();
  out.forEach((r, index) => {
    const p1 = serialProblem(r.serial);
    if (p1) problems.push({ index, field: "serial", value: r.serial, code: p1 });
    else if (seen.has(r.serial)) problems.push({ index, field: "serial", value: r.serial, code: "duplicate_in_batch" });
    if (r.serial) seen.set(r.serial, seen.get(r.serial) ?? index);
    if (r.serial2) {
      const p2 = serialProblem(r.serial2);
      if (p2) problems.push({ index, field: "serial2", value: r.serial2, code: p2 });
      else if (r.serial2 === r.serial) problems.push({ index, field: "serial2", value: r.serial2, code: "same_as_imei1" });
      else if (seen.has(r.serial2)) problems.push({ index, field: "serial2", value: r.serial2, code: "duplicate_in_batch" });
      seen.set(r.serial2, seen.get(r.serial2) ?? index);
    }
  });
  return { rows: out, problems };
}

/**
 * Pasted / scanned text → rows, one unit per line. `dual`: the first two values on a line (tab, comma, semicolon or
 * space separated) are IMEI 1 and IMEI 2. Otherwise each line is one serial (inner spaces dropped). Blank lines skipped.
 */
export function parseSerialLines(text: string, dual: boolean): SerialRow[] {
  const rows: SerialRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (dual) {
      const [a = "", b] = line.split(/[\t,;\s]+/).filter(Boolean);
      rows.push({ serial: normaliseSerial(a), serial2: b ? normaliseSerial(b) : null });
    } else {
      for (const part of line.split(/[\t,;]+/)) {
        const s = normaliseSerial(part);
        if (s) rows.push({ serial: s });
      }
    }
  }
  return rows;
}

/** "YYYY-MM-DD" plus `days` (UTC calendar maths on IST calendar days). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Days from `from` to `to` (both "YYYY-MM-DD"); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Last day of warranty for a sale on `soldDate` (IST calendar day) lasting `months`: the day before the same date
 * `months` later, or that month's last day when it is shorter (sold 2026-01-31 + 1 month → 2026-02-28; sold 2026-10-20 + 12 → 2027-10-19).
 * No warranty (0 months) → null.
 */
export function warrantyEnd(soldDate: string, months: number): string | null {
  if (!(months > 0)) return null;
  const [y, m, d] = soldDate.split("-").map(Number) as [number, number, number];
  const total = m - 1 + Math.floor(months);
  const ty = y + Math.floor(total / 12);
  const tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const lastDay = new Date(Date.UTC(ty, tm, last)).toISOString().slice(0, 10);
  if (d > last) return lastDay;
  return addDays(new Date(Date.UTC(ty, tm, d)).toISOString().slice(0, 10), -1);
}

export type WarrantyStatus = "active" | "expired" | "none";

/** Active through its last day; "none" when the unit carries no warranty (not sold, or 0 months). */
export function warrantyStatus(end: string | null | undefined, today: string): WarrantyStatus {
  if (!end) return "none";
  return end >= today ? "active" : "expired";
}

/** Days of warranty left counting today (0 once expired); null without a warranty. */
export function warrantyDaysLeft(end: string | null | undefined, today: string): number | null {
  if (!end) return null;
  return Math.max(0, daysBetween(today, end) + 1);
}

/** Units in these statuses are on the shelf and counted in inventory's stock totals. */
export const ON_SHELF: readonly SerialStatus[] = ["in_stock", "returned"];

/** Status changes staff can make by hand (sales, cancellations and returns come from bills and credit notes). */
const MANUAL: Record<SerialStatus, readonly SerialStatus[]> = {
  in_stock: ["defective", "written_off"],
  returned: ["in_stock", "defective", "written_off"],
  defective: ["in_stock", "written_off"],
  written_off: ["in_stock"],
  sold: [],
};

export const MANUAL_STATUSES = ["in_stock", "defective", "written_off"] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];

export function canMoveTo(from: SerialStatus, to: SerialStatus): boolean {
  return MANUAL[from].includes(to);
}

/** Inventory change for a status move: +1 back on the shelf, −1 off it, 0 otherwise. */
export function stockDelta(from: SerialStatus, to: SerialStatus): -1 | 0 | 1 {
  const a = ON_SHELF.includes(from);
  const b = ON_SHELF.includes(to);
  return a === b ? 0 : b ? 1 : -1;
}

// ---------------------------------------------------------------------------------------------- public lookup

/** The last `n` digits of a phone number ("" when it has fewer). */
export function lastDigits(phone: string | null | undefined, n = 4): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= n ? d.slice(-n) : "";
}

/** The customer's "last 4 digits of your phone" matches the phone on the sale (a sale without a phone never matches). */
export function phoneLast4Matches(phone: string | null | undefined, last4: string): boolean {
  const want = (last4 ?? "").replace(/\D/g, "");
  return want.length === 4 && lastDigits(phone) === want;
}

export type PublicWarrantyStatus = WarrantyStatus | "claimed";

/** What the public warranty page shows: a claim logged during the warranty reads "claimed" until the warranty ends. */
export function publicWarrantyStatus(end: string | null | undefined, today: string, claimed: boolean): PublicWarrantyStatus {
  const s = warrantyStatus(end, today);
  return s === "active" && claimed ? "claimed" : s;
}
