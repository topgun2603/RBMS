/**
 * In-memory sliding-window limiter (per process). `hit(key)` records an attempt and says whether it is allowed;
 * refused attempts are not recorded. Idle keys are swept as the map grows.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private sweptAt = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const now = this.now();
    this.sweep(now);
    const from = now - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, list[0]! + this.windowMs - now) };
    }
    list.push(now);
    this.hits.set(key, list);
    return { allowed: true, remaining: this.limit - list.length, retryAfterMs: 0 };
  }

  /** Number of tracked keys (tests). */
  get size() {
    return this.hits.size;
  }

  private sweep(now: number) {
    if (now - this.sweptAt < this.windowMs) return;
    this.sweptAt = now;
    const from = now - this.windowMs;
    for (const [k, list] of this.hits) if (!list.some((t) => t > from)) this.hits.delete(k);
  }
}
