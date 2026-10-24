/**
 * Seeded random numbers for the history simulator: the same seed always gives the same sequence, so a shop's history is
 * reproducible. `hashSeed` turns text (slug + date) into a seed; `fork` derives an independent stream.
 */
export function hashSeed(text: string): number {
  // FNV-1a, then a final avalanche so near-identical strings ("a:2026-10-01", "a:2026-10-02") spread out.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [min, max], both included. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(list: readonly T[]): T;
  /** Index of a weighted draw (weights need not sum to 1). */
  weightedIndex(weights: readonly number[]): number;
  weighted<T>(list: readonly T[], weight: (item: T, index: number) => number): T;
  /** Normal(mean, sd), Box-Muller. */
  normal(mean: number, sd: number): number;
  /** Poisson(lambda) (Knuth; large lambdas use a normal approximation). */
  poisson(lambda: number): number;
  shuffle<T>(list: readonly T[]): T[];
  /** An independent stream derived from this seed and a label. */
  fork(label: string): Rng;
}

export function createRng(seed: number | string): Rng {
  const base = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
  let a = base;
  const next = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (list) => {
      if (list.length === 0) throw new Error("pick from an empty list");
      return list[Math.floor(next() * list.length)]!;
    },
    weightedIndex: (weights) => {
      let total = 0;
      for (const w of weights) total += Math.max(w, 0);
      if (total <= 0) return Math.floor(next() * weights.length);
      let r = next() * total;
      for (let i = 0; i < weights.length; i++) {
        r -= Math.max(weights[i]!, 0);
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    weighted: (list, weight) => list[rng.weightedIndex(list.map(weight))]!,
    normal: (mean, sd) => {
      const u = Math.max(next(), 1e-12);
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
    poisson: (lambda) => {
      if (lambda <= 0) return 0;
      if (lambda > 30) return Math.max(0, Math.round(rng.normal(lambda, Math.sqrt(lambda))));
      const limit = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > limit);
      return k - 1;
    },
    shuffle: (list) => {
      const out = [...list];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
    fork: (label) => createRng(hashSeed(`${base}:${label}`)),
  };
  return rng;
}
