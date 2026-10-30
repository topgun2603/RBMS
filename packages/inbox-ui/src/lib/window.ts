/**
 * WhatsApp's 24-hour customer-service window (copied from @rbms/whatsapp logic.ts — UI modules don't import
 * server packages): free-form messages only within 24 h of the customer's last message; outside it, a template.
 */

import { hoursMinutes } from "./time";

export const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Under this much time left the banner turns amber. */
export const WINDOW_WARN_MS = 2 * 60 * 60 * 1000;

export type WindowTone = "open" | "closing" | "closed" | "never";

export interface WindowState {
  open: boolean;
  expiresAt: Date | null;
  remainingMs: number;
  hours: number;
  minutes: number;
  tone: WindowTone;
}

export function sessionWindow(lastInboundAt: string | Date | null | undefined, now: Date | number = Date.now()): WindowState {
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (!lastInboundAt) return { open: false, expiresAt: null, remainingMs: 0, hours: 0, minutes: 0, tone: "never" };
  const last = typeof lastInboundAt === "string" ? Date.parse(lastInboundAt) : lastInboundAt.getTime();
  const expiresAt = new Date(last + SESSION_WINDOW_MS);
  const remainingMs = Math.max(0, expiresAt.getTime() - nowMs);
  const { hours, minutes } = hoursMinutes(remainingMs);
  const open = remainingMs > 0;
  return { open, expiresAt, remainingMs, hours, minutes, tone: !open ? "closed" : remainingMs <= WINDOW_WARN_MS ? "closing" : "open" };
}

/** Free-form allowed now (the server is the last word: it answers 409 `window_closed` / `opted_out`). */
export function canSendFreeForm(c: { lastInboundAt: string | null; optedOutAt: string | null }, now: Date | number = Date.now()): boolean {
  const w = sessionWindow(c.lastInboundAt, now);
  if (!w.open) return false;
  if (c.optedOutAt && c.lastInboundAt && Date.parse(c.optedOutAt) > Date.parse(c.lastInboundAt)) return false;
  return true;
}

/** How often the countdown should tick: every minute normally, every 15 s in the last 5 minutes. */
export function countdownInterval(remainingMs: number): number {
  return remainingMs > 0 && remainingMs <= 5 * 60_000 ? 15_000 : 60_000;
}
