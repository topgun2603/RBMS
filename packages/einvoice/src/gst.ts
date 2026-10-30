// Small GST helpers copied from @rbms/gst (packages never import each other).

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

/**
 * Transporter id for an e-way bill: a GSTIN, or a 15-character TRANSIN (enrolled transporter id), which uses the
 * same mod-36 check character.
 */
export function isValidTransporterId(id: string | null | undefined): boolean {
  if (typeof id !== "string") return false;
  const g = normalizeGstin(id);
  if (!/^[0-9]{2}[0-9A-Z]{13}$/.test(g)) return false;
  return gstinCheckChar(g.slice(0, 14)) === g[14];
}

/** State code (first 2 digits) of a GSTIN, or null. */
export function stateFromGstin(gstin: string | null | undefined): string | null {
  if (typeof gstin !== "string") return null;
  const m = /^\s*(\d{2})/.exec(gstin);
  return m ? normalizeStateCode(m[1]) : null;
}

/** GST state / UT codes in current use (25 and 28 are retired). 97 = Other Territory, 96 = Other Country. */
export const GST_STATE_CODES: readonly string[] = [
  "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "20", "21", "22", "23", "24", "26", "27", "29", "30", "31", "32", "33", "34", "35", "36", "37", "38", "97",
];

/** "33" / "3" / 33 → "33"; anything that isn't one or two digits → null. */
export function normalizeStateCode(code: string | number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const s = String(code).trim();
  return /^\d{1,2}$/.test(s) ? s.padStart(2, "0") : null;
}

export function isValidStateCode(code: string | number | null | undefined): boolean {
  const c = normalizeStateCode(code);
  return c !== null && GST_STATE_CODES.includes(c);
}

/** GST rates NIC accepts for `GstRt` (40% from GST 2.0, Sept 2025). */
export const NIC_GST_RATES: readonly number[] = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

// ------------------------------------------------------------------ dates (IST)

export const IST_OFFSET_MINUTES = 330;
const IST_MS = IST_OFFSET_MINUTES * 60_000;
const DAY_MS = 86_400_000;

/** Today's date in IST as "YYYY-MM-DD". */
export function todayIST(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_MS).toISOString().slice(0, 10);
}

/** True for a real calendar date written as "YYYY-MM-DD". */
export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** "2026-10-15" → "15/10/2026" (NIC e-invoice / e-way bill date). */
export function toNicDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) throw new RangeError(`Invalid date: ${date}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** "15/10/2026" → "2026-10-15"; null when malformed. */
export function fromNicDate(date: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isValidDate(iso) ? iso : null;
}

/** "2026-10-15" → "15-10-2026" (GSTR-1 `idt`). */
export function toGstr1Date(date: string): string {
  return toNicDate(date).replace(/\//g, "-");
}

/** A Date as NIC's IST timestamp "YYYY-MM-DD HH:mm:ss". */
export function toNicDateTime(d: Date): string {
  return new Date(d.getTime() + IST_MS).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * NIC IST timestamps ("2026-10-15 12:30:00", also "15/10/2026 12:30:00 PM" from the e-way bill API) → Date.
 * Strings with an explicit zone (ISO) are parsed as-is. Null when unparseable.
 */
export function parseNicDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}+05:30`);
  m = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?(?: ?([AP]M))?)?$/i.exec(s);
  if (m) {
    let h = Number(m[4] ?? 0);
    const ap = m[7]?.toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return new Date(`${m[3]}-${m[2]}-${m[1]}T${String(h).padStart(2, "0")}:${m[5] ?? "00"}:${m[6] ?? "00"}+05:30`);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Indian financial year of a "YYYY-MM-DD" date in long form: "2026-10-14" → "2026-27", "2027-03-31" → "2026-27". */
export function financialYearLong(date: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(date);
  if (!m) throw new RangeError(`Invalid date: ${date}`);
  const year = Number(m[1]);
  const start = Number(m[2]) >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ money

/** Paise → rupees with 2 decimals (as a JSON number): 123456 → 1234.56. */
export const rupees = (paise: number): number => Math.round(paise) / 100;

/** Rupees (any float) → integer paise, rounding half away from zero. */
export const toPaise = (r: number): number => Math.sign(r) * Math.round(Math.abs(r) * 100);

/** Rounds to `dp` decimals (for quantities: 3). */
export const roundTo = (n: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.sign(n) * Math.round(Math.abs(n) * f) / f;
};
