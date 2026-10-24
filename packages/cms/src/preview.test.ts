import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import type { CatalogPort, ShopPort } from "./ports";
import {
  CmsPreview,
  MemoryPreviewDraftStore,
  PREVIEW_TTL_SECONDS,
  previewSecret,
  signPreviewToken,
  verifyPreviewToken,
  type PreviewClaims,
} from "./preview";
import { cmsPreviewRoutes } from "./preview-routes";

const T = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SECRET = "test-secret-test-secret-test-secret";
const NOW = Date.parse("2026-10-21T10:00:00Z");

const claims = (over: Partial<PreviewClaims> = {}): PreviewClaims => ({ v: 1, tid: T, uid: "u1", exp: NOW / 1000 + 600, jti: "abcdefghijklmnop", ...over });

describe("preview tokens", () => {
  it("round-trips signed claims", () => {
    const tok = signPreviewToken(claims(), SECRET);
    expect(tok).toMatch(/^pv1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(verifyPreviewToken(tok, SECRET, NOW)).toEqual(claims());
  });

  it("rejects expired tokens, other secrets, tampering and junk", () => {
    const tok = signPreviewToken(claims(), SECRET);
    expect(verifyPreviewToken(tok, SECRET, NOW + 601_000)).toBeNull();
    expect(verifyPreviewToken(tok, "another-secret-another-secret", NOW)).toBeNull();
    const [p, , mac] = tok.split(".");
    const forged = Buffer.from(JSON.stringify(claims({ tid: OTHER }))).toString("base64url");
    expect(verifyPreviewToken(`pv1.${forged}.${mac}`, SECRET, NOW)).toBeNull();
    expect(verifyPreviewToken(`pv1.${p}.${"A".repeat(43)}`, SECRET, NOW)).toBeNull();
    for (const junk of [undefined, null, 42, "", "pv1..", "Bearer x", "pv1.a.b", `pv1.${"x".repeat(600)}.${mac}`]) {
      expect(verifyPreviewToken(junk, SECRET, NOW)).toBeNull();
    }
  });

  it("rejects well-signed payloads with bad claims", () => {
    const bad = signPreviewToken({ ...claims(), jti: "short" }, SECRET);
    expect(verifyPreviewToken(bad, SECRET, NOW)).toBeNull();
  });

  it("derives a domain-separated secret; requires one in production", () => {
    expect(previewSecret({ APP_SECRET: "x".repeat(32) })).not.toBe("x".repeat(32));
    expect(previewSecret({ APP_SECRET: "a".repeat(32) })).not.toBe(previewSecret({ APP_SECRET: "b".repeat(32) }));
    expect(previewSecret({ CMS_PREVIEW_SECRET: "c".repeat(32), APP_SECRET: "a".repeat(32) })).toBe(previewSecret({ CMS_PREVIEW_SECRET: "c".repeat(32) }));
    expect(previewSecret({})).toBeTruthy();
    expect(() => previewSecret({ NODE_ENV: "production" })).toThrow();
  });
});

describe("MemoryPreviewDraftStore", () => {
  it("expires and caps entries", () => {
    let now = 0;
    const s = new MemoryPreviewDraftStore(2, () => now);
    s.set("a", { updatedAt: 1 }, 100);
    expect(s.get("a")).toEqual({ updatedAt: 1 });
    now = 100;
    expect(s.get("a")).toBeNull();
    s.set("b", { updatedAt: 1 }, 1000);
    s.set("c", { updatedAt: 1 }, 1000);
    s.set("d", { updatedAt: 1 }, 1000);
    expect(s.size).toBe(2);
    expect(s.get("b")).toBeNull();
    expect(s.get("d")).not.toBeNull();
  });
});

const product = { id: "p1", name: "Saree", slug: "saree", categoryId: null, categoryName: null, image: null, priceMin: 100, priceMax: 100, mrp: null, variantCount: 1, taxInclusive: true };
const catalog: CatalogPort = {
  categories: async () => [],
  collection: async () => null,
  productsByIds: async (_t, ids) => (ids.includes("33333333-3333-4333-8333-333333333333") ? [{ ...product, id: "33333333-3333-4333-8333-333333333333" }] : []),
  newest: async () => [product],
};
const shop: ShopPort = { info: async () => ({ name: "Raja Silks" }) };

function makePreview(saved: { draft: unknown; published: unknown } = { draft: null, published: null }) {
  const cms = { getHome: vi.fn(async () => ({ ...saved, publishedAt: null, updatedAt: null, hasUnpublishedChanges: false })) };
  const preview = new CmsPreview(cms as never, { catalog, shop, now: () => NOW }, { secret: SECRET });
  return { preview, cms };
}

describe("CmsPreview", () => {
  // The default draft store reads the real clock; pin it to NOW so the fixed token expiry never goes stale.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues tenant-bound tokens", async () => {
    const { preview } = makePreview();
    const { token, expiresAt, ttlSeconds } = preview.issue(T, "u1");
    expect(ttlSeconds).toBe(PREVIEW_TTL_SECONDS);
    expect(Date.parse(expiresAt)).toBe(NOW + PREVIEW_TTL_SECONDS * 1000);
    await expect(preview.session(T, token)).resolves.toMatchObject({ tenantId: T, tokens: null, draftHome: false });
    await expect(preview.session(OTHER, token)).rejects.toMatchObject({ status: 403 });
    await expect(preview.session(T, "nope")).rejects.toMatchObject({ status: 401 });
  });

  it("shows unsaved sections over the saved draft, and the saved draft over published", async () => {
    const { preview } = makePreview({ draft: { sections: [{ type: "text", id: "s1", heading: "Saved draft", markdown: "x" }] }, published: null });
    const { token } = preview.issue(T, "u1");
    expect((await preview.home(T, token)).sections).toMatchObject([{ type: "text", id: "s1", heading: "Saved draft" }]);

    await preview.putDraft(T, token, {
      home: {
        sections: [
          { type: "text", id: "k0", heading: "Unsaved", markdown: "hello" },
          { type: "text", id: "k1", heading: "Hidden", markdown: "x", hidden: true },
          { type: "nope" },
          { type: "products", id: "k2", title: "Picks", productIds: ["33333333-3333-4333-8333-333333333333"] },
        ],
      },
    });
    const home = await preview.home(T, token);
    expect(home.isDefault).toBe(false);
    expect(home.sections.map((s) => (s as { id?: string }).id)).toEqual(["k0", "k2"]);
    expect((await preview.session(T, token)).draftHome).toBe(true);

    // Tokens are merged in without dropping the sections; null clears.
    await preview.putDraft(T, token, { tokens: { colors: { primary: "#ff0000" } } });
    expect(await preview.session(T, token)).toMatchObject({ draftHome: true, tokens: { colors: { primary: "#ff0000" } } });
    await preview.putDraft(T, token, { home: null });
    expect((await preview.home(T, token)).sections).toMatchObject([{ heading: "Saved draft" }]);
    await preview.clearDraft(T, token);
    expect((await preview.session(T, token)).tokens).toBeNull();
  });

  it("falls back to the generated home and keeps drafts per token", async () => {
    const { preview } = makePreview();
    const a = preview.issue(T, "u1").token;
    const b = preview.issue(T, "u2").token;
    await preview.putDraft(T, a, { home: { sections: [{ type: "text", heading: "A", markdown: "a" }] } });
    expect((await preview.home(T, b)).isDefault).toBe(true);
    expect((await preview.home(T, a)).sections).toHaveLength(1);
  });

  it("rejects malformed and oversized drafts", async () => {
    const { preview } = makePreview();
    const { token } = preview.issue(T, "u1");
    await expect(preview.putDraft(T, token, { extra: 1 })).rejects.toBeInstanceOf(ZodError);
    await expect(preview.putDraft(T, token, { home: { sections: Array.from({ length: 61 }, () => ({})) } })).rejects.toBeInstanceOf(ZodError);
    await expect(preview.putDraft(T, token, { tokens: { blob: "x".repeat(600 * 1024) } })).rejects.toMatchObject({ status: 400 });
  });
});

describe("preview routes", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => app?.close());

  async function build(ctx: Partial<RequestContext>) {
    const { preview } = makePreview();
    app = Fastify();
    const configs: Record<string, unknown> = {};
    app.addHook("onRoute", (r) => {
      configs[`${r.method} ${r.url}`] = r.config;
    });
    app.decorateRequest("ctx", null as unknown as RequestContext);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), ...ctx };
    });
    app.setErrorHandler((err, _req, reply) => {
      if (err instanceof ZodError) return reply.code(400).send({ code: "validation" });
      if (err instanceof AppError) return reply.code(err.status).send({ code: err.code });
      return reply.code(500).send({ code: "internal" });
    });
    await app.register(cmsPreviewRoutes(preview), { prefix: "/v1/cms" });
    await app.ready();
    return { app, configs, preview };
  }

  const tenant = { id: T, slug: "raja", planId: null, appId: null };
  const owner = { id: "u1", sessionId: "s", platformRoles: [], tenantRoles: ["owner"], permissions: ["*"] };
  const shopper = { id: "u2", sessionId: "s", platformRoles: [], tenantRoles: [], permissions: [] };

  it("gates token issue on cms.manage; token routes on the token", async () => {
    const { app, configs } = await build({ tenant, user: owner } as never);
    expect(configs["POST /v1/cms/preview-token"]).toEqual({ feature: "cms", permission: "cms.manage" });
    expect(configs["GET /v1/cms/preview/home"]).toEqual({ feature: "cms" });

    const res = await app.inject({ method: "POST", url: "/v1/cms/preview-token" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    const { token } = res.json() as { token: string };

    expect((await app.inject({ method: "GET", url: "/v1/cms/preview/session" })).statusCode).toBe(401);
    const ok = await app.inject({ method: "GET", url: "/v1/cms/preview/session", headers: { "x-preview-token": token } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ tenantId: T });

    const put = await app.inject({ method: "PUT", url: "/v1/cms/preview/draft", headers: { "x-preview-token": token }, payload: { tokens: { colors: { primary: "#112233" } } } });
    expect(put.statusCode).toBe(200);
    const home = await app.inject({ method: "GET", url: "/v1/cms/preview/home", headers: { "x-preview-token": token } });
    expect(home.statusCode).toBe(200);
    expect(home.json()).toMatchObject({ isDefault: true });
  });

  it("refuses shoppers and anonymous callers a token", async () => {
    const a = await build({ tenant, user: shopper } as never);
    expect((await a.app.inject({ method: "POST", url: "/v1/cms/preview-token" })).statusCode).toBe(403);
    await a.app.close();
    const b = await build({ tenant });
    expect((await b.app.inject({ method: "POST", url: "/v1/cms/preview-token" })).statusCode).toBe(401);
  });
});
