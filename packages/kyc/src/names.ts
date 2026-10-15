/**
 * Name matching for Indian names across PAN, bank, UPI, GST and Aadhaar records, which spell the same person differently:
 * "S. Gowtham Kumar", "GOWTHAM KUMAR S", "Mr. Gowtham Kumar", "GOWTHAMKUMAR S". Pure, no I/O.
 *
 * Score (0–100) is a Dice coefficient over weighted tokens: full words weigh 1, initials 0.5.
 * - same word on both sides: full credit (1 + 1)
 * - near-identical words (edit similarity ≥ 0.8, e.g. MOHAMMED / MOHAMED): credit scaled by the similarity
 * - an initial and a word starting with that letter: 0.5 + 0.5 (the word keeps half its weight unmatched)
 * - same initial on both sides: 0.5 + 0.5
 * Order never matters. Identical token sets score 100; the same letters with different spacing ("GOWTHAMKUMAR" vs
 * "GOWTHAM KUMAR") score at least 95.
 */

/** Honorifics dropped from the start of a name. */
const LEADING_TITLES = new Set([
  "MR",
  "MRS",
  "MS",
  "MISS",
  "MASTER",
  "DR",
  "PROF",
  "SHRI",
  "SHREE",
  "SRI",
  "SMT",
  "KUM",
  "KUMARI",
  "SELVI",
  "THIRU",
  "TMT",
  "SIR",
  "MESSRS",
]);

/** Business-name spelling variants mapped to one form. */
const CANONICAL: Record<string, string> = {
  PRIVATE: "PVT",
  PVT: "PVT",
  LIMITED: "LTD",
  LTD: "LTD",
  COMPANY: "CO",
  CORPORATION: "CORP",
  ENTERPRISE: "ENTERPRISES",
  TRADER: "TRADERS",
  "&": "AND",
};

const VOWELS = /[AEIOUY]/;

/**
 * Upper-cases, drops `M/S`, relation clauses (`S/O …`, `D/O …`, `W/O …`, `C/O …`), punctuation and leading titles,
 * splits vowel-less 2–3 letter clumps into initials ("SG" → "S G"), canonicalises business words. Returns tokens.
 */
export function nameTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  let s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
  s = s.replace(/\b[SDWC]\s*\/\s*O\b.*$/, " "); // "RAVI S/O KUMAR" → "RAVI"
  s = s.replace(/\bM\s*\/\s*S\b\.?/g, " "); // "M/s Sri Traders"
  s = s.replace(/&/g, " & ");
  s = s.replace(/[^A-Z0-9&]+/g, " ").trim();
  let tokens = s.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && LEADING_TITLES.has(tokens[0]!)) tokens = tokens.slice(1);
  const out: string[] = [];
  for (const t of tokens) {
    const canonical = CANONICAL[t];
    if (canonical) out.push(canonical);
    else if (t.length >= 2 && t.length <= 3 && /^[A-Z]+$/.test(t) && !VOWELS.test(t)) out.push(...t.split(""));
    else out.push(t);
  }
  return out;
}

/** Tokens joined with single spaces, e.g. for display or equality checks. */
export const normalizeName = (name: string | null | undefined) => nameTokens(name).join(" ");

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** 1 − edit distance / longer length. */
export const wordSimilarity = (a: string, b: string) => (a.length || b.length ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1);

const FUZZY_MIN = 0.8;
const weight = (t: string) => (t.length === 1 ? 0.5 : 1);

/** 0–100 similarity of two names (see the module comment). Empty on either side → 0. */
export function nameMatchScore(a: string | null | undefined, b: string | null | undefined): number {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (!A.length || !B.length) return 0;
  if ([...A].sort().join(" ") === [...B].sort().join(" ")) return 100;

  const total = A.reduce((s, t) => s + weight(t), 0) + B.reduce((s, t) => s + weight(t), 0);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  let credit = 0;

  const pass = (score: (x: string, y: string) => number | null) => {
    // Best pairs first, so "KUMAR" pairs with "KUMAR" before a fuzzy "KUMARAN".
    const pairs: { i: number; j: number; c: number }[] = [];
    A.forEach((x, i) => {
      if (usedA.has(i)) return;
      B.forEach((y, j) => {
        if (usedB.has(j)) return;
        const c = score(x, y);
        if (c != null) pairs.push({ i, j, c });
      });
    });
    pairs.sort((p, q) => q.c - p.c);
    for (const p of pairs) {
      if (usedA.has(p.i) || usedB.has(p.j)) continue;
      usedA.add(p.i);
      usedB.add(p.j);
      credit += p.c;
    }
  };

  // 1) exact words, 2) near-identical words, 3) initials.
  pass((x, y) => (x.length > 1 && x === y ? 2 : null));
  pass((x, y) => {
    if (x.length < 3 || y.length < 3) return null;
    const s = wordSimilarity(x, y);
    return s >= FUZZY_MIN ? 2 * s : null;
  });
  pass((x, y) => {
    if (x.length === 1 && y.length === 1) return x === y ? 1 : null;
    if (x.length === 1 || y.length === 1) return x[0] === y[0] ? 1 : null;
    return null;
  });

  let score = Math.round((100 * credit) / total);
  if (A.join("") === B.join("") || [...A].sort().join("") === [...B].sort().join("")) score = Math.max(score, 95);
  return Math.max(0, Math.min(100, score));
}

/** Default pass mark used by the status rules (vendor payouts). */
export const NAME_MATCH_THRESHOLD = 80;
