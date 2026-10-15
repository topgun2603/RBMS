/**
 * Pure chat helpers for the storefront widget (no React, no DOM): message ordering and merging, read ticks, unread
 * counts and the reconnect back-off. Mirrors @srirealtime/chat's cursor format (`<ms>_<uuid>`).
 */
import type { ChatConversation, ChatMessage, ChatParticipant } from "../types";

/** Splits a `<ms>_<id>` cursor; null for anything else. */
export function parseCursor(cursor: string | null | undefined): { at: number; id: string } | null {
  const m = /^(\d{1,15})_(.+)$/.exec(cursor ?? "");
  return m ? { at: Number(m[1]), id: m[2]! } : null;
}

/** (created_at, id) order — the server's order. Messages without a cursor (optimistic) sort by createdAt, last on ties. */
export function compareMessages(a: Pick<ChatMessage, "cursor" | "createdAt" | "id">, b: Pick<ChatMessage, "cursor" | "createdAt" | "id">): number {
  const ca = parseCursor(a.cursor);
  const cb = parseCursor(b.cursor);
  const ta = ca?.at ?? Date.parse(a.createdAt);
  const tb = cb?.at ?? Date.parse(b.createdAt);
  if (ta !== tb) return ta - tb;
  if (!ca && cb) return 1;
  if (ca && !cb) return -1;
  const ia = ca?.id ?? a.id;
  const ib = cb?.id ?? b.id;
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/** True for a client-side optimistic message (not yet acknowledged by the API). */
export const isLocal = (m: Pick<ChatMessage, "pending">) => !!m.pending;

/**
 * Merges `incoming` into `existing`: same id → replaced (edits, deletions), new ids added, result in server order.
 * A confirmed message of mine also retires the oldest pending optimistic message with the same body, so a message that
 * arrives over the stream before its POST returns isn't shown twice.
 */
export function mergeMessages(existing: readonly ChatMessage[], incoming: readonly ChatMessage[], me?: string | null): ChatMessage[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) {
    if (!m.pending && me && m.senderId === me && !byId.has(m.id)) {
      const twin = [...byId.values()].find((x) => x.pending === "sending" && x.body === m.body);
      if (twin) byId.delete(twin.id);
    }
    byId.set(m.id, m);
  }
  return [...byId.values()].sort(compareMessages);
}

/** The newest cursor among confirmed messages (what to replay from after a reconnect), or null. */
export function latestCursor(messages: readonly ChatMessage[], current: string | null = null): string | null {
  let best = current;
  for (const m of messages) {
    if (m.pending || !parseCursor(m.cursor)) continue;
    if (!best || compareMessages({ cursor: best, createdAt: "", id: "" }, m) < 0) best = m.cursor;
  }
  return best;
}

/** Someone other than me (shop staff) has read up to this message. */
export function isSeen(message: Pick<ChatMessage, "createdAt" | "senderId">, participants: readonly ChatParticipant[], me: string): boolean {
  const at = Date.parse(message.createdAt);
  return participants.some((p) => p.userId !== me && p.lastReadAt !== null && Date.parse(p.lastReadAt) >= at);
}

/** Unread for me: live messages from others after my read marker. */
export function unreadCount(messages: readonly ChatMessage[], me: string, lastReadAt: string | null): number {
  const since = lastReadAt ? Date.parse(lastReadAt) : -Infinity;
  return messages.filter((m) => !m.pending && m.senderId !== me && !m.deletedAt && Date.parse(m.createdAt) > since).length;
}

/**
 * Applies a `read` event to a participant list (markers only move forward). A reader who isn't listed yet — staff
 * join a shop-facing conversation by reading or replying — is added as staff.
 */
export function applyRead(participants: readonly ChatParticipant[], userId: string, readAt: string): ChatParticipant[] {
  if (!participants.some((p) => p.userId === userId)) return [...participants, { userId, kind: "staff", name: null, lastReadAt: readAt, joinedAt: readAt }];
  return participants.map((p) =>
    p.userId === userId && (!p.lastReadAt || Date.parse(readAt) > Date.parse(p.lastReadAt)) ? { ...p, lastReadAt: readAt } : p,
  );
}

/** The conversation to open first: an order conversation for `orderId`, else the most recent support/order one. */
export function pickConversation(list: readonly ChatConversation[], orderId?: string | null): ChatConversation | null {
  if (orderId) {
    const hit = list.find((c) => c.type === "order" && c.subjectId === orderId);
    if (hit) return hit;
  }
  const mine = list.filter((c) => c.type === "support" || c.type === "order");
  return [...mine].sort((a, b) => Date.parse(b.lastMessageAt ?? b.createdAt) - Date.parse(a.lastMessageAt ?? a.createdAt))[0] ?? null;
}

/** Reconnect delay: 1 s, 2 s, 4 s … capped at 30 s, with up to 30 % jitter (`random` for tests). */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, Math.min(attempt, 15)));
  return Math.round(base * (1 + 0.3 * random()));
}

/** Day bucket for message separators: "today" | "yesterday" | an IST date key "2026-10-16". */
export function dayKey(iso: string, now: Date = new Date()): string {
  const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const day = ist(new Date(iso));
  if (day === ist(now)) return "today";
  if (day === ist(new Date(now.getTime() - 86_400_000))) return "yesterday";
  return day;
}

/** Name to show for a sender: the participant's name, else a fallback ("Shop"). */
export function senderName(participants: readonly ChatParticipant[], userId: string, fallback: string): string {
  return participants.find((p) => p.userId === userId)?.name?.trim() || fallback;
}

/** An order conversation's title is the orders module's label ("Order ORD/26-27/0171"): the bare number. */
export function orderNumberOf(title: string | null | undefined): string {
  return (title ?? "").replace(/^order\s+/i, "").trim();
}
