import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { badRequest, forbidden, unauthorized } from "@rbms/core";
import { z } from "zod";
import { CMS_LIMITS, seoSchema } from "./content";
import { noopLogger, type CatalogPort, type LoggerPort, type ShopPort } from "./ports";
import { publicHome, type PublicHome } from "./resolve";
import type { CmsService } from "./service";

/*
 * Live preview of the storefront for the shop's staff (the visual editor iframes the real store).
 *
 * - A preview token is a short-lived HMAC-signed claim set { tenant, user, expiry, id } — no table, no migration. It is
 *   issued to staff with `cms.manage` (POST /v1/cms/preview-token) and verified by the store's server, which sends it
 *   back as `x-preview-token` together with the shop's tenant headers; a token only works for the tenant it names.
 * - Unsaved edits (home sections, brand tokens) are parked per token in a draft store (in memory by default, keyed by
 *   the token id, dropped when the token expires) so the store can re-render them server-side on a soft refresh.
 * - Visitors never see any of this: the public reads ignore the draft store, and the store only consults it for
 *   requests that carry a valid preview cookie (rendered uncached).
 */

export const PREVIEW_TOKEN_HEADER = "x-preview-token";
/** Default lifetime of a preview token (the editor fetches a fresh one before it runs out). */
export const PREVIEW_TTL_SECONDS = 30 * 60;
/** Longest accepted token string (cookie-safe characters only, see TOKEN_RE). */
export const PREVIEW_TOKEN_MAX = 512;
/** Largest draft body the store may park (bytes of JSON). */
export const PREVIEW_DRAFT_MAX_BYTES = 512 * 1024;

const TOKEN_RE = /^pv1\.[A-Za-z0-9_-]{10,400}\.[A-Za-z0-9_-]{43}$/;
const DEV_SECRET = "dev-only-secret-change-me";

export interface PreviewClaims {
  v: 1;
  /** Tenant id the token previews. */
  tid: string;
  /** Staff user who asked for it (audit / logs). */
  uid: string;
  /** Expiry, epoch seconds. */
  exp: number;
  /** Random id: keys the draft store. */
  jti: string;
}

const claimsSchema = z.object({
  v: z.literal(1),
  tid: z.string().min(1).max(64),
  uid: z.string().min(1).max(64),
  exp: z.number().int().positive(),
  jti: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
});

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Signing key for preview tokens: CMS_PREVIEW_SECRET, else derived from APP_SECRET (the API's main secret). */
export function previewSecret(env: Record<string, string | undefined> = process.env): string {
  const raw = env.CMS_PREVIEW_SECRET || env.APP_SECRET;
  if (!raw) {
    if (env.NODE_ENV === "production") throw new Error("Set APP_SECRET (or CMS_PREVIEW_SECRET) to sign preview tokens");
    return createHmac("sha256", DEV_SECRET).update("srikit.cms.preview.v1").digest("base64url");
  }
  // Domain-separated from every other use of APP_SECRET.
  return createHmac("sha256", raw).update("srikit.cms.preview.v1").digest("base64url");
}

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(`pv1.${payload}`).digest("base64url");

/** Pure: a signed token for the claims. */
export function signPreviewToken(claims: PreviewClaims, secret: string): string {
  const payload = b64url(JSON.stringify(claims));
  return `pv1.${payload}.${sign(payload, secret)}`;
}

/** Pure: the claims of a well-formed, correctly signed, unexpired token; null otherwise (never throws). */
export function verifyPreviewToken(token: unknown, secret: string, nowMs = Date.now()): PreviewClaims | null {
  if (typeof token !== "string" || token.length > PREVIEW_TOKEN_MAX || !TOKEN_RE.test(token)) return null;
  const [, payload = "", mac = ""] = token.split(".");
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const claims = claimsSchema.safeParse(parsed);
  if (!claims.success) return null;
  if (claims.data.exp * 1000 <= nowMs) return null;
  return claims.data;
}

// ------------------------------------------------------------------ draft store

/** Unsaved edits for one preview token. Opaque JSON: the storefront re-validates before rendering. */
export interface PreviewDraft {
  home?: { sections: unknown[]; seo?: unknown } | null;
  /** Brand tokens (the branding package's `BrandTokensInput`), validated by the storefront. */
  tokens?: unknown;
  updatedAt: number;
}

/** Where drafts live. In memory by default; a Redis-backed store fits the same interface for several API replicas. */
export interface PreviewDraftStore {
  get(key: string): Promise<PreviewDraft | null> | PreviewDraft | null;
  set(key: string, draft: PreviewDraft, expiresAtMs: number): Promise<void> | void;
  delete(key: string): Promise<void> | void;
}

/** Process-local draft store with expiry and a size cap (oldest entries go first). */
export class MemoryPreviewDraftStore implements PreviewDraftStore {
  private readonly items = new Map<string, { draft: PreviewDraft; exp: number }>();
  constructor(
    private readonly max = 2000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): PreviewDraft | null {
    const it = this.items.get(key);
    if (!it) return null;
    if (it.exp <= this.now()) {
      this.items.delete(key);
      return null;
    }
    return it.draft;
  }

  set(key: string, draft: PreviewDraft, expiresAtMs: number): void {
    this.items.delete(key);
    this.items.set(key, { draft, exp: expiresAtMs });
    if (this.items.size > this.max) this.sweep();
  }

  delete(key: string): void {
    this.items.delete(key);
  }

  get size(): number {
    return this.items.size;
  }

  private sweep() {
    const now = this.now();
    for (const [k, v] of this.items) if (v.exp <= now) this.items.delete(k);
    // Still too many: drop the oldest (Map keeps insertion order; `set` re-inserts on update).
    for (const k of this.items.keys()) {
      if (this.items.size <= this.max) break;
      this.items.delete(k);
    }
  }
}

/** `PUT /preview/draft`: either part may be left out (kept), or null (cleared). */
export const previewDraftBodySchema = z
  .object({
    home: z
      .object({ sections: z.array(z.unknown()).max(CMS_LIMITS.sections), seo: z.unknown().optional() })
      .nullable()
      .optional(),
    tokens: z.unknown().optional(),
  })
  .strict();

// ------------------------------------------------------------------ service

export interface CmsPreviewDeps {
  catalog: CatalogPort;
  shop: ShopPort;
  log?: LoggerPort;
  /** Clock override for tests (ms). */
  now?: () => number;
}

export interface CmsPreviewOptions {
  /** Signing secret (default: previewSecret()). */
  secret?: string;
  ttlSeconds?: number;
  store?: PreviewDraftStore;
}

export interface PreviewSession {
  tenantId: string;
  expiresAt: string;
  /** Unsaved brand tokens for this preview, null when none were sent. */
  tokens: unknown;
  /** True when unsaved home sections were sent (else the saved draft is shown). */
  draftHome: boolean;
}

/** Preview tokens and per-token drafts (see the file comment). */
export class CmsPreview {
  private readonly secret: string;
  private readonly ttl: number;
  private readonly store: PreviewDraftStore;
  private readonly now: () => number;
  private readonly log: LoggerPort;

  constructor(
    private readonly cms: Pick<CmsService, "getHome">,
    private readonly deps: CmsPreviewDeps,
    opts: CmsPreviewOptions = {},
  ) {
    this.secret = opts.secret ?? previewSecret();
    this.ttl = opts.ttlSeconds ?? PREVIEW_TTL_SECONDS;
    this.store = opts.store ?? new MemoryPreviewDraftStore();
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? noopLogger;
  }

  /** A fresh token for staff `userId` of `tenantId`. */
  issue(tenantId: string, userId: string): { token: string; expiresAt: string; ttlSeconds: number } {
    const exp = Math.floor(this.now() / 1000) + this.ttl;
    const token = signPreviewToken({ v: 1, tid: tenantId, uid: userId, exp, jti: randomBytes(12).toString("base64url") }, this.secret);
    return { token, expiresAt: new Date(exp * 1000).toISOString(), ttlSeconds: this.ttl };
  }

  /** The token's claims; 401 when it's missing/invalid/expired, 403 when it's for another shop. */
  verify(tenantId: string, token: unknown): PreviewClaims {
    const claims = verifyPreviewToken(token, this.secret, this.now());
    if (!claims) throw unauthorized("Preview link expired or invalid");
    if (claims.tid !== tenantId) throw forbidden("This preview link is for another shop");
    return claims;
  }

  async session(tenantId: string, token: unknown): Promise<PreviewSession> {
    const c = this.verify(tenantId, token);
    const draft = await this.store.get(c.jti);
    return { tenantId, expiresAt: new Date(c.exp * 1000).toISOString(), tokens: draft?.tokens ?? null, draftHome: !!draft?.home };
  }

  /** Parks unsaved edits for the token (merging with what's there: omitted parts are kept, null clears). */
  async putDraft(tenantId: string, token: unknown, body: unknown): Promise<{ ok: true; updatedAt: number }> {
    const c = this.verify(tenantId, token);
    const input = previewDraftBodySchema.parse(body ?? {});
    const prev = (await this.store.get(c.jti)) ?? { updatedAt: 0 };
    const next: PreviewDraft = { ...prev, updatedAt: this.now() };
    if (input.home !== undefined) next.home = input.home;
    if (input.tokens !== undefined) next.tokens = input.tokens;
    if (JSON.stringify(next).length > PREVIEW_DRAFT_MAX_BYTES) throw badRequest("Preview draft too large");
    await this.store.set(c.jti, next, c.exp * 1000);
    return { ok: true, updatedAt: next.updatedAt };
  }

  async clearDraft(tenantId: string, token: unknown): Promise<{ ok: true }> {
    const c = this.verify(tenantId, token);
    await this.store.delete(c.jti);
    return { ok: true };
  }

  /**
   * The home the preview shows, resolved like `GET /public/home`: the unsaved sections when the editor sent some,
   * else the saved draft, else the published home (else the generated default). Hidden sections stay out, as in the
   * live store.
   */
  async home(tenantId: string, token: unknown): Promise<PublicHome> {
    const c = this.verify(tenantId, token);
    const draft = await this.store.get(c.jti);
    let doc: { sections: unknown[]; seo?: unknown } | null = draft?.home ?? null;
    if (!doc) {
      const saved = await this.cms.getHome(tenantId);
      doc = (saved.draft ?? saved.published ?? null) as typeof doc;
    }
    const deps = { catalog: this.deps.catalog, shop: this.deps.shop, log: this.log };
    // `publicHome` re-validates each section (invalid half-edited ones are dropped) and loads catalogue data.
    const home = await publicHome(tenantId, doc ? ({ sections: doc.sections ?? [], seo: seoOrUndefined(doc.seo) } as never) : null, null, deps);
    return { ...home, publishedAt: null };
  }
}

const seoOrUndefined = (seo: unknown) => {
  const r = seoSchema.safeParse(seo);
  return r.success ? r.data : undefined;
};
