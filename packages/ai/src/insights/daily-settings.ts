import { z } from "zod";
import { addDays } from "./calendar";

/** Settings > AI > Daily summary (stored inside the `ai` settings namespace as `dailySummary`). */
export const DAILY_SUMMARY_SCHEMA = z.object({
  /** Off by default: nothing is sent and no credits are used until the owner switches it on. */
  enabled: z.boolean(),
  /** HH:MM, IST. Default 21:00. */
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** Language of the narrative. */
  language: z.enum(["en", "ta"]),
  /** Extra phones (staff) that also get the summary on WhatsApp. The owner is always included unless `toOwner` is off. */
  phones: z.array(z.string().trim().regex(/^\+?[0-9][0-9 ()-]{6,17}$/, "Enter a valid phone number")).max(5),
  toOwner: z.boolean(),
});
export type DailySummarySettings = z.infer<typeof DAILY_SUMMARY_SCHEMA>;

export const DAILY_SUMMARY_DEFAULTS: DailySummarySettings = { enabled: false, time: "21:00", language: "en", phones: [], toOwner: true };

/** Stored (maybe partial or stale) value to complete settings; invalid parts fall back to the defaults. */
export function resolveDailySummary(stored: unknown): DailySummarySettings {
  const s = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...DAILY_SUMMARY_DEFAULTS };
  for (const key of Object.keys(DAILY_SUMMARY_SCHEMA.shape) as (keyof DailySummarySettings)[]) {
    if (s[key] === undefined) continue;
    const r = DAILY_SUMMARY_SCHEMA.shape[key].safeParse(s[key]);
    if (r.success) out[key] = r.data;
  }
  return out as DailySummarySettings;
}

const IST_MS = 330 * 60_000;
/** IST date and minutes since midnight of an instant. */
export function istParts(now: Date): { date: string; minutes: number } {
  const t = new Date(now.getTime() + IST_MS);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** How long after the chosen time a missed run may still go out (the job runs every 15 minutes; a restart can delay it). */
export const CATCH_UP_MINUTES = 6 * 60;

/**
 * Is a shop's summary due at `now`? Due from the chosen time until CATCH_UP_MINUTES later, once per day (the table's unique
 * key does the "once"). A time before noon summarises yesterday (the day has barely started); later times summarise today.
 */
export function dueNow(settings: Pick<DailySummarySettings, "enabled" | "time">, now: Date): { due: boolean; date: string } {
  const { date: today, minutes } = istParts(now);
  const at = minutesOf(settings.time);
  const date = at < 12 * 60 ? addDays(today, -1) : today;
  const due = settings.enabled && minutes >= at && minutes < at + CATCH_UP_MINUTES;
  return { due, date };
}

/** Indian mobile to "+91XXXXXXXXXX", else null. */
export function indianPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  let n = d;
  if (d.length === 12 && d.startsWith("91")) n = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) n = d.slice(1);
  else if (d.length !== 10) return null;
  return /^[6-9]\d{9}$/.test(n) ? `+91${n}` : null;
}
