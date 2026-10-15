import type { Viewer } from "./logic";
import { noopLogger, type LoggerPort, type PubSubPort, type Unsubscribe } from "./ports";
import { Presence } from "./presence";
import { formatSseEvent } from "./sse";

export type ChatEventName = "message" | "read" | "typing" | "conversation";

/** What travels over the pub/sub channel. Each instance delivers it to its own open streams. */
export interface ChatEnvelope {
  tenantId: string;
  event: ChatEventName;
  data: unknown;
  /** SSE id (new messages only: their cursor). */
  id?: string;
  /** Participants to deliver to. */
  recipients: string[];
  /** Also deliver to every connected `chat.manage` staff member of the tenant (support/order conversations). */
  shopFacing: boolean;
  /** Users not to deliver to (e.g. the one typing). */
  exclude?: string[];
}

export const DEFAULT_CHANNEL = "chat.events";

/** One open SSE stream. Events that arrive while the stream is replaying history are buffered, then flushed. */
export class StreamConnection {
  private buffer: ChatEnvelope[] | null = [];
  private closed = false;

  constructor(
    readonly viewer: Viewer,
    private readonly write: (frame: string) => void,
  ) {}

  /** Writes a frame directly (initial events, replay). */
  send(frame: string) {
    if (this.closed) return;
    try {
      this.write(frame);
    } catch {
      this.closed = true;
    }
  }

  deliver(env: ChatEnvelope) {
    if (this.closed) return;
    if (this.buffer) this.buffer.push(env);
    else this.send(formatSseEvent({ event: env.event, data: env.data, ...(env.id ? { id: env.id } : {}) }));
  }

  /** Ends buffering: flushes buffered events except new messages already replayed (by SSE id). */
  goLive(replayedIds: ReadonlySet<string> = new Set()) {
    const pending = this.buffer ?? [];
    this.buffer = null;
    for (const env of pending) if (!(env.id && replayedIds.has(env.id))) this.deliver(env);
  }

  close() {
    this.closed = true;
    this.buffer = null;
  }

  get isClosed() {
    return this.closed;
  }
}

/** Local registry of open streams + pub/sub fan-out. One per process. */
export class ChatHub {
  private readonly byUser = new Map<string, Set<StreamConnection>>();
  private readonly managers = new Map<string, Set<StreamConnection>>();
  private unsubscribe: Unsubscribe | null = null;
  private subscribing: Promise<void> | null = null;

  constructor(
    private readonly pubsub: PubSubPort,
    readonly presence: Presence = new Presence(),
    private readonly log: LoggerPort = noopLogger,
    private readonly channel = DEFAULT_CHANNEL,
  ) {}

  /** Subscribes to the channel once (idempotent). */
  start(): Promise<void> {
    if (this.unsubscribe) return Promise.resolve();
    this.subscribing ??= this.pubsub
      .subscribe(this.channel, (raw) => this.onRaw(raw))
      .then((u) => {
        this.unsubscribe = u;
      })
      .catch((err) => {
        this.subscribing = null;
        this.log.error({ err }, "chat: pub/sub subscribe failed");
        throw err;
      });
    return this.subscribing;
  }

  async stop() {
    const u = this.unsubscribe;
    this.unsubscribe = null;
    this.subscribing = null;
    if (u) await u();
    for (const set of this.byUser.values()) for (const c of set) c.close();
    this.byUser.clear();
    this.managers.clear();
  }

  private onRaw(raw: string) {
    let env: ChatEnvelope;
    try {
      env = JSON.parse(raw) as ChatEnvelope;
    } catch {
      this.log.warn({ raw: raw.slice(0, 200) }, "chat: bad pub/sub message");
      return;
    }
    this.dispatch(env);
  }

  /** Delivers to this process's streams. Each stream receives an event at most once. */
  dispatch(env: ChatEnvelope) {
    const exclude = new Set(env.exclude ?? []);
    const targets = new Set<StreamConnection>();
    for (const userId of env.recipients) {
      if (exclude.has(userId)) continue;
      for (const c of this.byUser.get(`${env.tenantId}:${userId}`) ?? []) targets.add(c);
    }
    if (env.shopFacing) {
      for (const c of this.managers.get(env.tenantId) ?? []) if (!exclude.has(c.viewer.userId)) targets.add(c);
    }
    for (const c of targets) c.deliver(env);
  }

  async publish(env: ChatEnvelope) {
    try {
      await this.pubsub.publish(this.channel, JSON.stringify(env));
    } catch (err) {
      // Fall back to local delivery so a pub/sub outage still serves this instance.
      this.log.error({ err, event: env.event }, "chat: publish failed, delivering locally");
      this.dispatch(env);
    }
  }

  add(conn: StreamConnection) {
    const { tenantId, userId } = conn.viewer;
    const key = `${tenantId}:${userId}`;
    let set = this.byUser.get(key);
    if (!set) this.byUser.set(key, (set = new Set()));
    set.add(conn);
    if (conn.viewer.isStaff && conn.viewer.canManage) {
      let m = this.managers.get(tenantId);
      if (!m) this.managers.set(tenantId, (m = new Set()));
      m.add(conn);
    }
    this.presence.connected(tenantId, userId);
  }

  remove(conn: StreamConnection) {
    const { tenantId, userId } = conn.viewer;
    const key = `${tenantId}:${userId}`;
    const set = this.byUser.get(key);
    if (!set?.delete(conn)) return;
    if (set.size === 0) this.byUser.delete(key);
    const m = this.managers.get(tenantId);
    if (m) {
      m.delete(conn);
      if (m.size === 0) this.managers.delete(tenantId);
    }
    conn.close();
    this.presence.disconnected(tenantId, userId);
  }

  /** Is any `chat.manage` staff member of the tenant connected to this process? */
  managerOnline(tenantId: string) {
    return (this.managers.get(tenantId)?.size ?? 0) > 0;
  }

  /** Open streams on this process (diagnostics). */
  get connections() {
    let n = 0;
    for (const s of this.byUser.values()) n += s.size;
    return n;
  }
}
