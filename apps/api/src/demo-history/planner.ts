import { addDays, dayOfMonth, festivalLift, lastDayOfMonth, monthKey, weekday } from "./calendar";
import { popularityWeights, type Profile } from "./profiles";
import { createRng, type Rng } from "./rng";

/**
 * The day planner: how busy each day is (weekday curve, salary week, festival build-up, month-to-month drift, noise) and
 * when in the day the bills fall. Pure functions of (profile, slug, date): every day is planned from its own seed
 * (`slug:date`), so planning a window, a longer window or a top-up gives the same day the same plan.
 */

export interface DayPlan {
  date: string;
  weekday: number;
  closed: boolean;
  /** Demand multiplier against an ordinary day (weekday curve excluded): festival, salary week, month drift. */
  factor: number;
  festival?: string;
  /** Mean bills before noise. */
  expected: number;
  /** Bills planned. */
  bills: number;
  open: number;
  close: number;
}

export function planDay(profile: Profile, slug: string, date: string): DayPlan {
  const dow = weekday(date);
  const closed = profile.closedWeekdays.includes(dow);
  const lift = festivalLift(date, undefined, profile.festivalAffinity);
  const salary = dayOfMonth(date) <= 7 ? profile.salaryWeekBoost : 1;
  // A slow-moving mood per month (+/- 6%), the same for every day of the month.
  const drift = 1 + (createRng(`${slug}:month:${monthKey(date)}`).next() - 0.5) * 0.12;
  const factor = lift.factor * salary * drift;
  const expected = closed ? 0 : profile.billsByWeekday[dow]! * factor;
  const rng = createRng(`${slug}:day:${date}`);
  const bills = closed ? 0 : Math.max(0, Math.round(rng.normal(expected, Math.sqrt(expected) * 0.9 + expected * 0.05)));
  return { date, weekday: dow, closed, factor, ...(lift.festival ? { festival: lift.festival.name } : {}), expected, bills, open: profile.hours.open, close: profile.hours.close };
}

export function planWindow(profile: Profile, slug: string, dates: readonly string[]): DayPlan[] {
  return dates.map((d) => planDay(profile, slug, d));
}

/** Minutes of day for `count` bills (sorted), drawn from the opening hours' peaks. */
export function sampleBillTimes(profile: Profile, rng: Rng, count: number): number[] {
  const { open, close, peaks } = profile.hours;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    let t = open + 1;
    for (let tries = 0; tries < 20; tries++) {
      const peak = peaks[rng.weightedIndex(peaks.map((p) => p.weight))]!;
      const x = Math.round(rng.normal(peak.at, peak.spread));
      if (x > open && x < close - 2) {
        t = x;
        break;
      }
    }
    out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/** Popularity weights of a profile's items (Zipf by rank, the catalogue being in popularity order). */
export const itemWeights = (profile: Profile, count = profile.catalogue.length) => popularityWeights(count, profile.pareto);

/** Share of volume the top 20% of `count` items take under the profile's popularity curve. */
export function topShare(profile: Profile, count = profile.catalogue.length): number {
  const w = itemWeights(profile, count);
  const total = w.reduce((a, b) => a + b, 0);
  const top = w.slice(0, Math.max(1, Math.round(count * 0.2))).reduce((a, b) => a + b, 0);
  return top / total;
}

/** Expected units sold per day of item `rank` (0-based), for sizing opening stock and restock orders. */
export function expectedDailyUnits(profile: Profile, rank: number, count = profile.catalogue.length): number {
  const w = itemWeights(profile, count);
  const total = w.reduce((a, b) => a + b, 0);
  const meanBills = profile.billsByWeekday.reduce((a, b) => a + b, 0) / 7;
  const entry = profile.catalogue[rank];
  const [lo, hi] = entry?.qty ?? [1, 2];
  return (meanBills * profile.basket.items * (w[rank] ?? 0)) / total * ((lo + hi) / 2);
}

/** Dates (in a window) on which a monthly expense falls: its day of month, clamped to the month's length. */
export function expenseDay(date: string, day: number): boolean {
  return dayOfMonth(date) === Math.min(day, lastDayOfMonth(date));
}

/** The dates between `from` and `to` (inclusive) that are the given weekday. */
export function weekdaysIn(from: string, to: string, dow: number): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekday(d) === dow) out.push(d);
  return out;
}
