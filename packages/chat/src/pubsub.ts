import type { PubSubPort, Unsubscribe } from "./ports";

/**
 * In-process pub/sub for development and single-instance deployments. Delivery is synchronous; a throwing handler is
 * isolated from the others. With several API instances use the Redis driver in apps/api instead.
 */
export class MemoryPubSub implements PubSubPort {
  private readonly channels = new Map<string, Set<(message: string) => void>>();

  async publish(channel: string, message: string): Promise<void> {
    const handlers = this.channels.get(channel);
    if (!handlers) return;
    for (const h of [...handlers]) {
      try {
        h(message);
      } catch {
        // one bad subscriber must not break the others
      }
    }
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<Unsubscribe> {
    let set = this.channels.get(channel);
    if (!set) this.channels.set(channel, (set = new Set()));
    set.add(handler);
    return () => {
      const s = this.channels.get(channel);
      s?.delete(handler);
      if (s && s.size === 0) this.channels.delete(channel);
    };
  }

  /** Number of handlers on a channel (tests, diagnostics). */
  listeners(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }
}
