/**
 * Recurring invoices: the schedule maths (docs/recurring-export-gstin.md). Pure: dates are "YYYY-MM-DD" (IST business
 * days), no clock, no database.
 *
 * A profile's dates are counted from its start date: every `interval` weeks on `weekday`, or every `interval` months
 * (quarters = 3, years = 12) on `dayOfMonth`. A day the month doesn't have (31 in April, 29–31 in February) bills on the
 * month's last day, and the next month goes back to the asked day (31 Jan, 28 Feb, 31 Mar ...).
 */
import type { RecurringFrequency } from "./schema-recurring";

export interface Schedule {
  frequency: RecurringFrequency;
  /** Every N weeks / months / quarters / years (≥ 1). */
  interval: number;
  /** Monthly and longer: 1–31 (null = the start date's day). */
  dayOfMonth: number | null;
  /** Weekly: 0 = Sunday … 6 = Saturday (null = the start date's weekday). */
  weekday: number | null;
  startDate: string;
  endDate: string | null;
}

/** Missed dates billed when the scheduler catches up (the latest ones); older missed dates are recorded as skipped. */
export const CATCH_UP_LIMIT = 3;
/** A failed run is retried on the next scheduler runs this many times in all. */
export const MAX_RUN_ATTEMPTS = 3;

const DAY = 86_400_000;
const toUtc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * DAY);
const weekdayOf = (d: string) => new Date(toUtc(d)).getUTCDay();
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Months between dates of one profile: monthly 1, quarterly 3, yearly 12 (times the interval). */
export const monthStep = (s: Pick<Schedule, "frequency" | "interval">) =>
  (s.frequency === "quarterly" ? 3 : s.frequency === "yearly" ? 12 : 1) * Math.max(1, Math.trunc(s.interval));

/** The k-th month after (year, month0) on `day`, clamped to the month's last day. */
function monthDate(year: number, month0: number, k: number, day: number): string {
  const total = year * 12 + month0 + k;
  const y = Math.floor(total / 12);
  const m = total - y * 12;
  const d = Math.min(day, daysInMonth(y, m));
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The profile's k-th date (k = 0, 1, ...). The first one is on or after the start date. */
export function occurrence(s: Schedule, k: number): string {
  if (s.frequency === "weekly") {
    const wd = s.weekday ?? weekdayOf(s.startDate);
    const first = addDays(s.startDate, (wd - weekdayOf(s.startDate) + 7) % 7);
    return addDays(first, k * 7 * Math.max(1, Math.trunc(s.interval)));
  }
  const day = s.dayOfMonth ?? Number(s.startDate.slice(8, 10));
  const y = Number(s.startDate.slice(0, 4));
  const m0 = Number(s.startDate.slice(5, 7)) - 1;
  // The start month's date can fall before the start day (start 20 Oct, bill on the 5th): the first bill is a step later.
  const skip = monthDate(y, m0, 0, day) < s.startDate ? 1 : 0;
  return monthDate(y, m0, (k + skip) * monthStep(s), day);
}

/** Index of the first date on or after `date` (0 when `date` is before the start). */
function indexOnOrAfter(s: Schedule, date: string): number {
  if (date <= occurrence(s, 0)) return 0;
  let k: number;
  if (s.frequency === "weekly") {
    k = Math.floor((toUtc(date) - toUtc(occurrence(s, 0))) / (7 * DAY * Math.max(1, Math.trunc(s.interval))));
  } else {
    const a = occurrence(s, 0);
    const months = (Number(date.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(date.slice(5, 7)) - Number(a.slice(5, 7)));
    k = Math.floor(months / monthStep(s));
  }
  k = Math.max(0, k - 1);
  while (occurrence(s, k) < date) k++;
  return k;
}

/** The first date on or after `date`, or null when it is past the end date. */
export function nextOnOrAfter(s: Schedule, date: string): string | null {
  const d = occurrence(s, indexOnOrAfter(s, date));
  return s.endDate && d > s.endDate ? null : d;
}

/** The first date strictly after `date`, or null when it is past the end date. */
export const nextAfter = (s: Schedule, date: string): string | null => nextOnOrAfter(s, addDays(date, 1));

export interface DuePlan {
  /** Dates to bill now (oldest first), at most `CATCH_UP_LIMIT`. */
  bill: string[];
  /** Missed dates older than the catch-up limit: recorded as skipped, never billed. */
  missed: string[];
  /** Next date after everything planned, null = the schedule has ended. */
  next: string | null;
}

/**
 * What the scheduler does today for a profile whose next date is `nextRunDate`: every date from it up to today, the
 * latest `limit` billed and the older ones recorded as missed, but never more bills than `remaining` (the count limit).
 */
export function planDue(s: Schedule, nextRunDate: string | null, today: string, remaining: number | null, limit = CATCH_UP_LIMIT): DuePlan {
  const due: string[] = [];
  let d = nextRunDate;
  // Guard against a very old next date: count at most a few hundred dates.
  while (d && d <= today && due.length < 400) {
    due.push(d);
    d = nextAfter(s, d);
  }
  let bill = due.slice(-limit);
  const missed = due.slice(0, Math.max(0, due.length - limit));
  let next = d;
  if (remaining !== null && bill.length > remaining) {
    bill = bill.slice(0, Math.max(0, remaining));
    next = null;
  } else if (remaining !== null && bill.length === remaining) next = null;
  return { bill, missed, next };
}

/** Human-readable check of a schedule's fields. Null when fine. */
export function scheduleProblem(s: Schedule & { maxCount?: number | null }): string | null {
  if (!Number.isInteger(s.interval) || s.interval < 1 || s.interval > 24) return "Repeat every 1 to 24 periods";
  if (s.frequency === "weekly") {
    if (s.weekday !== null && (!Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6)) return "Pick a day of the week";
  } else if (s.dayOfMonth !== null && (!Number.isInteger(s.dayOfMonth) || s.dayOfMonth < 1 || s.dayOfMonth > 31)) {
    return "Day of the month is 1 to 31";
  }
  if (s.endDate && s.endDate < s.startDate) return "The end date can't be before the start date";
  if (s.endDate && nextOnOrAfter(s, s.startDate) === null) return "No bill falls between the start and end dates";
  if (s.maxCount !== undefined && s.maxCount !== null && (!Number.isInteger(s.maxCount) || s.maxCount < 1)) return "Number of bills must be 1 or more";
  return null;
}

/** The next few dates of a schedule from `from` (for the form's preview). */
export function previewDates(s: Schedule, from: string, n = 5, maxCount: number | null = null): string[] {
  const out: string[] = [];
  let d = nextOnOrAfter(s, from);
  while (d && out.length < n && (maxCount === null || out.length < maxCount)) {
    out.push(d);
    d = nextAfter(s, d);
  }
  return out;
}
