import { GLOSSARY, UNIT_FAMILY, unitOf, type Unit } from "./lexicon";
import { skeleton, soundSimilarity, words } from "./phonetic";
import type { SpokenLine } from "./parse";

/**
 * Finds the catalogue item a spoken phrase means, in code. Everything the shop already has is used: the item name, variant,
 * the approved Tamil name, the AI search words (Tanglish spellings, synonyms) and a built-in glossary of everyday Tamil
 * grocery words. Tamil script and Latin spellings are compared by sound (`phonetic.ts`). Nothing here calls a model.
 */

export interface CounterItem {
  itemId: string;
  productId?: string | null;
  /** "Product" or "Product – Variant". */
  name: string;
  sku?: string | null;
  barcodes?: string[];
  unit: string;
  soldBy: "unit" | "weight";
  /** Paise per unit as sold. */
  price: number;
  taxInclusive: boolean;
  gstRate: number;
  gstRule?: unknown;
  hsn?: string | null;
  image?: string | null;
  /** Approved Tamil product name (Phase 1 translations), when there is one. */
  nameTa?: string | null;
  /** AI search words (Phase 4): Tamil, Tanglish, synonyms, spellings. */
  aliases?: string[];
  /** Units sold in the last 90 days: breaks ties between look-alikes. */
  popularity?: number;
}

interface Tok {
  raw: string;
  sk: string;
  concept: string | null;
  /** 1 for a name word, lower for a number or a size. */
  w: number;
  /** A joined pair of neighbouring name words ("toordal"): the positions it stands for. */
  cover?: number[];
}
interface Indexed {
  item: CounterItem;
  toks: Tok[];
  /** The size in the name ("5 kg", "500 ml"), if any. */
  pack: { value: number; unit: Unit } | null;
}
export interface CounterIndex {
  items: Indexed[];
  /** Items per concept / skeleton key, for the word weights. */
  df: Map<string, number>;
  n: number;
}

const conceptOfSk = new Map<string, string>();
for (const [concept, variants] of Object.entries(GLOSSARY)) {
  conceptOfSk.set(skeleton(concept), concept);
  for (const v of variants) {
    const sk = skeleton(v);
    if (sk.length >= 2 && !conceptOfSk.has(sk)) conceptOfSk.set(sk, concept);
  }
}

const NAME_UNITS: Unit[] = ["pkt", "bottle", "box", "strip", "bunch"];

const DESCRIPTORS = new Set(["loose", "pack", "packet", "packets", "bag", "bags", "pouch", "sachet", "bar", "pair", "nos"]);

function tokOf(raw: string): Tok | null {
  const sk = skeleton(raw);
  if (!sk) return null;
  const isNum = /^\d/.test(raw);
  const u = unitOf(raw);
  const concept = isNum ? null : (conceptOfSk.get(sk) ?? null);
  const w = isNum ? 0.25 : u ? (NAME_UNITS.includes(u) ? 0.3 : 0.1) : DESCRIPTORS.has(raw) ? 0.3 : 1;
  return { raw, sk, concept, w };
}

const PACK = /(\d+(?:\.\d+)?)\s*(kg|gm|g|ml|ltr|litre|liter|l)\b/i;
export function packSizeOf(name: string): { value: number; unit: Unit } | null {
  const m = name.toLowerCase().match(PACK);
  if (!m) return null;
  const u = unitOf(m[2]!);
  const v = Number(m[1]);
  return u && v > 0 ? { value: v, unit: u } : null;
}

export function buildCounterIndex(items: CounterItem[]): CounterIndex {
  const out: Indexed[] = [];
  const df = new Map<string, number>();
  for (const item of items) {
    const sources = [item.name, item.nameTa ?? "", ...(item.aliases ?? []), item.sku ?? ""];
    const seen = new Set<string>();
    const toks: Tok[] = [];
    let nameCount = 0;
    sources.forEach((src, si) => {
      for (const w of words(src)) {
        const t = tokOf(w);
        if (!t) continue;
        // the item's own name words are the ones that must be "explained" by the phrase; aliases only add ways to say them
        const key = `${si === 0 ? "n" : "a"}:${t.concept ?? t.sk}`;
        if (seen.has(key)) continue;
        seen.add(key);
        toks.push(si === 0 ? t : { ...t, w: Math.min(t.w, 0.9) });
      }
      if (si === 0) nameCount = toks.length;
    });
    // neighbouring name words also count as one joined word ("toor dal" = "toordal")
    for (let i = 0; i + 1 < Math.min(nameCount, 6); i++) {
      const a = toks[i]!;
      const b = toks[i + 1]!;
      if (a.w < 0.9 || b.w < 0.9) continue;
      const sk = a.sk + b.sk;
      toks.push({ raw: a.raw + b.raw, sk, concept: null, w: 0, cover: [i, i + 1] });
    }
    const keys = new Set(toks.filter((t) => !t.cover).map((t) => t.concept ?? t.sk));
    for (const k of keys) df.set(k, (df.get(k) ?? 0) + 1);
    out.push({ item, toks, pack: packSizeOf(item.name) });
  }
  return { items: out, df, n: out.length };
}

const idf = (idx: CounterIndex, key: string) => Math.max(0.35, Math.log(1 + idx.n / ((idx.df.get(key) ?? 0) + 1)) / Math.log(1 + idx.n));

function tokMatch(p: Tok, t: Tok): number {
  if (p.concept && t.concept && p.concept === t.concept) return p.sk === t.sk ? 1 : 0.95;
  if (p.sk === t.sk) return 0.97;
  if (p.sk.length >= 4 && t.sk.length >= 4 && (p.sk.startsWith(t.sk) || t.sk.startsWith(p.sk)) && Math.min(p.sk.length, t.sk.length) >= 4) return 0.8;
  return soundSimilarity(p.sk, t.sk) * 0.95;
}

export interface Candidate {
  item: CounterItem;
  /** 0 to 1: how well the words match. */
  score: number;
}

/** Candidates for a phrase, best first (score at least `min`). */
export function matchPhrase(idx: CounterIndex, phrase: string, opts: { min?: number; limit?: number; unit?: Unit | null; preferLoose?: boolean } = {}): Candidate[] {
  const min = opts.min ?? 0.3;
  const ptoks = words(phrase).map(tokOf).filter((t): t is Tok => !!t);
  const real = ptoks.filter((t) => t.w >= 0.3);
  if (!real.length) return [];
  const out: Candidate[] = [];
  for (const ix of idx.items) {
    let num = 0;
    let den = 0;
    const used = new Set<number>();
    for (const p of ptoks) {
      const wt = p.w * idf(idx, p.concept ?? p.sk);
      let best = 0;
      let bi = -1;
      ix.toks.forEach((t, i) => {
        const m = tokMatch(p, t);
        if (m > best) {
          best = m;
          bi = i;
        }
      });
      if (p.w < 0.3 && best < 0.5) continue; // an unmatched "packet" is not held against the item
      num += wt * best;
      den += wt;
      if (best >= 0.7 && bi >= 0) {
        used.add(bi);
        for (const c of ix.toks[bi]!.cover ?? []) used.add(c);
      }
    }
    if (den === 0) continue;
    let score = num / den;
    if (score < min) continue;
    // name words the cashier did not say count against the item a little ("Ponni rice 25 kg" vs "rice")
    const extra = ix.toks.filter((t, i) => !used.has(i) && t.w >= 0.9).length;
    score -= Math.min(0.12, 0.025 * extra);
    score += Math.min(0.02, (Math.log10(1 + (ix.item.popularity ?? 0)) / 5) * 0.02);
    if (opts.unit) score += unitFit(opts.unit, ix);
    else if (opts.preferLoose && looseUnit(ix.item.unit)) score += 0.1;
    // not capped at 1 here: a unit fit bonus must still break a tie between two perfect name matches
    out.push({ item: ix.item, score: Math.max(0, score) });
  }
  out.sort((a, b) => b.score - a.score || (b.item.popularity ?? 0) - (a.item.popularity ?? 0) || a.item.name.length - b.item.name.length);
  return out.slice(0, opts.limit ?? 5);
}

const LOOSE_UNITS = new Set(["kg", "g", "l", "ml", "litre", "liter", "gram", "kilo"]);
const looseUnit = (u: string): Unit | null => {
  const x = u.trim().toLowerCase();
  return LOOSE_UNITS.has(x) ? unitOf(x) : null;
};

/** A small nudge for items sold the way the cashier spoke ("2 kg" prefers the loose-by-kg item over a 25 kg bag). */
function unitFit(spoken: Unit, ix: Indexed): number {
  const fam = UNIT_FAMILY[spoken].family;
  if (fam !== "weight" && fam !== "volume") return 0;
  const loose = looseUnit(ix.item.unit);
  if (loose && UNIT_FAMILY[loose].family === fam) return 0.1;
  if (ix.pack && UNIT_FAMILY[ix.pack.unit].family === fam) return 0.03;
  return -0.03;
}

export type Confidence = "high" | "medium" | "low";
export interface Resolved {
  item: CounterItem;
  score: number;
  confidence: Confidence;
}

/** Top candidate and how sure we are: high needs a clear lead, low needs a tap. */
export function classify(c: Candidate[]): Resolved | null {
  const top = c[0];
  if (!top || top.score < 0.45) return null;
  const second = c[1]?.score ?? 0;
  const lead = top.score - second;
  const confidence: Confidence = top.score >= 0.85 && lead >= 0.08 ? "high" : top.score >= 0.7 && lead >= 0.05 ? "medium" : "low";
  return { item: top.item, score: top.score, confidence };
}

// ------------------------------------------------------------------ quantity against the item

export interface QtyResult {
  qty: number;
  /** The unit the qty is in (the item's own unit). */
  unit: string;
  /** Why the number was changed or could not be trusted ("pack_5kg", "unit_differs"...). */
  note: "none" | "converted" | "packs" | "pack_bigger" | "pack_rounded" | "unit_differs" | "dozen";
  /** The cashier should look at this line. */
  check: boolean;
}

const near = (a: number) => Math.abs(a - Math.round(a)) < 0.001;

/** Turns what was said ("2 kg", "500 g", "1 dozen") into a quantity in the item's own unit. */
export function reconcileQty(line: Pick<SpokenLine, "qty" | "unit">, item: CounterItem): QtyResult {
  const own = item.unit || "pcs";
  const { qty, unit } = line;
  if (!unit) return { qty, unit: own, note: "none", check: false };
  const loose = looseUnit(own);
  if (loose) {
    const f = UNIT_FAMILY[unit];
    const t = UNIT_FAMILY[loose];
    if (f.family === t.family) {
      const q = Math.round(((qty * f.toBase) / t.toBase) * 1000) / 1000;
      return { qty: q, unit: own, note: unit === loose ? "none" : "converted", check: false };
    }
    return { qty, unit: own, note: "unit_differs", check: true };
  }
  const f = UNIT_FAMILY[unit];
  if (unit === "dozen") return { qty: qty * 12, unit: own, note: "dozen", check: false };
  if (f.family === "weight" || f.family === "volume") {
    const pack = packSizeOf(item.name);
    if (pack && UNIT_FAMILY[pack.unit].family === f.family) {
      const n = (qty * f.toBase) / (pack.value * UNIT_FAMILY[pack.unit].toBase);
      if (near(n) && Math.round(n) >= 1) return { qty: Math.round(n), unit: own, note: "packs", check: false };
      if (n < 1) return { qty: 1, unit: own, note: "pack_bigger", check: true };
      return { qty: Math.ceil(n), unit: own, note: "pack_rounded", check: true };
    }
    return { qty, unit: own, note: "unit_differs", check: true };
  }
  return { qty, unit: own, note: "none", check: false };
}
