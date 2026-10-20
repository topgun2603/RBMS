import { z } from "zod";
import type { SubscriptionStatus } from "./schema";

// ------------------------------------------------------------------ settings

/**
 * Settings namespace `memberships` (apps/api: `settings.define("memberships", MEMBERSHIPS_SETTINGS_SCHEMA,
 * MEMBERSHIPS_SETTINGS_DEFAULTS)`). `allowMultipleCheckins` lets a member check in more than once a day (two sessions);
 * `expiringDays` is the "expiring soon" window of lists and the dashboard; `memberCodePrefix` starts new member codes.
 */
export const MEMBERSHIPS_SETTINGS_SCHEMA = z.object({
  allowMultipleCheckins: z.boolean(),
  expiringDays: z.number().int().min(1).max(90),
  memberCodePrefix: z
    .string()
    .trim()
    .min(1)
    .max(6)
    .regex(/^[A-Za-z0-9]+$/, "Letters and digits only"),
});
export type MembershipsSettings = z.infer<typeof MEMBERSHIPS_SETTINGS_SCHEMA>;

export const MEMBERSHIPS_SETTINGS_DEFAULTS: MembershipsSettings = { allowMultipleCheckins: false, expiringDays: 7, memberCodePrefix: "M" };

/** Stored values over the defaults, key by key; invalid stored values fall back to the default. */
export function resolveMembershipsSettings(stored: Partial<Record<keyof MembershipsSettings, unknown>> | null | undefined): MembershipsSettings {
  const out: Record<string, unknown> = { ...MEMBERSHIPS_SETTINGS_DEFAULTS };
  const shape = MEMBERSHIPS_SETTINGS_SCHEMA.shape;
  for (const key of Object.keys(shape) as (keyof MembershipsSettings)[]) {
    const v = stored?.[key];
    if (v === undefined || v === null) continue;
    const parsed = shape[key].safeParse(v);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as MembershipsSettings;
}

// ------------------------------------------------------------------ dates (IST calendar days, "YYYY-MM-DD")

/** "YYYY-MM-DD" plus `days` (UTC calendar maths; the dates are IST calendar days). */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The instant an IST calendar day starts (for timestamptz ranges). */
export const istDayStart = (date: string) => new Date(`${date}T00:00:00+05:30`);

/** Last day of a plan that starts on `start` and runs `durationDays` (both ends inclusive: 30 days from Oct 1 → Oct 30). */
export const endDateFor = (start: string, durationDays: number) => addDays(start, Math.max(1, Math.round(durationDays)) - 1);

/** A renewal continues the day after the previous end, or starts today if that has already passed. */
export function renewalStart(previousEnd: string, today: string): string {
  const next = addDays(previousEnd, 1);
  return next > today ? next : today;
}

/** Days left on the plan counting from today: 0 = ends today, negative = ended that many days ago. */
export const daysLeft = (endDate: string, today: string) => daysBetween(today, endDate);

/** Ends today or within the next `withinDays` days (not yet expired). */
export const isExpiringWithin = (endDate: string, today: string, withinDays: number) => endDate >= today && endDate <= addDays(today, withinDays);

// ------------------------------------------------------------------ state

/** What a subscription is on a given day. `expired` and `upcoming` come from the dates; the rest are stored. */
export type SubscriptionState = "active" | "frozen" | "expired" | "upcoming" | "cancelled";

export interface SubscriptionDates {
  status: SubscriptionStatus;
  startDate: string;
  endDate: string;
}

export function subscriptionState(s: SubscriptionDates, date: string): SubscriptionState {
  if (s.status === "cancelled") return "cancelled";
  if (s.status === "frozen") return "frozen";
  if (s.endDate < date) return "expired";
  if (s.startDate > date) return "upcoming";
  return "active";
}

/** Visits left on a session pack; null = unlimited. */
export const sessionsLeft = (total: number | null, used: number) => (total === null ? null : Math.max(0, total - used));

/** Freeze days still available. */
export const freezeDaysLeft = (allowed: number, used: number) => Math.max(0, allowed - used);

/**
 * Unfreezing on `today` after a freeze from `frozenFrom`: the days frozen (capped at what is left of the allowance)
 * are added to the end date. Unfreezing on the day it was frozen credits nothing.
 */
export function unfreezeResult(s: { endDate: string; frozenFrom: string; freezeDaysAllowed: number; freezeDaysUsed: number }, today: string) {
  const frozen = Math.max(0, daysBetween(s.frozenFrom, today));
  const credited = Math.min(frozen, freezeDaysLeft(s.freezeDaysAllowed, s.freezeDaysUsed));
  return { frozenDays: frozen, credited, endDate: addDays(s.endDate, credited), freezeDaysUsed: s.freezeDaysUsed + credited };
}

export type FreezeRefusal = "not_active" | "no_freeze_days" | "already_frozen";

/** A running plan with freeze days left can be frozen. */
export function canFreeze(s: SubscriptionDates & { freezeDaysAllowed: number; freezeDaysUsed: number }, today: string): FreezeRefusal | null {
  const state = subscriptionState(s, today);
  if (state === "frozen") return "already_frozen";
  if (state !== "active") return "not_active";
  if (freezeDaysLeft(s.freezeDaysAllowed, s.freezeDaysUsed) <= 0) return "no_freeze_days";
  return null;
}

// ------------------------------------------------------------------ check-in

export const CHECKIN_REFUSALS = ["no_active_plan", "frozen", "no_sessions_left", "already_checked_in"] as const;
export type CheckinRefusal = (typeof CHECKIN_REFUSALS)[number];

/**
 * May the member come in? Needs a running plan (not frozen) with sessions left, and, unless the shop allows several
 * visits a day, no check-in yet today. `state` is null when the member has no plan covering today.
 */
export function checkinDecision(p: {
  state: SubscriptionState | null;
  sessionsTotal: number | null;
  sessionsUsed: number;
  checkedInToday: boolean;
  allowMultiple: boolean;
}): { ok: true } | { ok: false; reason: CheckinRefusal } {
  if (p.state === "frozen") return { ok: false, reason: "frozen" };
  if (p.state !== "active") return { ok: false, reason: "no_active_plan" };
  if (sessionsLeft(p.sessionsTotal, p.sessionsUsed) === 0) return { ok: false, reason: "no_sessions_left" };
  if (p.checkedInToday && !p.allowMultiple) return { ok: false, reason: "already_checked_in" };
  return { ok: true };
}

/**
 * The subscription that decides a check-in or the member's card: of the plans not cancelled, the one covering `date`
 * (a frozen one counts), else the next upcoming one, else the last one that ended. Null without any.
 */
export function currentSubscription<T extends SubscriptionDates & { createdAt?: Date | string }>(subs: T[], date: string): T | null {
  const live = subs.filter((s) => s.status !== "cancelled");
  const byEndDesc = [...live].sort((a, b) => (a.endDate === b.endDate ? String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) : a.endDate < b.endDate ? 1 : -1));
  const covering = byEndDesc.filter((s) => s.status === "frozen" || (s.startDate <= date && s.endDate >= date));
  if (covering.length) return covering[covering.length - 1]!;
  const upcoming = live.filter((s) => s.startDate > date).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  if (upcoming.length) return upcoming[0]!;
  return byEndDesc[0] ?? null;
}

// ------------------------------------------------------------------ members

export type MemberStatus = "active" | "expiring" | "expired" | "none";
export const MEMBER_STATUSES = ["active", "expiring", "expired", "none"] as const satisfies readonly MemberStatus[];

/** From the member's latest end date (of plans not cancelled): none, expired, expiring within the window, or active. */
export function memberStatus(lastEnd: string | null, today: string, withinDays: number): MemberStatus {
  if (!lastEnd) return "none";
  if (lastEnd < today) return "expired";
  if (isExpiringWithin(lastEnd, today, withinDays)) return "expiring";
  return "active";
}

/** "M" + 42 → "M-0042". */
export const formatMemberCode = (prefix: string, n: number) => `${prefix.trim().toUpperCase() || "M"}-${String(n).padStart(4, "0")}`;

/**
 * An Indian mobile number as E.164 ("+919876543210"), or null when it isn't one. Copied from invoices' ledger
 * (packages never import each other). Accepts "98765 43210", "098765-43210", "+91 98765 43210", "919876543210".
 */
export function toIndianE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!/^\+?[0-9][0-9 ()-]*$/.test(trimmed)) return null;
  let d = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) {
    if (!d.startsWith("91")) return null;
    d = d.slice(2);
  } else if (d.length === 14 && d.startsWith("0091")) d = d.slice(4);
  else if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d) ? `+91${d}` : null;
}

/** What the front desk typed: a mobile number, a member code ("M-0042", "m0042") or just the number (42). */
export function parseLookup(input: string): { kind: "phone"; phone: string } | { kind: "code"; code: string } | { kind: "number"; n: number } | null {
  const v = input.trim();
  if (!v) return null;
  const phone = toIndianE164(v);
  if (phone) return { kind: "phone", phone };
  if (/^\d{1,9}$/.test(v)) return { kind: "number", n: Number(v) };
  const m = v.toUpperCase().match(/^([A-Z0-9]{1,6}?)-?(\d{1,9})$/);
  if (m) return { kind: "code", code: formatMemberCode(m[1]!, Number(m[2])) };
  return /^[A-Za-z0-9-]{1,20}$/.test(v) ? { kind: "code", code: v.toUpperCase() } : null;
}

// ------------------------------------------------------------------ reports

/** One row per day from `from` to `to` (inclusive), zero where there were no rows. */
export function fillDays(from: string, to: string, rows: { date: string; count: number }[]): { date: string; count: number }[] {
  const by = new Map(rows.map((r) => [r.date, r.count]));
  const out: { date: string; count: number }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push({ date: d, count: by.get(d) ?? 0 });
  return out;
}
