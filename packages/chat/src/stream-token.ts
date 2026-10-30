import { createHmac, randomBytes } from "node:crypto";
import { randomToken, safeEqual, type TenantRef } from "@rbms/core";
import type { Viewer } from "./logic";

/**
 * Short-lived, single-use tokens for `GET /stream?token=` — browsers' EventSource cannot send an Authorization header.
 * The token is an HMAC-SHA256-signed snapshot of the viewer (tenant, user, staff/manage flags), valid 60 s. Being
 * signed, any API instance sharing the secret can verify it; single use is enforced through a `NonceStorePort`
 * (in-memory per process by default; use Redis `SET key 1 NX PX ttl` across instances).
 */
export const STREAM_TOKEN_TTL_MS = 60_000;

export interface NonceStorePort {
  /** True the first time a nonce is claimed within `ttlMs`; false afterwards. */
  claim(nonce: string, ttlMs: number): Promise<boolean>;
}

export class MemoryNonceStore implements NonceStorePort {
  private readonly seen = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  async claim(nonce: string, ttlMs: number): Promise<boolean> {
    const now = this.now();
    for (const [k, exp] of this.seen) if (exp <= now) this.seen.delete(k);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now + ttlMs);
    return true;
  }
}

export interface StreamTokenPayload {
  viewer: Viewer;
  tenant: TenantRef;
  /** Expiry, ms since epoch. */
  exp: number;
  /** Nonce. */
  n: string;
}

export class StreamTokens {
  private readonly secret: Buffer;

  constructor(
    secret: string | undefined,
    private readonly nonces: NonceStorePort = new MemoryNonceStore(),
    private readonly now: () => number = Date.now,
    readonly ttlMs = STREAM_TOKEN_TTL_MS,
  ) {
    // Without a configured secret tokens only verify on the instance that issued them.
    this.secret = secret ? Buffer.from(secret) : randomBytes(32);
  }

  private sign(body: string) {
    return createHmac("sha256", this.secret).update(`chat-stream.${body}`).digest("base64url");
  }

  issue(viewer: Viewer, tenant: TenantRef): { token: string; expiresAt: string } {
    const exp = this.now() + this.ttlMs;
    const payload: StreamTokenPayload = { viewer, tenant, exp, n: randomToken(16) };
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return { token: `${body}.${this.sign(body)}`, expiresAt: new Date(exp).toISOString() };
  }

  /** Checks signature and expiry without consuming the token. */
  verify(token: string): StreamTokenPayload | null {
    const [body, sig, extra] = token.split(".");
    if (!body || !sig || extra !== undefined) return null;
    if (!safeEqual(sig, this.sign(body))) return null;
    let payload: StreamTokenPayload;
    try {
      payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StreamTokenPayload;
    } catch {
      return null;
    }
    if (typeof payload?.exp !== "number" || payload.exp <= this.now()) return null;
    if (!payload.viewer?.userId || !payload.viewer?.tenantId || payload.tenant?.id !== payload.viewer.tenantId) return null;
    return payload;
  }

  /** Verifies and consumes the token (single use). Null when invalid, expired or already used. */
  async redeem(token: string): Promise<StreamTokenPayload | null> {
    const payload = this.verify(token);
    if (!payload) return null;
    const fresh = await this.nonces.claim(payload.n, Math.max(1, payload.exp - this.now()) + 1_000);
    return fresh ? payload : null;
  }
}
