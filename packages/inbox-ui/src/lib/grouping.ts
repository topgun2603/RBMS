import { dayRelation, istDayKey, type DayRelation } from "./time";

/**
 * Turns a flat, oldest-first message list into what the thread renders: a day separator whenever the IST calendar
 * day changes, and runs of messages from the same sender (a new group after `gapMs` of silence, or after a day break).
 */

export interface GroupableMessage {
  id: string;
  senderId: string;
  createdAt: string;
}

export type ThreadItem<M extends GroupableMessage> =
  | { kind: "day"; key: string; day: string; relation: DayRelation; at: string }
  | { kind: "group"; key: string; senderId: string; mine: boolean; messages: M[] };

export interface GroupOptions {
  myId: string | null;
  now?: Date | number;
  /** A pause longer than this starts a new group even from the same sender. Default 5 minutes. */
  gapMs?: number;
}

export function groupMessages<M extends GroupableMessage>(messages: readonly M[], opts: GroupOptions): ThreadItem<M>[] {
  const gap = opts.gapMs ?? 5 * 60_000;
  const now = opts.now ?? Date.now();
  const out: ThreadItem<M>[] = [];
  let lastDay: string | null = null;
  let group: Extract<ThreadItem<M>, { kind: "group" }> | null = null;
  let lastAt = 0;
  for (const m of messages) {
    const at = Date.parse(m.createdAt);
    const day = istDayKey(at);
    if (day !== lastDay) {
      out.push({ kind: "day", key: `day-${day}`, day, relation: dayRelation(at, now), at: m.createdAt });
      lastDay = day;
      group = null;
    }
    if (!group || group.senderId !== m.senderId || at - lastAt > gap) {
      group = { kind: "group", key: `g-${m.id}`, senderId: m.senderId, mine: !!opts.myId && m.senderId === opts.myId, messages: [] };
      out.push(group);
    }
    group.messages.push(m);
    lastAt = at;
  }
  return out;
}

/** Merges two oldest-first lists by id (later copies win: edits, deletes), sorted by time then id. */
export function mergeById<M extends { id: string; createdAt: string }>(a: readonly M[], b: readonly M[]): M[] {
  const byId = new Map<string, M>();
  for (const m of a) byId.set(m.id, m);
  for (const m of b) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => Date.parse(x.createdAt) - Date.parse(y.createdAt) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

export type ReadState = "sending" | "failed" | "sent" | "read";

/**
 * Tick state of my message: "read" once any other participant's read marker reached it, else "sent".
 * (Pending/failed states come from the optimistic send queue, not from here.)
 */
export function readState(
  message: { senderId: string; createdAt: string },
  participants: readonly { userId: string; lastReadAt: string | null }[],
  myId: string,
): ReadState {
  const at = Date.parse(message.createdAt);
  const read = participants.some((p) => p.userId !== myId && p.lastReadAt && Date.parse(p.lastReadAt) >= at);
  return read ? "read" : "sent";
}

/** Typing users still "typing" (an event within `windowMs`), excluding me. */
export function activeTypers(typing: Readonly<Record<string, number>>, now: number, myId: string | null, windowMs = 5_000): string[] {
  return Object.entries(typing)
    .filter(([id, at]) => id !== myId && now - at < windowMs)
    .map(([id]) => id);
}
