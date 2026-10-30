import { forbidden, hasPermission, isSuperAdmin, requireTenant, requireUser, unauthorized, type FeatureGatePort, type RequestContext } from "@rbms/core";
import {
  formatSseEvent,
  HEARTBEAT_MS,
  RETRY_MS,
  SSE_HEADERS,
  sseComment,
  sseRetry,
  StreamTokens,
  type NonceStorePort,
  type PubSubPort,
  type Viewer,
} from "@rbms/chat";
import type { WhatsAppEvent } from "@rbms/whatsapp";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Logger } from "pino";

/**
 * Live WhatsApp inbox for staff, at `/v1/whatsapp/stream` (mounted next to the whatsapp module's own routes).
 *
 * Kept deliberately small and built from chat's pieces: `whatsapp.service.onEvent` → `publish()` → the shared pub/sub
 * channel `whatsapp.events` (Redis across API instances, in-memory in dev) → every instance writes the event to its own
 * open streams of that shop as SSE event `wa.<type>` (`wa.message`, `wa.status`, `wa.conversation`, `wa.campaign`).
 * Only staff holding `whatsapp.manage` may listen. Browsers' EventSource can't send headers, so like chat there is a
 * single-use 60 s token: `POST /v1/whatsapp/stream-token` → `GET /v1/whatsapp/stream?token=…` (or call the stream
 * with the normal Authorization header). No replay: on reconnect the inbox reloads its lists.
 */
export const WHATSAPP_EVENTS_CHANNEL = "whatsapp.events";
const MANAGE = "whatsapp.manage";
const FEATURE = "whatsapp";

interface Conn {
  viewer: Viewer;
  write(frame: string): void;
}

export function whatsappLiveRoutes(opts: { pubsub: PubSubPort; nonces: NonceStorePort; secret?: string; featureGate?: FeatureGatePort; log: Logger }) {
  // Own secret domain so a chat stream token can't open the WhatsApp stream (and vice versa).
  const tokens = new StreamTokens(opts.secret ? `whatsapp-live:${opts.secret}` : undefined, opts.nonces);
  const byTenant = new Map<string, Set<Conn>>();
  let unsubscribe: (() => void | Promise<void>) | null = null;

  const viewerOf = (ctx: RequestContext): Viewer => {
    const user = requireUser(ctx);
    const tenant = requireTenant(ctx);
    const isStaff = isSuperAdmin(ctx) || user.tenantRoles.some((r) => ["owner", "admin", "staff"].includes(r));
    if (!isStaff || !hasPermission(ctx, MANAGE)) throw forbidden("You can't see the WhatsApp inbox");
    return { tenantId: tenant.id, userId: user.id, isStaff, canManage: true };
  };

  const deliver = (raw: string) => {
    let e: WhatsAppEvent;
    try {
      e = JSON.parse(raw) as WhatsAppEvent;
    } catch {
      return;
    }
    const conns = byTenant.get(e.tenantId);
    if (!conns?.size) return;
    const frame = formatSseEvent({ event: `wa.${e.type}`, data: e });
    for (const c of [...conns]) c.write(frame);
  };

  return {
    publish(e: WhatsAppEvent) {
      opts.pubsub.publish(WHATSAPP_EVENTS_CHANNEL, JSON.stringify(e)).catch((err) => opts.log.warn({ err }, "whatsapp live: publish failed"));
    },
    async start() {
      unsubscribe = await opts.pubsub.subscribe(WHATSAPP_EVENTS_CHANNEL, deliver);
    },
    async stop() {
      await unsubscribe?.();
      unsubscribe = null;
      byTenant.clear();
    },
    /** Open streams (diagnostics, tests). */
    connections: () => [...byTenant.values()].reduce((n, s) => n + s.size, 0),
    async routes(app: FastifyInstance) {
      app.post("/stream-token", { config: { feature: FEATURE, permission: MANAGE, audit: false, summary: "Token for the live inbox stream" } }, async (req) =>
        tokens.issue(viewerOf(req.ctx), requireTenant(req.ctx)),
      );

      app.get("/stream", { config: { feature: FEATURE, audit: false, summary: "Live inbox events (SSE)" } }, async (req, reply) => {
        const q = (req.query ?? {}) as { token?: string };
        let viewer: Viewer;
        if (q.token) {
          const payload = await tokens.redeem(String(q.token));
          if (!payload) throw unauthorized("This stream link has expired; get a new one");
          if (req.ctx.tenant && req.ctx.tenant.id !== payload.viewer.tenantId) throw forbidden("Stream token is for another shop");
          if (!req.ctx.tenant && opts.featureGate && !(await opts.featureGate.isEnabled(payload.viewer.tenantId, FEATURE))) {
            throw forbidden("WhatsApp is turned off for this shop");
          }
          viewer = payload.viewer;
        } else {
          viewer = viewerOf(req.ctx);
        }

        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, { ...replyHeaders(reply), ...SSE_HEADERS });
        raw.flushHeaders?.();
        raw.write(sseRetry(RETRY_MS));
        raw.write(formatSseEvent({ event: "ready", data: { tenantId: viewer.tenantId } }));

        let closed = false;
        const conn: Conn = {
          viewer,
          write: (frame) => {
            if (closed || raw.writableEnded) return;
            if (raw.writableLength > 1_000_000) return cleanup();
            raw.write(frame);
          },
        };
        let set = byTenant.get(viewer.tenantId);
        if (!set) byTenant.set(viewer.tenantId, (set = new Set()));
        set.add(conn);
        const heartbeat = setInterval(() => conn.write(sseComment("ping")), HEARTBEAT_MS);
        heartbeat.unref?.();
        const maxTimer = setTimeout(() => cleanup(), 30 * 60_000);
        maxTimer.unref?.();
        function cleanup() {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          clearTimeout(maxTimer);
          byTenant.get(viewer.tenantId)?.delete(conn);
          if (!raw.writableEnded) raw.end();
        }
        req.raw.on("close", cleanup);
        raw.on("close", cleanup);
        raw.on("error", cleanup);
      });
    },
  };
}

/** Headers already on the reply (CORS from @fastify/cors), which a hijacked reply would otherwise lose. */
function replyHeaders(reply: FastifyReply): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(reply.getHeaders())) {
    if (v === undefined || k === "content-length" || k === "content-type") continue;
    out[k] = Array.isArray(v) ? v.map(String) : String(v);
  }
  return out;
}
