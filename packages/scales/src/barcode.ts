/**
 * In-store EAN-13 labels printed by electronic weighing scales (grocery, bakery, fruit & veg, meat, fish).
 *
 *   2 1 | 0 0 0 4 2 | 0 1 2 5 0 | 9
 *   prefix  PLU       value       EAN-13 check digit
 *
 * The prefix (GS1 "restricted circulation" 20–29) says it's a scale label, the PLU is the item code the scale was
 * loaded with, and the value is either the net weight in grams (1.250 kg) or the price in paise (₹12.50).
 * `prefix length + pluDigits + valueDigits` must be 12.
 *
 * Pure and browser-safe (no imports): the POS reads it through `@rbms/scales/barcode`.
 */

export type ScaleValueKind = "weight" | "price";

export interface ScaleBarcodeFormat {
  /** Leading digits that mark a scale label, e.g. ["21", "22"]. All the same length (1–3 digits). */
  prefixes: string[];
  /** Digits of the item code (PLU), 1–6. */
  pluDigits: number;
  /** Digits of the value, 3–7: grams for "weight", paise for "price". */
  valueDigits: number;
  valueKind: ScaleValueKind;
}

/** Prefixes 20–29, 5-digit PLU, 5-digit weight in grams (up to 99.999 kg). */
export const DEFAULT_SCALE_FORMAT: ScaleBarcodeFormat = {
  prefixes: ["20", "21", "22", "23", "24", "25", "26", "27", "28", "29"],
  pluDigits: 5,
  valueDigits: 5,
  valueKind: "weight",
};

export interface ParsedScaleBarcode {
  plu: number;
  /** Net weight (kg, 3 decimals) for "weight" labels. */
  weightKg?: number;
  /** Amount printed on the label (paise) for "price" labels. */
  pricePaise?: number;
  /** The raw value digits as a number (grams or paise; a count on "by count" PLUs). */
  value: number;
  /** The prefix that matched. */
  prefix: string;
}

const DIGITS = /^\d+$/;

/** EAN-13 check digit of the first 12 digits (weights 1, 3, 1, 3 … from the left). Throws on anything but 12 digits. */
export function ean13CheckDigit(first12: string): number {
  if (first12.length !== 12 || !DIGITS.test(first12)) throw new RangeError("EAN-13 needs 12 digits before the check digit");
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** 13 digits with a correct check digit. */
export function isValidEan13(code: string): boolean {
  return code.length === 13 && DIGITS.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Why a format can't work, or null when it's fine (settings forms show this). */
export function scaleFormatProblem(format: ScaleBarcodeFormat): string | null {
  const { prefixes, pluDigits, valueDigits, valueKind } = format;
  if (!Array.isArray(prefixes) || prefixes.length === 0) return "Add at least one prefix";
  if (prefixes.some((p) => typeof p !== "string" || !/^\d{1,3}$/.test(p))) return "Prefixes are 1 to 3 digits";
  const len = prefixes[0]!.length;
  if (prefixes.some((p) => p.length !== len)) return "All prefixes must have the same number of digits";
  if (new Set(prefixes).size !== prefixes.length) return "Each prefix only once";
  if (!Number.isInteger(pluDigits) || pluDigits < 1 || pluDigits > 6) return "PLU digits must be 1 to 6";
  if (!Number.isInteger(valueDigits) || valueDigits < 3 || valueDigits > 7) return "Value digits must be 3 to 7";
  if (valueKind !== "weight" && valueKind !== "price") return "Value is weight or price";
  if (len + pluDigits + valueDigits !== 12) return `Prefix (${len}) + PLU (${pluDigits}) + value (${valueDigits}) digits must add up to 12`;
  return null;
}

/** Largest PLU the format can carry (also capped at 99999, the item code range). */
export function maxPlu(format: Pick<ScaleBarcodeFormat, "pluDigits">): number {
  return Math.min(99_999, 10 ** format.pluDigits - 1);
}

const clean = (code: string) => (typeof code === "string" ? code.trim() : "");

function matchPrefix(code: string, format: ScaleBarcodeFormat): string | null {
  return format.prefixes.find((p) => code.startsWith(p)) ?? null;
}

/** A 13-digit code with a valid check digit that starts with one of the format's prefixes. */
export function isScaleBarcode(code: string, format: ScaleBarcodeFormat = DEFAULT_SCALE_FORMAT): boolean {
  const c = clean(code);
  return scaleFormatProblem(format) === null && isValidEan13(c) && matchPrefix(c, format) !== null;
}

/**
 * Reads a scale label. Null when it isn't one: wrong length, bad check digit, unknown prefix, PLU 0 or a zero value.
 * Weight labels give `weightKg` (grams / 1000), price labels `pricePaise`.
 */
export function parseScaleBarcode(code: string, format: ScaleBarcodeFormat = DEFAULT_SCALE_FORMAT): ParsedScaleBarcode | null {
  const c = clean(code);
  if (scaleFormatProblem(format) !== null || !isValidEan13(c)) return null;
  const prefix = matchPrefix(c, format);
  if (prefix === null) return null;
  const pluStart = prefix.length;
  const valueStart = pluStart + format.pluDigits;
  const plu = Number(c.slice(pluStart, valueStart));
  const value = Number(c.slice(valueStart, valueStart + format.valueDigits));
  if (plu < 1 || plu > 99_999 || value <= 0) return null;
  return format.valueKind === "weight"
    ? { plu, weightKg: Math.round(value) / 1000, value, prefix }
    : { plu, pricePaise: value, value, prefix };
}

export interface BuildScaleBarcodeInput {
  plu: number;
  /** For "weight" formats: net weight in kg (rounded to whole grams). */
  weightKg?: number;
  /** For "price" formats: label amount in paise. */
  pricePaise?: number;
  /** Which prefix to print; default the format's first. */
  prefix?: string;
}

/**
 * The 13 digits a scale would print (label previews and tests). Null when it doesn't fit: bad format, PLU out of
 * range, a value that needs more digits than the format has, or the value for the other kind.
 */
export function buildScaleBarcode(input: BuildScaleBarcodeInput, format: ScaleBarcodeFormat = DEFAULT_SCALE_FORMAT): string | null {
  if (scaleFormatProblem(format) !== null) return null;
  const prefix = input.prefix ?? format.prefixes[0]!;
  if (!format.prefixes.includes(prefix)) return null;
  const { plu } = input;
  if (!Number.isInteger(plu) || plu < 1 || plu > maxPlu(format)) return null;
  const raw = format.valueKind === "weight" ? (input.weightKg === undefined ? NaN : Math.round(input.weightKg * 1000)) : input.pricePaise === undefined ? NaN : Math.round(input.pricePaise);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 10 ** format.valueDigits - 1) return null;
  const first12 = `${prefix}${String(plu).padStart(format.pluDigits, "0")}${String(raw).padStart(format.valueDigits, "0")}`;
  return `${first12}${ean13CheckDigit(first12)}`;
}
