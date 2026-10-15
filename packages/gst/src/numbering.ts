/** GST rule 46: invoice numbers are at most 16 characters of A-Z, 0-9, "-" and "/". */
export const MAX_INVOICE_NUMBER_LENGTH = 16;
export const DEFAULT_INVOICE_PREFIX = "INV";
export const MAX_PREFIX_LENGTH = 6;

/** Indian financial year (April–March) of a "YYYY-MM-DD" date: "2026-10-14" → "26-27", "2027-03-31" → "26-27". */
export function financialYear(date: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(date);
  if (!m) throw new RangeError(`Invalid date: ${date}`);
  const year = Number(m[1]);
  const start = Number(m[2]) >= 4 ? year : year - 1;
  const yy = (n: number) => String(n % 100).padStart(2, "0");
  return `${yy(start)}-${yy(start + 1)}`;
}

/** Upper-cases and keeps only A-Z, 0-9 and "-", max 6 characters; empty → "INV". */
export function sanitizePrefix(prefix: string | null | undefined): string {
  const p = (prefix ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, MAX_PREFIX_LENGTH);
  return p || DEFAULT_INVOICE_PREFIX;
}

/**
 * "INV", "26-27", 1 → "INV/26-27/0001". The sequence is padded to 4 digits; when the result would exceed
 * 16 characters the prefix is shortened (it is dropped entirely only for absurdly large sequences).
 */
export function formatInvoiceNumber(prefix: string, fy: string, seq: number): string {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new RangeError("Sequence must be a positive integer");
  const p = sanitizePrefix(prefix);
  const tail = `${fy}/${String(seq).padStart(4, "0")}`;
  if (tail.length > MAX_INVOICE_NUMBER_LENGTH) throw new RangeError("Invoice number would exceed 16 characters");
  const room = MAX_INVOICE_NUMBER_LENGTH - tail.length - 1;
  const short = p.slice(0, Math.max(room, 0)).replace(/-+$/, "");
  return short ? `${short}/${tail}` : tail;
}
