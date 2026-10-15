"use client";

import * as React from "react";
import type { ChatConversation, ChatConversationList, ChatMessage, ChatMessagePage, ChatOrderContext } from "../types";
import { applyRead, backoffMs, latestCursor, mergeMessages, parseCursor, pickConversation } from "../lib/chat";
import { ApiError, call } from "./api";

export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "offline" | "unavailable";

export interface ChatSession {
  me: string | null;
  conversations: ChatConversation[];
  listLoaded: boolean;
  listError: boolean;
  active: ChatConversation | null;
  setActive(id: string | null): void;
  messages: ChatMessage[];
  messagesLoading: boolean;
  messagesError: boolean;
  hasOlder: boolean;
  loadOlder(): Promise<void>;
  /** userIds typing in the active conversation. */
  typing: string[];
  status: StreamStatus;
  unreadTotal: number;
  /** Opens the right conversation for a context (order → order conversation, else the latest support one). */
  focus(order?: ChatOrderContext | null): Promise<void>;
  send(body: string, order?: ChatOrderContext | null): Promise<void>;
  retry(localId: string): Promise<void>;
  markRead(): void;
  notifyTyping(): void;
  reload(): void;
}

const TYPING_TTL_MS = 5000;

/**
 * Live chat state for the signed-in shopper: conversations (with unread counts), the active thread, and one SSE stream
 * per tab opened with the stream-token flow (`POST /chat/stream-token` → `GET /chat/stream?token=`). Tokens are single
 * use, so the browser's own EventSource retry can't be used: on any stream error the hook closes it and reconnects with
 * a fresh token after an exponential back-off, replaying what it missed via `lastEventId` (the newest message cursor).
 * The stream opens only while the panel is open or the shopper has conversations (for the unread badge).
 */
export function useChatSession({ enabled, open, userId, onIncoming }: { enabled: boolean; open: boolean; userId: string | null; onIncoming?: (m: ChatMessage) => void }): ChatSession {
  const [me, setMe] = React.useState<string | null>(userId);
  const [conversations, setConversations] = React.useState<ChatConversation[]>([]);
  const [listLoaded, setListLoaded] = React.useState(false);
  const [listError, setListError] = React.useState(false);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = React.useState(false);
  const [messagesError, setMessagesError] = React.useState(false);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [typingMap, setTypingMap] = React.useState<Record<string, number>>({});
  const [status, setStatus] = React.useState<StreamStatus>("idle");
  const [reloadKey, setReloadKey] = React.useState(0);

  const meRef = React.useRef(me);
  const activeRef = React.useRef<string | null>(null);
  const openRef = React.useRef(open);
  const cursorRef = React.useRef<string | null>(null);
  const incomingRef = React.useRef(onIncoming);
  const readTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = React.useRef(0);
  meRef.current = me;
  activeRef.current = activeId;
  openRef.current = open;
  incomingRef.current = onIncoming;

  React.useEffect(() => setMe(userId), [userId]);

  // Signed out / feature off: forget everything.
  React.useEffect(() => {
    if (enabled) return;
    setConversations([]);
    setListLoaded(false);
    setActiveId(null);
    setMessages([]);
    setStatus("idle");
    cursorRef.current = null;
  }, [enabled]);

  const refreshList = React.useCallback(async () => {
    try {
      const r = await call<ChatConversationList>("/chat/conversations", { query: { limit: 30 } });
      setConversations(r.items);
      setListError(false);
    } catch (err) {
      setListError(true);
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) setStatus("unavailable");
    } finally {
      setListLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    if (enabled) void refreshList();
  }, [enabled, refreshList, reloadKey]);

  // ---- active thread
  const loadMessages = React.useCallback(async (id: string) => {
    setMessagesLoading(true);
    setMessagesError(false);
    try {
      const page = await call<ChatMessagePage>(`/chat/conversations/${id}/messages`, { query: { limit: 50 } });
      if (activeRef.current !== id) return;
      setMessages((prev) => mergeMessages(prev.filter((m) => m.pending && (!m.conversationId || m.conversationId === id)), page.items, meRef.current));
      setNextCursor(page.nextCursor);
      cursorRef.current = latestCursor(page.items, cursorRef.current);
    } catch {
      if (activeRef.current === id) setMessagesError(true);
    } finally {
      if (activeRef.current === id) setMessagesLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // A first message is sent before its conversation exists: keep unsent optimistic messages across the switch.
    setMessages((prev) => prev.filter((m) => m.pending && !m.conversationId));
    setNextCursor(null);
    setTypingMap({});
    if (activeId && enabled) void loadMessages(activeId);
  }, [activeId, enabled, loadMessages, reloadKey]);

  const loadOlder = React.useCallback(async () => {
    const id = activeRef.current;
    if (!id || !nextCursor) return;
    const page = await call<ChatMessagePage>(`/chat/conversations/${id}/messages`, { query: { limit: 50, before: nextCursor } });
    if (activeRef.current !== id) return;
    setMessages((prev) => mergeMessages(prev, page.items, meRef.current));
    setNextCursor(page.nextCursor);
  }, [nextCursor]);

  const markRead = React.useCallback(() => {
    const id = activeRef.current;
    if (!id) return;
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c)));
      call(`/chat/conversations/${id}/read`, { body: {} }).catch(() => undefined);
    }, 400);
  }, []);

  // ---- stream
  const wantStream = enabled && (open || conversations.length > 0);
  React.useEffect(() => {
    if (!wantStream) return;
    let es: EventSource | null = null;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let hadStream = false;

    const schedule = (immediate = false) => {
      if (cancelled) return;
      es?.close();
      es = null;
      if (timer) clearTimeout(timer);
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setStatus("offline");
        return;
      }
      setStatus("reconnecting");
      timer = setTimeout(connect, immediate ? 0 : backoffMs(attempt++));
    };

    const parse = (e: Event): Record<string, unknown> | null => {
      try {
        return JSON.parse((e as MessageEvent<string>).data) as Record<string, unknown>;
      } catch {
        return null;
      }
    };

    const onMessage = (e: Event) => {
      const d = parse(e) as { conversationId?: string; message?: ChatMessage } | null;
      if (!d?.conversationId || !d.message) return;
      const m = d.message;
      if (parseCursor(m.cursor)) cursorRef.current = latestCursor([m], cursorRef.current);
      const mine = m.senderId === meRef.current;
      const viewing = openRef.current && activeRef.current === d.conversationId && document.visibilityState === "visible";
      let isNew = !m.editedAt && !m.deletedAt;
      if (activeRef.current === d.conversationId) {
        setMessages((prev) => {
          if (prev.some((x) => x.id === m.id)) isNew = false;
          return mergeMessages(prev, [m], meRef.current);
        });
        setTypingMap((prev) => {
          if (!(m.senderId in prev)) return prev;
          const { [m.senderId]: _gone, ...rest } = prev;
          return rest;
        });
      }
      setConversations((prev) => {
        if (!prev.some((c) => c.id === d.conversationId)) {
          void refreshList();
          return prev;
        }
        return prev.map((c) =>
          c.id === d.conversationId
            ? {
                ...c,
                lastMessageAt: isNew ? m.createdAt : c.lastMessageAt,
                lastMessagePreview: isNew ? m.body || c.lastMessagePreview : c.lastMessagePreview,
                unread: isNew && !mine && !viewing ? c.unread + 1 : c.unread,
              }
            : c,
        );
      });
      if (isNew && !mine) {
        if (viewing) markRead();
        else incomingRef.current?.(m);
      }
    };

    const onRead = (e: Event) => {
      const d = parse(e) as { conversationId?: string; userId?: string; readAt?: string } | null;
      if (!d?.conversationId || !d.userId || !d.readAt) return;
      const { conversationId, userId: who, readAt } = d;
      setConversations((prev) =>
        prev.map((c) =>
          c.id !== conversationId
            ? c
            : who === meRef.current
              ? { ...c, unread: 0, lastReadAt: readAt, participants: applyRead(c.participants, who, readAt) }
              : { ...c, participants: applyRead(c.participants, who, readAt) },
        ),
      );
    };

    const onTyping = (e: Event) => {
      const d = parse(e) as { conversationId?: string; userId?: string } | null;
      if (!d?.conversationId || !d.userId || d.userId === meRef.current || d.conversationId !== activeRef.current) return;
      setTypingMap((prev) => ({ ...prev, [d.userId!]: Date.now() }));
    };

    const connect = async () => {
      if (cancelled) return;
      setStatus(hadStream ? "reconnecting" : "connecting");
      let token: string;
      try {
        token = (await call<{ token: string }>("/chat/stream-token", { method: "POST" })).token;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404)) {
          setStatus("unavailable");
          return;
        }
        schedule();
        return;
      }
      if (cancelled) return;
      const url = new URL("/api/v1/chat/stream", window.location.origin);
      url.searchParams.set("token", token);
      if (cursorRef.current) url.searchParams.set("lastEventId", cursorRef.current);
      const source = new EventSource(url.toString());
      es = source;
      source.addEventListener("ready", (e) => {
        const d = parse(e) as { userId?: string; truncated?: boolean } | null;
        if (d?.userId) setMe(d.userId);
        attempt = 0;
        setStatus("live");
        // Missed more than the replay window: reload lists (no gaps). A first connect already has fresh data.
        if (d?.truncated || (hadStream && !cursorRef.current)) setReloadKey((k) => k + 1);
        hadStream = true;
      });
      source.addEventListener("message", onMessage);
      source.addEventListener("read", onRead);
      source.addEventListener("typing", onTyping);
      source.addEventListener("conversation", () => void refreshList());
      source.onerror = () => {
        if (es !== source) return;
        schedule();
      };
    };

    const online = () => {
      attempt = 0;
      schedule(true);
    };
    const offline = () => {
      es?.close();
      es = null;
      setStatus("offline");
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    void connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      es?.close();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      setStatus("idle");
    };
  }, [wantStream, refreshList, markRead]);

  // Typing indicators fade after a few seconds without a new event.
  React.useEffect(() => {
    if (!Object.keys(typingMap).length) return;
    const id = setInterval(() => {
      const now = Date.now();
      setTypingMap((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([, at]) => now - at < TYPING_TTL_MS));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [typingMap]);

  // ---- actions
  const upsert = React.useCallback((c: ChatConversation) => {
    setConversations((prev) => (prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? { ...x, ...c } : x)) : [c, ...prev]));
  }, []);

  const ensureConversation = React.useCallback(
    async (order?: ChatOrderContext | null): Promise<string> => {
      if (activeRef.current) return activeRef.current;
      const c = await call<ChatConversation>("/chat/conversations", { body: order?.id ? { type: "order", orderId: order.id } : { type: "support" } });
      upsert(c);
      activeRef.current = c.id;
      setActiveId(c.id);
      return c.id;
    },
    [upsert],
  );

  const focus = React.useCallback(
    async (order?: ChatOrderContext | null) => {
      if (order?.id) {
        const hit = pickConversation(conversations, order.id);
        if (hit && hit.type === "order" && hit.subjectId === order.id) return setActiveId(hit.id);
        try {
          const c = await call<ChatConversation>("/chat/conversations", { body: { type: "order", orderId: order.id } });
          upsert(c);
          setActiveId(c.id);
        } catch {
          // not their order / orders port missing: fall back to the support chat
          setActiveId(pickConversation(conversations.filter((c) => c.type === "support"))?.id ?? null);
        }
        return;
      }
      if (!activeRef.current) setActiveId(pickConversation(conversations)?.id ?? null);
    },
    [conversations, upsert],
  );

  const deliver = React.useCallback(
    async (local: ChatMessage, order?: ChatOrderContext | null) => {
      try {
        const id = await ensureConversation(order);
        const real = await call<ChatMessage>(`/chat/conversations/${id}/messages`, { body: { body: local.body } });
        cursorRef.current = latestCursor([real], cursorRef.current);
        setMessages((prev) => mergeMessages(prev.filter((m) => m.id !== local.id), [real], meRef.current));
        setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, lastMessageAt: real.createdAt, lastMessagePreview: real.body } : c)));
      } catch (err) {
        setMessages((prev) => prev.map((m) => (m.id === local.id ? { ...m, pending: "failed" } : m)));
        throw err;
      }
    },
    [ensureConversation],
  );

  const send = React.useCallback(
    async (body: string, order?: ChatOrderContext | null) => {
      const text = body.trim();
      if (!text) return;
      const local: ChatMessage = {
        id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        conversationId: activeRef.current ?? "",
        senderId: meRef.current ?? "me",
        body: text,
        attachments: [],
        replyTo: null,
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        cursor: "",
        pending: "sending",
      };
      setMessages((prev) => mergeMessages(prev, [local], meRef.current));
      await deliver(local, order);
    },
    [deliver],
  );

  const retry = React.useCallback(
    async (localId: string) => {
      const m = messages.find((x) => x.id === localId);
      if (!m) return;
      const again = { ...m, pending: "sending" as const, createdAt: new Date().toISOString() };
      setMessages((prev) => mergeMessages(prev.filter((x) => x.id !== localId), [again], meRef.current));
      await deliver(again);
    },
    [messages, deliver],
  );

  const notifyTyping = React.useCallback(() => {
    const id = activeRef.current;
    if (!id || Date.now() - lastTypingSent.current < 3000) return;
    lastTypingSent.current = Date.now();
    call(`/chat/conversations/${id}/typing`, { method: "POST" }).catch(() => undefined);
  }, []);

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const unreadTotal = conversations.reduce((s, c) => s + (c.muted ? 0 : c.unread), 0);

  return {
    me,
    conversations,
    listLoaded,
    listError,
    active,
    setActive: setActiveId,
    messages: activeId ? messages.filter((m) => !m.conversationId || m.conversationId === activeId || m.pending) : messages,
    messagesLoading,
    messagesError,
    hasOlder: !!nextCursor,
    loadOlder,
    typing: Object.keys(typingMap),
    status,
    unreadTotal,
    focus,
    send,
    retry,
    markRead,
    notifyTyping,
    reload: () => setReloadKey((k) => k + 1),
  };
}
