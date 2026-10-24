import type { Evidence } from "./tools";

/**
 * Number check for "Ask your shop" answers. The model writes the words, but every number in its reply must come from the
 * tool results: shown as they are, rounded the way people write them (1,24,831 for 124830.50; 1.25 lakh), or computed
 * in the simplest ways (a sum, a difference, a share in percent, a change in percent, an average, a count of rows).
 * Anything else is "untraced" and the answer is not shown as written. Deterministic code, no model involved.
 */

const TAMIL_DIGITS = "௦௧௨௩௪௫௬௭௮௯";
export function asciiDigits(s: string): string {
  return s.replace(/[௦-௯]/g, (c) => String(TAMIL_DIGITS.indexOf(c)));
}

const UNIT: Record<string, number> = {
  lakh: 1e5,
  lakhs: 1e5,
  lac: 1e5,
  lacs: 1e5,
  crore: 1e7,
  crores: 1e7,
  cr: 1e7,
  k: 1e3,
  thousand: 1e3,
  "லட்சம்": 1e5,
  "லட்சங்கள்": 1e5,
  "கோடி": 1e7,
  "ஆயிரம்": 1e3,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  "ஜனவரி": 1, "பிப்ரவரி": 2, "மார்ச்": 3, "ஏப்ரல்": 4, "மே": 5, "ஜூன்": 6, "ஜூலை": 7, "ஆகஸ்ட்": 8, "செப்டம்பர்": 9, "அக்டோபர்": 10, "நவம்பர்": 11, "டிசம்பர்": 12,
};
const MONTH_RE = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");

export interface Mentioned {
  /** The text as written, for the message. */
  text: string;
  value: number;
  /** Allowed difference from a source number. */
  tol: number;
  percent: boolean;
  /** Written with lakh / crore / thousand: only matched against a source number directly. */
  united: boolean;
}

export interface Extracted {
  numbers: Mentioned[];
  /** ISO dates written in the answer. */
  isoDates: string[];
  /** Day + month written in the answer ("24 Oct", "Oct 24", "24/10"). */
  dayMonths: { text: string; day: number; month: number }[];
}

const decimalsOf = (s: string) => (s.includes(".") ? s.split(".")[1]!.length : 0);

/** Every number a reply states (dates, list numbers and ordinals are set aside; dates are returned separately). */
export function extractNumbers(reply: string): Extracted {
  let text = asciiDigits(reply).replace(/\*\*/g, "");
  const isoDates: string[] = [];
  const dayMonths: Extracted["dayMonths"] = [];

  text = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d) => {
    isoDates.push(`${y}-${mo}-${d}`);
    return " ";
  });
  text = text.replace(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g, (m: string, d: string, mo: string, y: string) => {
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31 || Number(y) < 1990 || Number(y) > 2100) return m; // a bill number like 26-27/0042, not a date
    isoDates.push(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    return " ";
  });
  const dm1 = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTH_RE})\\b(?:\\s*,?\\s*(\\d{4}))?`, "giu");
  text = text.replace(dm1, (m, d, mon) => {
    dayMonths.push({ text: m.trim(), day: Number(d), month: MONTHS[String(mon).toLowerCase()]! });
    return " ";
  });
  const dm2 = new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*[,]?\\s*\\d{3})`, "giu");
  text = text.replace(dm2, (m, mon, d) => {
    dayMonths.push({ text: m.trim(), day: Number(d), month: MONTHS[String(mon).toLowerCase()]! });
    return " ";
  });
  // A bare "5/11" style day/month.
  text = text.replace(/\b(\d{1,2})\/(\d{1,2})\b/g, (m, d, mo) => {
    dayMonths.push({ text: m, day: Number(d), month: Number(mo) });
    return " ";
  });
  // Clock times.
  text = text.replace(/\b\d{1,2}:\d{2}\b/g, " ");
  // Numbered list markers at the start of a line.
  text = text.replace(/^[ \t]*\d{1,2}[.)](?=\s)/gm, " ");
  // Ordinals.
  text = text.replace(/\b\d+(?:st|nd|rd|th)\b/gi, " ");

  const unitRe = Object.keys(UNIT)
    .sort((a, b) => b.length - a.length)
    .join("|");
  const re = new RegExp(`(?<![\\w.,])(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)(\\s*(?:${unitRe})(?![\\p{L}])|\\s*%)?`, "giu");
  const numbers: Mentioned[] = [];
  for (const m of text.matchAll(re)) {
    const raw = m[1]!;
    const clean = raw.replace(/,/g, "");
    const n = Number(clean);
    if (!Number.isFinite(n)) continue;
    const suffix = (m[2] ?? "").trim().toLowerCase();
    const percent = suffix === "%";
    const mult = !percent && suffix ? (UNIT[suffix] ?? 1) : 1;
    const d = decimalsOf(clean);
    const half = 0.5 * 10 ** -d;
    // "1.25 lakh" is good to 0.005 lakh; "5 lakh" is read as 5.00 lakh, so a loose round figure does not pass for an exact one.
    const tol = suffix && !percent ? 0.5 * 10 ** -Math.max(d, 2) * mult : Math.max(half, d === 0 ? 0.5 : 0);
    numbers.push({ text: (raw + (m[2] ?? "")).trim(), value: n * mult, tol: tol + 1e-9, percent, united: !!suffix && !percent });
  }
  return { numbers, isoDates, dayMonths };
}

// ------------------------------------------------------------------ what the tools said

interface Pool {
  /** Every number the sources state (names, dates, the question...), sorted: an answer number may simply equal one. */
  sorted: number[];
  /** The numbers that tools returned as numbers (plus sums over a column and row counts): only these are combined. */
  ops: number[];
  dates: Set<string>;
  monthDays: Set<string>;
  years: Set<number>;
}

const SERIES_ROWS = 12;
const NUM_IN_STRING = /\d+(?:\.\d+)?/g;

/**
 * Walks tool JSON. `direct` gets every number, including digits inside names and dates; `ops` only real numeric values,
 * the length of arrays and sums over a numeric column (the numbers a sum, share or average is made from).
 */
function walk(v: unknown, direct: number[], ops: number[], dates: Set<string>): void {
  if (typeof v === "number") {
    if (Number.isFinite(v)) {
      direct.push(v);
      ops.push(v);
    }
  } else if (typeof v === "string") {
    const s = asciiDigits(v);
    for (const d of s.matchAll(/[0-9]{4}-[0-9]{2}-[0-9]{2}/g)) dates.add(d[0]);
    for (const m of s.matchAll(NUM_IN_STRING)) direct.push(Number(m[0]));
  } else if (Array.isArray(v)) {
    direct.push(v.length);
    ops.push(v.length);
    const objs = v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x));
    if (objs.length > 1) {
      const keys = new Set(objs.flatMap((o) => Object.keys(o)));
      for (const k of keys) {
        const vals = objs.map((o) => o[k]);
        if (!vals.every((x) => typeof x === "number")) continue;
        const long = vals.length > SERIES_ROWS;
        const add = (n: number, operand: boolean) => {
          const r = Math.round(n * 100) / 100;
          direct.push(r);
          if (operand) ops.push(r);
        };
        let run = 0;
        (vals as number[]).forEach((x, i) => {
          run += x;
          if (i >= 1) add(run, !long || i === vals.length - 1); // the first i+1 rows added up (all rows at the end)
        });
        if (!long) {
          let tail = 0;
          for (let i = vals.length - 1; i >= 1; i--) {
            tail += vals[i] as number;
            add(tail + (vals[i - 1] as number), true); // the last rows added up
          }
        }
      }
    }
    // Rows of a long series (a daily breakdown) can be quoted, but are not combined with each other.
    const quiet = v.length > SERIES_ROWS;
    for (const x of v) walk(x, direct, quiet ? [] : ops, dates);
  } else if (v && typeof v === "object") {
    for (const x of Object.values(v)) walk(x, direct, ops, dates);
  }
}

function buildPool(evidence: Evidence[], sources: string[]): Pool {
  const direct: number[] = [0];
  const ops: number[] = [];
  const dates = new Set<string>();
  const ranges: [string, string][] = [];
  const argNums: number[] = [];
  for (const e of evidence) {
    walk(e.data, direct, ops, dates);
    walk(e.args, argNums, [], dates);
    const d = e.data as { from?: unknown; to?: unknown } | null;
    if (d && typeof d.from === "string" && typeof d.to === "string") ranges.push([d.from, d.to]);
  }
  direct.push(...argNums);
  for (const s of sources) {
    const t = asciiDigits(s);
    for (const d of t.matchAll(/[0-9]{4}-[0-9]{2}-[0-9]{2}/g)) dates.add(d[0]);
    const ex = extractNumbers(t);
    for (const n of ex.numbers) {
      direct.push(n.value);
      direct.push(Number(n.text.replace(/[^\d.]/g, "")) || 0); // "5 thousand" also as 5
    }
    for (const dm of ex.dayMonths) direct.push(dm.day, dm.month);
    for (const m of t.matchAll(NUM_IN_STRING)) direct.push(Number(m[0]));
  }
  // Days in each range the tools were asked about (for daily averages).
  for (const [a, b] of ranges) {
    const days = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
    if (days > 0 && days < 4000) {
      direct.push(days);
      ops.push(days);
    }
  }
  const monthDays = new Set<string>();
  const years = new Set<number>();
  for (const d of dates) {
    monthDays.add(`${Number(d.slice(5, 7))}-${Number(d.slice(8, 10))}`);
    years.add(Number(d.slice(0, 4)));
    direct.push(Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10)));
  }
  // A loss is written as a positive amount ("a loss of ₹2,81,682"): negative figures count by their size too.
  const uniq = (xs: number[]) => [...new Set(xs.filter((n) => Number.isFinite(n)).flatMap((n) => (n < 0 ? [n, -n] : [n])))].sort((x, y) => x - y);
  for (const y of [...years]) {
    years.add(y - 1);
    years.add(y + 1);
  }
  return { sorted: uniq(direct), ops: uniq(ops), dates, monthDays, years };
}

/** True when some number of the sorted pool lies in [lo, hi]. */
function hasIn(sorted: number[], lo: number, hi: number): boolean {
  if (!(lo <= hi)) return false;
  let a = 0;
  let b = sorted.length - 1;
  while (a <= b) {
    const mid = (a + b) >> 1;
    const v = sorted[mid]!;
    if (v < lo) a = mid + 1;
    else if (v > hi) b = mid - 1;
    else return true;
  }
  return false;
}

const MAX_PAIR_POOL = 700;
const lg = (n: number) => Math.log10(Math.abs(n) + 1);

/**
 * Is `m` (within its rounding) one of the source numbers, or made from two tool numbers the simple way people do?
 *   money / counts:  a + b, a - b, a / b (an average or a multiple)
 *   percentages:     a / b * 100 (a share), (a - b) / b * 100 (a change)
 * Nothing else (no products, no chains), so a made-up figure does not slip through by luck.
 */
function traced(m: Mentioned, pool: Pool): boolean {
  const { value: x, tol } = m;
  if (hasIn(pool.sorted, x - tol, x + tol)) return true;
  if (m.united) return false; // "1.25 lakh" is only good to +-500: too loose to be built from a sum by luck
  const all = pool.ops;
  if (all.length === 0) return false;
  const near = all.length > MAX_PAIR_POOL ? [...all].sort((p, q) => Math.abs(lg(p) - lg(x)) - Math.abs(lg(q) - lg(x))).slice(0, MAX_PAIR_POOL) : all;
  const partners = near === all ? all : [...near].sort((p, q) => p - q);
  const t2 = tol + 0.011; // a sum or difference carries the rounding of both parts
  for (const a of near) {
    if (!m.percent) {
      if (hasIn(partners, x - a - t2, x - a + t2) && x - a !== 0) return true;
      if (hasIn(partners, a - x - t2, a - x + t2) && a - x !== 0) return true;
      if (a > 0 && x > t2) {
        // a / b = x  ->  b = a / x
        const lo = a / (x + tol);
        const hi = a / (x - tol > 0 ? x - tol : 1e-9);
        if (lo > 0 && hasIn(partners, lo * (1 - 1e-9), hi * (1 + 1e-9))) return true;
      }
    } else {
      if (a > 0 && x > tol) {
        // share: a / b * 100 = x  ->  b = a * 100 / x
        const lo = (a * 100) / (x + tol);
        const hi = (a * 100) / (x - tol);
        if (hasIn(partners, lo * (1 - 1e-9), hi * (1 + 1e-9))) return true;
      }
      if (a > 0) {
        // change: (c - a) / a * 100 = x  ->  c = a * (1 + x / 100)
        const target = a * (1 + x / 100);
        const slack = a * (tol / 100) + 0.011;
        if (hasIn(partners, target - slack, target + slack)) return true;
      }
    }
  }
  return false;
}

export interface VerifyResult {
  ok: boolean;
  /** The numbers (as written) and dates that could not be traced to the tool results. */
  untraced: string[];
  checked: number;
}

/**
 * Checks every number and date in `reply` against what the tools returned (plus the question, the earlier turns and
 * today's date). `sources` are those extra texts.
 */
export function verifyNumbers(reply: string, evidence: Evidence[], sources: string[] = []): VerifyResult {
  const ex = extractNumbers(reply);
  const pool = buildPool(evidence, sources);
  const untraced: string[] = [];
  for (const n of ex.numbers) {
    if (n.value === 0 || n.value === 0.0) continue;
    // A year inside a financial year label or a date: fine when it belongs to a date the sources mention.
    if (Number.isInteger(n.value) && n.value >= 1990 && n.value <= 2100 && pool.years.has(n.value)) continue;
    if (!traced(n, pool)) untraced.push(n.text);
  }
  for (const d of ex.isoDates) if (!pool.dates.has(d)) untraced.push(d);
  for (const dm of ex.dayMonths) if (!pool.monthDays.has(`${dm.month}-${dm.day}`)) untraced.push(dm.text);
  return { ok: untraced.length === 0, untraced: [...new Set(untraced)], checked: ex.numbers.length + ex.isoDates.length + ex.dayMonths.length };
}
