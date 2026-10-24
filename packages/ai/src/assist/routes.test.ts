import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { AiService } from "../service";
import { chunkGuide, GuideIndex } from "./help";
import { assistRoutes, RateLimiter, type AssistPorts } from "./routes";
import type { TranslationService } from "./translations";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "33333333-3333-4333-8333-333333333333";
const tenant = { id: TENANT, slug: "kumar", planId: "bl-starter", appId: "BL" };
const as = (roles: string[], permissions: string[] = [], id = "u1"): Partial<RequestContext> => ({
  tenant,
  user: { id, sessionId: "s", platformRoles: [], tenantRoles: roles, permissions } as RequestContext["user"],
});
const owner = as(["owner"], ["*"]);
const demo: Partial<RequestContext> = { tenant, user: { id: "d", sessionId: "s", platformRoles: ["demo"], tenantRoles: ["staff", "role:demo"], permissions: ["*.view", "invoices.credit-book"] } as RequestContext["user"] };

const hsnOut = { suggestions: [{ hsn: "1006", kind: "goods", official_title: "Rice", gstRate: 0, confidence: "high", reason: "rice" }] };
const guides = new GuideIndex(chunkGuide("# 3. P\n\n## Add an item\n\nOpen **Items** in the menu, tap **Add item**, type the name and tap **Save** to put the item on your bill.\n", "user-manual", "en"));
const result = (output: unknown, credits = 1) => ({ output, runId: "r1", credits, usage: {}, model: "m", provider: "mock" });

const byFeature = (req: { feature: string }) => result(req.feature === "import-mapping" ? { mappings: [{ field: "a", column: 0, confidence: "high", reason: "r" }] } : req.feature === "help" ? { answered: true, answer: "ok", sections: ["user-manual#1"], language: "en" } : hsnOut);

function setup(run: (req: { feature: string }) => unknown = byFeature) {
  const ai = { run: vi.fn(async (req: { feature: string }) => run(req)) };
  const translations = {
    estimate: vi.fn(async () => ({ count: 2, credits: 30, perProduct: 15, remaining: 100, enough: true })),
    start: vi.fn(async () => ({ batchId: "b", count: 2 })),
    list: vi.fn(async () => []),
    approve: vi.fn(async (_t: string, _u: string | null, id: string) => ({ id, status: "approved" })),
    reject: vi.fn(async (_t: string, _u: string | null, id: string) => ({ id, status: "rejected" })),
    approveBatch: vi.fn(async () => ({ approved: 2 })),
  };
  const ports: AssistPorts = {
    product: vi.fn(async (_t, id) => (id === PRODUCT ? { name: "Silk saree" } : null)),
    products: vi.fn(async () => []),
    shop: vi.fn(async () => ({ trade: "Textiles", policies: [] })),
  };
  return { ai, translations, ports };
}

async function build(s: ReturnType<typeof setup>, ctx: Partial<RequestContext>, limiter?: RateLimiter) {
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    return reply.status(500).send({ error: { code: "other" } });
  });
  await app.register(
    async (a) => assistRoutes({ ai: s.ai as unknown as AiService, translations: s.translations as unknown as TranslationService, ports: s.ports, guides, limiter })(a),
    { prefix: "/v1/ai/assist" },
  );
  return app;
}
const post = (app: Awaited<ReturnType<typeof build>>, url: string, payload: unknown = {}) => app.inject({ method: "POST", url: `/v1/ai/assist${url}`, payload: payload as object });

describe("assist routes: permissions", () => {
  it("needs a signed-in member and ai.use", async () => {
    const s = setup();
    expect((await post(await build(s, {}), "/hsn", { name: "rice" })).statusCode).toBe(401);
    expect((await post(await build(s, as(["staff"], ["catalogue.manage"])), "/hsn", { name: "rice" })).statusCode).toBe(403);
    expect(s.ai.run).not.toHaveBeenCalled();
  });
  it("hsn: ai.use plus permission to create items (catalogue or billing)", async () => {
    const s = setup();
    expect((await post(await build(s, as(["staff"], ["ai.use"])), "/hsn", { name: "rice" })).statusCode).toBe(403);
    const ok = await post(await build(s, as(["staff"], ["ai.use", "invoices.create"])), "/hsn", { name: "rice" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().suggestions[0].hsn).toBe("1006");
    expect((await post(await build(s, as(["staff"], ["ai.use", "catalogue.manage"])), "/hsn", { name: "rice" })).statusCode).toBe(200);
    expect((await post(await build(s, owner), "/hsn", { name: "" })).statusCode).toBe(400);
  });
  it("describe and translate need catalogue.manage; mapping needs importexport.run; help needs only ai.use", async () => {
    const s = setup();
    const aiOnly = await build(s, as(["staff"], ["ai.use"]));
    const gated: [string, unknown][] = [
      ["/describe", { product: { name: "x" } }],
      ["/translate/estimate", { productIds: [PRODUCT] }],
      ["/translate", { productIds: [PRODUCT] }],
      ["/mapping", { headers: ["a"], fields: [{ key: "a", label: "A" }] }],
    ];
    for (const [url, body] of gated) expect((await post(aiOnly, url, body)).statusCode).toBe(403);
    expect((await aiOnly.inject({ method: "GET", url: "/v1/ai/assist/translations" })).statusCode).toBe(403);
    expect((await post(aiOnly, "/help", { question: "how do I add an item" })).statusCode).toBe(200);
    expect((await post(await build(s, as(["staff"], ["ai.use", "importexport.run"])), "/mapping", { headers: ["a"], fields: [{ key: "a", label: "A" }] })).statusCode).toBe(200);
    expect((await post(await build(s, as(["staff"], ["ai.use", "catalogue.manage"])), "/translate/estimate", { productIds: [PRODUCT] })).statusCode).toBe(200);
  });
  it("the demo role cannot spend credits", async () => {
    const s = setup();
    const app = await build(s, demo);
    for (const url of ["/hsn", "/describe", "/help", "/mapping", "/translate"]) expect((await post(app, url, { name: "x", question: "how to bill" })).statusCode).toBe(403);
    expect(s.ai.run).not.toHaveBeenCalled();
  });
  it("describe loads a product of this shop only", async () => {
    const s = setup(() => result({ title: "t", description_en: "A saree.", description_ta: "புடவை.", seo_title: "s", seo_description: "d", bullets_en: [], bullets_ta: [] }, 12));
    const app = await build(s, owner);
    const ok = await post(app, "/describe", { productId: PRODUCT });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().draft.description_en).toBe("A saree.");
    expect(s.ports.product).toHaveBeenCalledWith(TENANT, PRODUCT);
    expect((await post(app, "/describe", { productId: "44444444-4444-4444-8444-444444444444" })).statusCode).toBe(404);
  });
});

describe("assist routes: credits, switches, rate limit, review", () => {
  it("passes ai_off and ai_credits_exhausted through unchanged", async () => {
    const off = setup(() => {
      throw new AppError(403, "ai_off", "off");
    });
    expect((await post(await build(off, owner), "/hsn", { name: "rice" })).json().error.code).toBe("ai_off");
    const broke = setup(() => {
      throw new AppError(402, "ai_credits_exhausted", "none");
    });
    const r = await post(await build(broke, owner), "/help", { question: "how do I add an item" });
    expect(r.statusCode).toBe(402);
  });
  it("limits help questions per user and does not mix users", async () => {
    const s = setup(() => result({ answered: true, answer: "ok", sections: ["user-manual#1"], language: "en" }));
    const limiter = new RateLimiter(() => 1_000);
    const app = await build(s, owner, limiter);
    for (let i = 0; i < 8; i++) expect((await post(app, "/help", { question: "how do I add an item" })).statusCode).toBe(200);
    const blocked = await post(app, "/help", { question: "how do I add an item" });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error.code).toBe("rate_limited");
    expect((await post(await build(s, as(["staff"], ["ai.use"], "u2"), limiter), "/help", { question: "how do I add an item" })).statusCode).toBe(200);
  });
  it("review routes go to the translation service with the shop and user", async () => {
    const s = setup();
    const app = await build(s, owner);
    const id = "55555555-5555-4555-8555-555555555555";
    expect((await post(app, `/translations/${id}/approve`, { name: "பட்டுப் புடவை" })).statusCode).toBe(200);
    expect(s.translations.approve).toHaveBeenCalledWith(TENANT, "u1", id, { name: "பட்டுப் புடவை" });
    expect((await post(app, `/translations/${id}/reject`)).statusCode).toBe(200);
    expect((await post(app, `/translations/batches/${id}/approve`)).json()).toEqual({ approved: 2 });
    expect((await post(app, "/translate", { productIds: [PRODUCT] })).json().batchId).toBe("b");
    expect((await post(app, "/translate", { productIds: ["nope"] })).statusCode).toBe(400);
  });
});
