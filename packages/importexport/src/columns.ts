/**
 * Column definitions for importers and exporters, plus parsers for Indian shop data
 * (₹ amounts → paise, GST rates, yes/no, mobile numbers, state names/codes, GSTIN).
 * All pure; a parser throws `ParseError` with a user-facing message.
 */

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

const fail = (message: string): never => {
  throw new ParseError(message);
};

export interface ImportColumn<V = unknown> {
  /** Stable key used in templates and mapping, e.g. "opening_stock". */
  key: string;
  /** Header shown in templates, e.g. "Opening stock". */
  label: string;
  required?: boolean;
  /** Example value for the template row. */
  example?: string;
  /** One-line help for the template's Help sheet. */
  help?: string;
  /** Other header spellings that map to this column ("gst %", "tax rate"). */
  aliases?: string[];
  /** Parses a non-empty trimmed cell. Throw ParseError (or any Error) with a message for the user. */
  parse(value: string): V;
  /** Value used when the cell is empty and the column isn't required. */
  default?: V;
}

export interface ExportColumn<R = Record<string, unknown>> {
  key: string;
  label: string;
  /** Turns the row into the cell value (default: row[key]). */
  value?: (row: R) => string | number | boolean | Date | null | undefined;
  /** Excel number format for the column, e.g. "#,##0.00". */
  numFmt?: string;
  width?: number;
}

// ------------------------------------------------------------------ value parsers

/** "1,234.50", "₹ 1,23,456", "Rs. 99", "(100)" → paise. Up to 2 decimals. */
export function parseMoney(value: string, opts: { allowNegative?: boolean } = {}): number {
  let s = value.trim().replace(/\s+/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^(₹|rs\.?|inr)/i, "").replace(/\/-$/, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/^(₹|rs\.?|inr)/i, "");
  if (!/^(\d{1,3}(,\d{2,3})*|\d+)(\.\d+)?$/.test(s)) fail(`"${value}" is not an amount`);
  const plain = s.replace(/,/g, "");
  const [whole, frac = ""] = plain.split(".");
  if (frac.length > 2) fail(`"${value}" has more than 2 decimal places`);
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise)) fail(`"${value}" is too large`);
  if (negative && !opts.allowNegative) fail("Amount can't be negative");
  return negative ? -paise : paise;
}

/** Decimal with at most `decimals` places ("1,234.5", "2.250"). */
export function parseDecimal(value: string, opts: { decimals?: number; min?: number; max?: number; allowNegative?: boolean } = {}): number {
  const s = value.trim().replace(/,/g, "").replace(/\s+/g, "");
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(s)) fail(`"${value}" is not a number`);
  const n = Number(s);
  const decimals = opts.decimals ?? 3;
  const frac = s.split(".")[1]?.replace(/0+$/, "") ?? "";
  if (frac.length > decimals) fail(decimals === 0 ? `"${value}" must be a whole number` : `"${value}" has more than ${decimals} decimal places`);
  if (n < 0 && !opts.allowNegative && (opts.min === undefined || opts.min >= 0)) fail("Can't be negative");
  if (opts.min !== undefined && n < opts.min) fail(`Must be at least ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) fail(`Must be at most ${opts.max}`);
  return Number(n.toFixed(decimals));
}

export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;
export type GstRate = (typeof GST_RATES)[number];

/** "18", "18%", "GST 18", "0.25", "nil", "exempt", and fractions written by Excel percent cells ("0.18") → 18. */
export function parseGstRate(value: string): GstRate {
  const s = value.trim().toLowerCase().replace(/^(gst|igst)\s*[@:-]?\s*/, "").replace(/\s*%$/, "").trim();
  if (["nil", "exempt", "exempted", "none", "zero", "-"].includes(s)) return 0;
  if (!/^\d+(\.\d+)?$/.test(s)) fail(`"${value}" is not a GST rate (use 0, 0.25, 3, 5, 12, 18 or 28)`);
  let n = Number(s);
  // A percent-formatted Excel cell arrives as a fraction: 0.18 → 18 (but 0.25 is a real rate).
  if (n > 0 && n < 1 && n !== 0.25) n = Math.round(n * 10_000) / 100;
  if (!GST_RATES.includes(n as GstRate)) fail(`${n}% is not a GST rate (use 0, 0.25, 3, 5, 12, 18 or 28)`);
  return n as GstRate;
}

const TRUE = new Set(["yes", "y", "true", "1", "t", "on", "inclusive", "incl", "incl.", "ஆம்"]);
const FALSE = new Set(["no", "n", "false", "0", "f", "off", "exclusive", "excl", "excl.", "இல்லை"]);

/** yes/no/true/false/1/0/y/n (case-insensitive). */
export function parseBool(value: string): boolean {
  const s = value.trim().toLowerCase();
  if (TRUE.has(s)) return true;
  if (FALSE.has(s)) return false;
  return fail(`"${value}" should be yes or no`);
}

/**
 * Indian mobile number → E.164 "+919876543210". Accepts "98765 43210", "098765-43210", "+91 98765 43210",
 * "919876543210", "0091 98765 43210" and numbers Excel stored as 9876543210 or 919876543210.
 * Other "+<country>" numbers are kept (8–15 digits).
 */
export function parsePhone(value: string): string {
  const trimmed = value.trim();
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) fail(`"${value}" is not a phone number`);
  let d = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && !d.startsWith("91")) {
    if (d.length < 8 || d.length > 15) fail(`"${value}" is not a phone number`);
    return `+${d}`;
  }
  if (trimmed.startsWith("+")) d = d.slice(2);
  else if (d.length === 14 && d.startsWith("0091")) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) fail(`"${value}" is not a valid 10-digit mobile number`);
  return `+91${d}`;
}

export function parseEmail(value: string): string {
  const s = value.trim().toLowerCase();
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) fail(`"${value}" is not an email address`);
  return s;
}

/** GST state codes (current), as in @rbms/gst. */
export const STATES: readonly { code: string; name: string; aliases?: string[] }[] = [
  { code: "01", name: "Jammu and Kashmir", aliases: ["j&k", "jk", "jammu & kashmir"] },
  { code: "02", name: "Himachal Pradesh", aliases: ["hp"] },
  { code: "03", name: "Punjab", aliases: ["pb"] },
  { code: "04", name: "Chandigarh", aliases: ["ch"] },
  { code: "05", name: "Uttarakhand", aliases: ["uttaranchal", "uk"] },
  { code: "06", name: "Haryana", aliases: ["hr"] },
  { code: "07", name: "Delhi", aliases: ["new delhi", "nct of delhi", "dl"] },
  { code: "08", name: "Rajasthan", aliases: ["rj"] },
  { code: "09", name: "Uttar Pradesh", aliases: ["up"] },
  { code: "10", name: "Bihar", aliases: ["br"] },
  { code: "11", name: "Sikkim", aliases: ["sk"] },
  { code: "12", name: "Arunachal Pradesh", aliases: ["ar"] },
  { code: "13", name: "Nagaland", aliases: ["nl"] },
  { code: "14", name: "Manipur", aliases: ["mn"] },
  { code: "15", name: "Mizoram", aliases: ["mz"] },
  { code: "16", name: "Tripura", aliases: ["tr"] },
  { code: "17", name: "Meghalaya", aliases: ["ml"] },
  { code: "18", name: "Assam", aliases: ["as"] },
  { code: "19", name: "West Bengal", aliases: ["wb"] },
  { code: "20", name: "Jharkhand", aliases: ["jh"] },
  { code: "21", name: "Odisha", aliases: ["orissa", "od", "or"] },
  { code: "22", name: "Chhattisgarh", aliases: ["chattisgarh", "cg"] },
  { code: "23", name: "Madhya Pradesh", aliases: ["mp"] },
  { code: "24", name: "Gujarat", aliases: ["gj"] },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu", aliases: ["dnh", "daman and diu", "dadra and nagar haveli", "dd"] },
  { code: "27", name: "Maharashtra", aliases: ["mh"] },
  { code: "29", name: "Karnataka", aliases: ["ka"] },
  { code: "30", name: "Goa", aliases: ["ga"] },
  { code: "31", name: "Lakshadweep", aliases: ["ld"] },
  { code: "32", name: "Kerala", aliases: ["kl"] },
  { code: "33", name: "Tamil Nadu", aliases: ["tamilnadu", "tn", "தமிழ்நாடு", "தமிழ் நாடு"] },
  { code: "34", name: "Puducherry", aliases: ["pondicherry", "py", "pondy", "புதுச்சேரி"] },
  { code: "35", name: "Andaman and Nicobar Islands", aliases: ["andaman and nicobar", "an"] },
  { code: "36", name: "Telangana", aliases: ["ts", "tg"] },
  { code: "37", name: "Andhra Pradesh", aliases: ["ap"] },
  { code: "38", name: "Ladakh", aliases: ["la"] },
  { code: "97", name: "Other Territory", aliases: ["ot"] },
];

const normName = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9஀-௿]+/g, "");
const STATE_LOOKUP = new Map<string, string>();
for (const s of STATES) {
  STATE_LOOKUP.set(normName(s.name), s.code);
  for (const a of s.aliases ?? []) STATE_LOOKUP.set(normName(a), s.code);
}

/** "Tamil Nadu" / "tamilnadu" / "TN" / "33" / "33 - Tamil Nadu" / "3" (→ "03") → 2-digit GST state code. */
export function parseState(value: string): string {
  const s = value.trim();
  const lead = /^(\d{1,2})(\s*[-–:]\s*.*)?$/.exec(s);
  if (lead) {
    const code = lead[1]!.padStart(2, "0");
    if (STATES.some((x) => x.code === code)) return code;
    return fail(`"${value}" is not a GST state code`);
  }
  const code = STATE_LOOKUP.get(normName(s));
  return code ?? fail(`"${value}" is not an Indian state or state code`);
}

export const stateName = (code: string | null | undefined) => STATES.find((s) => s.code === code)?.name ?? null;

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function gstinCheckChar(first14: string): string | null {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]!);
    if (v < 0) return null;
    const product = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}

/** Upper-cased, spaces removed, format + check character verified. */
export function parseGstin(value: string): string {
  const g = value.replace(/\s+/g, "").toUpperCase();
  if (!GSTIN_FORMAT.test(g)) fail(`"${value}" is not a GSTIN (15 characters, e.g. 33AAACR5055K1ZE)`);
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) fail(`"${value}" has a wrong check character; please re-check the GSTIN`);
  return g;
}

/** "2026-10-15", "15/10/2026", "15-10-2026", "15.10.2026" → "YYYY-MM-DD" (Indian day-first order). */
export function parseDate(value: string): string {
  const s = value.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(T.*)?$/.exec(s);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else return fail(`"${value}" is not a date (use YYYY-MM-DD or DD/MM/YYYY)`);
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) fail(`"${value}" is not a real date`);
  return iso;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Batch dates as printed on packs and in pharmacy / FMCG software: "03/2027", "03-27", "Mar-2027", "MAR 27", "2027-03"
 * (a month: the expiry is the last day of it, a manufacturing date the first), or any full date ("15/03/2027").
 */
export function parseBatchDate(value: string, which: "expiry" | "mfg" = "expiry"): string {
  const s = value.trim();
  let y: number | null = null;
  let m: number | null = null;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/.exec(s))) [m, y] = [Number(match[1]), Number(match[2])];
  else if ((match = /^(\d{4})\s*[/.-]\s*(\d{1,2})$/.exec(s))) [y, m] = [Number(match[1]), Number(match[2])];
  else if ((match = /^([A-Za-z]{3})[a-z]*[\s/.-]*(\d{2}|\d{4})$/.exec(s))) [m, y] = [MONTHS.indexOf(match[1]!.toLowerCase()) + 1, Number(match[2])];
  if (y !== null && m !== null) {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || y < 2000 || y > 2100) return fail(`"${value}" is not a month and year (e.g. 03/2027)`);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${which === "expiry" ? String(last).padStart(2, "0") : "01"}`;
  }
  return parseDate(s);
}

// ------------------------------------------------------------------ column helpers

type Opts<V> = Partial<Omit<ImportColumn<V>, "key" | "label" | "parse">>;

const def = <V>(key: string, label: string, parse: (v: string) => V, opts: Opts<V> = {}): ImportColumn<V> => ({ key, label, parse, ...opts });

/** Ready-made column builders. */
export const col = {
  text: (key: string, label: string, opts: Opts<string> & { max?: number; min?: number; pattern?: RegExp; patternMessage?: string; upper?: boolean } = {}) => {
    const { max = 500, min, pattern, patternMessage, upper, ...rest } = opts;
    return def(
      key,
      label,
      (v) => {
        const s = upper ? v.toUpperCase() : v;
        if (s.length > max) fail(`Too long (max ${max} characters)`);
        if (min !== undefined && s.length < min) fail(`Too short (min ${min} characters)`);
        if (pattern && !pattern.test(s)) fail(patternMessage ?? `"${v}" is not valid`);
        return s;
      },
      rest,
    );
  },
  money: (key: string, label: string, opts: Opts<number> & { allowNegative?: boolean } = {}) => {
    const { allowNegative, ...rest } = opts;
    return def(key, label, (v) => parseMoney(v, { allowNegative }), { help: "Rupees, e.g. 1,234.50", ...rest });
  },
  decimal: (key: string, label: string, opts: Opts<number> & { decimals?: number; min?: number; max?: number; allowNegative?: boolean } = {}) => {
    const { decimals, min, max, allowNegative, ...rest } = opts;
    return def(key, label, (v) => parseDecimal(v, { decimals, min, max, allowNegative }), rest);
  },
  int: (key: string, label: string, opts: Opts<number> & { min?: number; max?: number } = {}) => {
    const { min, max, ...rest } = opts;
    return def(key, label, (v) => parseDecimal(v, { decimals: 0, min, max }), rest);
  },
  bool: (key: string, label: string, opts: Opts<boolean> = {}) => def(key, label, parseBool, { help: "yes or no", ...opts }),
  gstRate: (key: string, label: string, opts: Opts<GstRate> = {}) => def(key, label, parseGstRate, { help: "0, 0.25, 3, 5, 12, 18 or 28", ...opts }),
  phone: (key: string, label: string, opts: Opts<string> = {}) => def(key, label, parsePhone, { help: "10-digit mobile number", ...opts }),
  email: (key: string, label: string, opts: Opts<string> = {}) => def(key, label, parseEmail, opts),
  state: (key: string, label: string, opts: Opts<string> = {}) => def(key, label, parseState, { help: "State name or GST code, e.g. Tamil Nadu or 33", ...opts }),
  gstin: (key: string, label: string, opts: Opts<string> = {}) => def(key, label, parseGstin, { help: "15-character GSTIN", ...opts }),
  date: (key: string, label: string, opts: Opts<string> = {}) => def(key, label, parseDate, { help: "YYYY-MM-DD or DD/MM/YYYY", ...opts }),
  /** Expiry or manufacturing date of a batch: also month and year only ("03/2027", "Mar-27"). */
  batchDate: (key: string, label: string, which: "expiry" | "mfg", opts: Opts<string> = {}) => def(key, label, (v) => parseBatchDate(v, which), { help: "MM/YYYY or DD/MM/YYYY", ...opts }),
  oneOf: <T extends string>(key: string, label: string, values: readonly T[], opts: Opts<T> = {}) =>
    def(
      key,
      label,
      (v) => {
        const found = values.find((x) => x.toLowerCase() === v.toLowerCase());
        return found ?? fail(`"${v}" should be one of: ${values.join(", ")}`);
      },
      { help: values.join(" / "), ...opts },
    ),
  /** Comma/semicolon/pipe-separated list ("tag1, tag2"). */
  list: (key: string, label: string, opts: Opts<string[]> & { maxItems?: number } = {}) => {
    const { maxItems = 50, ...rest } = opts;
    return def(
      key,
      label,
      (v) => {
        const items = v
          .split(/[,;|]/)
          .map((x) => x.trim())
          .filter(Boolean);
        if (items.length > maxItems) fail(`At most ${maxItems} values`);
        return items;
      },
      rest,
    );
  },
};

/** Paise → "1234.50" for exports. */
export const rupees = (paise: number | null | undefined) => (paise === null || paise === undefined ? null : (paise / 100).toFixed(2));
