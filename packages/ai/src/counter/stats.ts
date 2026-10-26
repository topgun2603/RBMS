/** Small robust statistics for the counter helpers (unusual-activity alerts, coaching, shift planning). No model, no randomness. */

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Linear-interpolated percentile, p in 0..100. */
export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const r = (Math.min(Math.max(p, 0), 100) / 100) * (s.length - 1);
  const lo = Math.floor(r);
  const hi = Math.ceil(r);
  return lo === hi ? s[lo]! : s[lo]! + (s[hi]! - s[lo]!) * (r - lo);
}

/** Median absolute deviation, scaled to be comparable with a standard deviation (x 1.4826). */
export function mad(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m))) * 1.4826;
}

export interface SpikeOptions {
  /** The smallest value worth an alert whatever the history says. */
  minToday: number;
  /** How many robust deviations above the median. Default 3.5. */
  z?: number;
  /** Days of history needed to judge at all. Default 14. */
  minHistory?: number;
  /** The smallest rise over the median worth an alert. Default 2. */
  floorDelta?: number;
}
export interface SpikeResult {
  fires: boolean;
  z: number;
  median: number;
  /** The usual range (25th to 75th percentile), rounded. */
  usualLow: number;
  usualHigh: number;
  history: number;
}

/**
 * Is `today` unusually high against the person's (or the shop's) own recent days? Robust z-score: the spread is the larger of
 * the MAD and a Poisson-like floor, so a person whose days are all nearly the same does not alert on a rise of one.
 */
export function spike(history: readonly number[], today: number, o: SpikeOptions): SpikeResult {
  const med = median(history);
  const usualLow = Math.round(percentile(history, 25));
  const usualHigh = Math.round(percentile(history, 75));
  const scale = Math.max(mad(history), Math.sqrt(Math.max(med, 0.5)) * 0.75, 0.5);
  const z = (today - med) / scale;
  const fires = history.length >= (o.minHistory ?? 14) && today >= o.minToday && today - med >= (o.floorDelta ?? 2) && z >= (o.z ?? 3.5);
  return { fires, z: Math.round(z * 10) / 10, median: med, usualLow, usualHigh, history: history.length };
}

/** "1-2" or "3": the usual range as words for a message. */
export const usualText = (s: Pick<SpikeResult, "usualLow" | "usualHigh">, lang: "en" | "ta" = "en") => (s.usualLow === s.usualHigh ? String(s.usualHigh) : `${s.usualLow}${lang === "ta" ? " முதல் " : " to "}${s.usualHigh}`);
