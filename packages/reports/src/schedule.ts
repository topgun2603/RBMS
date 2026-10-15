/** Schedule presets → cron (IST) and next-run computation. Pure. */
import { z } from "zod";
import { IST_OFFSET_MS } from "./dates";

export const SCHEDULE_PRESETS = ["daily", "weekly", "monthly"] as const;
export type SchedulePreset = (typeof SCHEDULE_PRESETS)[number];

export const scheduleTimingSchema = z
  .object({
    preset: z.enum(SCHEDULE_PRESETS),
    /** IST hour, default 8. */
    hour: z.number().int().min(0).max(23).default(8),
    /** IST minute, default 0. */
    minute: z.number().int().min(0).max(59).default(0),
    /** Weekly: 0 = Sunday ... 6 = Saturday; default 1 (Monday). */
    weekday: z.number().int().min(0).max(6).default(1),
    /** Monthly: 1–28 (so every month has it); default 1. */
    dayOfMonth: z.number().int().min(1).max(28).default(1),
  })
  .strict();
export type ScheduleTimingInput = z.input<typeof scheduleTimingSchema>;
export type ScheduleTiming = z.output<typeof scheduleTimingSchema>;

/** Cron in IST: daily `0 8 * * *`, weekly Monday `0 8 * * 1`, monthly 1st `0 8 1 * *` (defaults). */
export function presetCron(input: ScheduleTimingInput): string {
  const t = scheduleTimingSchema.parse(input);
  const time = `${t.minute} ${t.hour}`;
  if (t.preset === "daily") return `${time} * * *`;
  if (t.preset === "weekly") return `${time} * * ${t.weekday}`;
  return `${time} ${t.dayOfMonth} * *`;
}

export interface ParsedCron {
  minute: number;
  hour: number;
  /** null = any */
  dayOfMonth: number | null;
  weekday: number | null;
}

/** Parses the restricted cron the presets produce: `m h dom * dow` with numbers or `*` (dom and dow not both set). */
export function parseCron(cron: string): ParsedCron {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Unsupported cron "${cron}"`);
  const [m, h, dom, mon, dow] = parts as [string, string, string, string, string];
  const num = (s: string, min: number, max: number, any: boolean): number | null => {
    if (any && s === "*") return null;
    if (!/^\d{1,2}$/.test(s)) throw new Error(`Unsupported cron "${cron}"`);
    const n = Number(s);
    if (n < min || n > max) throw new Error(`Unsupported cron "${cron}"`);
    return n;
  };
  if (mon !== "*") throw new Error(`Unsupported cron "${cron}"`);
  const out: ParsedCron = {
    minute: num(m, 0, 59, false)!,
    hour: num(h, 0, 23, false)!,
    dayOfMonth: num(dom, 1, 31, true),
    weekday: num(dow, 0, 6, true),
  };
  if (out.dayOfMonth !== null && out.weekday !== null) throw new Error(`Unsupported cron "${cron}"`);
  return out;
}

/** The first run strictly after `after`, evaluating the cron in IST. */
export function nextRunAt(cron: string, after: Date): Date {
  const c = parseCron(cron);
  // Work in "IST wall clock as UTC" space; IST has no DST so this is exact.
  const local = new Date(after.getTime() + IST_OFFSET_MS);
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  for (let i = 0; i < 800; i++) {
    const d = new Date(day.getTime() + i * 86_400_000);
    if (c.dayOfMonth !== null && d.getUTCDate() !== c.dayOfMonth) continue;
    if (c.weekday !== null && d.getUTCDay() !== c.weekday) continue;
    const runLocal = d.getTime() + (c.hour * 60 + c.minute) * 60_000;
    const run = new Date(runLocal - IST_OFFSET_MS);
    if (run.getTime() > after.getTime()) return run;
  }
  throw new Error(`Cron "${cron}" never runs`);
}

/** Reads a stored cron back into preset timing (for the edit form). Null for crons the presets can't produce. */
export function cronTiming(cron: string): ScheduleTiming | null {
  try {
    const c = parseCron(cron);
    const base = { hour: c.hour, minute: c.minute, weekday: 1, dayOfMonth: 1 };
    if (c.weekday !== null) return { ...base, preset: "weekly", weekday: c.weekday };
    if (c.dayOfMonth !== null) return c.dayOfMonth <= 28 ? { ...base, preset: "monthly", dayOfMonth: c.dayOfMonth } : null;
    return { ...base, preset: "daily" };
  } catch {
    return null;
  }
}
