/*
 * Live streams over Server-Sent Events (chat: /v1/chat/stream, WhatsApp: /v1/whatsapp/stream).
 *
 * Browsers' EventSource can't send an Authorization header, so every connection starts with a single-use, 60 s
 * stream token (`POST …/stream-token` → `GET …/stream?token=…`). Because the token is single-use, EventSource's own
 * automatic reconnect (same URL) would always fail: on any error we close the source and reconnect ourselves with a
 * fresh token, with exponential backoff and jitter. Chat streams also send the last message cursor we saw
 * (`lastEventId`) so the server replays what we missed; the WhatsApp stream has no replay (consumers reload their
 * lists when `onReady` reports a reconnect).
 *
 * Pure (no React, no globals): the EventSource constructor, token fetch, timers and randomness are injected, so the
 * reconnect logic is unit-tested with a fake EventSource.
 */

export type LiveStatus =
  /** First connection in progress. */
  | "connecting"
  /** Stream open and the server sent `ready`. */
  | "live"
  /** Lost the stream; a retry is scheduled or in progress. */
  | "reconnecting"
  /** The server has no stream route (404): consumers poll instead. */
  | "polling"
  /** Not allowed (401/403) or stopped: no more retries. */
  | "offline";

export interface LiveEvent {
  /** SSE event name (`message`, `typing`, `wa.message`, …). */
  type: string;
  /** Parsed JSON (the raw string when it isn't JSON). */
  data: unknown;
  /** SSE id when the frame had one. */
  id?: string;
}

/** The part of EventSource we use. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (ev: { data?: unknown; lastEventId?: string }) => void): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

/** Errors from the token call that carry an HTTP status (the kit's ApiError does). */
interface StatusError {
  status?: number;
}

export interface ReadyInfo {
  /** True for every connection after the first. */
  reconnected: boolean;
  /** The server's `ready` payload (chat: `{ replayed, truncated }`). */
  data: unknown;
}

export interface LiveStreamOptions {
  /** Fetches a fresh single-use token (`POST …/stream-token`). */
  fetchToken: () => Promise<{ token: string }>;
  /** Stream URL for a token (and the last event id, for streams that replay). */
  buildUrl: (token: string, lastEventId: string | null) => string;
  createEventSource: EventSourceFactory;
  /** Event names to listen for (besides `ready` and `error`). */
  events: readonly string[];
  onEvent: (e: LiveEvent) => void;
  onStatus?: (s: LiveStatus) => void;
  onReady?: (info: ReadyInfo) => void;
  /** Send the last seen event id on reconnect (chat). Default false. */
  replay?: boolean;
  /** Backoff: base delay, cap, and the jitter source (0..1). */
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** A stream that opens but never says `ready` within this long is treated as failed. Default 15 s. */
  readyTimeoutMs?: number;
}

/** Delay before reconnect attempt `attempt` (0-based): base·2^attempt capped, times a 0.5–1.0 jitter factor. */
export function backoffDelay(attempt: number, baseMs = 1000, maxMs = 30_000, random: () => number = Math.random): number {
  const raw = Math.min(maxMs, baseMs * 2 ** Math.max(0, Math.min(attempt, 16)));
  return Math.round(raw * (0.5 + random() / 2));
}

/** Chat cursors are `<ms>_<uuid>`; returns the later of two (null-safe). Unknown shapes compare as strings. */
export function laterCursor(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  const pa = /^(\d+)_(.+)$/.exec(a);
  const pb = /^(\d+)_(.+)$/.exec(b);
  if (pa && pb) {
    const ta = Number(pa[1]);
    const tb = Number(pb[1]);
    if (ta !== tb) return ta > tb ? a : b;
    return pa[2]! >= pb[2]! ? a : b;
  }
  return a >= b ? a : b;
}

function parseData(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export class LiveStream {
  private source: EventSourceLike | null = null;
  private timer: unknown = null;
  private readyTimer: unknown = null;
  private attempt = 0;
  private connections = 0;
  private running = false;
  /** Bumped on every connect/stop so callbacks of an older source are ignored. */
  private generation = 0;
  private _status: LiveStatus = "offline";
  private _lastEventId: string | null = null;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  constructor(private readonly opts: LiveStreamOptions) {
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get status(): LiveStatus {
    return this._status;
  }

  get lastEventId(): string | null {
    return this._lastEventId;
  }

  /** Remember a cursor seen outside the stream (e.g. the newest message of a page we loaded). Keeps the later one. */
  noteEventId(id: string | null | undefined) {
    if (this.opts.replay) this._lastEventId = laterCursor(this._lastEventId, id);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.attempt = 0;
    this.setStatus("connecting");
    void this.connect();
  }

  stop() {
    this.running = false;
    this.generation++;
    this.teardown();
    this.setStatus("offline");
  }

  /** Reconnect right away (browser came back online, tab became visible after a long sleep). */
  reconnectNow() {
    if (!this.running || this._status === "polling" || this._status === "offline") return;
    if (this._status === "live") return;
    this.attempt = 0;
    this.teardown();
    void this.connect();
  }

  private setStatus(s: LiveStatus) {
    if (this._status === s) return;
    this._status = s;
    this.opts.onStatus?.(s);
  }

  private teardown() {
    if (this.timer !== null) this.clearTimer(this.timer);
    if (this.readyTimer !== null) this.clearTimer(this.readyTimer);
    this.timer = null;
    this.readyTimer = null;
    if (this.source) {
      const s = this.source;
      this.source = null;
      s.onopen = null;
      s.onerror = null;
      s.close();
    }
  }

  private scheduleRetry() {
    if (!this.running) return;
    this.teardown();
    this.setStatus("reconnecting");
    const delay = backoffDelay(this.attempt++, this.opts.baseDelayMs, this.opts.maxDelayMs, this.opts.random);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }

  private async connect() {
    if (!this.running) return;
    const gen = ++this.generation;
    let token: string;
    try {
      token = (await this.opts.fetchToken()).token;
    } catch (err) {
      if (gen !== this.generation || !this.running) return;
      const status = (err as StatusError | null)?.status;
      if (status === 404) {
        // No stream route on this API: consumers fall back to polling.
        this.running = false;
        this.setStatus("polling");
        return;
      }
      if (status === 401 || status === 403) {
        this.running = false;
        this.setStatus("offline");
        return;
      }
      this.scheduleRetry();
      return;
    }
    if (gen !== this.generation || !this.running) return;

    const url = this.opts.buildUrl(token, this.opts.replay ? this._lastEventId : null);
    const source = this.opts.createEventSource(url);
    this.source = source;
    const current = () => gen === this.generation && this.source === source;

    source.onerror = () => {
      if (!current()) return;
      // Never let EventSource retry with the spent token.
      this.scheduleRetry();
    };
    source.onopen = () => {
      if (!current()) return;
      const ms = this.opts.readyTimeoutMs ?? 15_000;
      if (this.readyTimer !== null) this.clearTimer(this.readyTimer);
      this.readyTimer = this.setTimer(() => {
        this.readyTimer = null;
        if (current() && this._status !== "live") this.scheduleRetry();
      }, ms);
    };
    source.addEventListener("ready", (ev) => {
      if (!current()) return;
      if (this.readyTimer !== null) this.clearTimer(this.readyTimer);
      this.readyTimer = null;
      const reconnected = this.connections > 0;
      this.connections++;
      this.attempt = 0;
      this.setStatus("live");
      this.opts.onReady?.({ reconnected, data: parseData(ev.data) });
    });
    // The server reports a failure to open the stream as an `error` *event* with data.
    source.addEventListener("error", (ev) => {
      if (!current() || ev?.data === undefined) return;
      this.scheduleRetry();
    });
    for (const type of this.opts.events) {
      source.addEventListener(type, (ev) => {
        if (!current()) return;
        const id = ev.lastEventId || undefined;
        if (id && this.opts.replay) this._lastEventId = laterCursor(this._lastEventId, id);
        this.opts.onEvent({ type, data: parseData(ev.data), ...(id ? { id } : {}) });
      });
    }
  }
}

/**
 * One stream shared by every subscriber in the tab (pages, widgets): starts with the first subscriber, stops a little
 * after the last one leaves (so navigating between screens doesn't reconnect).
 */
export class SharedStream {
  private stream: LiveStream | null = null;
  private readonly listeners = new Set<(e: LiveEvent) => void>();
  private readonly statusListeners = new Set<(s: LiveStatus) => void>();
  private readonly readyListeners = new Set<(r: ReadyInfo) => void>();
  private stopTimer: unknown = null;
  private _status: LiveStatus = "offline";

  constructor(
    private readonly make: (hooks: Pick<LiveStreamOptions, "onEvent" | "onStatus" | "onReady">) => LiveStream,
    private readonly lingerMs = 5_000,
    private readonly setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
    private readonly clearTimer: (h: unknown) => void = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  ) {}

  get status(): LiveStatus {
    return this._status;
  }

  get live(): LiveStream | null {
    return this.stream;
  }

  subscribe(listener: (e: LiveEvent) => void): () => void {
    this.listeners.add(listener);
    this.ensure();
    return () => {
      this.listeners.delete(listener);
      this.maybeStop();
    };
  }

  onStatus(listener: (s: LiveStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onReady(listener: (r: ReadyInfo) => void): () => void {
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  reconnectNow() {
    this.stream?.reconnectNow();
  }

  private ensure() {
    if (this.stopTimer !== null) {
      this.clearTimer(this.stopTimer);
      this.stopTimer = null;
    }
    // A stream that gave up (401/403, stopped) is replaced; one that is connecting, live, retrying or polling is kept.
    if (this.stream && this._status !== "offline") return;
    this._status = "connecting";
    this.stream = this.make({
      onEvent: (e) => {
        for (const l of [...this.listeners]) l(e);
      },
      onStatus: (s) => {
        this._status = s;
        for (const l of [...this.statusListeners]) l(s);
      },
      onReady: (r) => {
        for (const l of [...this.readyListeners]) l(r);
      },
    });
    this.stream.start();
  }

  private maybeStop() {
    if (this.listeners.size > 0 || this.stopTimer !== null) return;
    this.stopTimer = this.setTimer(() => {
      this.stopTimer = null;
      if (this.listeners.size > 0) return;
      this.stream?.stop();
      this.stream = null;
    }, this.lingerMs);
  }
}
