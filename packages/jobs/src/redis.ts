import { Redis, type RedisOptions } from "ioredis";
import { noopLogger, type LoggerPort } from "./types";

/**
 * The slice of an ioredis client these helpers use. A real `Redis` satisfies it; tests pass a fake.
 */
export interface RedisClientLike {
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  set(key: string, value: string, px: "PX", milliseconds: number, nx: "NX"): Promise<string | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown;
  quit(): Promise<unknown>;
  disconnect(): void;
}

export type RedisRole = "publisher" | "subscriber" | "client";

export interface RedisHelperOptions {
  /** Builds a connection (default: ioredis with long-lived settings). Tests inject a fake here. */
  createClient?: (url: string, role: RedisRole) => RedisClientLike;
  log?: LoggerPort;
}

/**
 * Settings for long-lived connections: connect on first use, never fail a command because of a reconnect
 * (`maxRetriesPerRequest: null`, commands wait in the offline queue), back off up to 5 s between reconnects,
 * and re-subscribe automatically after a reconnect.
 */
export const LONG_LIVED_REDIS_OPTIONS: RedisOptions = {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  enableOfflineQueue: true,
  autoResubscribe: true,
  retryStrategy: (times: number) => Math.min(times * 200, 5000),
};

export const defaultRedisClient = (url: string, role: RedisRole): RedisClientLike =>
  new Redis(url, { ...LONG_LIVED_REDIS_OPTIONS, connectionName: `srikit:${role}` });

async function closeClient(client: RedisClientLike | null): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

export interface RedisPubSub {
  publish(channel: string, message: string): Promise<void>;
  /** Adds a handler; resolves (once subscribed) to a function that removes it. */
  subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

/**
 * Redis pub/sub with ONE publisher connection and ONE dedicated subscriber connection (a subscribed ioredis
 * connection cannot run other commands), both created lazily. Several handlers may listen on one channel; the
 * Redis SUBSCRIBE is sent for the first and UNSUBSCRIBE after the last is removed. A throwing (or rejecting)
 * handler is logged and never affects the others.
 */
export function createRedisPubSub(url: string, opts: RedisHelperOptions = {}): RedisPubSub {
  const create = opts.createClient ?? defaultRedisClient;
  const log = opts.log ?? noopLogger;
  const handlers = new Map<string, Set<(message: string) => void>>();
  /** In-flight SUBSCRIBE per channel, so later handlers wait for the same confirmation. */
  const pending = new Map<string, Promise<unknown>>();
  let pub: RedisClientLike | null = null;
  let sub: RedisClientLike | null = null;
  let closed = false;

  const assertOpen = () => {
    if (closed) throw new Error("redis pub/sub is closed");
  };

  const dispatch = (channel: string, message: string) => {
    const set = handlers.get(channel);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        const r = handler(message) as unknown;
        if (r && typeof (r as Promise<unknown>).then === "function") {
          (r as Promise<unknown>).catch((err) => log.error({ err, channel }, "redis pub/sub: handler failed"));
        }
      } catch (err) {
        log.error({ err, channel }, "redis pub/sub: handler failed");
      }
    }
  };

  const publisher = () => {
    if (!pub) {
      pub = create(url, "publisher");
      pub.on("error", (err: unknown) => log.warn({ err }, "redis pub/sub: publisher connection error"));
    }
    return pub;
  };

  const subscriber = () => {
    if (!sub) {
      sub = create(url, "subscriber");
      sub.on("error", (err: unknown) => log.warn({ err }, "redis pub/sub: subscriber connection error"));
      sub.on("message", (channel: string, message: string) => dispatch(String(channel), String(message)));
    }
    return sub;
  };

  return {
    async publish(channel, message) {
      assertOpen();
      await publisher().publish(channel, message);
    },

    async subscribe(channel, handler) {
      assertOpen();
      let set = handlers.get(channel);
      const first = !set;
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
      }
      set.add(handler);
      if (first) pending.set(channel, subscriber().subscribe(channel));
      const ready = pending.get(channel);
      try {
        await ready;
      } catch (err) {
        set.delete(handler);
        if (set.size === 0 && handlers.get(channel) === set) handlers.delete(channel);
        throw err;
      } finally {
        if (pending.get(channel) === ready && first) pending.delete(channel);
      }
      let removed = false;
      return async () => {
        if (removed) return;
        removed = true;
        const current = handlers.get(channel);
        if (!current) return;
        current.delete(handler);
        if (current.size === 0) {
          handlers.delete(channel);
          if (!closed && sub) await sub.unsubscribe(channel);
        }
      };
    },

    async close() {
      if (closed) return;
      closed = true;
      handlers.clear();
      pending.clear();
      const [p, s] = [pub, sub];
      pub = null;
      sub = null;
      await Promise.all([closeClient(p), closeClient(s)]);
    },
  };
}

export interface RedisNonceStore {
  /** True when the nonce was unused (and is now claimed for `ttlMs`); false when it was already claimed. */
  claim(nonce: string, ttlMs: number): Promise<boolean>;
  close(): Promise<void>;
}

/** One-time nonces (replay protection) via `SET <prefix><nonce> 1 NX PX <ttl>` on one lazily created connection. */
export function createRedisNonceStore(url: string, prefix = "chat:nonce:", opts: RedisHelperOptions = {}): RedisNonceStore {
  const create = opts.createClient ?? defaultRedisClient;
  const log = opts.log ?? noopLogger;
  let client: RedisClientLike | null = null;
  let closed = false;

  const conn = () => {
    if (!client) {
      client = create(url, "client");
      client.on("error", (err: unknown) => log.warn({ err }, "redis nonce store: connection error"));
    }
    return client;
  };

  return {
    async claim(nonce, ttlMs) {
      if (closed) throw new Error("redis nonce store is closed");
      if (!nonce) throw new Error("nonce is required");
      const ttl = Math.max(1, Math.ceil(Number.isFinite(ttlMs) ? ttlMs : 1));
      const res = await conn().set(`${prefix}${nonce}`, "1", "PX", ttl, "NX");
      return res === "OK";
    },
    async close() {
      if (closed) return;
      closed = true;
      const c = client;
      client = null;
      await closeClient(c);
    },
  };
}

export interface RedisProbe {
  /** PING with a fail-fast connection; throws when Redis is unreachable. */
  ping(): Promise<{ status: string }>;
  close(): Promise<void>;
}

/**
 * A dedicated connection for readiness checks: no offline queue and one retry per command, so a PING while Redis is
 * down fails at once instead of waiting for the reconnect (the long-lived connections queue commands until then).
 */
export function createRedisProbe(url: string): RedisProbe {
  let client: Redis | null = null;
  const get = () =>
    (client ??= new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      connectionName: "srikit:probe",
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
    }));
  return {
    async ping() {
      const c = get();
      // Swallow connection errors here; the PING below reports them.
      if (c.listenerCount("error") === 0) c.on("error", () => {});
      if (c.status === "wait") await c.connect();
      await c.ping();
      return { status: c.status };
    },
    async close() {
      if (!client) return;
      await client.quit().catch(() => client?.disconnect());
      client = null;
    },
  };
}

export interface RedisWindowCounter {
  /** Counts one hit in the fixed window of `key`; resolves to the count so far and the ms left in the window. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
  close(): Promise<void>;
}

/**
 * A fixed-window counter on Redis (INCR + PEXPIRE) for the API's HTTP rate limiter. Fail-fast connection (no offline
 * queue, short timeouts): when Redis is down `hit` rejects at once and the caller falls back to its in-memory counter.
 */
export function createRedisWindowCounter(url: string, prefix = "rl:"): RedisWindowCounter {
  let client: Redis | null = null;
  const get = () => {
    if (!client) {
      client = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 1500,
        connectionName: "srikit:ratelimit",
        retryStrategy: (times: number) => Math.min(times * 200, 2000),
      });
      client.on("error", () => {});
    }
    return client;
  };
  return {
    async hit(key, windowMs) {
      const c = get();
      if (c.status === "wait") await c.connect();
      const k = `${prefix}${key}`;
      const res = await c.multi().incr(k).pttl(k).exec();
      const count = Number(res?.[0]?.[1] ?? 1);
      let ttl = Number(res?.[1]?.[1] ?? -1);
      if (ttl < 0) {
        await c.pexpire(k, windowMs);
        ttl = windowMs;
      }
      return { count, resetMs: ttl };
    },
    async close() {
      if (!client) return;
      await client.quit().catch(() => client?.disconnect());
      client = null;
    },
  };
}
