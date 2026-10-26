import { fractionOf, isConnector, isFiller, isRupeeWord, numberWord, unitOf, UNIT_FAMILY, UNIT_SUFFIXES, isHundredsWord, isTensWord, type Unit } from "./lexicon";
import { asciiDigits } from "./phonetic";

/**
 * The deterministic part of Tamil voice billing: turns what a cashier said ("ரெண்டு கிலோ பொன்னி அரிசி, ஒரு நல்லெண்ணெய், அரை கிலோ
 * துவரம் பருப்பு, மூணு பால் பாக்கெட்") into lines { item words, quantity, unit }. No model is involved and nothing is looked up
 * in the catalogue here (`match.ts` does that). The words are data: they are only read, never obeyed.
 */

export interface SpokenLine {
  /** What was said for this line, for the review strip. */
  raw: string;
  /** The item words with numbers, units, fillers and connectors removed ("பொன்னி அரிசி"). Packet-like unit words stay (low weight). */
  phrase: string;
  /** Quantity in `unit` (1 when none was said). */
  qty: number;
  unit: Unit | null;
  /** The cashier said a number (false = the 1 is a default). */
  qtyExplicit: boolean;
  /** "50 rupees of rice": an amount instead of a quantity (the cashier sets the quantity). */
  amount: number | null;
  issues: SpokenIssue[];
}
export type SpokenIssue = "amount" | "qty_odd" | "unit_only" | "no_item";

export interface ParseResult {
  lines: SpokenLine[];
  /** Words and numbers that stood alone (no item) and were left out, so the cashier can see nothing was silently used. */
  ignored: string[];
}

type Atom =
  | { t: "num"; v: number; frac: boolean; raw: string }
  | { t: "unit"; u: Unit; raw: string }
  | { t: "word"; w: string; raw: string }
  | { t: "rupee"; raw: string }
  | { t: "break"; raw: string };

const VULGAR: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };
const SANDHI = /[கசதப]்$/u;

/** Cleans a transcript for tokenising: digits to ASCII, punctuation to spaces, hard breaks kept as "|". */
export function normalizeTranscript(text: string): string {
  return asciiDigits(text.normalize("NFC"))
    .replace(/[​-‏‪-‮﻿]/g, "")
    .replace(/₹/g, " ₹ ")
    .replace(/[,;\n\r|।]+/g, " | ")
    .replace(/(\d)\.(?!\d)/g, "$1 | ")
    .replace(/(?<!\d)\.(?!\d)/g, " | ")
    .replace(/(\d)([^\d\s./½¼¾|])/g, "$1 $2")
    .replace(/([½¼¾])(?=\S)/g, "$1 ")
    .replace(/[!?"“”()[\]{}<>:*#@]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numericToken(t: string): { v: number; frac: boolean } | null {
  if (/^\d+(?:\.\d+)?$/.test(t)) return { v: Number(t), frac: false };
  if (/^\d+,\d{1,2}$/.test(t)) return { v: Number(t.replace(",", ".")), frac: false };
  const f = t.match(/^(\d+)\/(\d+)$/);
  if (f && Number(f[2]) > 0) return { v: Number(f[1]) / Number(f[2]), frac: true };
  if (VULGAR[t] !== undefined) return { v: VULGAR[t]!, frac: true };
  const mixed = t.match(/^(\d+)([½¼¾])$/);
  if (mixed) return { v: Number(mixed[1]) + VULGAR[mixed[2]!]!, frac: false };
  return null;
}

/** A number-ish word (digit string, number word, fraction word) as an atom, or null. */
function numAtom(t: string): { v: number; frac: boolean } | null {
  const d = numericToken(t);
  if (d) return d;
  const f = fractionOf(t);
  if (f !== null) return { v: f, frac: true };
  const n = numberWord(t);
  if (n !== null) return { v: n, frac: !Number.isInteger(n) };
  return null;
}

function toAtoms(text: string): Atom[] {
  const tokens = normalizeTranscript(text.toLowerCase()).split(" ").filter(Boolean);
  const atoms: Atom[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!;
    if (raw === "|") {
      atoms.push({ t: "break", raw });
      continue;
    }
    // "one and a half", "one and half": the "and" and "a" belong to the number
    if ((raw === "and" || raw === "&") && atoms.at(-1)?.t === "num") {
      let j = i + 1;
      if (tokens[j] === "a") j++;
      const nxt = tokens[j];
      if (nxt && (fractionOf(nxt) !== null || numericToken(nxt)?.frac)) {
        i = j - 1;
        continue;
      }
    }
    const n = numAtom(raw);
    if (n) {
      atoms.push({ t: "num", v: n.v, frac: n.frac, raw });
      continue;
    }
    const u = unitOf(raw);
    if (u) {
      atoms.push({ t: "unit", u, raw });
      continue;
    }
    // number and unit in one word: "ரெண்டுகிலோ", "அரைக்கிலோ", "2kg" (split above for digits)
    let fusedHit = false;
    if (/[஀-௿]/.test(raw)) {
      for (const [suffix, unit] of UNIT_SUFFIXES) {
        if (raw.length <= suffix.length || !raw.endsWith(suffix)) continue;
        const prefix = raw.slice(0, -suffix.length).replace(SANDHI, "");
        const pn = prefix ? numAtom(prefix) : null;
        if (pn) {
          atoms.push({ t: "num", v: pn.v, frac: pn.frac, raw: prefix });
          atoms.push({ t: "unit", u: unit, raw: suffix });
          fusedHit = true;
          break;
        }
      }
    }
    if (fusedHit) continue;
    if (isRupeeWord(raw)) {
      atoms.push({ t: "rupee", raw });
      continue;
    }
    if (isConnector(raw)) {
      atoms.push({ t: "break", raw });
      continue;
    }
    if (isFiller(raw)) continue;
    atoms.push({ t: "word", w: raw, raw });
  }
  // merge number runs: "இருபது ஐந்து" = 25, "இருநூறு ஐம்பது" = 250, "1 அரை" = 1.5
  const merged: Atom[] = [];
  for (const a of atoms) {
    const prev = merged.at(-1);
    if (a.t === "num" && prev?.t === "num") {
      if (!prev.frac && !a.frac && isTensWord(prev.v) && a.v >= 1 && a.v <= 9) {
        merged[merged.length - 1] = { t: "num", v: prev.v + a.v, frac: false, raw: `${prev.raw} ${a.raw}` };
        continue;
      }
      if (!prev.frac && !a.frac && isHundredsWord(prev.v) && Number.isInteger(a.v) && a.v >= 1 && a.v < 100) {
        merged[merged.length - 1] = { t: "num", v: prev.v + a.v, frac: false, raw: `${prev.raw} ${a.raw}` };
        continue;
      }
      if (!prev.frac && Number.isInteger(prev.v) && a.frac && a.v < 1) {
        merged[merged.length - 1] = { t: "num", v: prev.v + a.v, frac: false, raw: `${prev.raw} ${a.raw}` };
        continue;
      }
    }
    merged.push(a);
  }
  return merged;
}

interface Cur {
  qty: number | null;
  unit: Unit | null;
  words: string[];
  raw: string[];
  /** "pre": the number came before the item words; "post": after. */
  pos: "pre" | "post" | null;
  amount: number | null;
}
const fresh = (): Cur => ({ qty: null, unit: null, words: [], raw: [], pos: null, amount: null });

/** Unit words that are usually part of an item's name ("milk packet"): kept in the phrase with a low weight. */
const NAME_UNITS = new Set<Unit>(["pkt", "bottle", "box", "strip", "bunch"]);

export function parseUtterance(transcript: string): ParseResult {
  const atoms = toAtoms(transcript);
  const first = atoms.find((a) => a.t === "num" || a.t === "word" || a.t === "unit");
  const style: "pre" | "post" = first?.t === "word" ? "post" : "pre";
  const lines: SpokenLine[] = [];
  const ignored: string[] = [];
  let cur = fresh();

  const flush = () => {
    const phrase = cur.words.join(" ").trim();
    if (!phrase) {
      if (cur.raw.length) ignored.push(cur.raw.join(" "));
    } else {
      const issues: SpokenIssue[] = [];
      let qty = cur.qty;
      let explicit = qty !== null;
      if (cur.amount !== null) issues.push("amount");
      if (qty === null) {
        qty = 1;
        explicit = false;
      }
      if (!(qty > 0) || qty > 100_000) issues.push("qty_odd");
      lines.push({ raw: cur.raw.join(" "), phrase, qty: Math.round(qty * 1000) / 1000, unit: cur.unit, qtyExplicit: explicit && cur.amount === null, amount: cur.amount, issues });
    }
    cur = fresh();
  };

  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]!;
    const next = atoms[i + 1];
    switch (a.t) {
      case "break":
        flush();
        break;
      case "num": {
        if (cur.qty !== null) flush();
        if (cur.words.length > 0 && cur.qty === null) {
          // a number after item words: "அரிசி ரெண்டு கிலோ" belongs to them when it has a unit, or when the cashier speaks item-first
          if (style === "post" || next?.t === "unit") {
            cur.qty = a.v;
            cur.pos = "post";
            cur.raw.push(a.raw);
            break;
          }
          flush();
        }
        cur.qty = a.v;
        cur.pos = "pre";
        cur.raw.push(a.raw);
        break;
      }
      case "unit": {
        cur.raw.push(a.raw);
        if (cur.qty === null && cur.words.length === 0) {
          // a unit alone ("கிலோ பொன்னி அரிசி"): one of it
          cur.qty = 1;
          cur.unit = a.u;
          cur.pos = "pre";
        } else if (cur.qty !== null && cur.unit === null) {
          cur.unit = a.u;
          if (NAME_UNITS.has(a.u)) cur.words.push(a.raw);
        } else if (cur.qty !== null && cur.unit !== null && cur.pos === "post") {
          flush();
          cur.qty = 1;
          cur.unit = a.u;
          cur.pos = "pre";
          cur.raw.push(a.raw);
        } else if (NAME_UNITS.has(a.u)) cur.words.push(a.raw);
        break;
      }
      case "rupee": {
        cur.raw.push(a.raw);
        if (cur.qty !== null && cur.unit === null) {
          cur.amount = cur.qty;
          cur.qty = null;
        } else if (cur.qty === null && cur.words.length === 0 && lines.length > 0) {
          // "அரிசி 50 ரூபாய்": the number was cut into its own line; give it back to the previous line
          const prev = lines.at(-1)!;
          if (prev.amount === null && !prev.qtyExplicit) {
            prev.amount = atoms[i - 1]?.t === "num" ? (atoms[i - 1] as { v: number }).v : null;
            prev.issues.push("amount");
          }
        }
        break;
      }
      case "word": {
        if (cur.pos === "post" && cur.qty !== null) flush();
        // a word after a finished "number + unit" line starts nothing new in prefix style (the item words follow the quantity)
        cur.words.push(a.w);
        cur.raw.push(a.raw);
        break;
      }
    }
  }
  flush();
  // a line whose number was cut off by a rupee word and left empty
  return { lines: lines.filter((l) => l.phrase), ignored };
}

/** Converts a quantity in one unit to another of the same family (kg to g...). Null when the units cannot be converted. */
export function convertQty(qty: number, from: Unit, to: Unit): number | null {
  const f = UNIT_FAMILY[from];
  const t = UNIT_FAMILY[to];
  if (f.family !== t.family) return null;
  return Math.round(((qty * f.toBase) / t.toBase) * 1000) / 1000;
}
