import type { AiMaskOptions } from "./types";

/**
 * Privacy helpers applied to text before it leaves for the model (DPDP data minimisation, docs/ai.md). Masking keeps
 * enough to tell people apart in an answer ("customer ending 4321") but never the full number or address.
 */

const PHONE_RE = /(?<![\w.])(?:\+?91[\s-]?)?0?([6-9]\d{4}[\s-]?\d{5}|[6-9]\d{9})(?!\d)/g;
// Bounded so a long run of letters with no @ cannot make the scan slow.
const EMAIL_RE = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,4}\.[A-Za-z]{2,24}/g;
const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;

/** "98765 43210", "+91 98765 43210" -> "XXXXXX3210". */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `XXXXXX${digits.slice(-4)}`;
}

/** "ravi.kumar@gmail.com" -> "r***@gmail.com". */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/** "33ABCDE1234F1Z5" -> "33XXXXXXXXXX1Z5": the state and the check characters stay, the PAN goes. */
export function maskGstin(gstin: string): string {
  return gstin.length === 15 ? `${gstin.slice(0, 2)}XXXXXXXXXX${gstin.slice(12)}` : "XXXXXXXXXXXXXXX";
}

export const DEFAULT_MASK: Required<AiMaskOptions> = { phones: true, emails: true, gstin: false };

/** Masks phone numbers, emails and (optionally) GSTINs in free text. Idempotent. */
export function maskText(text: string, opts: AiMaskOptions = {}): string {
  const o = { ...DEFAULT_MASK, ...opts };
  let out = text;
  if (o.emails) out = out.replace(EMAIL_RE, (m) => maskEmail(m));
  if (o.gstin) out = out.replace(GSTIN_RE, (m) => maskGstin(m));
  if (o.phones) out = out.replace(PHONE_RE, (m) => maskPhone(m));
  return out;
}

/** Keeps only the listed keys of a record before it goes into a prompt ("the item name and rate, not the whole row"). */
export function pick<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (k in row) out[k] = row[k];
  return out;
}

/** Trims long text to about `max` characters (start and end kept) so a prompt stays small. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = Math.max(0, max - 7);
  const head = Math.ceil(keep * 0.7);
  return `${text.slice(0, head)} [...] ${text.slice(text.length - (keep - head))}`;
}
