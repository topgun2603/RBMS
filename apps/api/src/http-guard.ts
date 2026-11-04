import { tooMany } from "@rbms/core";
import type { FastifyReply, FastifyRequest, onRequestAsyncHookHandler, onSendAsyncHookHandler, preValidationAsyncHookHandler } from "fastify";
import { OPS_PATHS } from "./ops";

/**
 * HTTP hardening for the API host: a global rate limit and security response headers.
 *
 * Rate limit: fixed windows per client IP (before auth), then per signed-in user and per shop (after auth), with a
 * much stricter per-IP budget for the sign-in routes. Health/ops routes, CORS preflights and webhooks are exempt (a
 * payment provider retrying must never be throttled). The counters live in Redis when a `counter` is given (shared by
 * all API instances) and fall back to this process's memory when Redis is down or unset. A 429 uses the repo's error
 * shape (`{ error: { code: "rate_limited", ... } }`) plus `Retry-After`.
 */

export interface WindowCounter {
  hit(key: string, windowMs: number): Promise<{ count: number; resetMs: number }>;
}

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  /** Requests per window per client IP (all routes). */
  ipMax: number;
  /** Requests per window per signed-in user. */
  userMax: number;
  /** Requests per window per shop (all its users and devices together). */
  tenantMax: number;
  /** Requests per window per client IP on the sign-in routes (OTP, Google, Firebase, 2FA, demo, handoff redeem). */
  authMax: number;
  /** Shared counter (Redis); in-memory when absent or failing. */
  counter?: WindowCounter;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = { enabled: true, windowMs: 60_000, ipMax: 600, userMax: 900, tenantMax: 6000, authMax: 30 };

/** In-memory fixed-window counter (one process). */
export class MemoryWindowCounter implements WindowCounter {
  private readonly slots = new Map<string, { count: number; resetAt: number }>();
  private calls = 0;
  constructor(private readonly now: () => number = Date.now) {}
  async hit(key: string, windowMs: number) {
    const t = this.now();
    if (++this.calls % 1000 === 0) for (const [k, v] of this.slots) if (v.resetAt <= t) this.slots.delete(k);
    let s = this.slots.get(key);
    if (!s || s.resetAt <= t) {
      s = { count: 0, resetAt: t + windowMs };
      this.slots.set(key, s);
    }
    s.count += 1;
    return { count: s.count, resetMs: s.resetAt - t };
  }
}

const OPS = new Set<string>(OPS_PATHS);

/** Routes that are never throttled: ops probes, preflights and provider webhooks. */
export function isRateLimitExempt(req: { method: string; url: string }): boolean {
  if (req.method === "OPTIONS") return true;
  const path = req.url.split("?")[0] ?? "";
  return OPS.has(path) || /\/webhooks?(\/|$)/.test(path);
}

const AUTH_SENSITIVE = /^\/v1\/auth\/(otp\/|guest\/|google$|firebase$|mfa\/|demo$|handoff\/redeem$)/;
/** The sign-in routes that get the strict per-IP budget. */
export const isAuthSensitive = (req: { method: string; url: string }): boolean => req.method === "POST" && AUTH_SENSITIVE.test(req.url.split("?")[0] ?? "");

/**
 * The shared counter with this process's memory as the fallback (Redis down or unset). Also handed to modules that
 * keep their own limits (the enquiry form), so every API instance counts them together.
 */
export function sharedWindowCounter(counter?: WindowCounter | null): WindowCounter {
  const memory = new MemoryWindowCounter();
  return {
    async hit(key, windowMs) {
      if (counter) {
        try {
          return await counter.hit(key, windowMs);
        } catch {
          /* Redis down: fall back to this process's counter */
        }
      }
      return memory.hit(key, windowMs);
    },
  };
}

export function createRateLimiter(cfg: RateLimitConfig) {
  const counter = sharedWindowCounter(cfg.counter);
  const hit = (key: string) => counter.hit(key, cfg.windowMs);
  const check = async (reply: FastifyReply, key: string, max: number, what: string) => {
    const r = await hit(key);
    const seconds = Math.max(1, Math.ceil(r.resetMs / 1000));
    if (r.count > max) {
      reply.header("retry-after", String(seconds));
      reply.header("x-ratelimit-limit", String(max));
      reply.header("x-ratelimit-remaining", "0");
      reply.header("x-ratelimit-reset", String(seconds));
      throw tooMany(`Too many ${what}. Please wait ${seconds} seconds and try again`);
    }
    return { max, left: Math.max(0, max - r.count), seconds };
  };

  /** Registered at the root, before authentication: per client IP. */
  const ipHook: onRequestAsyncHookHandler = async (req, reply) => {
    if (!cfg.enabled || isRateLimitExempt(req)) return;
    const ip = req.ip || "unknown";
    if (isAuthSensitive(req)) await check(reply, `auth:${ip}`, cfg.authMax, "sign-in attempts");
    const r = await check(reply, `ip:${ip}`, cfg.ipMax, "requests");
    reply.header("x-ratelimit-limit", String(r.max));
    reply.header("x-ratelimit-remaining", String(r.left));
    reply.header("x-ratelimit-reset", String(r.seconds));
  };

  /** Registered after the context hooks: per signed-in user and per shop. */
  const actorHook: onRequestAsyncHookHandler = async (req, reply) => {
    if (!cfg.enabled || isRateLimitExempt(req)) return;
    const user = req.ctx?.user;
    const tenant = req.ctx?.tenant;
    if (user) await check(reply, `user:${user.id}`, cfg.userMax, "requests");
    if (tenant) await check(reply, `tenant:${tenant.id}`, cfg.tenantMax, "requests from this shop");
  };
  return { ipHook, actorHook };
}

/**
 * Security headers on every response (the API is JSON, not a web page): no MIME sniffing, no referrer, and no framing
 * of JSON answers. Non-JSON answers (uploaded images, PDFs) are left frameable so documents can still be previewed in
 * the apps. HSTS only in production (browsers ignore it on plain http anyway).
 */
export function securityHeaders(opts: { hsts: boolean }): onSendAsyncHookHandler {
  return async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-permitted-cross-domain-policies", "none");
    if (opts.hsts) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    const type = String(reply.getHeader("content-type") ?? "");
    if (type.startsWith("application/json")) {
      reply.header("x-frame-options", "DENY");
      reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    }
    return payload;
  };
}

/** A null byte, or half of an emoji pair: Postgres can't store either, so without this they surface as a 500 from the query. */
const UNSAFE_TEXT = /\u0000|\p{Cs}/u;
/** Paging numbers past Postgres's int range, which the routes that read them by hand would otherwise pass straight to the query. */
const PAGING = new Set(["offset", "limit", "page"]);
const MAX_PAGING = 2_147_483_647;

/** True when a query, URL parameter or JSON body holds text the database can't take. Iterative, so deep nesting can't overflow the stack. */
export function hasUnsafeText(root: unknown): boolean {
  const stack: unknown[] = [root];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === "string") {
      if (UNSAFE_TEXT.test(v)) return true;
    } else if (Array.isArray(v)) {
      for (const item of v) stack.push(item);
    } else if (v && typeof v === "object" && !Buffer.isBuffer(v)) {
      for (const [k, item] of Object.entries(v)) {
        if (UNSAFE_TEXT.test(k)) return true;
        stack.push(item);
      }
    }
  }
  return false;
}

const invalidInput = (reply: FastifyReply, message: string) => reply.status(400).send({ error: { code: "invalid_input", message } });

/** Refuses what no route can use, once and for all routes, with a clean 400 rather than a crash per route. */
export const unsafeInputGuard: preValidationAsyncHookHandler = async (req, reply) => {
  if (hasUnsafeText(req.params) || hasUnsafeText(req.query) || hasUnsafeText(req.body)) return invalidInput(reply, "The request holds characters that can't be saved");
  for (const [k, v] of Object.entries((req.query ?? {}) as Record<string, unknown>)) {
    if (PAGING.has(k) && typeof v === "string" && /^\d+$/.test(v) && Number(v) > MAX_PAGING) return invalidInput(reply, `${k} is too large`);
  }
};