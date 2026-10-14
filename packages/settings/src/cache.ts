/** Tiny TTL cache keyed by string; invalidated by key prefix. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V) {
    if (this.ttlMs <= 0) return;
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  deletePrefix(prefix: string) {
    for (const k of this.entries.keys()) if (k.startsWith(prefix)) this.entries.delete(k);
  }

  clear() {
    this.entries.clear();
  }
}
