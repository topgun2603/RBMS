import { documented, hasPermission, permissionDenied, requireRole, requireTenant } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { idParams, okSchema } from "./api-schemas";
import { DISPLAY_TOKEN_HEADER, displayCreateBody, displayPairBody, displayPatchBody, displayStateBody, type DisplayService } from "./display";
import { POS_PERMISSION_KEYS } from "./ports";
import type { Actor } from "./service";

const FEATURE = "invoices";
/** Counter staff (who can sell) and managers of terminals may set screens up. */
const MAKE_BILLS = "invoices.create";
const SELF = { audit: false as const };
const registerQuery = z.object({ register: z.string().trim().max(40).optional() });

const actorOf = (req: FastifyRequest): Actor => ({ userId: req.ctx.user?.id ?? null, ip: req.ctx.ip, userAgent: req.ctx.userAgent });

function requireCounter(req: FastifyRequest) {
  requireRole(req.ctx, "owner", "admin", "staff");
  const tenant = requireTenant(req.ctx);
  if (!hasPermission(req.ctx, MAKE_BILLS) && !hasPermission(req.ctx, POS_PERMISSION_KEYS.devices)) throw permissionDenied(MAKE_BILLS);
  return tenant;
}

const tokenOf = (req: FastifyRequest) => {
  const raw = req.headers[DISPLAY_TOKEN_HEADER];
  return (Array.isArray(raw) ? raw[0] : raw)?.trim();
};

/** Headers already on the reply (CORS), which a hijacked reply would otherwise lose. */
function replyHeaders(reply: FastifyReply): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(reply.getHeaders())) {
    if (v === undefined || k === "content-length" || k === "content-type") continue;
    out[k] = Array.isArray(v) ? v.map(String) : String(v);
  }
  return out;
}

const HEARTBEAT_MS = 25_000;
/** A feed is cut after this long; the screen reconnects by itself. */
const MAX_FEED_MS = 30 * 60_000;

/**
 * Routes under /v1/pos for the customer display (docs/counter-close-display-labels.md):
 * - the counter (staff): `GET|POST /displays`, `POST /displays/:id/code`, `PATCH|DELETE /displays/:id`, `PUT /display/state`
 * - the screen (header `x-display-token`, no account): `POST /display/pair` (public, code), `GET /display/config`,
 *   `GET /display/stream` (server-sent events; the token goes in the header, so the screen reads it with fetch)
 */
export function displayRoutes(service: DisplayService) {
  return (app: FastifyInstance) => {
    const staff = { feature: FEATURE, ...SELF };

    app.get("/displays", documented({}, staff), async (req) => {
      const tenant = requireCounter(req);
      const { register } = registerQuery.parse(req.query ?? {});
      return service.list(tenant.id, register);
    });
    app.post("/displays", documented({ body: displayCreateBody }, staff), async (req) => service.create(requireCounter(req).id, req.body as never, actorOf(req)));
    app.post("/displays/:id/code", documented({}, staff), async (req) => {
      const tenant = requireCounter(req);
      const { id } = idParams.parse(req.params);
      return service.newCode(tenant.id, id, actorOf(req));
    });
    app.patch("/displays/:id", documented({ body: displayPatchBody }, staff), async (req) => {
      const tenant = requireCounter(req);
      const { id } = idParams.parse(req.params);
      return service.update(tenant.id, id, req.body as never);
    });
    app.delete("/displays/:id", documented({ response: okSchema }, staff), async (req) => {
      const tenant = requireCounter(req);
      const { id } = idParams.parse(req.params);
      return service.revoke(tenant.id, id, actorOf(req));
    });
    // The counter's state: a few times a second while the cashier rings up, so it records nothing in the audit trail.
    app.put("/display/state", documented({ body: displayStateBody, response: okSchema }, staff), async (req) => service.publish(requireCounter(req).id, req.body as never));

    // ---------------------------------------------------------------- the screen
    app.post("/display/pair", documented({ body: displayPairBody }, SELF), async (req) => service.pair(req.body as never, actorOf(req)));
    app.get("/display/config", documented({}, SELF), async (req) => service.config(await service.authenticate(tokenOf(req))));
    app.get("/display/stream", { config: SELF }, async (req, reply) => {
      const auth = await service.authenticate(tokenOf(req));
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        ...replyHeaders(reply),
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      raw.flushHeaders?.();
      raw.write("retry: 3000\n\n");
      raw.write(`event: ready\ndata: ${JSON.stringify({ register: auth.register, name: auth.name })}\n\n`);

      let closed = false;
      let unsubscribe: (() => void) | null = null;
      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS);
      const maxTimer = setTimeout(() => cleanup(), MAX_FEED_MS);
      heartbeat.unref?.();
      maxTimer.unref?.();
      function write(frame: string) {
        if (closed || raw.writableEnded) return;
        if (raw.writableLength > 1_000_000) return cleanup();
        raw.write(frame);
      }
      function cleanup() {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(maxTimer);
        unsubscribe?.();
        if (!raw.writableEnded) raw.end();
      }
      req.raw.on("close", cleanup);
      raw.on("close", cleanup);
      raw.on("error", cleanup);
      unsubscribe = await service.subscribe(auth, (state) => write(`event: state\ndata: ${JSON.stringify(state)}\n\n`), () => {
        write(`event: revoked\ndata: {}\n\n`);
        cleanup();
      });
      if (closed) unsubscribe();
    });
  };
}
