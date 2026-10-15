import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createRedisNonceStore, createRedisPubSub, LONG_LIVED_REDIS_OPTIONS, type RedisClientLike, type RedisRole } from "./redis";

/** In-memory stand-in for ioredis: a shared "server" routes PUBLISH to subscribed fake connections. */
function fakeRedis() {
  const subscribers = new Set<FakeClient>();
  const keys = new Map<string, { value: string; expiresAt: number }>();
  const created: Array<{ role: RedisRole; client: FakeClient }> = [];
  let now = 0;

  class FakeClient extends EventEmitter implements RedisClientLike {
    channels = new Set<string>();
    calls: string[] = [];
    quitCalled = false;
    async publish(channel: string, message: string) {
      this.calls.push(`publish ${channel}`);
      let n = 0;
      for (const s of subscribers) {
        if (s.channels.has(channel)) {
          n++;
          queueMicrotask(() => s.emit("message", channel, message));
        }
      }
      return n;
    }
    async subscribe(channel: string) {
      this.calls.push(`subscribe ${channel}`);
      this.channels.add(channel);
      subscribers.add(this);
      return this.channels.size;
    }
    async unsubscribe(channel: string) {
      this.calls.push(`unsubscribe ${channel}`);
      this.channels.delete(channel);
      return this.channels.size;
    }
    async set(key: string, value: string, px: "PX", ms: number, nx: "NX") {
      this.calls.push(`set ${key} ${value} ${px} ${ms} ${nx}`);
      const existing = keys.get(key);
      if (existing && existing.expiresAt > now) return null;
      keys.set(key, { value, expiresAt: now + ms });
      return "OK";
    }
    async quit() {
      this.quitCalled = true;
      subscribers.delete(this);
      return "OK";
    }
    disconnect() {}
  }

  return {
    created,
    advance: (ms: number) => (now += ms),
    createClient: vi.fn((_url: string, role: RedisRole) => {
      const client = new FakeClient();
      created.push({ role, client });
      return client;
    }),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createRedisPubSub", () => {
  it("creates connections lazily: one publisher, one subscriber", async () => {
    const r = fakeRedis();
    const ps = createRedisPubSub("redis://x", { createClient: r.createClient });
    expect(r.createClient).not.toHaveBeenCalled();
    await ps.subscribe("a", () => {});
    await ps.subscribe("b", () => {});
    await ps.publish("a", "1");
    await ps.publish("b", "2");
    expect(r.created.map((c) => c.role).sort()).toEqual(["publisher", "subscriber"]);
    await ps.close();
  });

  it("delivers to every handler on a channel and only subscribes once", async () => {
    const r = fakeRedis();
    const ps = createRedisPubSub("redis://x", { createClient: r.createClient });
    const a = vi.fn();
    const b = vi.fn();
    const other = vi.fn();
    await Promise.all([ps.subscribe("chat:t1", a), ps.subscribe("chat:t1", b)]);
    await ps.subscribe("chat:t2", other);
    await ps.publish("chat:t1", '{"x":1}');
    await flush();
    expect(a).toHaveBeenCalledWith('{"x":1}');
    expect(b).toHaveBeenCalledWith('{"x":1}');
    expect(other).not.toHaveBeenCalled();
    const sub = r.created.find((c) => c.role === "subscriber")!.client;
    expect(sub.calls.filter((c) => c === "subscribe chat:t1")).toHaveLength(1);
    await ps.close();
  });

  it("isolates handler errors (sync and async)", async () => {
    const r = fakeRedis();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const ps = createRedisPubSub("redis://x", { createClient: r.createClient, log });
    const ok = vi.fn();
    await ps.subscribe("c", () => {
      throw new Error("boom");
    });
    await ps.subscribe("c", (async () => {
      throw new Error("async boom");
    }) as unknown as (m: string) => void);
    await ps.subscribe("c", ok);
    await ps.publish("c", "m");
    await flush();
    expect(ok).toHaveBeenCalledWith("m");
    expect(log.error).toHaveBeenCalledTimes(2);
    await ps.close();
  });

  it("unsubscribes from Redis after the last handler is removed", async () => {
    const r = fakeRedis();
    const ps = createRedisPubSub("redis://x", { createClient: r.createClient });
    const a = vi.fn();
    const b = vi.fn();
    const offA = await ps.subscribe("c", a);
    const offB = await ps.subscribe("c", b);
    await offA();
    await offA(); // idempotent
    await ps.publish("c", "1");
    await flush();
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    const sub = r.created.find((c) => c.role === "subscriber")!.client;
    expect(sub.calls).not.toContain("unsubscribe c");
    await offB();
    expect(sub.calls).toContain("unsubscribe c");
    await ps.publish("c", "2");
    await flush();
    expect(b).toHaveBeenCalledTimes(1);
    await ps.close();
  });

  it("closes both connections and refuses further use", async () => {
    const r = fakeRedis();
    const ps = createRedisPubSub("redis://x", { createClient: r.createClient });
    await ps.subscribe("c", () => {});
    await ps.publish("c", "1");
    await ps.close();
    await ps.close();
    expect(r.created.every((c) => c.client.quitCalled)).toBe(true);
    await expect(ps.publish("c", "x")).rejects.toThrow(/closed/);
    await expect(ps.subscribe("c", () => {})).rejects.toThrow(/closed/);
  });

  it("uses long-lived connection settings by default", () => {
    expect(LONG_LIVED_REDIS_OPTIONS).toMatchObject({ lazyConnect: true, maxRetriesPerRequest: null, autoResubscribe: true });
  });
});

describe("createRedisNonceStore", () => {
  it("claims a nonce once until it expires, with SET NX PX", async () => {
    const r = fakeRedis();
    const store = createRedisNonceStore("redis://x", undefined, { createClient: r.createClient });
    expect(await store.claim("abc", 60_000)).toBe(true);
    expect(await store.claim("abc", 60_000)).toBe(false);
    expect(await store.claim("def", 60_000)).toBe(true);
    r.advance(60_001);
    expect(await store.claim("abc", 60_000)).toBe(true);
    expect(r.created).toHaveLength(1);
    expect(r.created[0]!.client.calls[0]).toBe("set chat:nonce:abc 1 PX 60000 NX");
    await store.close();
    expect(r.created[0]!.client.quitCalled).toBe(true);
    await expect(store.claim("x", 1000)).rejects.toThrow(/closed/);
  });

  it("uses a custom prefix and a whole-millisecond ttl of at least 1", async () => {
    const r = fakeRedis();
    const store = createRedisNonceStore("redis://x", "wh:", { createClient: r.createClient });
    await store.claim("n", 0.2);
    expect(r.created[0]!.client.calls[0]).toBe("set wh:n 1 PX 1 NX");
    await store.close();
  });
});
