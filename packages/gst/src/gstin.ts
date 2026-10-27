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

/** What the 4th character of a PAN says about its holder (Income-tax Department codes). */
export const PAN_HOLDER_TYPES = {
  P: "individual",
  C: "company",
  H: "huf",
  F: "firm",
  A: "aop",
  T: "trust",
  B: "boi",
  L: "local_authority",
  J: "artificial_juridical_person",
  G: "government",
  E: "llp",
} as const;
export type PanHolderType = (typeof PAN_HOLDER_TYPES)[keyof typeof PAN_HOLDER_TYPES];

/** Everything a GSTIN says about itself, read offline from the number (no lookup). */
export interface GstinParts {
  /** Normalised (upper case, no spaces). */
  gstin: string;
  /** Format and check character are right. */
  valid: boolean;
  /** Why it is not valid: wrong length / layout, or a wrong check character (a typo). */
  problem: "format" | "checksum" | null;
  /** 2-digit state code, when the first two characters are a known state. */
  stateCode: string | null;
  /** The PAN inside the GSTIN (characters 3–12), when the layout is right. */
  pan: string | null;
  /** Holder type from the PAN's 4th character (company, individual, firm ...), null when unknown. */
  panHolder: PanHolderType | null;
  /** 13th character: the registration number of this PAN in the state (1 = first). */
  entityNumber: string | null;
  /** The check character the first 14 characters need (to point at a typo). */
  expectedCheck: string | null;
}

/** Reads a GSTIN offline: checksum, state and PAN. Never throws. */
export function parseGstin(input: string | null | undefined): GstinParts {
  const g = normalizeGstin(typeof input === "string" ? input : "");
  const layout = GSTIN_FORMAT.test(g);
  const expected = g.length >= 14 ? gstinCheckChar(g.slice(0, 14)) : null;
  const valid = layout && expected === g[14];
  const state = layout ? normalizeStateCode(g.slice(0, 2)) : null;
  const pan = layout ? g.slice(2, 12) : null;
  const holder = pan ? ((PAN_HOLDER_TYPES as Record<string, PanHolderType>)[pan[3]!] ?? null) : null;
  return {
    gstin: g,
    valid,
    problem: valid ? null : layout ? "checksum" : "format",
    stateCode: state,
    pan,
    panHolder: holder,
    entityNumber: layout ? g[12]! : null,
    expectedCheck: expected,
  };
}
