// Pure helpers mirrored from @srirealtime/serials (logic.ts) so the receive dialog can check rows before submit.

export function normaliseSerial(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

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

/** 15 digits with a correct Luhn check digit. */
export const isValidImei = (value: string) => {
  const v = normaliseSerial(value);
  return /^\d{15}$/.test(v) && luhnValid(v);
};

const SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9\-/.]{2,39}$/;

export type RowCode = "empty" | "format" | "imei_check" | "duplicate_in_batch" | "same_as_imei1" | "exists";

export interface ParsedRow {
  line: number;
  serial: string;
  serial2: string | null;
  problems: { field: "serial" | "serial2"; code: RowCode }[];
}

function problemOf(serial: string): RowCode | null {
  if (!serial) return "empty";
  if (!SERIAL_PATTERN.test(serial)) return "format";
  if (/^\d{15}$/.test(serial) && !luhnValid(serial)) return "imei_check";
  return null;
}

/**
 * Pasted / scanned text → checked rows. `dual`: the first two values on a line are IMEI 1 and IMEI 2 (tab, comma,
 * semicolon or space between); otherwise one serial per line (or comma / tab separated). Same rules as the API.
 */
export function parseAndCheck(text: string, dual: boolean): ParsedRow[] {
  const rows: ParsedRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (dual) {
      const [a = "", b] = line.split(/[\t,;\s]+/).filter(Boolean);
      rows.push({ line: i + 1, serial: normaliseSerial(a), serial2: b ? normaliseSerial(b) : null, problems: [] });
    } else {
      for (const part of line.split(/[\t,;]+/)) {
        const s = normaliseSerial(part);
        if (s) rows.push({ line: i + 1, serial: s, serial2: null, problems: [] });
      }
    }
  });
  const seen = new Set<string>();
  for (const r of rows) {
    const p1 = problemOf(r.serial);
    if (p1) r.problems.push({ field: "serial", code: p1 });
    else if (seen.has(r.serial)) r.problems.push({ field: "serial", code: "duplicate_in_batch" });
    seen.add(r.serial);
    if (r.serial2) {
      const p2 = problemOf(r.serial2);
      if (p2) r.problems.push({ field: "serial2", code: p2 });
      else if (r.serial2 === r.serial) r.problems.push({ field: "serial2", code: "same_as_imei1" });
      else if (seen.has(r.serial2)) r.problems.push({ field: "serial2", code: "duplicate_in_batch" });
      seen.add(r.serial2);
    }
  }
  return rows;
}
