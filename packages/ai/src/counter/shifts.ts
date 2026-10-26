import { addDays, daysBetween, PLAN_FESTIVALS, type PlanFestival } from "../insights/calendar";
import { median } from "./stats";

/**
 * Shift planning (feature `shift-planning`, no model). From the last 8 weeks of bills per hour per weekday the software works out
 * how many bills to expect in each hour of next week, lifts days inside a festival's shopping window, and divides by how many
 * bills one person usually handles in an hour at this shop. The result is a suggestion for the owner to copy or print.
 */

export interface HourRow {
  /** IST date. */
  date: string;
  hour: number;
  bills: number;
  /** Different people who rang a bill in that hour. */
  staff: number;
}

export interface ShiftSettings {
  /** Bills one person handles in an hour. Missing = the shop's own median. */
  billsPerStaffHour?: number;
}

export interface UpliftInfo {
  festival: { id: string; name: string; nameTa: string; date: string };
  factor: number;
  /** "history": from this shop's own sales around the same festival last year. "default": a plain rule until there is a year of data. */
  source: "history" | "default";
}

export interface ShiftCell {
  hour: number;
  expectedBills: number;
  staff: number;
}
export interface ShiftDay {
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  uplift: UpliftInfo | null;
  cells: ShiftCell[];
  peakHour: number | null;
  peakStaff: number;
  expectedBills: number;
  staffHours: number;
}
export interface ShiftPlan {
  /** First day (Monday) of the planned week. */
  weekStart: string;
  days: ShiftDay[];
  target: { billsPerStaffHour: number; source: "setting" | "median" | "fallback" };
  weeksUsed: number;
  /** The hours shown (opening range across the week). */
  fromHour: number;
  toHour: number;
  totals: { staffHours: number; expectedBills: number };
}

const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** The Monday on or before a date. */
export const mondayOf = (d: string) => addDays(d, -((weekdayOf(d) + 6) % 7));

/** Default lift for a day inside a festival's shopping window: stronger in the last two days before it, none on the day. */
export function defaultUplift(daysAway: number): number {
  if (daysAway <= 0) return 1;
  if (daysAway <= 2) return 1.4;
  return 1.2;
}

export interface UpliftPorts {
  /** This shop's own ratio for a festival last year (average daily bills in its shopping window over the weeks before it), or null. */
  history?(festival: PlanFestival): number | null;
}

/** The festival (if any) whose shopping window holds `date`. The nearest one wins. */
export function upliftFor(date: string, ports: UpliftPorts = {}, list: readonly PlanFestival[] = PLAN_FESTIVALS): UpliftInfo | null {
  let best: { f: PlanFestival; away: number } | null = null;
  for (const f of list) {
    const away = daysBetween(date, f.date);
    if (away < 0 || away > f.leadDays) continue;
    if (!best || away < best.away) best = { f, away };
  }
  if (!best) return null;
  const h = ports.history?.(best.f) ?? null;
  const raw = h !== null && Number.isFinite(h) ? h : defaultUplift(best.away);
  const factor = Math.min(2.5, Math.max(1, Math.round(raw * 100) / 100));
  return { festival: { id: best.f.id, name: best.f.name, nameTa: best.f.nameTa, date: best.f.date }, factor, source: h !== null ? "history" : "default" };
}

/** The shop's own bills per person per hour: the median over its busy hours (hours with at least one bill). */
export function medianBillsPerStaffHour(rows: readonly HourRow[]): number | null {
  const vals = rows.filter((r) => r.bills > 0 && r.staff > 0).map((r) => r.bills / r.staff);
  if (vals.length < 20) return null;
  return Math.max(1, Math.round(median(vals) * 10) / 10);
}

/**
 * Next week's grid. `today` is IST today; the planned week is the Monday after `today` unless today is Monday and `thisWeek` is
 * set. `rows` are the last 8 weeks (up to yesterday); weeks with no bills at all on a weekday (shop closed) count as zero.
 */
export function planShifts(rows: readonly HourRow[], today: string, settings: ShiftSettings = {}, ports: UpliftPorts = {}, opts: { thisWeek?: boolean } = {}): ShiftPlan {
  const weekStart = opts.thisWeek ? mondayOf(today) : addDays(mondayOf(today), 7);
  const from = addDays(today, -56);
  const used = rows.filter((r) => r.date >= from && r.date < today);

  // weekday -> hour -> sums over the weeks that weekday was seen
  const dayBills = new Map<string, number>();
  for (const r of used) dayBills.set(r.date, (dayBills.get(r.date) ?? 0) + r.bills);
  const openDates = new Set([...dayBills.entries()].filter(([, b]) => b > 0).map(([d]) => d));
  const perWeekday = new Map<number, Set<string>>();
  for (const d of openDates) perWeekday.set(weekdayOf(d), (perWeekday.get(weekdayOf(d)) ?? new Set()).add(d));
  const total = new Map<string, number>(); // `${weekday}:${hour}`
  for (const r of used) {
    if (!openDates.has(r.date)) continue;
    const k = `${weekdayOf(r.date)}:${r.hour}`;
    total.set(k, (total.get(k) ?? 0) + r.bills);
  }
  const weeksUsed = Math.min(8, Math.max(0, ...[...perWeekday.values()].map((s) => s.size)));

  const median1 = medianBillsPerStaffHour(used);
  const target =
    typeof settings.billsPerStaffHour === "number" && settings.billsPerStaffHour > 0
      ? { billsPerStaffHour: settings.billsPerStaffHour, source: "setting" as const }
      : median1 !== null
        ? { billsPerStaffHour: median1, source: "median" as const }
        : { billsPerStaffHour: 8, source: "fallback" as const };

  const days: ShiftDay[] = [];
  let lo = 24;
  let hi = -1;
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const wd = weekdayOf(date);
    const n = perWeekday.get(wd)?.size ?? 0;
    const uplift = upliftFor(date, ports);
    const cells: ShiftCell[] = [];
    for (let h = 0; h < 24; h++) {
      const avg = n > 0 ? (total.get(`${wd}:${h}`) ?? 0) / n : 0;
      const expected = avg * (uplift?.factor ?? 1);
      if (expected < 0.3) continue;
      const staff = Math.max(1, Math.ceil(expected / target.billsPerStaffHour - 1e-9));
      cells.push({ hour: h, expectedBills: Math.round(expected * 10) / 10, staff });
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    const peak = cells.reduce<ShiftCell | null>((b, c) => (!b || c.expectedBills > b.expectedBills ? c : b), null);
    days.push({
      date,
      weekday: wd,
      uplift,
      cells,
      peakHour: peak?.hour ?? null,
      peakStaff: peak?.staff ?? 0,
      expectedBills: Math.round(cells.reduce((s, c) => s + c.expectedBills, 0)),
      staffHours: cells.reduce((s, c) => s + c.staff, 0),
    });
  }
  return {
    weekStart,
    days,
    target,
    weeksUsed,
    fromHour: hi < 0 ? 9 : lo,
    toHour: hi < 0 ? 20 : hi,
    totals: { staffHours: days.reduce((s, d) => s + d.staffHours, 0), expectedBills: days.reduce((s, d) => s + d.expectedBills, 0) },
  };
}

const hr = (h: number, ta = false) => {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return ta ? `${h < 12 ? "காலை" : h < 17 ? "மதியம்" : "மாலை"} ${h12}` : `${h12} ${h < 12 ? "am" : "pm"}`;
};
export const hourLabel = hr;

/** A one-line summary in code (the optional AI line is not needed). */
export function planSummary(p: ShiftPlan, lang: "en" | "ta"): string {
  const busiest = [...p.days].filter((d) => d.peakHour !== null).sort((a, b) => b.expectedBills - a.expectedBills)[0];
  if (!busiest) return lang === "ta" ? "இதுவரை போதுமான பில் தரவு இல்லை." : "There is not enough billing history yet.";
  const names = lang === "ta" ? ["ஞாயிறு", "திங்கள்", "செவ்வாய்", "புதன்", "வியாழன்", "வெள்ளி", "சனி"] : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return lang === "ta"
    ? `${p.totals.expectedBills} பில்கள் எதிர்பார்க்கப்படுகிறது, மொத்தம் ${p.totals.staffHours} பணியாளர்-மணி நேரம். மிகவும் பரபரப்பான நாள் ${names[busiest.weekday]}, உச்ச நேரம் ${hr(busiest.peakHour!, true)} மணி (${busiest.peakStaff} பேர்).`
    : `About ${p.totals.expectedBills} bills expected, ${p.totals.staffHours} staff-hours in all. Busiest day is ${names[busiest.weekday]}, peak at ${hr(busiest.peakHour!)} (${busiest.peakStaff} people).`;
}
