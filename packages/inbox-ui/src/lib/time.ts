/** Time helpers in IST (UTC+05:30, no daylight saving): day keys, day separators, countdowns. */

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

const ms = (d: Date | string | number) => (d instanceof Date ? d.getTime() : typeof d === "number" ? d : Date.parse(d));

/** "2026-10-15" — the IST calendar day of an instant. */
export function istDayKey(d: Date | string | number): string {
  return new Date(ms(d) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Whole IST calendar days from `a` to `b` (b later → positive). */
export function istDayDiff(a: Date | string | number, b: Date | string | number): number {
  const day = (x: Date | string | number) => Math.floor((ms(x) + IST_OFFSET_MS) / DAY_MS);
  return day(b) - day(a);
}

export type DayRelation = "today" | "yesterday" | "date";

/** How a day separator reads relative to `now`. */
export function dayRelation(d: Date | string | number, now: Date | number = Date.now()): DayRelation {
  const diff = istDayDiff(d, now);
  return diff === 0 ? "today" : diff === 1 ? "yesterday" : "date";
}

/** "HH:MM" in IST, 24 h. */
export function istTime(d: Date | string | number): string {
  return new Date(ms(d) + IST_OFFSET_MS).toISOString().slice(11, 16);
}

/** Splits a duration into hours and minutes (rounded up to the minute, never negative). */
export function hoursMinutes(remainingMs: number): { hours: number; minutes: number } {
  const total = Math.max(0, Math.ceil(remainingMs / 60_000));
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** Short relative age for lists: "now", "5m", "3h", "2d", or a date key past a week. */
export function shortAge(d: Date | string | number | null | undefined, now: Date | number = Date.now()): { unit: "now" | "m" | "h" | "d" | "date"; value: number } {
  if (d === null || d === undefined) return { unit: "date", value: 0 };
  const diff = Math.max(0, ms(now) - ms(d));
  if (diff < 60_000) return { unit: "now", value: 0 };
  if (diff < 3_600_000) return { unit: "m", value: Math.floor(diff / 60_000) };
  if (diff < DAY_MS) return { unit: "h", value: Math.floor(diff / 3_600_000) };
  if (diff < 7 * DAY_MS) return { unit: "d", value: Math.floor(diff / DAY_MS) };
  return { unit: "date", value: 0 };
}

/** `<input type="datetime-local">` value (IST wall clock) → ISO instant; null when empty or invalid. */
export function istLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const t = Date.parse(`${local}:00+05:30`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** ISO instant → `datetime-local` value in IST. */
export function isoToIstLocal(iso: string | Date): string {
  return new Date(ms(iso) + IST_OFFSET_MS).toISOString().slice(0, 16);
}
