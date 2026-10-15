export interface RateDecision {
  allowed: boolean;
  /** Tokens left after this request. */
  remaining: number;
  /** Seconds until a token is available (0 when allowed). */
  retryAfterSec: number;
}

export interface RateLimiter {
  take(key: string, nowMs?: number): RateDecision;
}

/**
 * In-memory token bucket per key: `capacity` requests, refilled continuously at `capacity / windowMs`.
 * Per process only (each API instance counts separately).
 */
export class TokenBucketLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly ratePerMs: number;

  constructor(
    readonly capacity = 600,
    readonly windowMs = 60_000,
    private readonly maxKeys = 10_000,
  ) {
    this.ratePerMs = capacity / windowMs;
  }

  take(key: string, nowMs = Date.now()): RateDecision {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.prune(nowMs);
      b = { tokens: this.capacity, at: nowMs };
      this.buckets.set(key, b);
    } else {
      b.tokens = Math.min(this.capacity, b.tokens + Math.max(0, nowMs - b.at) * this.ratePerMs);
      b.at = nowMs;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { allowed: true, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
    }
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / this.ratePerMs / 1000)) };
  }

  /** Drops buckets that are full again (idle keys). */
  private prune(nowMs: number) {
    for (const [k, b] of this.buckets) {
      if (b.tokens + (nowMs - b.at) * this.ratePerMs >= this.capacity) this.buckets.delete(k);
    }
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}
