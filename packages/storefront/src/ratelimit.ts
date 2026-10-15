/** In-memory sliding-window limiter (per process). `hit` returns false once `limit` hits fall inside `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private calls = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  hit(key: string): boolean {
    const t = this.now();
    const from = t - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((x) => x > from);
    if (++this.calls % 500 === 0) this.sweep(from);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    return true;
  }

  private sweep(from: number) {
    for (const [k, v] of this.hits) if (!v.some((x) => x > from)) this.hits.delete(k);
  }
}
