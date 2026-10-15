/**
 * Saved replies ("macros lite") for the support desk: kept in localStorage per signed-in user, never on the server.
 * Every read/write is guarded (private windows, blocked storage) and falls back to an in-memory copy.
 */

export interface SavedReply {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

export const SAVED_REPLIES_MAX = 50;

export const savedRepliesKey = (userId: string) => `sr_inbox_saved_replies:${userId}`;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const memory = new Map<string, string>();
const memoryStore: KeyValueStore = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) };

function defaultStore(): KeyValueStore {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // blocked
  }
  return memoryStore;
}

function isReply(v: unknown): v is SavedReply {
  const r = v as SavedReply;
  return !!r && typeof r.id === "string" && typeof r.title === "string" && typeof r.body === "string";
}

export function loadSavedReplies(userId: string, store: KeyValueStore = defaultStore()): SavedReply[] {
  try {
    const raw = store.getItem(savedRepliesKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isReply).slice(0, SAVED_REPLIES_MAX) : [];
  } catch {
    return [];
  }
}

export function storeSavedReplies(userId: string, list: readonly SavedReply[], store: KeyValueStore = defaultStore()): boolean {
  try {
    store.setItem(savedRepliesKey(userId), JSON.stringify(list.slice(0, SAVED_REPLIES_MAX)));
    return true;
  } catch {
    return false;
  }
}

/** Adds or replaces (same id) a reply; newest first, at most SAVED_REPLIES_MAX. */
export function upsertReply(list: readonly SavedReply[], reply: Omit<SavedReply, "id" | "updatedAt"> & { id?: string }, now = new Date()): SavedReply[] {
  const id = reply.id ?? `r${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const next: SavedReply = { id, title: reply.title.trim().slice(0, 80), body: reply.body.trim().slice(0, 5000), updatedAt: now.toISOString() };
  return [next, ...list.filter((r) => r.id !== id)].slice(0, SAVED_REPLIES_MAX);
}

export const removeReply = (list: readonly SavedReply[], id: string) => list.filter((r) => r.id !== id);

/**
 * Fills `{name}` and `{ticket}` in a saved reply. Single braces only (`{{1}}` style is WhatsApp's, not ours);
 * unknown names are left as written.
 */
export function fillReply(body: string, vars: { name?: string | null; ticket?: string | null }): string {
  return body.replace(/\{(name|ticket)\}/g, (all, k: "name" | "ticket") => vars[k]?.trim() || all);
}
