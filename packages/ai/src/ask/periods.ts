/**
 * Date ranges for "Ask your shop", all in IST calendar days (YYYY-MM-DD strings, no time zones to get wrong).
 * The model never does calendar arithmetic for weeks, months, financial years or festivals: it asks `resolve_period`.
 */

export const PERIOD_PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "this_month",
  "last_month",
  "this_quarter",
  "this_year",
  "this_fy",
  "last_fy",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const FESTIVALS = ["deepavali", "pongal", "tamil_new_year"] as const;
export type Festival = (typeof FESTIVALS)[number];

/** Main day of Deepavali (the Naraka Chaturdashi / Lakshmi puja day most shops trade on), from the published calendars. */
const DEEPAVALI: Record<number, string> = {
  2021: "2021-11-04",
  2022: "2022-10-24",
  2023: "2023-11-12",
  2024: "2024-10-31",
  2025: "2025-10-20",
  2026: "2026-11-08",
  2027: "2027-10-29",
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const parseISO = (s: string) => new Date(`${s}T00:00:00Z`);
export const toISO = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => toISO(new Date(parseISO(s).getTime() + n * 86_400_000));
export const daysBetween = (from: string, to: string) => Math.round((parseISO(to).getTime() - parseISO(from).getTime()) / 86_400_000);

/** The IST calendar day of a moment. */
export function istDate(now: Date): string {
  return toISO(new Date(now.getTime() + 330 * 60_000));
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayOf = (s: string) => WEEKDAYS[parseISO(s).getUTCDay()]!;

const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
const monthEnd = (s: string) => addDays(`${addMonths(monthStart(s), 1)}`, -1);
function addMonths(s: string, n: number): string {
  const d = parseISO(s);
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}
/** Financial year (April to March) containing `s`: [start, end]. */
function fyOf(s: string): { from: string; to: string; label: string } {
  const y = Number(s.slice(0, 4));
  const start = Number(s.slice(5, 7)) >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `FY ${start}-${String(start + 1).slice(2)}` };
}

export interface ResolvedPeriod {
  from: string;
  to: string;
  label: string;
  days: number;
  /** The range runs past today: only days up to today can have data. */
  includesFuture: boolean;
}

const make = (from: string, to: string, label: string, today: string): ResolvedPeriod => ({
  from,
  to,
  label,
  days: daysBetween(from, to) + 1,
  includesFuture: to > today,
});

export function presetRange(preset: PeriodPreset, today: string): ResolvedPeriod {
  const dow = (parseISO(today).getUTCDay() + 6) % 7; // Monday = 0
  switch (preset) {
    case "today":
      return make(today, today, "today", today);
    case "yesterday":
      return make(addDays(today, -1), addDays(today, -1), "yesterday", today);
    case "this_week": {
      const from = addDays(today, -dow);
      return make(from, today, "this week (Monday to today)", today);
    }
    case "last_week": {
      const from = addDays(today, -dow - 7);
      return make(from, addDays(from, 6), "last week (Monday to Sunday)", today);
    }
    case "last_7_days":
      return make(addDays(today, -6), today, "the last 7 days", today);
    case "last_30_days":
      return make(addDays(today, -29), today, "the last 30 days", today);
    case "last_90_days":
      return make(addDays(today, -89), today, "the last 90 days", today);
    case "this_month":
      return make(monthStart(today), today, "this month so far", today);
    case "last_month": {
      const prev = addMonths(monthStart(today), -1);
      return make(prev, monthEnd(prev), "last month", today);
    }
    case "this_quarter": {
      const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3;
      return make(`${today.slice(0, 4)}-${String(q + 1).padStart(2, "0")}-01`, today, "this quarter so far", today);
    }
    case "this_year":
      return make(`${today.slice(0, 4)}-01-01`, today, "this calendar year so far", today);
    case "this_fy": {
      const f = fyOf(today);
      return make(f.from, today, `${f.label} so far`, today);
    }
    case "last_fy": {
      const f = fyOf(addDays(fyOf(today).from, -1));
      return make(f.from, f.to, f.label, today);
    }
  }
}

/** The festival window shops compare: the 7 days leading up to the festival and the festival day itself (8 days). */
export function festivalRange(festival: Festival, year: number, today: string): ResolvedPeriod | { error: string } {
  let day: string | undefined;
  let name: string;
  if (festival === "deepavali") {
    day = DEEPAVALI[year];
    name = "Deepavali";
  } else if (festival === "pongal") {
    day = `${year}-01-14`; // Bhogi; Thai Pongal is the 14th or 15th
    name = "Pongal";
  } else {
    day = `${year}-04-14`;
    name = "Tamil New Year";
  }
  if (!day) return { error: `I do not have the ${name} date for ${year}.` };
  const from = addDays(day, festival === "pongal" ? 0 : -7);
  const to = festival === "pongal" ? addDays(day, 3) : day;
  if (from > today) return { error: `${name} ${year} (${day}) has not happened yet, so there are no sales to read.` };
  return make(from, to, `${name} ${year} (${festival === "pongal" ? "Bhogi to Kaanum Pongal" : "the 7 days before it and the day itself"})`, today);
}

export const MAX_RANGE_DAYS = 366;

/** Validates a from/to pair from the model: real dates, from <= to, at most a year. Returns a message for the model on failure. */
export function checkRange(from: unknown, to: unknown): { from: string; to: string } | { error: string } {
  if (!isIsoDate(from) || !isIsoDate(to)) return { error: "from and to must be real dates as YYYY-MM-DD." };
  if (to < from) return { error: "to must not be before from." };
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return { error: `The range is too long: ask for at most ${MAX_RANGE_DAYS} days at a time.` };
  return { from, to };
}
