"use client";

import * as React from "react";
import { api, apiUrl } from "@srirealtime/web";
import { LiveStream, SharedStream, type EventSourceLike, type LiveEvent, type LiveStatus, type ReadyInfo } from "./sse";

/** The two live streams of the inbox. */
export type StreamKind = "chat" | "whatsapp";

const CONFIG: Record<StreamKind, { base: string; events: readonly string[]; replay: boolean }> = {
  chat: { base: "/chat", events: ["message", "read", "typing", "conversation"], replay: true },
  whatsapp: { base: "/whatsapp", events: ["wa.message", "wa.status", "wa.conversation", "wa.campaign"], replay: false },
};

/** WhatsApp lists poll this often when the API has no `/whatsapp/stream` route (or while the stream is down). */
export const POLL_MS = 10_000;

const streams = new Map<StreamKind, SharedStream>();

function createEventSource(url: string): EventSourceLike {
  return new EventSource(url) as unknown as EventSourceLike;
}

function sharedStream(kind: StreamKind): SharedStream {
  let s = streams.get(kind);
  if (!s) {
    const c = CONFIG[kind];
    s = new SharedStream(
      (hooks) =>
        new LiveStream({
          ...hooks,
          events: c.events,
          replay: c.replay,
          fetchToken: () => api.post<{ token: string }>(`${c.base}/stream-token`),
          buildUrl: (token, lastEventId) => apiUrl(`${c.base}/stream`, { token, lastEventId }),
          createEventSource,
        }),
    );
    streams.set(kind, s);
    if (typeof window !== "undefined") {
      const wake = () => s!.reconnectNow();
      window.addEventListener("online", wake);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") wake();
      });
    }
  }
  return s;
}

/** Latest-callback ref so subscriptions don't churn on every render. */
function useLatest<T>(value: T) {
  const ref = React.useRef(value);
  React.useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Subscribes to a live stream while the component is mounted. `onEvent` gets every event, `onReady` every (re)connect
 * (reload lists on `reconnected`). Returns the connection status for the status pill.
 * `enabled: false` (feature off, no permission, SSR) does nothing and reports "offline".
 */
export function useLiveStream(
  kind: StreamKind,
  handlers: { onEvent?: (e: LiveEvent) => void; onReady?: (r: ReadyInfo) => void },
  enabled = true,
): LiveStatus {
  const [status, setStatus] = React.useState<LiveStatus>("connecting");
  const latest = useLatest(handlers);
  React.useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
      setStatus(typeof window !== "undefined" && typeof EventSource === "undefined" ? "polling" : "offline");
      return;
    }
    const s = sharedStream(kind);
    const offStatus = s.onStatus(setStatus);
    const offReady = s.onReady((r) => latest.current.onReady?.(r));
    const off = s.subscribe((e) => latest.current.onEvent?.(e));
    setStatus(s.status === "offline" ? "connecting" : s.status);
    return () => {
      off();
      offReady();
      offStatus();
    };
  }, [kind, enabled, latest]);
  return enabled ? status : "offline";
}

/** Tells the chat stream about a cursor we loaded over HTTP, so a reconnect replays only what came after it. */
export function noteChatCursor(cursor: string | null | undefined) {
  streams.get("chat")?.live?.noteEventId(cursor);
}

/** Poll interval for queries that the stream would otherwise keep fresh: polling when not live, off when live. */
export function pollWhenNotLive(status: LiveStatus, ms = POLL_MS): number | false {
  return status === "live" ? false : ms;
}
