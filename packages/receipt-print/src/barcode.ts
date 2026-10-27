/**
 * Barcode encoding for labels (docs/counter-close-display-labels.md): Code 128 (sets B and C, switching to C for runs of
 * digits) and EAN-13. Pure: returns the bars as modules (true = dark) so the HTML sheet, the canvas for the label
 * printer and the tests all draw the same thing. Quiet zones are the drawer's job (`QUIET_MODULES`).
 */

/** Bar/space widths of Code 128 symbol values 0..106 (106 = stop, 7 elements). */
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
] as const;

const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

/** Light margin the scanners want on each side, in modules. */
export const QUIET_MODULES = 10;

export type BarcodeType = "code128" | "ean13";

export interface Barcode {
  type: BarcodeType;
  /** The value as encoded (EAN-13: all 13 digits with the check digit). */
  value: string;
  /** Dark (true) and light (false) modules from the first bar to the last, without quiet zones. */
  modules: boolean[];
}

/** Printable ASCII, the only thing Code 128 sets A/B can carry here. */
export const isCode128Text = (text: string): boolean => text.length > 0 && text.length <= 48 && /^[\x20-\x7e]+$/.test(text);

/**
 * Symbol values (start, data, check, stop) for `text`. Starts in set C when the text begins with four or more digits,
 * drops into set C for any later run of four or more digits (an even count; an odd leftover digit stays in B), and
 * goes back to B for the rest. Throws on anything but printable ASCII.
 */
export function code128Values(text: string): number[] {
  if (!isCode128Text(text)) throw new RangeError("Code 128 labels take 1 to 48 printable ASCII characters");
  const values: number[] = [];
  let set: "B" | "C" | null = null;
  let i = 0;
  while (i < text.length) {
    const digits = /^\d*/.exec(text.slice(i))![0].length;
    // A run of digits worth packing in pairs: at the start or inside the text, 4+ digits (2+ pairs); the whole text may be as short as 2.
    const wholeText = i === 0 && digits === text.length && digits >= 2;
    if (digits >= 4 || wholeText) {
      const take = digits - (digits % 2);
      if (set === null) {
        values.push(START_C);
      } else if (set === "B") {
        values.push(CODE_C);
      }
      set = "C";
      for (let k = 0; k < take; k += 2) values.push(Number(text.slice(i + k, i + k + 2)));
      i += take;
      continue;
    }
    if (set === null) {
      values.push(START_B);
    } else if (set === "C") {
      values.push(CODE_B);
    }
    set = "B";
    values.push(text.charCodeAt(i) - 32);
    i += 1;
  }
  let sum = values[0]!;
  for (let k = 1; k < values.length; k++) sum += values[k]! * k;
  values.push(sum % 103, STOP);
  return values;
}

/** Dark/light modules for a Code 128 value. */
export function code128Modules(text: string): boolean[] {
  const out: boolean[] = [];
  for (const v of code128Values(text)) {
    let dark = true;
    for (const ch of PATTERNS[v]!) {
      for (let n = 0; n < Number(ch); n++) out.push(dark);
      dark = !dark;
    }
  }
  return out;
}

// ---------------------------------------------------------------- EAN-13

const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"] as const;
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"] as const;
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"] as const;
/** Which of L / G the six left digits use, by the first digit. */
const EAN_FIRST = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"] as const;

/** The check digit of the first 12 digits of an EAN-13. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new RangeError("EAN-13 needs 12 digits before the check digit");
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** 13 digits with a correct check digit. */
export const isEan13 = (code: string): boolean => /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);

/** 12 digits get their check digit; 13 digits must already have the right one. Throws otherwise. */
export function normalizeEan13(code: string): string {
  const c = code.trim();
  if (/^\d{12}$/.test(c)) return `${c}${ean13CheckDigit(c)}`;
  if (isEan13(c)) return c;
  throw new RangeError("Not a valid EAN-13");
}

/** The 95 modules of an EAN-13 (guards included). */
export function ean13Modules(code: string): boolean[] {
  const c = normalizeEan13(code);
  const parity = EAN_FIRST[Number(c[0])]!;
  let bits = "101";
  for (let i = 0; i < 6; i++) bits += (parity[i] === "L" ? EAN_L : EAN_G)[Number(c[1 + i])]!;
  bits += "01010";
  for (let i = 0; i < 6; i++) bits += EAN_R[Number(c[7 + i])]!;
  bits += "101";
  return [...bits].map((b) => b === "1");
}

// ---------------------------------------------------------------- choosing

/**
 * The barcode for an item's code. `auto` uses EAN-13 for 13 valid digits (or 12, which get their check digit) and
 * Code 128 for everything else printable (SKUs, internal codes, box barcodes). Returns null when the text can't be a
 * barcode (empty, too long, non-ASCII), or `ean13` was asked for something that is not an EAN-13.
 */
export function barcodeFor(value: string | null | undefined, want: "auto" | BarcodeType = "auto"): Barcode | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (want !== "code128" && (/^\d{12}$/.test(v) || isEan13(v))) {
    const code = normalizeEan13(v);
    return { type: "ean13", value: code, modules: ean13Modules(code) };
  }
  if (want === "ean13") return null;
  if (!isCode128Text(v)) return null;
  return { type: "code128", value: v, modules: code128Modules(v) };
}

/** Bar and space widths in modules, starting with a bar: for drawing as rectangles. */
export function moduleRuns(modules: readonly boolean[]): number[] {
  const runs: number[] = [];
  let cur = true;
  let n = 0;
  for (const m of modules) {
    if (m === cur) n++;
    else {
      runs.push(n);
      cur = m;
      n = 1;
    }
  }
  if (n) runs.push(n);
  // The first run is always a bar (both symbologies start dark).
  return modules[0] === false ? [0, ...runs] : runs;
}
