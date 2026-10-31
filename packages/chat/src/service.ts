import { AppError, badRequest, forbidden, notFound, tooMany, unauthorized, type FeatureGatePort, type TenantRef } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, asc, count, desc, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { CHAT_FEATURE_KEYS } from "./features";
import { ChatHub, StreamConnection, type ChatEnvelope } from "./hub";
import {
  accessTo,
  assertCanCreate,
  canDelete,
  canEdit,
  createConversationSchema,
  decodeCursor,
  editInputSchema,
  isShopFacing,
  isUuid,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  messageInputSchema,
  muteInputSchema,
  pageOf,
  previewOf,
  readInputSchema,
  SEND_RATE,
  SHOP_FACING_TYPES,
  toConversation,
  toMessage,
  viewerKind,
  type Access,
  type ChatConversation,
  type ChatMessage,
  type ChatParticipant,
  type CreateConversationInput,
  type Cursor,
  type EditInput,
  type ListConversationsQuery,
  type ListMessagesQuery,
  type MessageInput,
  type Viewer,
} from "./logic";
import { noopLogger, type DirectoryPort, type LoggerPort, type NotifierPort, type OrdersPort, type PubSubPort } from "./ports";
import { NOTIFY_COOLDOWN_MS, NotifyThrottle, OFFLINE_GRACE_MS, Presence } from "./presence";
import { MemoryPubSub } from "./pubsub";
import { RateLimiter } from "./rate-limit";
import { chatConversations, chatMessages, chatParticipants, type ConversationRow, type MessageRow, type ParticipantKind, type ParticipantRow } from "./schema";
import { HEARTBEAT_MS, formatSseEvent } from "./sse";
import { StreamTokens, type NonceStorePort, type StreamTokenPayload } from "./stream-token";

export interface ChatDeps {
  db: Db;
  /** Cross-instance fan-out. Default: in-memory (single process). */
  pubsub?: PubSubPort;
  /** Offline notifications (push / WhatsApp `chat.message`). Without it nobody is notified. */
  notifier?: NotifierPort;
  /** User kinds and names. Needed for direct and group conversations (targets must be staff or vendors). */
  directory?: DirectoryPort;
  /** Needed for `order` conversations. */
  orders?: OrdersPort;
  /** Checks `chat` for streams opened with a stream token (those requests may carry no tenant). */
  featureGate?: FeatureGatePort;
  /** HMAC secret for stream tokens; share it between API instances. Default: random per process. */
  streamTokenSecret?: string;
  /** Single-use store for stream tokens. Default: in-memory per process. */
  nonceStore?: NonceStorePort;
  /** Messages per user per window. Default 20 / 60 s. */
  sendRate?: { limit: number; windowMs: number };
  /** No open stream for this long → offline notification. Default 60 s. */
  offlineGraceMs?: number;
  /** One notification per recipient and conversation per cooldown. Default 10 min. */
  notifyCooldownMs?: number;
  /** Max messages replayed on reconnect (`Last-Event-ID`). Default 500. */
  replayLimit?: number;
  /** Pub/sub channel. Default "chat.events". */
  channel?: string;
  log?: LoggerPort;
  now?: () => Date;
}

export interface StreamHandle {
  close(): void;
}

export interface MessagePage {
  items: ChatMessage[];
  /** Pass as `before=` for older messages; null at the oldest page. */
  nextCursor: string | null;
}

export interface ConversationList {
  items: ChatConversation[];
  total: number;
  /** Sum of `unread` over all my conversations (not just this page). */
  unreadTotal: number;
}

const ORDER_SUBJECT = "order";
/** A timestamp parameter for raw `sql` (the postgres-js driver does not serialise Date objects there). */
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/**
 * Chat (docs/batch3.md §A2): conversations, messages, read receipts and typing over SSE. Every query is scoped by
 * tenant; access goes through `accessTo` (participants; `chat.manage` staff also see shop-facing conversations).
 */
export class ChatService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  readonly hub: ChatHub;
  readonly tokens: StreamTokens;
  private readonly sendLimiter: RateLimiter;
  private readonly typingLimiter: RateLimiter;
  private readonly throttle: NotifyThrottle;
  private readonly graceMs: number;
  private readonly replayLimit: number;

  constructor(private readonly deps: ChatDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
    const nowMs = () => this.now().getTime();
    this.hub = new ChatHub(deps.pubsub ?? new MemoryPubSub(), new Presence(nowMs), this.log, deps.channel);
    this.tokens = new StreamTokens(deps.streamTokenSecret, deps.nonceStore, nowMs);
    const rate = deps.sendRate ?? SEND_RATE;
    this.sendLimiter = new RateLimiter(rate.limit, rate.windowMs, nowMs);
    this.typingLimiter = new RateLimiter(1, 3_000, nowMs);
    this.throttle = new NotifyThrottle(deps.notifyCooldownMs ?? NOTIFY_COOLDOWN_MS, nowMs);
    this.graceMs = deps.offlineGraceMs ?? OFFLINE_GRACE_MS;
    this.replayLimit = deps.replayLimit ?? 500;
  }

  start() {
    return this.hub.start();
  }

  stop() {
    return this.hub.stop();
  }

  // ================================================================ streams

  /** `POST /stream-token`: a 60 s single-use token for `GET /stream?token=` (EventSource can't send headers). */
  issueStreamToken(viewer: Viewer, tenant: TenantRef) {
    return this.tokens.issue(viewer, tenant);
  }

  async redeemStreamToken(token: string): Promise<StreamTokenPayload> {
    const payload = await this.tokens.redeem(token);
    if (!payload) throw unauthorized("Stream token is invalid, expired or already used");
    return payload;
  }

  /** For requests the host's feature check can't see (no tenant on the request). */
  async assertFeature(tenantId: string) {
    if (!this.deps.featureGate) return;
    if (!(await this.deps.featureGate.isEnabled(tenantId, CHAT_FEATURE_KEYS.base))) {
      throw new AppError(403, "feature_disabled", "Chat is turned off for this shop", { feature: CHAT_FEATURE_KEYS.base, reason: "shop" });
    }
  }

  /**
   * Registers a stream: replays messages after `lastEventId` (a message cursor) from the database, then sends `ready`
   * `{ replayed, truncated }` and goes live. Live events that arrive during the replay are buffered and de-duplicated.
   */
  async openStream(viewer: Viewer, write: (frame: string) => void, lastEventId?: string | null): Promise<StreamHandle> {
    await this.hub.start();
    const conn = new StreamConnection(viewer, write);
    this.hub.add(conn);
    const replayed = new Set<string>();
    let truncated = false;
    const since = decodeCursor(lastEventId);
    if (since) {
      try {
        const rows = await this.messagesSince(viewer, since, this.replayLimit + 1);
        truncated = rows.length > this.replayLimit;
        for (const r of rows.slice(0, this.replayLimit)) {
          const m = toMessage(r);
          replayed.add(m.cursor);
          conn.send(formatSseEvent({ event: "message", id: m.cursor, data: { conversationId: m.conversationId, message: m } }));
        }
      } catch (err) {
        this.log.error({ err }, "chat: replay failed");
        truncated = true;
      }
    }
    conn.send(
      formatSseEvent({
        event: "ready",
        data: { userId: viewer.userId, heartbeatMs: HEARTBEAT_MS, replayed: replayed.size, truncated, at: this.now().toISOString() },
      }),
    );
    conn.goLive(replayed);
    return { close: () => this.hub.remove(conn) };
  }

  private visibleWhere(viewer: Viewer): SQL {
    const mine = sql`exists (select 1 from ${chatParticipants} cp where cp.conversation_id = ${chatConversations.id} and cp.user_id = ${viewer.userId})`;
    return viewer.isStaff && viewer.canManage ? or(mine, inArray(chatConversations.type, [...SHOP_FACING_TYPES]))! : mine;
  }

  private async messagesSince(viewer: Viewer, c: Cursor, limit: number): Promise<MessageRow[]> {
    const rows = await this.db
      .select({ m: chatMessages })
      .from(chatMessages)
      .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
      .where(
        and(
          eq(chatMessages.tenantId, viewer.tenantId),
          eq(chatConversations.tenantId, viewer.tenantId),
          sql`(${chatMessages.createdAt} > ${ts(c.at)} or (${chatMessages.createdAt} = ${ts(c.at)} and ${chatMessages.id} > ${c.id}::uuid))`,
          this.visibleWhere(viewer),
        ),
      )
      .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
      .limit(limit);
    return rows.map((r) => r.m);
  }

  // ================================================================ conversations

  private async load(viewer: Viewer, id: string): Promise<{ conv: ConversationRow; parts: ParticipantRow[]; access: Exclude<Access, null> }> {
    if (!isUuid(id)) throw notFound("Conversation");
    const [conv] = await this.db
      .select()
      .from(chatConversations)
      .where(and(eq(chatConversations.tenantId, viewer.tenantId), eq(chatConversations.id, id)))
      .limit(1);
    if (!conv) throw notFound("Conversation");
    const parts = await this.db
      .select()
      .from(chatParticipants)
      .where(and(eq(chatParticipants.tenantId, viewer.tenantId), eq(chatParticipants.conversationId, id)));
    const access = accessTo(conv, parts.map((p) => p.userId), viewer);
    // 404, not 403: don't reveal that the conversation exists.
    if (!access) throw notFound("Conversation");
    return { conv, parts, access };
  }

  /** Managers join a shop-facing conversation when they reply or mark it read. */
  private async join(viewer: Viewer, conv: ConversationRow, kind: ParticipantKind, lastReadAt: Date | null) {
    await this.db
      .insert(chatParticipants)
      .values({ tenantId: viewer.tenantId, conversationId: conv.id, userId: viewer.userId, kind, lastReadAt, joinedAt: this.now() })
      .onConflictDoNothing();
  }

  private async names(tenantId: string, ids: string[]): Promise<Record<string, string>> {
    if (!this.deps.directory?.names || ids.length === 0) return {};
    try {
      return await this.deps.directory.names(tenantId, [...new Set(ids)]);
    } catch (err) {
      this.log.warn({ err }, "chat: directory names failed");
      return {};
    }
  }

  private async participantViews(tenantId: string, parts: ParticipantRow[], known?: Record<string, string>): Promise<ChatParticipant[]> {
    const names = known ?? (await this.names(tenantId, parts.map((p) => p.userId)));
    return parts
      .slice()
      .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
      .map((p) => ({
        userId: p.userId,
        kind: p.kind,
        name: names[p.userId] ?? null,
        lastReadAt: p.lastReadAt?.toISOString() ?? null,
        joinedAt: p.joinedAt.toISOString(),
      }));
  }

  /**
   * Unread for a row of conversations LEFT JOIN my participant row (see `unreadCount` / `awaitingReplyCount`):
   * joined → others' messages after my last read; not joined (a manager looking at a shop-facing conversation) →
   * messages after the last staff message, i.e. how many are waiting for a reply.
   */
  private unreadSql(viewer: Viewer) {
    return sql<number>`(select count(*)::int from ${chatMessages} um
      where um.tenant_id = ${viewer.tenantId} and um.conversation_id = ${chatConversations.id}
        and um.deleted_at is null and um.sender_id <> ${viewer.userId}
        and case when ${chatParticipants.userId} is not null
          then (${chatParticipants.lastReadAt} is null or um.created_at > ${chatParticipants.lastReadAt})
          else um.created_at > coalesce((
            select max(sm.created_at) from ${chatMessages} sm
            join ${chatParticipants} sp on sp.conversation_id = sm.conversation_id and sp.user_id = sm.sender_id
            where sm.tenant_id = ${viewer.tenantId} and sm.conversation_id = ${chatConversations.id} and sp.kind = 'staff'
          ), '-infinity'::timestamptz)
        end)`;
  }

  /** `GET /conversations`: newest activity first, with my unread count per conversation. */
  async listConversations(viewer: Viewer, query: ListConversationsQuery = {}): Promise<ConversationList> {
    const q = listConversationsQuerySchema.parse(query);
    const joinOn = and(eq(chatParticipants.conversationId, chatConversations.id), eq(chatParticipants.userId, viewer.userId));
    const managed = viewer.isStaff && viewer.canManage && q.scope === "all";
    const where = and(
      eq(chatConversations.tenantId, viewer.tenantId),
      q.type ? eq(chatConversations.type, q.type) : undefined,
      managed ? or(isNotNull(chatParticipants.userId), inArray(chatConversations.type, [...SHOP_FACING_TYPES])) : isNotNull(chatParticipants.userId),
    );
    const unread = this.unreadSql(viewer);
    const [rows, [totals]] = await Promise.all([
      this.db
        .select({ c: chatConversations, p: chatParticipants, unread })
        .from(chatConversations)
        .leftJoin(chatParticipants, joinOn)
        .where(where)
        // Latest activity first; a conversation with no messages yet counts from its creation, so a new chat is on page one.
        .orderBy(sql`coalesce(${chatConversations.lastMessageAt}, ${chatConversations.createdAt}) desc`, asc(chatConversations.id))
        .limit(q.limit)
        .offset(q.offset),
      this.db
        .select({ total: count(), unreadTotal: sql<number>`coalesce(sum(${unread}), 0)::int` })
        .from(chatConversations)
        .leftJoin(chatParticipants, joinOn)
        .where(where),
    ]);
    const ids = rows.map((r) => r.c.id);
    const parts = ids.length
      ? await this.db
          .select()
          .from(chatParticipants)
          .where(and(eq(chatParticipants.tenantId, viewer.tenantId), inArray(chatParticipants.conversationId, ids)))
      : [];
    const names = await this.names(viewer.tenantId, parts.map((p) => p.userId));
    const grouped = new Map<string, ParticipantRow[]>();
    for (const p of parts) grouped.set(p.conversationId, [...(grouped.get(p.conversationId) ?? []), p]);
    const byConv = new Map<string, ChatParticipant[]>();
    for (const [cid, list] of grouped) byConv.set(cid, await this.participantViews(viewer.tenantId, list, names));
    return {
      items: rows.map((r) =>
        toConversation(
          r.c,
          { joined: !!r.p, muted: r.p?.muted ?? false, lastReadAt: r.p?.lastReadAt ?? null, unread: Number(r.unread ?? 0) },
          byConv.get(r.c.id) ?? [],
        ),
      ),
      total: Number(totals?.total ?? 0),
      unreadTotal: Number(totals?.unreadTotal ?? 0),
    };
  }

  /** `GET /conversations/:id`. */
  async getConversation(viewer: Viewer, id: string): Promise<ChatConversation> {
    const { conv, parts } = await this.load(viewer, id);
    const me = parts.find((p) => p.userId === viewer.userId);
    const [u] = await this.db
      .select({ n: this.unreadSql(viewer) })
      .from(chatConversations)
      .leftJoin(chatParticipants, and(eq(chatParticipants.conversationId, chatConversations.id), eq(chatParticipants.userId, viewer.userId)))
      .where(and(eq(chatConversations.tenantId, viewer.tenantId), eq(chatConversations.id, id)));
    return toConversation(
      conv,
      { joined: !!me, muted: me?.muted ?? false, lastReadAt: me?.lastReadAt ?? null, unread: Number(u?.n ?? 0) },
      await this.participantViews(viewer.tenantId, parts),
    );
  }

  private async findExisting(viewer: Viewer, type: "support" | "order" | "direct", key: string): Promise<ConversationRow | null> {
    const base = and(eq(chatConversations.tenantId, viewer.tenantId), eq(chatConversations.type, type));
    let where: SQL | undefined;
    if (type === "support") {
      // one support conversation per shopper
      where = and(
        base,
        eq(chatConversations.createdBy, viewer.userId),
        sql`exists (select 1 from ${chatParticipants} cp where cp.conversation_id = ${chatConversations.id} and cp.user_id = ${viewer.userId})`,
      );
    } else if (type === "order") {
      where = and(base, eq(chatConversations.subjectType, ORDER_SUBJECT), eq(chatConversations.subjectId, key));
    } else {
      where = and(
        base,
        sql`exists (select 1 from ${chatParticipants} cp where cp.conversation_id = ${chatConversations.id} and cp.user_id = ${viewer.userId})`,
        sql`exists (select 1 from ${chatParticipants} cp where cp.conversation_id = ${chatConversations.id} and cp.user_id = ${key})`,
      );
    }
    const [row] = await this.db.select().from(chatConversations).where(where).orderBy(asc(chatConversations.createdAt)).limit(1);
    return row ?? null;
  }

  private async kindOf(tenantId: string, userId: string): Promise<ParticipantKind | null> {
    if (!this.deps.directory) return null;
    return this.deps.directory.kindOf(tenantId, userId);
  }

  /**
   * `POST /conversations`. Support (shopper ↔ shop), order (about one order; its shopper is added) and direct
   * conversations are reused when one already exists; groups are always new.
   */
  async createConversation(viewer: Viewer, input: CreateConversationInput): Promise<{ conversation: ChatConversation; created: boolean }> {
    const data = createConversationSchema.parse(input);
    const now = this.now();
    const me = { userId: viewer.userId, kind: viewerKind(viewer) };
    let members: { userId: string; kind: ParticipantKind }[] = [me];
    let values: { type: ConversationRow["type"]; title?: string | null; subjectType?: string; subjectId?: string };

    if (data.type === "support") {
      assertCanCreate(viewer, "support");
      const existing = await this.findExisting(viewer, "support", viewer.userId);
      if (existing) return { conversation: await this.getConversation(viewer, existing.id), created: false };
      values = { type: "support", title: data.title || null };
    } else if (data.type === "order") {
      assertCanCreate(viewer, "order");
      if (!this.deps.orders) throw badRequest("Order conversations are not available");
      const customer = await this.deps.orders.customerUserId(viewer.tenantId, data.orderId);
      if (!viewer.isStaff && customer !== viewer.userId) throw notFound("Order");
      if (viewer.isStaff && customer === null) throw notFound("Order");
      const existing = await this.findExisting(viewer, "order", data.orderId);
      if (existing) {
        await this.join(viewer, existing, me.kind, now);
        return { conversation: await this.getConversation(viewer, existing.id), created: false };
      }
      if (customer && customer !== viewer.userId) members.push({ userId: customer, kind: "shopper" });
      const title = this.deps.orders.label ? await this.deps.orders.label(viewer.tenantId, data.orderId).catch(() => null) : null;
      values = { type: "order", title, subjectType: ORDER_SUBJECT, subjectId: data.orderId };
    } else if (data.type === "direct") {
      if (data.userId === viewer.userId) throw badRequest("Pick someone else");
      const kind = viewer.isStaff ? await this.kindOf(viewer.tenantId, data.userId) : null;
      assertCanCreate(viewer, "direct", [kind]);
      const existing = await this.findExisting(viewer, "direct", data.userId);
      if (existing) return { conversation: await this.getConversation(viewer, existing.id), created: false };
      members.push({ userId: data.userId, kind: kind! });
      values = { type: "direct", title: null };
    } else {
      const ids = [...new Set(data.userIds)].filter((id) => id !== viewer.userId);
      const kinds = viewer.isStaff ? await Promise.all(ids.map((id) => this.kindOf(viewer.tenantId, id))) : [];
      assertCanCreate(viewer, "group", kinds);
      if (ids.length === 0) throw badRequest("Add at least one person");
      members = [me, ...ids.map((userId, i) => ({ userId, kind: kinds[i]! }))];
      values = { type: "group", title: data.title };
    }

    const id = await this.db.transaction(async (tx) => {
      const [conv] = await tx
        .insert(chatConversations)
        .values({ tenantId: viewer.tenantId, createdBy: viewer.userId, createdAt: now, ...values })
        .returning({ id: chatConversations.id });
      await tx.insert(chatParticipants).values(
        members.map((m) => ({
          tenantId: viewer.tenantId,
          conversationId: conv!.id,
          userId: m.userId,
          kind: m.kind,
          joinedAt: now,
          lastReadAt: m.userId === viewer.userId ? now : null,
        })),
      );
      return conv!.id;
    });
    const conversation = await this.getConversation(viewer, id);
    await this.publish(viewer.tenantId, "conversation", { conversation: { ...conversation, unread: 0, joined: true } }, members.map((m) => m.userId), isShopFacing(values.type));
    return { conversation, created: true };
  }

  /** `POST /conversations/:id/mute`. */
  async setMuted(viewer: Viewer, id: string, input: { muted: boolean }) {
    const { muted } = muteInputSchema.parse(input);
    const { access } = await this.load(viewer, id);
    if (access !== "participant") throw badRequest("Join the conversation first");
    await this.db
      .update(chatParticipants)
      .set({ muted })
      .where(and(eq(chatParticipants.tenantId, viewer.tenantId), eq(chatParticipants.conversationId, id), eq(chatParticipants.userId, viewer.userId)));
    return { muted };
  }

  // ================================================================ messages

  /** `GET /conversations/:id/messages?before=&limit=`: a page shown oldest-first, plus the cursor for older ones. */
  async listMessages(viewer: Viewer, conversationId: string, query: ListMessagesQuery = {}): Promise<MessagePage> {
    const q = listMessagesQuerySchema.parse(query);
    await this.load(viewer, conversationId);
    let before: Cursor | null = null;
    if (q.before) {
      before = decodeCursor(q.before);
      if (!before && isUuid(q.before)) {
        const m = await this.message(viewer.tenantId, q.before).catch(() => null);
        if (m && m.conversationId === conversationId) before = { at: m.createdAt, id: m.id };
      }
      if (!before) throw badRequest("Invalid cursor");
    }
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.tenantId, viewer.tenantId),
          eq(chatMessages.conversationId, conversationId),
          before
            ? sql`(${chatMessages.createdAt} < ${ts(before.at)} or (${chatMessages.createdAt} = ${ts(before.at)} and ${chatMessages.id} < ${before.id}::uuid))`
            : undefined,
        ),
      )
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(q.limit + 1);
    const page = pageOf(rows, q.limit);
    return { items: page.rows.map(toMessage), nextCursor: page.nextCursor };
  }

  private async message(tenantId: string, id: string): Promise<MessageRow> {
    if (!isUuid(id)) throw notFound("Message");
    const [m] = await this.db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.tenantId, tenantId), eq(chatMessages.id, id)))
      .limit(1);
    if (!m) throw notFound("Message");
    return m;
  }

  /** `POST /conversations/:id/messages`. 20 per minute per user. */
  async sendMessage(viewer: Viewer, conversationId: string, input: MessageInput): Promise<ChatMessage> {
    const data = messageInputSchema.parse(input);
    const rl = this.sendLimiter.hit(`${viewer.tenantId}:${viewer.userId}`);
    if (!rl.allowed) throw tooMany(`You're sending messages too fast. Try again in ${Math.ceil(rl.retryAfterMs / 1000)} s`);
    const { conv, parts, access } = await this.load(viewer, conversationId);
    if (data.replyTo) {
      const parent = await this.message(viewer.tenantId, data.replyTo).catch(() => null);
      if (!parent || parent.conversationId !== conversationId) throw badRequest("Replied message not found in this conversation");
    }
    const now = this.now();
    const preview = previewOf(data.body, data.attachments);
    const row = await this.db.transaction(async (tx) => {
      if (access === "manager") {
        await tx
          .insert(chatParticipants)
          .values({ tenantId: viewer.tenantId, conversationId, userId: viewer.userId, kind: "staff", joinedAt: now, lastReadAt: now })
          .onConflictDoNothing();
      }
      const [m] = await tx
        .insert(chatMessages)
        .values({
          tenantId: viewer.tenantId,
          conversationId,
          senderId: viewer.userId,
          body: data.body,
          attachments: data.attachments,
          replyTo: data.replyTo ?? null,
          createdAt: now,
        })
        .returning();
      await tx
        .update(chatConversations)
        .set({ lastMessageAt: now, lastMessagePreview: preview })
        .where(and(eq(chatConversations.tenantId, viewer.tenantId), eq(chatConversations.id, conversationId)));
      await tx
        .update(chatParticipants)
        .set({ lastReadAt: now })
        .where(and(eq(chatParticipants.tenantId, viewer.tenantId), eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.userId, viewer.userId)));
      return m!;
    });
    const message = toMessage(row);
    const recipients = [...new Set([...parts.map((p) => p.userId), viewer.userId])];
    const shopFacing = isShopFacing(conv.type);
    if (access === "manager") {
      await this.publish(viewer.tenantId, "conversation", { conversationId, joined: { userId: viewer.userId, kind: "staff" } }, recipients, shopFacing);
    }
    await this.publish(viewer.tenantId, "message", { conversationId, message }, recipients, shopFacing, message.cursor);
    void this.notifyOffline(viewer, conv, parts, message, preview).catch((err) => this.log.error({ err }, "chat: offline notify failed"));
    return message;
  }

  /** `PATCH /messages/:id`: own messages, within 15 minutes. */
  async editMessage(viewer: Viewer, id: string, input: EditInput): Promise<ChatMessage> {
    const data = editInputSchema.parse(input);
    const msg = await this.message(viewer.tenantId, id);
    const { conv, parts } = await this.load(viewer, msg.conversationId);
    const now = this.now();
    if (!canEdit(msg, viewer, now)) throw forbidden("You can only edit your own messages within 15 minutes");
    if (!data.body && msg.attachments.length === 0) throw badRequest("A message can't be empty — delete it instead");
    const [row] = await this.db
      .update(chatMessages)
      .set({ body: data.body, editedAt: now })
      .where(and(eq(chatMessages.tenantId, viewer.tenantId), eq(chatMessages.id, id)))
      .returning();
    await this.refreshPreview(viewer.tenantId, conv, row!);
    const message = toMessage(row!);
    await this.publish(viewer.tenantId, "message", { conversationId: conv.id, message }, parts.map((p) => p.userId), isShopFacing(conv.type));
    return message;
  }

  /** `DELETE /messages/:id`: soft delete (own; `chat.manage` staff in shop-facing conversations). */
  async deleteMessage(viewer: Viewer, id: string): Promise<ChatMessage> {
    const msg = await this.message(viewer.tenantId, id);
    const { conv, parts } = await this.load(viewer, msg.conversationId);
    if (msg.deletedAt) return toMessage(msg);
    if (!canDelete(msg, conv, viewer)) throw forbidden("You can only delete your own messages");
    const [row] = await this.db
      .update(chatMessages)
      .set({ deletedAt: this.now() })
      .where(and(eq(chatMessages.tenantId, viewer.tenantId), eq(chatMessages.id, id)))
      .returning();
    await this.refreshPreview(viewer.tenantId, conv, row!);
    const message = toMessage(row!);
    await this.publish(viewer.tenantId, "message", { conversationId: conv.id, message }, parts.map((p) => p.userId), isShopFacing(conv.type));
    return message;
  }

  /** Keeps the conversation preview in step when its last message is edited or deleted. */
  private async refreshPreview(tenantId: string, conv: ConversationRow, row: MessageRow) {
    if (!conv.lastMessageAt || conv.lastMessageAt.getTime() !== row.createdAt.getTime()) return;
    await this.db
      .update(chatConversations)
      .set({ lastMessagePreview: row.deletedAt ? "Message deleted" : previewOf(row.body, row.attachments) })
      .where(and(eq(chatConversations.tenantId, tenantId), eq(chatConversations.id, conv.id)));
  }

  /** `POST /conversations/:id/read`: moves my read marker forward (to `messageId`, or now) and tells the others. */
  async markRead(viewer: Viewer, conversationId: string, input: { messageId?: string } = {}) {
    const data = readInputSchema.parse(input);
    const { conv, parts, access } = await this.load(viewer, conversationId);
    let at = this.now();
    if (data.messageId) {
      const m = await this.message(viewer.tenantId, data.messageId);
      if (m.conversationId !== conversationId) throw badRequest("Message not in this conversation");
      at = m.createdAt;
    }
    if (access === "manager") await this.join(viewer, conv, "staff", at);
    const [row] = await this.db
      .update(chatParticipants)
      .set({ lastReadAt: sql`greatest(coalesce(${chatParticipants.lastReadAt}, ${ts(at)}), ${ts(at)})` })
      .where(and(eq(chatParticipants.tenantId, viewer.tenantId), eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.userId, viewer.userId)))
      .returning({ lastReadAt: chatParticipants.lastReadAt });
    const readAt = (row?.lastReadAt ?? at).toISOString();
    this.throttle.reset(`${viewer.tenantId}:${conversationId}:${viewer.userId}`);
    const recipients = [...new Set([...parts.map((p) => p.userId), viewer.userId])];
    await this.publish(viewer.tenantId, "read", { conversationId, userId: viewer.userId, readAt }, recipients, isShopFacing(conv.type));
    return { conversationId, readAt };
  }

  /** `POST /conversations/:id/typing`: not stored; at most one event per user and conversation every 3 s. */
  async typing(viewer: Viewer, conversationId: string) {
    const { conv, parts } = await this.load(viewer, conversationId);
    if (!this.typingLimiter.hit(`${viewer.tenantId}:${conversationId}:${viewer.userId}`).allowed) return { ok: true, sent: false };
    await this.publish(
      viewer.tenantId,
      "typing",
      { conversationId, userId: viewer.userId, at: this.now().toISOString() },
      parts.map((p) => p.userId),
      isShopFacing(conv.type),
      undefined,
      [viewer.userId],
    );
    return { ok: true, sent: true };
  }

  // ================================================================ fan-out + notifications

  private publish(
    tenantId: string,
    event: ChatEnvelope["event"],
    data: unknown,
    recipients: string[],
    shopFacing: boolean,
    id?: string,
    exclude?: string[],
  ) {
    return this.hub.publish({ tenantId, event, data, recipients, shopFacing, ...(id ? { id } : {}), ...(exclude ? { exclude } : {}) });
  }

  /** Recipients with no open stream for `offlineGraceMs` get one notification per conversation per cooldown. */
  async notifyOffline(viewer: Viewer, conv: ConversationRow, parts: ParticipantRow[], message: ChatMessage, preview: string) {
    const notifier = this.deps.notifier;
    if (!notifier) return;
    const presence = this.hub.presence;
    const targets = parts.filter(
      (p) =>
        p.userId !== viewer.userId &&
        !p.muted &&
        presence.isOffline(viewer.tenantId, p.userId, this.graceMs) &&
        this.throttle.take(`${viewer.tenantId}:${conv.id}:${p.userId}`),
    );
    const askShop =
      !viewer.isStaff &&
      isShopFacing(conv.type) &&
      !parts.some((p) => p.kind === "staff") &&
      !this.hub.managerOnline(viewer.tenantId) &&
      this.throttle.take(`${viewer.tenantId}:${conv.id}:shop`);
    if (targets.length === 0 && !askShop) return;
    const senderName = (await this.names(viewer.tenantId, [viewer.userId]))[viewer.userId] ?? null;
    const base = {
      tenantId: viewer.tenantId,
      template: "chat.message" as const,
      conversationId: conv.id,
      conversationType: conv.type,
      conversationTitle: conv.title,
      senderId: message.senderId,
      senderName,
      preview: preview || "New message",
    };
    const sends = targets.map((p) => notifier.notify({ ...base, audience: "user", recipientUserId: p.userId }));
    if (askShop) sends.push(notifier.notify({ ...base, audience: "shop", recipientUserId: null }));
    const results = await Promise.allSettled(sends);
    for (const r of results) if (r.status === "rejected") this.log.warn({ err: r.reason, conversationId: conv.id }, "chat: notification failed");
  }
}
