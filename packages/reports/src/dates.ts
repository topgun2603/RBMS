/** IST (Asia/Kolkata, UTC+05:30, no DST) calendar helpers. Pure. */
import type { DatePreset } from "./types";

export const IST_OFFSET_MS = 330 * 60_000;
export const IST_TZ = "Asia/Kolkata";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date "YYYY-MM-DD". */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** The IST calendar date of an instant. */
export const istDate = (now: Date): string => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** The instant an IST date starts (00:00 IST), e.g. "2026-04-01" → 2026-03-31T18:30:00.000Z. */
export const istStart = (date: string): Date => new Date(new Date(`${date}T00:00:00Z`).getTime() - IST_OFFSET_MS);

export function addDaysISO(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

/** Monday of the week containing `date`. */
function mondayOf(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysISO(date, -((dow + 6) % 7));
}

/** Indian financial year (April–March) start year for a date. */
export const fyStartYear = (date: string): number => {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 4 ? y : y - 1;
};

/** Resolves a relative preset to inclusive IST dates, as of `now`. */
export function resolvePreset(preset: DatePreset, now: Date): { from: string; to: string } {
  const today = istDate(now);
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const d = addDaysISO(today, -1);
      return { from: d, to: d };
    }
    case "last_7_days":
      return { from: addDaysISO(today, -6), to: today };
    case "last_30_days":
      return { from: addDaysISO(today, -29), to: today };
    case "this_week":
      return { from: mondayOf(today), to: today };
    case "last_week": {
      const from = addDaysISO(mondayOf(today), -7);
      return { from, to: addDaysISO(from, 6) };
    }
    case "this_month":
      return { from: ymd(y, m, 1), to: today };
    case "last_month":
      return { from: ymd(y, m - 1, 1), to: ymd(y, m, 0) };
    case "this_quarter": {
      const qStart = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: ymd(y, qStart, 1), to: today };
    }
    case "this_fy":
      return { from: ymd(fyStartYear(today), 4, 1), to: today };
    case "last_fy": {
      const fy = fyStartYear(today) - 1;
      return { from: ymd(fy, 4, 1), to: ymd(fy + 1, 3, 31) };
    }
  }
}

/** "01-04-2026" style (Indian day-first) for email subjects and file names. */
export const displayDate = (date: string) => `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
