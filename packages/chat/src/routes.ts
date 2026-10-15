import { forbidden, requireTenant } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { CHAT_FEATURE_KEYS } from "./features";
import { viewerFromContext, type Viewer } from "./logic";
import type { ChatService } from "./service";
import { HEARTBEAT_MS, RETRY_MS, SSE_HEADERS, formatSseEvent, sseComment, sseRetry } from "./sse";

/** What the routes use of the service (tests pass a stub). */
export type ChatRouteService = Pick<
  ChatService,
  | "issueStreamToken"
  | "redeemStreamToken"
  | "assertFeature"
  | "openStream"
  | "listConversations"
  | "getConversation"
  | "createConversation"
  | "setMuted"
  | "listMessages"
  | "sendMessage"
  | "editMessage"
  | "deleteMessage"
  | "markRead"
  | "typing"
>;

export interface ChatRouteOptions {
  /** Comment line every N ms so proxies keep the connection open. Default 25 s. */
  heartbeatMs?: number;
  /** Reconnect delay hint sent as `retry:`. Default 3 s. */
  retryMs?: number;
  /** Streams are closed after this long so clients reconnect (fresh permissions; balances instances). Default 30 min. */
  maxStreamMs?: number;
  /** A client this far behind (bytes buffered) is disconnected. Default 1 MB. */
  maxBufferedBytes?: number;
}

const idParam = z.object({ id: z.string().uuid() });
const streamQuery = z.object({ token: z.string().min(10).max(4096).optional(), lastEventId: z.string().max(100).optional() });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;

const feature = CHAT_FEATURE_KEYS.base;
/** Chat traffic is conversation, not shop administration: no audit entries. */
const ROUTE = { config: { feature, audit: false as const } };

/** Headers already set on the reply (CORS from @fastify/cors) — lost on hijack unless copied. */
function replyHeaders(reply: FastifyReply): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(reply.getHeaders())) {
    if (v === undefined || k === "content-length" || k === "content-type") continue;
    out[k] = Array.isArray(v) ? v.map(String) : String(v);
  }
  return out;
}

/**
 * Routes under /v1/chat (feature `chat`). Any signed-in user of the shop (staff or shopper); what they see is decided
 * per conversation by the service (`accessTo`). `chat.manage` is checked there, not in route config, because shoppers
 * use the same routes.
 *
 * Streams: `GET /stream` with the normal session (Authorization: Bearer, or the session cookie), or
 * `GET /stream?token=<POST /stream-token>` for EventSource clients that can't set headers. `Last-Event-ID` (header, or
 * `?lastEventId=` when opening a new EventSource) replays missed messages.
 */
export function chatRoutes(service: ChatRouteService, opts: ChatRouteOptions = {}) {
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const retryMs = opts.retryMs ?? RETRY_MS;
  const maxStreamMs = opts.maxStreamMs ?? 30 * 60_000;
  const maxBuffered = opts.maxBufferedBytes ?? 1_000_000;

  return async (app: FastifyInstance) => {
    // ---- streams
    app.post("/stream-token", ROUTE, async (req) => {
      const viewer = viewerFromContext(req.ctx);
      return service.issueStreamToken(viewer, requireTenant(req.ctx));
    });

    app.get("/stream", ROUTE, async (req, reply) => {
      const q = streamQuery.parse(query(req));
      let viewer: Viewer;
      if (q.token) {
        const payload = await service.redeemStreamToken(q.token);
        if (req.ctx.tenant && req.ctx.tenant.id !== payload.viewer.tenantId) throw forbidden("Stream token is for another shop");
        // Without a tenant on the request the host's feature check didn't run.
        if (!req.ctx.tenant) await service.assertFeature(payload.viewer.tenantId);
        viewer = payload.viewer;
      } else {
        viewer = viewerFromContext(req.ctx);
      }
      const header = req.headers["last-event-id"];
      const lastEventId = (Array.isArray(header) ? header[0] : header) ?? q.lastEventId ?? null;

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, { ...replyHeaders(reply), ...SSE_HEADERS });
      raw.flushHeaders?.();
      raw.write(sseRetry(retryMs));

      let closed = false;
      let handle: { close(): void } | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let maxTimer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (maxTimer) clearTimeout(maxTimer);
        handle?.close();
        handle = null;
        if (!raw.writableEnded) raw.end();
      };
      const write = (frame: string) => {
        if (closed || raw.writableEnded) return;
        if (raw.writableLength > maxBuffered) {
          req.log.warn({ userId: viewer.userId }, "chat: slow stream client disconnected");
          cleanup();
          return;
        }
        raw.write(frame);
      };
      req.raw.on("close", cleanup);
      raw.on("close", cleanup);
      raw.on("error", cleanup);

      try {
        handle = await service.openStream(viewer, write, lastEventId);
      } catch (err) {
        req.log.error({ err }, "chat: stream open failed");
        write(formatSseEvent({ event: "error", data: { code: "stream_failed", message: "Could not open the chat stream" } }));
        cleanup();
        return;
      }
      if (closed) {
        // the client went away while we were replaying
        handle.close();
        return;
      }
      heartbeat = setInterval(() => write(sseComment("ping")), heartbeatMs);
      heartbeat.unref?.();
      if (maxStreamMs > 0) {
        maxTimer = setTimeout(cleanup, maxStreamMs);
        maxTimer.unref?.();
      }
    });

    // ---- conversations
    app.get("/conversations", ROUTE, async (req) => service.listConversations(viewerFromContext(req.ctx), query(req)));
    app.post("/conversations", ROUTE, async (req) => {
      const { conversation, created } = await service.createConversation(viewerFromContext(req.ctx), body(req) as never);
      return { ...conversation, created };
    });
    app.get("/conversations/:id", ROUTE, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.getConversation(viewerFromContext(req.ctx), id);
    });
    app.post("/conversations/:id/mute", ROUTE, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.setMuted(viewerFromContext(req.ctx), id, body(req) as { muted: boolean });
    });
    app.get("/conversations/:id/messages", ROUTE, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.listMessages(viewerFromContext(req.ctx), id, query(req));
    });
    app.post("/conversations/:id/messages", ROUTE, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.sendMessage(viewerFromContext(req.ctx), id, body(req));
    });
    app.post("/conversations/:id/read", ROUTE, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.markRead(viewerFromContext(req.ctx), id, body(req) as { messageId?: string });
    });
    app.post("/conversations/:id/typing", ROUTE, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.typing(viewerFromContext(req.ctx), id);
    });

    // ---- messages
    app.patch("/messages/:id", ROUTE, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.editMessage(viewerFromContext(req.ctx), id, body(req) as { body: string });
    });
    app.delete("/messages/:id", ROUTE, async (req) => {
      const { id } = idParam.parse(req.params);
      return service.deleteMessage(viewerFromContext(req.ctx), id);
    });
  };
}
