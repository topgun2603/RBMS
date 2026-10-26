/** Small text helpers shared by the Phase 4 part B store features. */

export const hasTamil = (s: string): boolean => /[஀-௿]/.test(s);

/** Lowercase NFC words of a text, punctuation removed (Tamil kept as typed). */
export function normWords(s: string): string[] {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}' -]+/gu, " ")
    .split(/[\s-]+/)
    .map((w) => w.trim())
    .filter(Boolean);
}

/** Levenshtein distance (small strings only). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Indian-grouped rupees from paise ("₹1,250" / "₹1,250.50"). */
export function inr(paise: number): string {
  const r = Math.round(paise) / 100;
  return `₹${r.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(r) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** A sliding-window limiter per key, in memory (one API process; resets on restart). */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}
  /** Records a hit and returns true when allowed; false (no hit recorded) when `max` hits are already inside `windowMs`. */
  take(key: string, max: number, windowMs: number): boolean {
    const t = this.now();
    const list = (this.hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (list.length >= max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(t);
    this.hits.set(key, list);
    if (this.hits.size > 20_000) for (const [k, v] of this.hits) if (v.every((x) => t - x >= windowMs)) this.hits.delete(k);
    return true;
  }
}
