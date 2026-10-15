import { describe, expect, it } from "vitest";
import { backoffDelay, laterCursor, LiveStream, SharedStream, type EventSourceLike, type LiveEvent, type LiveStatus, type ReadyInfo } from "./sse";

/** A controllable stand-in for the browser's EventSource. */
class FakeEventSource implements EventSourceLike {
  static all: FakeEventSource[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((ev: { data?: unknown; lastEventId?: string }) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: (ev: { data?: unknown; lastEventId?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.({});
  }
  emit(type: string, data: unknown, lastEventId = "") {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: typeof data === "string" ? data : JSON.stringify(data), lastEventId });
  }
  fail() {
    this.onerror?.({});
  }
}

/** Manual clock for timers. */
function timers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => {
      const id = ++seq;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h: unknown) => void pending.delete(h as number),
    advance(ms: number) {
      now += ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        due[1].fn();
      }
    },
    get size() {
      return pending.size;
    },
    delays: () => [...pending.values()].map((t) => t.at - now),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(opts: { replay?: boolean; tokenError?: { status: number } | null } = {}) {
  FakeEventSource.all = [];
  const clock = timers();
  const events: LiveEvent[] = [];
  const statuses: LiveStatus[] = [];
  const readies: ReadyInfo[] = [];
  let tokens = 0;
  let tokenError = opts.tokenError ?? null;
  const stream = new LiveStream({
    fetchToken: async () => {
      if (tokenError) throw Object.assign(new Error("x"), tokenError);
      return { token: `tok${++tokens}` };
    },
    buildUrl: (token, last) => `/stream?token=${token}${last ? `&lastEventId=${last}` : ""}`,
    createEventSource: (url) => new FakeEventSource(url),
    events: ["message", "typing"],
    replay: opts.replay ?? true,
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    onReady: (r) => readies.push(r),
    random: () => 1,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    setTimer: clock.set,
    clearTimer: clock.clear,
  });
  return {
    stream,
    clock,
    events,
    statuses,
    readies,
    get tokens() {
      return tokens;
    },
    setTokenError: (e: { status: number } | null) => (tokenError = e),
    last: () => FakeEventSource.all[FakeEventSource.all.length - 1]!,
  };
}

describe("backoff", () => {
  it("doubles from the base, caps, and jitters between half and full", () => {
    expect(backoffDelay(0, 1000, 30_000, () => 1)).toBe(1000);
    expect(backoffDelay(3, 1000, 30_000, () => 1)).toBe(8000);
    expect(backoffDelay(10, 1000, 30_000, () => 1)).toBe(30_000);
    expect(backoffDelay(2, 1000, 30_000, () => 0)).toBe(2000);
  });

  it("orders chat cursors by time, then id", () => {
    const a = "1700000000000_00000000-0000-4000-8000-000000000001";
    const b = "1700000000500_00000000-0000-4000-8000-000000000000";
    expect(laterCursor(a, b)).toBe(b);
    expect(laterCursor(b, a)).toBe(b);
    expect(laterCursor(null, a)).toBe(a);
    expect(laterCursor(a, undefined)).toBe(a);
  });
});

describe("LiveStream", () => {
  it("connects with a fresh token, goes live on ready and delivers parsed events", async () => {
    const t = setup();
    t.stream.start();
    expect(t.stream.status).toBe("connecting");
    await flush();
    expect(t.last().url).toBe("/stream?token=tok1");
    t.last().open();
    t.last().emit("ready", { replayed: 0, truncated: false });
    expect(t.stream.status).toBe("live");
    expect(t.readies).toEqual([{ reconnected: false, data: { replayed: 0, truncated: false } }]);
    t.last().emit("message", { conversationId: "c1" }, "1000_m1");
    expect(t.events).toEqual([{ type: "message", data: { conversationId: "c1" }, id: "1000_m1" }]);
  });

  it("on error closes the source (never lets EventSource reuse the spent token) and reconnects with a new token and lastEventId", async () => {
    const t = setup();
    t.stream.start();
    await flush();
    const first = t.last();
    first.emit("ready", {});
    first.emit("message", { a: 1 }, "2000_00000000-0000-4000-8000-000000000002");
    first.fail();
    expect(first.closed).toBe(true);
    expect(t.stream.status).toBe("reconnecting");
    expect(t.clock.delays()).toEqual([1000]);
    t.clock.advance(1000);
    await flush();
    const second = t.last();
    expect(second).not.toBe(first);
    expect(second.url).toBe("/stream?token=tok2&lastEventId=2000_00000000-0000-4000-8000-000000000002");
    second.emit("ready", { replayed: 3 });
    expect(t.readies.at(-1)).toEqual({ reconnected: true, data: { replayed: 3 } });
    expect(t.statuses).toEqual(["connecting", "live", "reconnecting", "live"]);
  });

  it("backs off exponentially while failing and resets after a good connection", async () => {
    const t = setup();
    t.stream.start();
    await flush();
    t.last().fail();
    expect(t.clock.delays()).toEqual([1000]);
    t.clock.advance(1000);
    await flush();
    t.last().fail();
    expect(t.clock.delays()).toEqual([2000]);
    t.clock.advance(2000);
    await flush();
    t.last().fail();
    expect(t.clock.delays()).toEqual([4000]);
    t.clock.advance(4000);
    await flush();
    t.last().fail();
    expect(t.clock.delays()).toEqual([8000]);
    t.clock.advance(8000);
    await flush();
    t.last().fail();
    expect(t.clock.delays()).toEqual([8000]); // capped
    t.clock.advance(8000);
    await flush();
    t.last().emit("ready", {});
    t.last().fail();
    expect(t.clock.delays()).toEqual([1000]);
  });

  it("retries a failing token call, and ignores events from a closed source", async () => {
    const t = setup({ tokenError: { status: 503 } });
    t.stream.start();
    await flush();
    expect(t.stream.status).toBe("reconnecting");
    expect(FakeEventSource.all).toHaveLength(0);
    t.setTokenError(null);
    t.clock.advance(1000);
    await flush();
    const s = t.last();
    s.emit("ready", {});
    s.fail();
    s.emit("message", { stale: true }, "9_x");
    expect(t.events).toEqual([]);
  });

  it("stops retrying on 401/403 and switches to polling on 404", async () => {
    const denied = setup({ tokenError: { status: 403 } });
    denied.stream.start();
    await flush();
    expect(denied.stream.status).toBe("offline");
    expect(denied.clock.size).toBe(0);

    const missing = setup({ tokenError: { status: 404 } });
    missing.stream.start();
    await flush();
    expect(missing.stream.status).toBe("polling");
    expect(missing.clock.size).toBe(0);
  });

  it("treats a stream that opens but never says ready as failed", async () => {
    const t = setup();
    t.stream.start();
    await flush();
    t.last().open();
    t.clock.advance(15_000);
    expect(t.stream.status).toBe("reconnecting");
    expect(t.last().closed).toBe(true);
  });

  it("reconnects on a server error event and doesn't replay for streams without replay", async () => {
    const t = setup({ replay: false });
    t.stream.start();
    await flush();
    t.last().emit("ready", {});
    t.last().emit("message", { x: 1 }, "5_abc");
    t.last().emit("error", { code: "stream_failed" });
    expect(t.stream.status).toBe("reconnecting");
    t.clock.advance(1000);
    await flush();
    expect(t.last().url).toBe("/stream?token=tok2");
  });

  it("noteEventId keeps the later cursor; stop closes everything", async () => {
    const t = setup();
    t.stream.noteEventId("3000_00000000-0000-4000-8000-000000000003");
    t.stream.noteEventId("1000_00000000-0000-4000-8000-000000000001");
    expect(t.stream.lastEventId).toBe("3000_00000000-0000-4000-8000-000000000003");
    t.stream.start();
    await flush();
    expect(t.last().url).toContain("lastEventId=3000_");
    t.stream.stop();
    expect(t.last().closed).toBe(true);
    expect(t.stream.status).toBe("offline");
    expect(t.clock.size).toBe(0);
  });

  it("reconnectNow skips the backoff wait", async () => {
    const t = setup();
    t.stream.start();
    await flush();
    t.last().fail();
    t.last().fail();
    expect(t.clock.size).toBe(1);
    t.stream.reconnectNow();
    await flush();
    expect(FakeEventSource.all).toHaveLength(2);
    expect(t.tokens).toBe(2);
  });
});

describe("SharedStream", () => {
  it("starts once for many subscribers and stops after the last one leaves (with a linger)", () => {
    const clock = timers();
    let made = 0;
    let started = 0;
    let stopped = 0;
    const shared = new SharedStream(
      () => {
        made++;
        return { start: () => void started++, stop: () => void stopped++, reconnectNow: () => undefined } as unknown as LiveStream;
      },
      5000,
      clock.set,
      clock.clear,
    );
    const a = shared.subscribe(() => undefined);
    const b = shared.subscribe(() => undefined);
    expect([made, started]).toEqual([1, 1]);
    a();
    b();
    clock.advance(4000);
    const c = shared.subscribe(() => undefined); // comes back within the linger: same stream
    clock.advance(5000);
    expect(stopped).toBe(0);
    c();
    clock.advance(5000);
    expect(stopped).toBe(1);
  });
});
