// Pure coupon display rules (value label, validity window, usage) for the coupon screens. Unit-tested.
import { istDate, money, todayIST } from "./format";
import type { Coupon } from "./types";

export type CouponState = "active" | "scheduled" | "expired" | "used_up" | "off";

/** Where a coupon stands today (IST): switched off, not started, ended, fully used, or live. */
export function couponState(c: Pick<Coupon, "active" | "startsAt" | "endsAt" | "usageLimit" | "usedCount">, now: Date = new Date()): CouponState {
  if (!c.active) return "off";
  if (c.endsAt && new Date(c.endsAt).getTime() < now.getTime()) return "expired";
  if (c.startsAt && new Date(c.startsAt).getTime() > now.getTime()) return "scheduled";
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return "used_up";
  return "active";
}

/** "10%" (with "up to ₹200"), "₹100", or null for free shipping (the caller shows its own label). */
export function couponValueText(c: Pick<Coupon, "type" | "value" | "maxDiscount">): { main: string | null; cap: string | null } {
  if (c.type === "percent") return { main: `${c.value}%`, cap: c.maxDiscount ? money(c.maxDiscount) : null };
  if (c.type === "flat") return { main: money(c.value), cap: null };
  return { main: null, cap: null };
}

/** IST calendar days of the window, for date inputs and labels ("2026-10-01" … "2026-10-31"); null when open. */
export function couponWindow(c: Pick<Coupon, "startsAt" | "endsAt">): { from: string | null; to: string | null } {
  return { from: c.startsAt ? istDate(c.startsAt) : null, to: c.endsAt ? istDate(c.endsAt) : null };
}

/** Days left until the coupon ends (IST days, inclusive of today); null without an end. */
export function daysLeft(c: Pick<Coupon, "endsAt">, today = todayIST()): number | null {
  if (!c.endsAt) return null;
  const end = istDate(c.endsAt);
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Random readable code: 8 characters without look-alikes (0/O, 1/I). */
export function randomCode(prefix = "", len = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const bytes = new Uint8Array(len);
  globalThis.crypto?.getRandomValues?.(bytes);
  for (let i = 0; i < len; i++) s += alphabet[(bytes[i] ?? Math.floor(Math.random() * 256)) % alphabet.length];
  return `${prefix}${s}`;
}
