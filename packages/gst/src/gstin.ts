import { normalizeStateCode } from "./states";

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 2-digit state, 10-char PAN, entity number, "Z" by default, check character. */
const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The check character for the first 14 characters (base-36 Luhn "mod 36" variant used by GSTN). */
export function gstinCheckChar(first14: string): string | null {
  if (first14.length !== 14) return null;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]!);
    if (v < 0) return null;
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36]!;
}

/** Upper-cases and strips spaces. */
export const normalizeGstin = (gstin: string) => gstin.replace(/\s+/g, "").toUpperCase();

/** Checks the format and the check character. Input is normalised (case, spaces) first. */
export function isValidGstin(gstin: string | null | undefined): boolean {
  if (typeof gstin !== "string") return false;
  const g = normalizeGstin(gstin);
  if (!GSTIN_FORMAT.test(g)) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

/** The state code (first 2 digits) of a GSTIN, or null if it doesn't start with one. */
export function stateFromGstin(gstin: string | null | undefined): string | null {
  if (typeof gstin !== "string") return null;
  const m = /^\s*(\d{2})/.exec(gstin);
  return m ? normalizeStateCode(m[1]) : null;
}
