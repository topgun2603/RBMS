import { z } from "zod";
import { TICKET_PRIORITIES, type TicketPriority, type TicketStatus } from "./schema";

// ------------------------------------------------------------------ settings (namespace `support`)

const HHMM = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Use HH:MM (24 h)");
const hours = z.number().positive().max(24 * 60);

/**
 * Working hours for SLA clocks, in IST. `days`: 0 = Sunday … 6 = Saturday. `null` = round the clock (24×7).
 * A window must not cross midnight (`start < end`).
 */
export const businessHoursSchema = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    start: HHMM,
    end: HHMM,
  })
  .refine((b) => toMinutes(b.start) < toMinutes(b.end), "Closing time must be after opening time");
export type BusinessHours = z.output<typeof businessHoursSchema>;

/** For apps/api: `settings.define("support", SUPPORT_SETTINGS_SCHEMA, SUPPORT_SETTINGS_DEFAULTS)`. */
export const SUPPORT_SETTINGS_SCHEMA = z.object({
  /** Ticket number prefix: "TKT" → "TKT-0001". */
  prefix: z.string().trim().regex(/^[A-Z0-9]{1,8}$/, "1–8 capital letters or digits"),
  /** Hours to the first staff reply, per priority. */
  firstResponseHours: z.object({ low: hours, normal: hours, high: hours, urgent: hours }),
  /** Count SLA hours only inside these hours; null = 24×7 (default). */
  businessHours: businessHoursSchema.nullable(),
  /** New tickets are assigned to this staff member (auth user id); null = unassigned, the support team is told. */
  defaultAssigneeId: z.string().uuid().nullable(),
  /** Guests (no account, OTP-verified phone) may raise tickets. */
  allowGuests: z.boolean(),
});
export type SupportSettings = z.output<typeof SUPPORT_SETTINGS_SCHEMA>;

export const SUPPORT_SETTINGS_DEFAULTS: SupportSettings = {
  prefix: "TKT",
  firstResponseHours: { low: 72, normal: 24, high: 8, urgent: 2 },
  businessHours: null,
  defaultAssigneeId: null,
  allowGuests: true,
};

/** A stored settings value (possibly partial or stale) with defaults filled in field by field. */
export function resolveSupportSettings(raw: unknown): SupportSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const shape = SUPPORT_SETTINGS_SCHEMA.shape;
  const pick = <K extends keyof SupportSettings>(key: K): SupportSettings[K] => {
    const r = shape[key].safeParse(v[key]);
    return r.success ? (r.data as SupportSettings[K]) : SUPPORT_SETTINGS_DEFAULTS[key];
  };
  const frh = (v.firstResponseHours ?? {}) as Record<string, unknown>;
  const firstResponseHours = { ...SUPPORT_SETTINGS_DEFAULTS.firstResponseHours };
  for (const p of TICKET_PRIORITIES) {
    const r = hours.safeParse(frh[p]);
    if (r.success) firstResponseHours[p] = r.data;
  }
  return {
    prefix: pick("prefix"),
    firstResponseHours,
    businessHours: v.businessHours === undefined ? null : pick("businessHours"),
    defaultAssigneeId: v.defaultAssigneeId === undefined ? null : pick("defaultAssigneeId"),
    allowGuests: pick("allowGuests"),
  };
}

// ------------------------------------------------------------------ SLA math

const MINUTE = 60_000;
const DAY = 86_400_000;
/** IST = UTC+05:30, no daylight saving. */
const IST_OFFSET = 330 * MINUTE;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * `start` + `hours` of SLA time. Without business hours this is plain clock time (24×7). With business hours only
 * minutes inside the IST working windows count: a ticket raised at night starts its clock when the shop opens.
 */
export function addSlaHours(start: Date, hrs: number, businessHours: BusinessHours | null = null): Date {
  const total = Math.max(0, hrs) * 60 * MINUTE;
  if (!businessHours) return new Date(start.getTime() + total);
  const days = new Set(businessHours.days);
  const open = toMinutes(businessHours.start) * MINUTE;
  const close = toMinutes(businessHours.end) * MINUTE;
  if (days.size === 0 || open >= close) return new Date(start.getTime() + total);

  let remaining = total;
  let cursor = start.getTime() + IST_OFFSET; // IST wall-clock milliseconds
  // 1970-01-01 was a Thursday (4). A year of days is plenty for any sane SLA.
  for (let guard = 0; guard < 3700; guard++) {
    const day = Math.floor(cursor / DAY);
    const dow = (((day + 4) % 7) + 7) % 7;
    if (days.has(dow)) {
      const windowStart = day * DAY + open;
      const windowEnd = day * DAY + close;
      if (cursor < windowStart) cursor = windowStart;
      if (cursor < windowEnd) {
        const available = windowEnd - cursor;
        if (remaining <= available) return new Date(cursor + remaining - IST_OFFSET);
        remaining -= available;
      }
    }
    cursor = (day + 1) * DAY;
  }
  return new Date(start.getTime() + total);
}

/** First-response deadline of a ticket created at `createdAt` with `priority`. */
export function slaDueAt(createdAt: Date, priority: TicketPriority, settings: Pick<SupportSettings, "firstResponseHours" | "businessHours">): Date {
  return addSlaHours(createdAt, settings.firstResponseHours[priority], settings.businessHours);
}

/** Statuses whose first-response clock is still running. */
export const SLA_ACTIVE_STATUSES: readonly TicketStatus[] = ["open", "pending"];

/**
 * Overdue now: no first staff reply yet, still active, not merged away, and past the deadline.
 * (A ticket answered late is not overdue any more; `slaBreached` remembers the miss.)
 */
export function isOverdue(
  t: { status: TicketStatus; firstResponseAt: Date | null; slaDueAt: Date | null; mergedIntoId?: string | null },
  now: Date,
): boolean {
  if (t.firstResponseAt || !t.slaDueAt || t.mergedIntoId) return false;
  if (!SLA_ACTIVE_STATUSES.includes(t.status)) return false;
  return now.getTime() > t.slaDueAt.getTime();
}

/** Did a first reply at `at` miss the deadline? */
export const missedSla = (slaDue: Date | null, at: Date) => Boolean(slaDue && at.getTime() > slaDue.getTime());
