import { createHash } from "node:crypto";
import { AppError, defineModule } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { idempotencyKeys } from "./schema";

export * from "./schema";

/** How long a stored answer is replayed. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
/** A first request still running after this long is taken to have died; a retry may take its key over. */
export const IDEMPOTENCY_STALE_MS = 2 * 60_000;
/** Answers bigger than this aren't kept (the key is released instead). */
const MAX_BODY = 1_000_000;
const KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The `Idempotency-Key` header when it is well formed; null when absent. Throws 400 when it is malformed. */
export function idempotencyKeyOf(header: string | string[] | undefined): string | null {
  const v = (Array.isArray(header) ? header[0] : header)?.trim();
  if (!v) return null;
  if (!KEY_RE.test(v)) throw new AppError(400, "idempotency_key_invalid", "Idempotency-Key must be 8–128 letters, digits or _ . : -");
  return v;
}

export const requestHash = (method: string, url: string, body: unknown) =>
  createHash("sha256")
    .update(`${method} ${url}\n${body === undefined ? "" : JSON.stringify(body)}`)
    .digest("hex");

export interface IdempotencyOptions {
  now?: () => number;
}

/**
 * `Idempotency-Key` for writes from the mobile apps and API clients (docs/market-plan.md, M0). A signed-in POST / PUT /
 * PATCH / DELETE that carries the header runs once per user, shop and key:
 * - a retry of a request that succeeded gets the stored answer again (`idempotent-replayed: true`);
 * - a retry while the first is still running gets 409 `idempotency_in_progress`;
 * - the same key with a different request gets 422 `idempotency_key_reused`;
 * - a request that failed releases its key, so the retry runs.
 * Requests without the header, or without a signed-in user, are untouched.
 */
export function createIdempotency(db: Db, opts: IdempotencyOptions = {}) {
  const now = opts.now ?? Date.now;
  const claimed = new WeakMap<FastifyRequest, string>();

  async function preHandler(req: FastifyRequest, reply: FastifyReply) {
    if (!WRITE_METHODS.has(req.method)) return;
    const key = idempotencyKeyOf(req.headers["idempotency-key"]);
    const user = req.ctx?.user;
    if (!key || !user) return;
    const scope = `${req.ctx.tenant?.id ?? "-"}:${user.id}:${key}`;
    const hash = requestHash(req.method, req.url, req.body);

    const inserted = await db
      .insert(idempotencyKeys)
      .values({ scope, requestHash: hash, createdAt: new Date(now()) })
      .onConflictDoNothing()
      .returning({ scope: idempotencyKeys.scope });
    if (inserted.length) {
      claimed.set(req, scope);
      if (Math.random() < 0.01) await purge().catch(() => undefined);
      return;
    }

    const [row] = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.scope, scope)).limit(1);
    if (!row) throw new AppError(409, "idempotency_in_progress", "This request is still being processed. Try again in a moment");
    const age = now() - row.createdAt.getTime();
    if (age > IDEMPOTENCY_TTL_MS) {
      // Expired: start afresh with this request.
      await db.update(idempotencyKeys).set({ requestHash: hash, status: null, body: null, contentType: null, createdAt: new Date(now()) }).where(eq(idempotencyKeys.scope, scope));
      claimed.set(req, scope);
      return;
    }
    if (row.requestHash !== hash) throw new AppError(422, "idempotency_key_reused", "This Idempotency-Key was used for a different request");
    if (row.status === null) {
      if (age < IDEMPOTENCY_STALE_MS) throw new AppError(409, "idempotency_in_progress", "This request is still being processed. Try again in a moment");
      const taken = await db
        .update(idempotencyKeys)
        .set({ createdAt: new Date(now()) })
        .where(and(eq(idempotencyKeys.scope, scope), isNull(idempotencyKeys.status), eq(idempotencyKeys.createdAt, row.createdAt)))
        .returning({ scope: idempotencyKeys.scope });
      if (!taken.length) throw new AppError(409, "idempotency_in_progress", "This request is still being processed. Try again in a moment");
      claimed.set(req, scope);
      return;
    }
    reply.header("idempotent-replayed", "true");
    if (row.contentType) reply.header("content-type", row.contentType);
    return reply.code(row.status).send(row.body ?? "");
  }

  async function onSend(req: FastifyRequest, reply: FastifyReply, payload: unknown) {
    const scope = claimed.get(req);
    if (!scope) return payload;
    claimed.delete(req);
    const ok = reply.statusCode >= 200 && reply.statusCode < 300;
    const text = typeof payload === "string" ? payload : Buffer.isBuffer(payload) ? payload.toString("utf8") : null;
    if (ok && text !== null && text.length <= MAX_BODY) {
      const contentType = reply.getHeader("content-type");
      await db
        .update(idempotencyKeys)
        .set({ status: reply.statusCode, body: text, contentType: contentType ? String(contentType) : null })
        .where(eq(idempotencyKeys.scope, scope));
    } else {
      await db.delete(idempotencyKeys).where(eq(idempotencyKeys.scope, scope));
    }
    return payload;
  }

  /** Deletes answers older than the replay window. */
  async function purge(): Promise<number> {
    const res = await db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.createdAt, new Date(now() - IDEMPOTENCY_TTL_MS)))
      .returning({ scope: idempotencyKeys.scope });
    return res.length;
  }

  return {
    module: defineModule({ id: "idempotency", tables: { idempotencyKeys } }),
    /** Register after the context hooks (it needs `ctx.user`). */
    preHandler,
    /** Register as a global onSend hook. */
    onSend,
    purge,
  };
}
export type Idempotency = ReturnType<typeof createIdempotency>;
