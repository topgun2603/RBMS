/**
 * The number rule for Phase 2 text: numbers are computed in code, the AI only writes words around them. Every number in
 * AI text must trace to the facts sheet that was given to the model. If one does not, the caller throws the AI text away
 * and uses its deterministic template.
 */

const TAMIL_DIGITS = "௦௧௨௩௪௫௬௭௮௯";

/** Tamil digits to ASCII, so "௧௨" and "12" are the same number. */
export function asciiDigits(s: string): string {
  return s.replace(/[௦-௯]/g, (d) => String(TAMIL_DIGITS.indexOf(d)));
}

/** Canonical form of a numeric token: "12,450.50" -> "12450.5", "007" -> "7". */
export function canonNumber(token: string): string {
  const n = Number(token.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : token;
}

/** Every number written in the text (Latin or Tamil digits, Indian or Western grouping), canonical. */
export function numbersIn(text: string): string[] {
  const t = asciiDigits(text);
  const out: string[] = [];
  for (const m of t.matchAll(/\d+(?:,\d{2,3})*(?:\.\d+)?/g)) out.push(canonNumber(m[0]));
  return out;
}

export interface NumberCheck {
  ok: boolean;
  /** Numbers in the text that are not in the facts. */
  unknown: string[];
}

/** The set of numbers a text may use: everything written in the facts sheet (plus any extra allowed values). */
export function allowedNumbers(factsSheet: string, extra: (number | string)[] = []): Set<string> {
  const set = new Set(numbersIn(factsSheet));
  for (const e of extra) set.add(canonNumber(String(e)));
  return set;
}

/** True when every number in `text` is in `allowed`. Placeholders such as {{1}} are ignored. */
export function checkNumbers(text: string, allowed: Set<string>): NumberCheck {
  const unknown = [...new Set(numbersIn(text.replace(/\{\{\s*\d+\s*\}\}/g, " ")).filter((n) => !allowed.has(n)))];
  return { ok: unknown.length === 0, unknown };
}

/** Whole rupees from paise, Indian grouping: 1245000 -> "₹12,450". Paise shown only when not whole. */
export function rupees(paise: number): string {
  const r = Math.round(paise) / 100;
  const whole = Number.isInteger(r);
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** A quantity with at most 2 decimals and no trailing zeros. */
export const qtyText = (n: number): string => String(Math.round(n * 100) / 100);
