/** Date ranges and data shaping for the store analytics screen and widget. Pure — unit-tested. */
import { FUNNEL_STEPS, type FunnelStep, type Overview } from "./types";

export const RANGE_PRESETS = ["7d", "30d", "90d", "month"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export interface DateRange {
  from: string;
  to: string;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** IST calendar date, "2026-10-15". */
export const todayIST = (now: Date = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inclusive number of days in a range. */
export const dayCount = (r: DateRange) => Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;

/** Last N days including today, or the current calendar month up to today. */
export function rangeFor(preset: RangePreset, today: string = todayIST()): DateRange {
  switch (preset) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

/** The same number of days right before `r` (what deltas compare against). */
export function previousRange(r: DateRange): DateRange {
  const n = dayCount(r);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

/** Percentage change; null without a base (no "∞ %"). */
export function pctDelta(cur: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** Difference in percentage points (conversion rate); null when there was no traffic before. */
export function pointsDelta(cur: number, prev: number | null | undefined, prevSessions: number | null | undefined): number | null {
  if (prev === null || prev === undefined || !prevSessions) return null;
  return Math.round((cur - prev) * 100) / 100;
}

export interface FunnelRow {
  step: FunnelStep;
  count: number;
  /** Share of the first step (sessions), 0–100. */
  ofStart: number;
  /** Lost since the previous step, 0–100; null for the first step or when the previous step had none. */
  dropOff: number | null;
}

/** Funnel in the fixed step order with drop-off per step (missing steps count 0). */
export function funnelRows(funnel: Overview["funnel"]): FunnelRow[] {
  const by = new Map(funnel.map((f) => [f.step, f.count]));
  const counts = FUNNEL_STEPS.map((step) => ({ step, count: by.get(step) ?? 0 }));
  const start = counts[0]?.count ?? 0;
  return counts.map((c, i) => {
    const prev = i > 0 ? counts[i - 1]!.count : null;
    return {
      ...c,
      ofStart: start > 0 ? round1((c.count / start) * 100) : 0,
      dropOff: prev === null || prev === 0 ? null : round1(Math.max(0, ((prev - c.count) / prev) * 100)),
    };
  });
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Single-metric series for a trend chart. */
export const series = (trend: Overview["trend"], metric: "visitors" | "purchases" | "revenue") =>
  trend.map((d) => ({ date: d.date, value: d[metric] }));

/** Each item's share of the total, in percent (1 decimal). */
export function withShare<T>(items: readonly T[], value: (t: T) => number): (T & { share: number })[] {
  const total = items.reduce((s, i) => s + Math.max(0, value(i)), 0);
  return items.map((i) => ({ ...i, share: total > 0 ? round1((value(i) / total) * 100) : 0 }));
}

/** True when the store has sent no events in the range (beacon not installed, or no visitors yet). */
export const isEmptyOverview = (o: Pick<Overview, "sessions" | "pageViews" | "visitors" | "purchases">) =>
  o.sessions === 0 && o.pageViews === 0 && o.visitors === 0 && o.purchases === 0;

/** Top products with a conversion figure (purchases per view). */
export const productRows = (rows: Overview["topProducts"]) =>
  rows.map((r) => ({ ...r, conversion: r.views > 0 ? round1((r.purchases / r.views) * 100) : 0 }));

/** Known device keys (others shown as-is). */
export const DEVICE_KEYS = ["mobile", "desktop", "tablet"] as const;

/** Key under `site.analytics.source.*` for well-known sources, else null (show the host). */
export function sourceKey(source: string): string | null {
  const s = source.toLowerCase();
  if (s === "direct" || s === "") return "direct";
  if (/(^|\.)google\./.test(s) || s === "google") return "google";
  if (/(^|\.)(facebook|fb)\.(com|me)$/.test(s) || s === "facebook" || s === "fb") return "facebook";
  if (/(^|\.)instagram\.com$/.test(s) || s === "instagram" || s === "ig") return "instagram";
  if (/(^|\.)(whatsapp\.com|wa\.me)$/.test(s) || s === "whatsapp") return "whatsapp";
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(s) || s === "youtube") return "youtube";
  return null;
}

/** Visitors per day for the dashboard sparkline (needs at least 2 points to draw). */
export const sparkValues = (o: Pick<Overview, "trend"> | undefined) => (o?.trend ?? []).map((d) => d.visitors);
