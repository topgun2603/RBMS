import { forbidden, tooMany, AppError, type UserRef } from "@srirealtime/core";
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import "./fastify";
import { hashApiKey, isApiKeyToken, looksLikeApiKey } from "./keys";
import type { LoggerPort, TenantLookupPort } from "./ports";
import { TokenBucketLimiter, type RateLimiter } from "./ratelimit";

/** `ctx.user` for a request authenticated with an API key. */
export interface ApiKeyPrincipal extends UserRef {
  apiKey: true;
  apiKeyId: string;
  permissions: string[];
}

export const isApiKeyPrincipal = (u: UserRef | null | undefined): u is ApiKeyPrincipal =>
  !!u && (u as Partial<ApiKeyPrincipal>).apiKey === true;

/** Just the columns the hook needs. */
export interface StoredApiKey {
  id: string;
  tenantId: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

export interface ApiKeyStore {
  findByHash(hash: string): Promise<StoredApiKey | null>;
  /** Sets `last_used_at`; the hook throttles calls to once a minute per key. */
  touch(id: string, at: Date): Promise<void>;
}

export interface ApiKeyHookOptions {
  store: ApiKeyStore;
  tenants: TenantLookupPort;
  /** Production accepts only `sk_live_` keys. */
  production: boolean;
  /** Default: 600 requests / minute per key. */
  limiter?: RateLimiter;
  now?: () => Date;
  /** `ctx.user.id` for a key. Default `key:<id>`. */
  principalId?: (keyId: string) => string;
  log?: LoggerPort;
}

export const TOUCH_INTERVAL_MS = 60_000;

const invalidKey = (message = "Invalid API key") => new AppError(401, "invalid_api_key", message);

function bearerOf(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1]! : null;
}

/** Usable now? Returns why not, for the 401 message. */
export function keyUnusableReason(key: StoredApiKey, now: Date): string | null {
  if (key.revokedAt && key.revokedAt.getTime() <= now.getTime()) return "This API key was revoked";
  if (key.expiresAt && key.expiresAt.getTime() <= now.getTime()) return "This API key has expired";
  return null;
}

/**
 * The context hook for `Authorization: Bearer sk_…`. Register it AFTER tenancy's hook (it compares and then sets
 * `ctx.tenant`) and before or after auth's (auth ignores tokens it doesn't know, so it never overwrites the key user).
 * Other bearers / cookies are left to auth.
 *
 * - malformed, unknown, revoked or expired key → 401 `invalid_api_key`;
 * - `x-tenant` header (or a host-resolved tenant) for another shop → 403;
 * - over the per-key rate (600/min) → 429 `rate_limited` with `retry-after`.
 * On success `ctx.tenant` = the key's tenant and `ctx.user` = an {@link ApiKeyPrincipal} with role "staff" and
 * `permissions` = the key's scopes.
 */
export function createApiKeyHook(opts: ApiKeyHookOptions) {
  const limiter = opts.limiter ?? new TokenBucketLimiter(600, 60_000);
  const now = opts.now ?? (() => new Date());
  const principalId = opts.principalId ?? ((id: string) => `key:${id}`);
  const lastTouch = new Map<string, number>();

  return (app: FastifyInstance) => {
    app.addHook("onRequest", async (req, reply) => {
      const token = bearerOf(req);
      if (!looksLikeApiKey(token)) return;
      if (!isApiKeyToken(token, opts.production)) throw invalidKey();
      const key = await opts.store.findByHash(hashApiKey(token));
      if (!key) throw invalidKey();
      const at = now();
      const reason = keyUnusableReason(key, at);
      if (reason) throw invalidKey(reason);

      const tenant = await opts.tenants.byId(key.tenantId);
      if (!tenant) throw invalidKey("This API key's shop is not active");
      const headerSlug = req.headers["x-tenant"];
      const slug = Array.isArray(headerSlug) ? headerSlug[0] : headerSlug;
      if ((slug && slug !== tenant.slug) || (req.ctx.tenant && req.ctx.tenant.id !== tenant.id))
        throw forbidden("This API key belongs to another shop");

      const rate = limiter.take(key.id, at.getTime());
      reply.header("x-ratelimit-remaining", String(rate.remaining));
      if (!rate.allowed) {
        reply.header("retry-after", String(rate.retryAfterSec));
        throw tooMany("Too many requests for this API key, slow down");
      }

      const last = Math.max(lastTouch.get(key.id) ?? 0, key.lastUsedAt?.getTime() ?? 0);
      if (at.getTime() - last >= TOUCH_INTERVAL_MS) {
        lastTouch.set(key.id, at.getTime());
        if (lastTouch.size > 50_000) lastTouch.clear();
        opts.store.touch(key.id, at).catch((err) => opts.log?.warn({ err, keyId: key.id }, "developer: last_used update failed"));
      }

      req.ctx.tenant = tenant;
      const user: ApiKeyPrincipal = {
        id: principalId(key.id),
        sessionId: "",
        platformRoles: [],
        tenantRoles: ["staff"],
        permissions: [...key.scopes],
        apiKey: true,
        apiKeyId: key.id,
      };
      req.ctx.user = user;
    });
  };
}

/** Routes API keys can never use, whatever their scopes (key management: no privilege escalation). */
export const API_KEY_DENIED_PREFIXES = ["/v1/developer/keys"];

/**
 * Global preHandler (add it to the host's `preHandlers`): refuses API-key requests to routes with
 * `config.apiKey === false`, under key management (always), or under `extraDenyPrefixes` (e.g. super-admin areas).
 * Super-admin checks already fail for keys (no platform roles); this makes the rule explicit.
 */
export function apiKeyGuard(extraDenyPrefixes: readonly string[] = []): preHandlerAsyncHookHandler {
  const denyPrefixes = [...new Set([...API_KEY_DENIED_PREFIXES, ...extraDenyPrefixes])];
  return async (req) => {
    if (!isApiKeyPrincipal(req.ctx?.user)) return;
    const url = req.routeOptions.url ?? req.url;
    if (req.routeOptions.config?.apiKey === false || denyPrefixes.some((p) => url.startsWith(p)))
      throw forbidden("API keys can't use this endpoint; sign in instead");
  };
}
