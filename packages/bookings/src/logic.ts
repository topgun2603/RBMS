import { inclusiveOfRate } from "@srirealtime/gst";
import type { AppointmentStatus, HoursBreak } from "./schema";

/*
 * Slot maths. Everything here works in IST (UTC+05:30, no daylight saving): a day is "YYYY-MM-DD" and a time of day is
 * minutes since IST midnight (0…1440). Intervals are half-open, [from, to).
 */

export const IST_OFFSET_MIN = 330;
export const DAY_MIN = 24 * 60;
const MIN_MS = 60_000;

export interface Interval {
  from: number;
  to: number;
}

export interface DayHours {
  opens: string;
  closes: string;
  breaks: HoursBreak[];
}

// ---------------------------------------------------------------------------------------------- IST dates

/** "09:30" → 570. Accepts 00:00…24:00; anything else → null. */
export function parseHHMM(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null;
  return h * 60 + min;
}

/** 570 → "09:30". */
export const formatHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** The IST calendar day of an instant. */
export const istDateOf = (d: Date) => new Date(d.getTime() + IST_OFFSET_MIN * MIN_MS).toISOString().slice(0, 10);

/** Minutes since IST midnight of an instant (0…1439, fractions floored). */
export function istMinuteOf(d: Date): number {
  const ms = d.getTime() + IST_OFFSET_MIN * MIN_MS;
  return Math.floor((((ms % 86_400_000) + 86_400_000) % 86_400_000) / MIN_MS);
}

/** The instant of minute `minute` on IST day `date` (minute 1440 = next midnight). */
export const istInstant = (date: string, minute: number) => new Date(Date.parse(`${date}T00:00:00Z`) + (minute - IST_OFFSET_MIN) * MIN_MS);

/** 0 = Sunday … 6 = Saturday. */
export const istWeekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** IST midnight to the next IST midnight. */
export const istDayRange = (date: string) => ({ start: istInstant(date, 0), end: istInstant(date, DAY_MIN) });

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Whole days from `a` to `b` (both "YYYY-MM-DD"). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The part of [from, to) that falls on IST day `date`, in minutes of that day; null when none does. */
export function clipToDay(date: string, from: Date, to: Date): Interval | null {
  const { start } = istDayRange(date);
  const a = Math.max(0, Math.floor((from.getTime() - start.getTime()) / MIN_MS));
  const b = Math.min(DAY_MIN, Math.ceil((to.getTime() - start.getTime()) / MIN_MS));
  return b > a ? { from: a, to: b } : null;
}

// ---------------------------------------------------------------------------------------------- intervals

/** Sorted, merged, empty ones dropped. */
export function normalize(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.to > i.from).sort((a, b) => a.from - b.from);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.from <= last.to) last.to = Math.max(last.to, i.to);
    else out.push({ ...i });
  }
  return out;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of normalize(a)) for (const y of normalize(b)) {
    const from = Math.max(x.from, y.from);
    const to = Math.min(x.to, y.to);
    if (to > from) out.push({ from, to });
  }
  return normalize(out);
}

/** `a` with every part covered by `b` cut out. */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  let out = normalize(a);
  for (const cut of normalize(b)) {
    out = out.flatMap((x) => {
      if (cut.to <= x.from || cut.from >= x.to) return [x];
      const parts: Interval[] = [];
      if (cut.from > x.from) parts.push({ from: x.from, to: cut.from });
      if (cut.to < x.to) parts.push({ from: cut.to, to: x.to });
      return parts;
    });
  }
  return out;
}

/** Half-open overlap: touching end to start is not an overlap. */
export const overlaps = (a: Interval, b: Interval) => a.from < b.to && b.from < a.to;

/** Same for instants (appointments). */
export const overlapsAt = (a: { start: Date; end: Date }, b: { start: Date; end: Date }) => a.start < b.end && b.start < a.end;

// ---------------------------------------------------------------------------------------------- hours

/** Problem with a day's hours, or null: opens before closes, breaks inside the day and not overlapping. */
export function hoursError(h: DayHours): string | null {
  const o = parseHHMM(h.opens);
  const c = parseHHMM(h.closes);
  if (o === null || c === null) return "Use HH:MM times";
  if (c <= o) return "Closing time must be after opening time";
  const breaks: Interval[] = [];
  for (const b of h.breaks) {
    const f = parseHHMM(b.from);
    const t = parseHHMM(b.to);
    if (f === null || t === null) return "Use HH:MM times";
    if (t <= f) return "A break must end after it starts";
    if (f < o || t > c) return "Breaks must be inside the opening hours";
    if (breaks.some((x) => overlaps(x, { from: f, to: t }))) return "Breaks overlap";
    breaks.push({ from: f, to: t });
  }
  return null;
}

/** Working windows of a day's hours (opening hours minus breaks). Null / invalid = closed. */
export function hoursWindows(h: DayHours | null | undefined): Interval[] {
  if (!h || hoursError(h)) return [];
  const open: Interval = { from: parseHHMM(h.opens)!, to: parseHHMM(h.closes)! };
  return subtract([open], h.breaks.map((b) => ({ from: parseHHMM(b.from)!, to: parseHHMM(b.to)! })));
}

/**
 * When a staff member can be booked on a day: the shop's hours ∩ their own. `staff` undefined = they follow the shop's
 * hours; null = they're off that day.
 */
export function workingWindows(shop: DayHours | null | undefined, staff: DayHours | null | undefined): Interval[] {
  const s = hoursWindows(shop);
  return staff === undefined ? s : intersect(s, hoursWindows(staff));
}

// ---------------------------------------------------------------------------------------------- slots

export const DEFAULT_STEP_MIN = 15;

/** Total time of several services done back to back; the clean-up buffer is the longest one (done once, at the end). */
export function serviceTotals(list: { durationMin: number; bufferMin: number }[]): { durationMin: number; bufferMin: number } {
  return { durationMin: list.reduce((s, x) => s + x.durationMin, 0), bufferMin: list.reduce((m, x) => Math.max(m, x.bufferMin), 0) };
}

/**
 * Earliest start minute allowed on `date`: nothing in the past, and at least `leadMin` from now. A past day →
 * Infinity (no slots); a future day → 0.
 */
export function earliestStart(date: string, now: Date, leadMin = 0): number {
  const today = istDateOf(now);
  if (date < today) return Number.POSITIVE_INFINITY;
  const earliest = istMinuteOf(now) + leadMin - daysBetween(today, date) * DAY_MIN;
  return Math.max(0, earliest);
}

export interface SlotOptions {
  /** When the person works (minutes of the day). */
  windows: Interval[];
  /** Time already taken: appointments (with their buffers) and time off. */
  busy: Interval[];
  durationMin: number;
  bufferMin?: number;
  stepMin?: number;
  /** No start before this minute (see `earliestStart`). */
  earliest?: number;
}

/**
 * Free start minutes for one person: on the clock grid of `stepMin` (09:00, 09:15 …), the service fits inside a working
 * window, and service + buffer clash with nothing busy. The buffer may run past closing time.
 */
export function freeStarts(o: SlotOptions): number[] {
  const step = Math.max(5, o.stepMin ?? DEFAULT_STEP_MIN);
  const buffer = Math.max(0, o.bufferMin ?? 0);
  const earliest = o.earliest ?? 0;
  if (o.durationMin <= 0 || !Number.isFinite(earliest)) return [];
  const busy = normalize(o.busy);
  const out: number[] = [];
  for (const w of normalize(o.windows)) {
    for (let s = Math.ceil(Math.max(w.from, earliest) / step) * step; s + o.durationMin <= w.to; s += step) {
      const slot = { from: s, to: s + o.durationMin + buffer };
      if (!busy.some((b) => overlaps(slot, b))) out.push(s);
    }
  }
  return out;
}

/** Free starts of one bookable person (`staffId` null = the shop itself when it has no staff set up). */
export interface ResourceSlots {
  staffId: string | null;
  starts: number[];
  /** Minutes already booked that day: "any staff" goes to the least busy. */
  bookedMin: number;
}

export interface AnySlot {
  start: number;
  /** Who gets it: the least busy free person (ties → first in the list). */
  staffId: string | null;
  /** Everyone free then. */
  staffIds: (string | null)[];
}

/** "Any staff": every start at least one person is free for, assigned to the least busy of them. */
export function mergeAnyStaff(list: ResourceSlots[]): AnySlot[] {
  const byStart = new Map<number, ResourceSlots[]>();
  for (const r of list) for (const s of r.starts) byStart.set(s, [...(byStart.get(s) ?? []), r]);
  return [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, free]) => ({ start, staffId: pickLeastBusy(free)!.staffId, staffIds: free.map((r) => r.staffId) }));
}

/** The entry with the fewest booked minutes; the first one wins a tie. */
export function pickLeastBusy<T extends { bookedMin: number }>(list: T[]): T | undefined {
  let best: T | undefined;
  for (const x of list) if (!best || x.bookedMin < best.bookedMin) best = x;
  return best;
}

/** Whether a staff member does every one of these services (`serviceItemIds` empty = they do everything). */
export const staffDoes = (serviceItemIds: readonly string[], itemIds: readonly string[]) => serviceItemIds.length === 0 || itemIds.every((id) => serviceItemIds.includes(id));

/** Busy minutes of an appointment on its day: start → end + buffer. */
export function appointmentBusy(date: string, a: { start: Date; end: Date; bufferMin: number }): Interval | null {
  return clipToDay(date, a.start, new Date(a.end.getTime() + a.bufferMin * MIN_MS));
}

// ---------------------------------------------------------------------------------------------- status

const NEXT: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  booked: ["confirmed", "arrived", "in_service", "cancelled", "no_show"],
  confirmed: ["arrived", "in_service", "cancelled", "no_show"],
  arrived: ["in_service", "cancelled", "no_show"],
  in_service: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

/** booked → confirmed → arrived → in_service → completed (skipping ahead is fine); cancel / no-show before service starts. */
export const canMoveStatus = (from: AppointmentStatus, to: AppointmentStatus) => from === to || NEXT[from].includes(to);

/** The moves the desk can make from a status, in flow order. */
export const nextStatuses = (from: AppointmentStatus): readonly AppointmentStatus[] => NEXT[from];

/** Time and staff can still change (not started, not closed). */
export const canReschedule = (s: AppointmentStatus) => s === "booked" || s === "confirmed";

/** A bill can be made once the service has started. */
export const canBill = (s: AppointmentStatus) => s === "in_service" || s === "completed";

/** Customers may cancel their own booking until `beforeMin` minutes (default 2 h) before it starts. */
export function canCustomerCancel(status: AppointmentStatus, start: Date, now: Date, beforeMin = 120): boolean {
  return (status === "booked" || status === "confirmed") && start.getTime() - now.getTime() >= beforeMin * MIN_MS;
}

/** GST-inclusive price shown to customers, from the GST-exclusive rate in paise (services priced before GST). */
export const priceWithGst = (rate: number, gstRate: number) => Math.round((rate * (100 + gstRate)) / 100);

/** What the price port says about a service's catalogue item. */
export interface PricedItem {
  rate: number;
  gstRate: number;
  price?: number | null;
  taxInclusive?: boolean | null;
}

/**
 * The GST-inclusive price customers see and pay: the entered price itself when the catalogue price includes GST
 * (₹6,500 stays ₹6,500), else the exclusive rate plus GST. Never converted to the exclusive rate and back.
 */
export function servicePrice(item: PricedItem): number {
  if (item.taxInclusive && typeof item.price === "number") return item.price;
  return priceWithGst(item.rate, item.gstRate);
}

/**
 * The GST-inclusive amount of a booked service line (`rate` / `gstRate` as saved on the appointment), given the
 * catalogue item now (`live`, if still there): null for a service priced before GST (the bill adds GST on top as
 * usual). For a tax-inclusive price it is the catalogue's price while the saved rate still matches it, else the price
 * recovered from the saved rate (`inclusiveOfRate`) — never `rate + GST`, which drifts by a paisa.
 */
export function bookedInclusive(line: { rate: number; gstRate: number }, live: PricedItem | null | undefined): number | null {
  if (!live?.taxInclusive || !line.gstRate) return null;
  if (live.rate === line.rate && live.gstRate === line.gstRate && typeof live.price === "number") return live.price;
  return inclusiveOfRate(line.rate, line.gstRate);
}

/** What a customer pays for a booked service line, GST included. */
export const bookedPrice = (line: { rate: number; gstRate: number }, live: PricedItem | null | undefined) =>
  bookedInclusive(line, live) ?? priceWithGst(line.rate, line.gstRate);
