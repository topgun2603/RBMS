/** Small IST-date helpers for the money helpers ("YYYY-MM-DD" strings, calendar arithmetic in UTC). */

const DAY = 86_400_000;
const ms = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

export const addDays = (d: string, n: number): string => new Date(ms(d) + n * DAY).toISOString().slice(0, 10);
/** Whole days from `a` to `b` (positive when b is later). */
export const daysBetween = (a: string, b: string): number => Math.round((ms(b) - ms(a)) / DAY);
/** 0 = Sunday. */
export const weekdayOf = (d: string): number => new Date(ms(d)).getUTCDay();
export const monthOf = (d: string): string => d.slice(0, 7);
export const addMonths = (month: string, n: number): string => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const d = new Date(Date.UTC(y, m, 1));
  return d.toISOString().slice(0, 7);
};
export const daysInMonth = (month: string): number => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

export const r0 = (n: number) => Math.round(n);
export const r1 = (n: number) => Math.round(n * 10) / 10;
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
