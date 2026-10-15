import type { Ticket, TicketPriority, TicketStatus } from "./types";

/**
 * SLA badge for a ticket's first-response deadline (mirrors @srirealtime/support sla.ts `isOverdue`):
 * - "overdue": no first reply yet, still open/pending, past `slaDueAt` (red)
 * - "due_soon": same, but due within `soonMs` (amber; default 2 h, or a quarter of the window for short SLAs)
 * - "on_track": due later
 * - "met" / "missed": a first reply was sent (on time / late)
 * - "none": no SLA (merged, resolved/closed without reply, or no deadline)
 * The badge is never colour alone: the component always shows an icon and text.
 */
export type SlaState = "overdue" | "due_soon" | "on_track" | "met" | "missed" | "none";

const ACTIVE: readonly TicketStatus[] = ["open", "pending"];

export function slaState(
  t: Pick<Ticket, "status" | "firstResponseAt" | "slaDueAt" | "mergedIntoId" | "slaBreached" | "createdAt">,
  now: Date | number = Date.now(),
  soonMs = 2 * 60 * 60 * 1000,
): SlaState {
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (t.mergedIntoId) return "none";
  if (t.firstResponseAt) {
    const missed = t.slaBreached || (!!t.slaDueAt && Date.parse(t.firstResponseAt) > Date.parse(t.slaDueAt));
    return missed ? "missed" : "met";
  }
  if (!t.slaDueAt || !ACTIVE.includes(t.status)) return "none";
  const due = Date.parse(t.slaDueAt);
  if (nowMs > due) return "overdue";
  const windowMs = due - Date.parse(t.createdAt);
  const soon = windowMs > 0 ? Math.min(soonMs, windowMs / 4) : soonMs;
  return due - nowMs <= soon ? "due_soon" : "on_track";
}

/** Signed minutes to the deadline (negative = overdue by). */
export const minutesToDue = (slaDueAt: string, now: Date | number = Date.now()) =>
  Math.round((Date.parse(slaDueAt) - (typeof now === "number" ? now : now.getTime())) / 60_000);

/** "2h 15m" / "45m" / "3d 4h" pieces for a duration in minutes (absolute value). */
export function durationParts(minutes: number): { d: number; h: number; m: number } {
  const total = Math.abs(Math.round(minutes));
  return { d: Math.floor(total / 1440), h: Math.floor((total % 1440) / 60), m: total % 60 };
}

/** Allowed status moves (mirror of the server's TICKET_TRANSITIONS). */
export const TICKET_TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  open: ["pending", "resolved", "closed"],
  pending: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};

export const nextStatuses = (s: TicketStatus): readonly TicketStatus[] => TICKET_TRANSITIONS[s];

/** Sort weight for priorities (urgent first). */
export const PRIORITY_RANK: Record<TicketPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
