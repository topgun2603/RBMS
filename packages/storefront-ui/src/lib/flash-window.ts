/**
 * When a flash sale is live (pure): between its `startsAt` (omitted = now) and `endsAt`, and — with a `daily` window
 * ("every day 18:00–21:00", shop time = IST) — only inside that window each day. A window may run past midnight
 * (22:00–02:00); "24:00" is midnight at the end of the day. The countdown runs to the end of the current window
 * (never past `endsAt`).
 */

export interface FlashTimes {
  startsAt?: string;
  endsAt: string;
  daily?: { from: string; to: string };
}

const IST_OFFSET_MIN = 330;
const DAY_MS = 86_400_000;

/** "18:30" → 1110; "24:00" → 1440; anything else → null. */
export function hhmm(v: string | undefined): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(v ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return 1440;
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export interface FlashState {
  live: boolean;
  /** Epoch ms the countdown runs to (the current window's end, capped by `endsAt`); null when not live. */
  endsAt: number | null;
}

export function flashState(s: FlashTimes, now: number): FlashState {
  const start = s.startsAt ? Date.parse(s.startsAt) : NaN;
  const end = Date.parse(s.endsAt);
  if ((Number.isFinite(start) && now < start) || (Number.isFinite(end) && now >= end)) return { live: false, endsAt: null };
  const from = hhmm(s.daily?.from);
  const to = hhmm(s.daily?.to);
  if (from === null || to === null || from === to) return { live: true, endsAt: Number.isFinite(end) ? end : null };
  // Minutes since IST midnight, and IST midnight today as epoch ms.
  const local = now + IST_OFFSET_MIN * 60_000;
  const minute = Math.floor((local % DAY_MS) / 60_000);
  const midnight = now - (local % DAY_MS);
  let windowEnd: number | null = null;
  if (from < to) {
    if (minute >= from && minute < to) windowEnd = midnight + to * 60_000;
  } else if (minute >= from) windowEnd = midnight + DAY_MS + to * 60_000; // overnight, before midnight
  else if (minute < to) windowEnd = midnight + to * 60_000; // overnight, after midnight
  if (windowEnd === null) return { live: false, endsAt: null };
  return { live: true, endsAt: Number.isFinite(end) ? Math.min(end, windowEnd) : windowEnd };
}

/** "6:00 pm" / Tamil "மாலை 6:00" for an "HH:MM" (shop time). */
export function formatShopTime(v: string, locale: string): string {
  const m = hhmm(v);
  if (m === null) return v;
  const d = new Date(Date.UTC(2026, 0, 1, 0, 0) + (m % 1440) * 60_000);
  return new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(d);
}
