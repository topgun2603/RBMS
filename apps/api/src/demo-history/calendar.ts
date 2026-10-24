/**
 * Dates (IST business dates as YYYY-MM-DD strings) and the Tamil Nadu festival calendar that shapes demand.
 * All arithmetic is on UTC midnights of the date text, so it never depends on the machine's time zone.
 */

const DAY_MS = 86_400_000;
const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
const ms = (d: string) => {
  const [y, m, dd] = parts(d);
  return Date.UTC(y, m - 1, dd);
};
const text = (t: number) => new Date(t).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => text(ms(d) + n * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY_MS);
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (d: string) => new Date(ms(d)).getUTCDay();
export const dayOfMonth = (d: string) => parts(d)[2];
export const monthKey = (d: string) => d.slice(0, 7);
export const lastDayOfMonth = (d: string) => {
  const [y, m] = parts(d);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
export const isValidDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && text(ms(d)) === d;

/** The IST business date right now. */
export const istToday = (now: Date = new Date()) => text(now.getTime() + 330 * 60_000);
/** Minutes since midnight in IST right now. */
export const istMinutes = (now: Date = new Date()) => {
  const t = new Date(now.getTime() + 330 * 60_000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};
/** The instant of an IST date and minute of day. */
export const istInstant = (d: string, minutes: number, seconds = 0) => new Date(ms(d) + (minutes * 60 + seconds) * 1000 - 330 * 60_000);

/** The days of a history window ending `today`: `days` dates, oldest first. */
export function windowDates(today: string, days: number): string[] {
  if (!Number.isInteger(days) || days < 1) throw new Error("days must be a whole number of at least 1");
  return Array.from({ length: days }, (_, i) => addDays(today, i - days + 1));
}

/** Days of the window still to generate (top-up): those not already `done`, in order. */
export function pendingDays(window: readonly string[], done: ReadonlySet<string>): string[] {
  return window.filter((d) => !done.has(d));
}

// ------------------------------------------------------------------ festivals

/** How a festival moves different trades: profiles scale each group by their own affinity. */
export type FestivalGroup = "major" | "worship" | "gold" | "minor";

export interface Festival {
  id: string;
  name: string;
  /** The day itself. */
  date: string;
  group: FestivalGroup;
  /** Shopping build-up: days before the festival over which demand climbs (peaks the day before). */
  before: number;
  /** Demand at the top of the build-up (e.g. 1.6 = +60%). */
  peak: number;
  /** Demand on the festival day itself (shops sell less, restaurants more). */
  dayOf: number;
  /** Days after the festival that stay a little quieter. */
  after: number;
}

const f = (id: string, name: string, date: string, group: FestivalGroup, before: number, peak: number, dayOf: number, after = 1): Festival => ({ id, name, date, group, before, peak, dayOf, after });

/** 2025 to 2027. Deepavali 2026 falls on 8 Nov; Navaratri / Ayudha Pooja 2026 on 11 to 19 Oct. */
export const FESTIVALS: Festival[] = [
  f("pongal-2025", "Pongal", "2025-01-14", "major", 7, 1.5, 0.7, 2),
  f("tamil-new-year-2025", "Tamil New Year", "2025-04-14", "major", 5, 1.35, 0.8),
  f("akshaya-tritiya-2025", "Akshaya Tritiya", "2025-04-30", "gold", 3, 1.9, 1.4),
  f("vinayagar-2025", "Vinayagar Chathurthi", "2025-08-27", "worship", 4, 1.3, 0.8),
  f("ayudha-pooja-2025", "Ayudha Pooja", "2025-10-01", "worship", 8, 1.35, 0.5, 2),
  f("deepavali-2025", "Deepavali", "2025-10-20", "major", 14, 2.1, 0.55, 2),
  f("karthigai-deepam-2025", "Karthigai Deepam", "2025-12-04", "minor", 2, 1.15, 1.0),
  f("pongal-2026", "Pongal", "2026-01-14", "major", 7, 1.5, 0.7, 2),
  f("tamil-new-year-2026", "Tamil New Year", "2026-04-14", "major", 5, 1.35, 0.8),
  f("akshaya-tritiya-2026", "Akshaya Tritiya", "2026-04-19", "gold", 3, 1.9, 1.4),
  f("aadi-perukku-2026", "Aadi Perukku", "2026-08-03", "minor", 1, 1.1, 1.0),
  f("varalakshmi-2026", "Varalakshmi Vratham", "2026-08-21", "worship", 3, 1.25, 1.0),
  f("onam-2026", "Onam", "2026-08-26", "minor", 3, 1.15, 1.0),
  f("vinayagar-2026", "Vinayagar Chathurthi", "2026-09-14", "worship", 4, 1.3, 0.8),
  // Navaratri 11 Oct to Ayudha Pooja on 19 Oct: a long build-up, the day itself quiet (shops shut for the pooja).
  f("ayudha-pooja-2026", "Navaratri / Ayudha Pooja", "2026-10-19", "worship", 8, 1.4, 0.5, 2),
  f("dhanteras-2026", "Dhanteras", "2026-11-06", "gold", 3, 1.8, 1.4),
  f("deepavali-2026", "Deepavali", "2026-11-08", "major", 14, 2.1, 0.55, 2),
  f("karthigai-deepam-2026", "Karthigai Deepam", "2026-11-24", "minor", 2, 1.15, 1.0),
  f("pongal-2027", "Pongal", "2027-01-14", "major", 7, 1.5, 0.7, 2),
  f("tamil-new-year-2027", "Tamil New Year", "2027-04-14", "major", 5, 1.35, 0.8),
  f("deepavali-2027", "Deepavali", "2027-10-29", "major", 14, 2.1, 0.55, 2),
];

export interface FestivalLift {
  /** Demand multiplier before the trade's affinity is applied (1 = nothing special). */
  factor: number;
  festival?: Festival;
}

/** The strongest festival effect on a date (build-up ramps up to the day before; the day itself and the days after follow). */
export function festivalLift(date: string, festivals: readonly Festival[] = FESTIVALS, affinity?: Partial<Record<FestivalGroup, number>>): FestivalLift {
  let best: FestivalLift = { factor: 1 };
  for (const fest of festivals) {
    const d = daysBetween(date, fest.date); // days until the festival
    let raw = 1;
    if (d === 0) raw = fest.dayOf;
    else if (d > 0 && d <= fest.before) raw = 1 + (fest.peak - 1) * (1 - (d - 1) / fest.before);
    else if (d < 0 && -d <= fest.after) raw = 1 - (1 - Math.min(fest.dayOf, 1)) * 0.3 * (1 + d / (fest.after + 1));
    else continue;
    const a = affinity?.[fest.group] ?? 1;
    const factor = 1 + (raw - 1) * a;
    if (Math.abs(factor - 1) > Math.abs(best.factor - 1)) best = { factor, festival: fest };
  }
  return best;
}
