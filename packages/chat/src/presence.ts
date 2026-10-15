/**
 * Who has an open stream, per process. With several API instances a user connected to another instance looks offline
 * here, so they may get an offline notification they did not need (never the reverse). A shared presence store
 * (Redis) can replace this class by implementing the same methods.
 */
export const OFFLINE_GRACE_MS = 60_000;
export const NOTIFY_COOLDOWN_MS = 10 * 60_000;

export interface PresenceState {
  /** Open streams. */
  open: number;
  /** When the last stream closed (ms), null if never connected or still connected. */
  lastClosedAt: number | null;
}

/** Offline = no open stream, and none closed within the grace period (default 60 s). */
export function isOffline(state: PresenceState | undefined, now: number, graceMs = OFFLINE_GRACE_MS): boolean {
  if (!state) return true;
  if (state.open > 0) return false;
  return state.lastClosedAt === null || now - state.lastClosedAt >= graceMs;
}

export class Presence {
  private readonly states = new Map<string, PresenceState>();

  constructor(private readonly now: () => number = Date.now) {}

  private key = (tenantId: string, userId: string) => `${tenantId}:${userId}`;

  connected(tenantId: string, userId: string) {
    const k = this.key(tenantId, userId);
    const s = this.states.get(k) ?? { open: 0, lastClosedAt: null };
    s.open += 1;
    s.lastClosedAt = null;
    this.states.set(k, s);
  }

  disconnected(tenantId: string, userId: string) {
    const s = this.states.get(this.key(tenantId, userId));
    if (!s) return;
    s.open = Math.max(0, s.open - 1);
    if (s.open === 0) s.lastClosedAt = this.now();
  }

  state(tenantId: string, userId: string): PresenceState | undefined {
    return this.states.get(this.key(tenantId, userId));
  }

  isOnline(tenantId: string, userId: string): boolean {
    return (this.state(tenantId, userId)?.open ?? 0) > 0;
  }

  isOffline(tenantId: string, userId: string, graceMs = OFFLINE_GRACE_MS): boolean {
    const now = this.now();
    const s = this.state(tenantId, userId);
    // forget users who have been gone for a long time
    if (s && s.open === 0 && s.lastClosedAt !== null && now - s.lastClosedAt > 24 * 3_600_000) {
      this.states.delete(this.key(tenantId, userId));
    }
    return isOffline(s, now, graceMs);
  }
}

/** At most one notification per key per cooldown. */
export class NotifyThrottle {
  private readonly last = new Map<string, number>();

  constructor(
    private readonly cooldownMs = NOTIFY_COOLDOWN_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** True (and remembers it) when `key` was not notified within the cooldown. */
  take(key: string): boolean {
    const now = this.now();
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < this.cooldownMs) return false;
    this.last.set(key, now);
    if (this.last.size > 10_000) {
      for (const [k, t] of this.last) if (now - t >= this.cooldownMs) this.last.delete(k);
    }
    return true;
  }

  /** Forget a key, e.g. once the recipient has read the conversation. */
  reset(key: string) {
    this.last.delete(key);
  }
}
