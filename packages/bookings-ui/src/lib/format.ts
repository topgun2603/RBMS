import { formatINR, IST_OFFSET_MINUTES, todayIST } from "@rbms/gst";
import type { Interval } from "./types";

/*
 * The shop works in IST whatever the browser's timezone, so times are computed against UTC+05:30 explicitly.
 */

const MIN_MS = 60_000;

/** ₹ with Indian grouping from integer paise. */
export const money = (paise: number | null | undefined) => formatINR(Math.round(paise ?? 0));

/** Paise GST-exclusive → GST-inclusive (what the customer pays). */
export const withGst = (rate: number, gstRate: number) => Math.round((rate * (100 + gstRate)) / 100);

export { todayIST };

/** 570 → "09:30". */
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** "09:30" → 570; invalid → null. */
export function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 24 || min > 59 || (h === 24 && min > 0) ? null : h * 60 + min;
}

/** 570 → "9:30 am" (12-hour, as people say it). */
export function time12(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** Minutes since IST midnight of an ISO instant. */
export const istMinute = (iso: string | Date) => {
  const ms = new Date(iso).getTime() + IST_OFFSET_MINUTES * MIN_MS;
  return Math.floor((((ms % 86_400_000) + 86_400_000) % 86_400_000) / MIN_MS);
};

/** IST calendar day of an ISO instant. */
export const istDate = (iso: string | Date) => todayIST(new Date(iso));

/** ISO instant of minute `min` on IST day `date`. */
export const istIso = (date: string, min: number) => new Date(Date.parse(`${date}T00:00:00Z`) + (min - IST_OFFSET_MINUTES) * MIN_MS).toISOString();

/** "HH:MM" of an ISO instant in IST. */
export const istTime = (iso: string) => hhmm(istMinute(iso));

export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** 0 = Sunday. */
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** "45 min" / "1 h 30 min". */
export function duration(min: number): string {
  if (min < 60) return `${min} min`;
  const m = min % 60;
  return m ? `${Math.floor(min / 60)} h ${m} min` : `${Math.floor(min / 60)} h`;
}

/** The calendar's hours: 08:00–21:00, widened to the hour around anything that falls outside. */
export function gridRange(intervals: Interval[], base: Interval = { from: 8 * 60, to: 21 * 60 }): Interval {
  let from = base.from;
  let to = base.to;
  for (const i of intervals) {
    if (i.to <= i.from) continue;
    from = Math.min(from, Math.floor(i.from / 60) * 60);
    to = Math.max(to, Math.ceil(i.to / 60) * 60);
  }
  return { from: Math.max(0, from), to: Math.min(24 * 60, to) };
}

/**
 * Side-by-side lanes for overlapping blocks in one column (e.g. several unassigned appointments at 10:00): each block
 * gets a lane and the number of lanes in its cluster of overlaps.
 */
export function layoutLanes<T extends { from: number; to: number }>(blocks: T[]): { block: T; lane: number; lanes: number }[] {
  const sorted = [...blocks].sort((a, b) => a.from - b.from || b.to - a.to);
  const out: { block: T; lane: number; lanes: number }[] = [];
  let cluster: { block: T; lane: number; lanes: number }[] = [];
  let clusterEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) c.lanes = lanes;
    out.push(...cluster);
    cluster = [];
  };
  for (const b of sorted) {
    if (cluster.length && b.from >= clusterEnd) close();
    const taken = new Set(cluster.filter((c) => c.block.to > b.from).map((c) => c.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    cluster.push({ block: b, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, b.to);
  }
  if (cluster.length) close();
  return out;
}
