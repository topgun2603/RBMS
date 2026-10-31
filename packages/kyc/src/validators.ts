/**
 * Local format checks for Indian identifiers. These run before any provider call, so a typo never costs a paid API hit.
 * All functions normalise case and spaces first.
 */

const strip = (v: string) => v.replace(/[\s-]+/g, "").toUpperCase();

// ---------------------------------------------------------------- PAN

/** 4th character of a PAN: the holder's entity type. */
export const PAN_ENTITY_TYPES = {
  P: "Individual",
  C: "Company",
  H: "Hindu Undivided Family (HUF)",
  F: "Firm / LLP",
  A: "Association of Persons (AOP)",
  T: "Trust",
  B: "Body of Individuals (BOI)",
  L: "Local authority",
  J: "Artificial juridical person",
  G: "Government",
  K: "Krish (trust)",
  E: "Limited Liability Partnership",
} as const;
export type PanEntityCode = keyof typeof PAN_ENTITY_TYPES;

const PAN_FORMAT = /^[A-Z]{3}[ABCEFGHJKLPT][A-Z][0-9]{4}[A-Z]$/;

export const normalizePan = (pan: string) => strip(pan);

export type PanCheck =
  | { ok: true; pan: string; entityCode: string; entityType: string | null }
  | { ok: false; reason: string };

export interface PanOptions {
  /**
   * Reject a 4th letter that is not a known holder type (P, C, H, F, A, T, B, L, J, G, K, E). Default true. The widely
   * used sample PAN `ABCDE1234F` (4th letter D) only passes with `strictEntity: false`.
   */
  strictEntity?: boolean;
}

/** `AAAAA9999A`; the 4th letter is the holder type (`entityType`, null when unknown and not strict). */
export function validatePan(input: string | null | undefined, opts: PanOptions = {}): PanCheck {
  if (typeof input !== "string") return { ok: false, reason: "PAN is required" };
  const pan = normalizePan(input);
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return { ok: false, reason: "PAN must look like ABCDE1234F" };
  const known = PAN_FORMAT.test(pan);
  if (!known && opts.strictEntity !== false) return { ok: false, reason: "The 4th letter of the PAN is not a valid holder type" };
  const entityCode = pan[3]!;
  return { ok: true, pan, entityCode, entityType: known ? PAN_ENTITY_TYPES[entityCode as PanEntityCode] : null };
}

export const isValidPan = (pan: string | null | undefined, opts?: PanOptions) => validatePan(pan, opts).ok;

// ---------------------------------------------------------------- GSTIN (algorithm copied from @rbms/gst)

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
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

export const normalizeGstin = (gstin: string) => strip(gstin);

/** GST state codes: 01–38, 97 (other territory), 99 (centre jurisdiction). */
const validStateCode = (code: string) => {
  const n = Number(code);
  return (n >= 1 && n <= 38) || n === 97 || n === 99;
};

export type GstinCheck = { ok: true; gstin: string; stateCode: string; pan: string; entityNumber: string } | { ok: false; reason: string };

/** Format, state code, embedded PAN (incl. its entity letter, see `PanOptions`) and the check character. */
export function validateGstin(input: string | null | undefined, opts: PanOptions = {}): GstinCheck {
  if (typeof input !== "string") return { ok: false, reason: "GSTIN is required" };
  const gstin = normalizeGstin(input);
  if (!GSTIN_FORMAT.test(gstin)) return { ok: false, reason: "GSTIN must look like 33ABCDE1234F1Z5" };
  const stateCode = gstin.slice(0, 2);
  if (!validStateCode(stateCode)) return { ok: false, reason: "GSTIN state code is not valid" };
  const pan = gstin.slice(2, 12);
  if (!validatePan(pan, opts).ok) return { ok: false, reason: "GSTIN does not contain a valid PAN" };
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return { ok: false, reason: "GSTIN check character does not match (typo?)" };
  return { ok: true, gstin, stateCode, pan, entityNumber: gstin[12]! };
}

export const isValidGstin = (gstin: string | null | undefined, opts?: PanOptions) => validateGstin(gstin, opts).ok;

// ---------------------------------------------------------------- bank

export const normalizeIfsc = (ifsc: string) => strip(ifsc);
/** 4 letters (bank), a zero, 6 alphanumerics (branch). */
export const isValidIfsc = (ifsc: string | null | undefined) => typeof ifsc === "string" && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalizeIfsc(ifsc));

export const normalizeAccountNumber = (acc: string) => acc.replace(/[\s-]+/g, "");
/** Indian bank account numbers are 9–18 digits; all zeros is rejected. */
export function isValidAccountNumber(acc: string | null | undefined): boolean {
  if (typeof acc !== "string") return false;
  const a = normalizeAccountNumber(acc);
  return /^[0-9]{9,18}$/.test(a) && !/^0+$/.test(a);
}

// ---------------------------------------------------------------- UPI

export const normalizeVpa = (vpa: string) => vpa.trim().toLowerCase();
/** `name@handle`: 2–256 chars of letters, digits, `.`, `-`, `_` before `@`; the handle starts with a letter. */
export const isValidVpa = (vpa: string | null | undefined) =>
  typeof vpa === "string" && /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$/.test(normalizeVpa(vpa));

// ---------------------------------------------------------------- Aadhaar (only for recognising / masking; never stored)

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** 12 digits, not starting with 0 or 1, valid Verhoeff checksum. */
export function isValidAadhaar(input: string | null | undefined): boolean {
  if (typeof input !== "string") return false;
  const a = input.replace(/[\s-]+/g, "");
  if (!/^[2-9][0-9]{11}$/.test(a)) return false;
  let c = 0;
  const digits = a.split("").reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = VERHOEFF_D[c]![VERHOEFF_P[i % 8]![digits[i]!]!]!;
  return c === 0;
}
