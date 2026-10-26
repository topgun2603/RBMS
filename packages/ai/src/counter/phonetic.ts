/**
 * Phonetic folding for matching spoken Tamil / Tanglish / English words (voice billing). The same coarse "skeleton" is made from
 * Tamil script and from Latin letters, so "அரிசி", "arisi" and "arissi" meet, and "thuvaram paruppu" meets "துவரம் பருப்பு".
 * It is deliberately lossy (k/g, t/d, p/b, s/ch/j, long = short vowels, doubled letters): the matcher only needs "sounds alike".
 */

const TAMIL_DIGITS = "௦௧௨௩௪௫௬௭௮௯";

export const hasTamil = (s: string): boolean => /[஀-௿]/.test(s);

/** Tamil digits to ASCII, nothing else changed. */
export function asciiDigits(s: string): string {
  return s.replace(/[௦-௯]/g, (d) => String(TAMIL_DIGITS.indexOf(d)));
}

const CONS: Record<string, string> = {
  க: "k", ங: "n", ச: "s", ஞ: "n", ட: "t", ண: "n", த: "t", ந: "n", ப: "p", ம: "m", ய: "y", ர: "r", ல: "l", வ: "v", ழ: "l", ள: "l", ற: "r", ன: "n",
  ஜ: "s", ஷ: "s", ஸ: "s", ஹ: "h", ஶ: "s",
};
const INDEP: Record<string, string> = { அ: "a", ஆ: "a", இ: "i", ஈ: "i", உ: "u", ஊ: "u", எ: "e", ஏ: "e", ஐ: "ai", ஒ: "o", ஓ: "o", ஔ: "au" };
const SIGN: Record<string, string> = { "ா": "a", "ி": "i", "ீ": "i", "ு": "u", "ூ": "u", "ெ": "e", "ே": "e", "ை": "ai", "ொ": "o", "ோ": "o", "ௌ": "au" };
const VIRAMA = "்";

/** Tamil script to plain Latin letters (a coarse, sound-based scheme; not reversible). Other characters pass through. */
export function romanize(text: string): string {
  const s = asciiDigits(text.normalize("NFC"));
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const c = CONS[ch];
    if (c !== undefined) {
      const next = s[i + 1];
      if (next === VIRAMA) {
        out += c;
        i++;
      } else if (next && SIGN[next] !== undefined) {
        out += c + SIGN[next];
        i++;
      } else out += c + "a";
      continue;
    }
    if (INDEP[ch] !== undefined) {
      out += INDEP[ch];
      continue;
    }
    if (ch === "ஃ" || ch === VIRAMA || SIGN[ch] !== undefined) continue;
    out += ch;
  }
  return out;
}

/** The folded form of one Latin word (already lower case, letters only). */
function foldLatin(w: string): string {
  let s = w
    .replace(/zh/g, "l")
    .replace(/(?:th|dh)/g, "t")
    .replace(/sh/g, "s")
    .replace(/ch/g, "s")
    .replace(/(?:kh|gh)/g, "k")
    .replace(/(?:bh|ph)/g, "p")
    .replace(/ng/g, "n")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/x/g, "ks")
    .replace(/h/g, "");
  s = s.replace(/[gcq]/g, "k").replace(/d/g, "t").replace(/b/g, "p").replace(/[jz]/g, "s").replace(/f/g, "p").replace(/w/g, "v");
  s = s.replace(/y/g, "i");
  // long vowels: aa, ee, oo, ii, uu become short; ou / au / ai kept simple
  s = s.replace(/aa+/g, "a").replace(/ee+/g, "i").replace(/oo+/g, "u").replace(/ii+/g, "i").replace(/uu+/g, "u").replace(/ou/g, "u").replace(/ey/g, "ei");
  // doubled letters (kk, tt, nn...) collapse
  s = s.replace(/([a-z])\1+/g, "$1");
  return s;
}

/** The skeleton of a word in any of the three scripts: lower case, folded, letters only. "" when there is nothing left. */
export function skeleton(word: string): string {
  const latin = romanize(word.toLowerCase().normalize("NFC"))
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return foldLatin(latin);
}

/** Levenshtein distance for short words. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** How alike two skeletons sound, 0 to 1 (1 = identical, 0 = unrelated). Short words must match closely. */
export function soundSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const len = Math.max(a.length, b.length);
  const d = editDistance(a, b);
  if (len <= 3) return 0;
  if (len <= 5) return d <= 1 ? 0.8 : 0;
  if (len <= 8) return d <= 1 ? 0.85 : d <= 2 ? 0.7 : 0;
  return d <= 2 ? 0.85 : d <= 3 ? 0.7 : 0;
}

/** Splits a text into lowercase word tokens (Tamil kept as written, Latin letters and digits), punctuation removed. */
export function words(text: string): string[] {
  return asciiDigits(text.normalize("NFC").toLowerCase())
    .replace(/[^\p{L}\p{M}\p{N}'./½¼¾-]+/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[-'./]+|[-'./]+$/g, ""))
    .filter(Boolean);
}
