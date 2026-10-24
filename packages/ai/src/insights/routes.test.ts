import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { kit, T } from "../assist/test-kit";
import { RateLimiter } from "../assist/routes";
import type { DailySummaryService } from "./daily";
import { insightRoutes, type InsightPorts } from "./routes";
import type { ReorderInput } from "./reorder";

const tenant = { id: T, slug: "kumar", planId: "bl-starter", appId: "BL" };
const as = (roles: string[], permissions: string[]): Partial<RequestContext> => ({
  tenant,
  user: { id: "u1", sessionId: "s", platformRoles: [], tenantRoles: roles, permissions } as RequestContext["user"],
});
const owner = as(["owner"], ["*"]);
const demo: Partial<RequestContext> = { tenant, user: { id: "d", sessionId: "s", platformRoles: ["demo"], tenantRoles: ["staff", "role:demo"], permissions: ["*.view", "invoices.credit-book"] } as RequestContext["user"] };

const item: ReorderInput = { itemId: "i1", name: "Ghee", unit: "pcs", stock: 0, reorderLevel: 5, onOrder: 0, sold28: 56, sold90: 180, historyDays: 90, daily28: Array(28).fill(2), leadDays: 3 };
const ports = (): InsightPorts => ({
  reorder: vi.fn(async () => ({ today: "2026-10-24", historyDays: 90, inputs: [item], festivals: [] })),
  segment: vi.fn(async () => [{ id: "c1", name: "Raja", phone: "9876543210", visits: 5, matched: true, lastVisit: "2026-10-01", lastMessagedAt: null, optedOut: false }]),
  peakHour: vi.fn(async () => 18),
  shop: vi.fn(async () => ({ name: "Kumar Stores", trade: "Grocery" })),
  review: vi.fn(async () => ({ id: "r1", rating: 2, body: "poor" })),
  reviewTexts: vi.fn(async () => [{ rating: 5, text: "great quality" }]),
  today: () => "2026-10-24",
  now: () => new Date("2026-10-24T05:00:00Z"),
});

async function build(ctx: Partial<RequestContext>, k = kit(), p = ports()) {
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    return reply.status(500).send({ error: { code: "other" } });
  });
  const daily = { latest: vi.fn(async () => null), list: vi.fn(async () => []), preview: vi.fn(), run: vi.fn() } as unknown as DailySummaryService;
  await app.register(async (a) => insightRoutes({ ai: k.service, daily, ports: p, limiter: new RateLimiter() })(a), { prefix: "/v1/ai/insights" });
  return { app, k, p };
}
const post = (app: Awaited<ReturnType<typeof build>>["app"], url: string, payload: unknown = {}) => app.inject({ method: "POST", url: `/v1/ai/insights${url}`, payload: payload as object });
const REVIEW = "33333333-3333-4333-8333-333333333333";

describe("insight routes: permissions", () => {
  it("need a member and the AI permission plus the module's own permission", async () => {
    expect((await post((await build({})).app, "/reorder")).statusCode).toBe(401);
    expect((await post((await build(as(["staff"], ["inventory.purchases"]))).app, "/reorder")).statusCode).toBe(403); // no ai.use
    expect((await post((await build(as(["staff"], ["ai.use"]))).app, "/reorder")).statusCode).toBe(403); // no inventory.purchases
    expect((await post((await build(as(["staff"], ["ai.use", "inventory.purchases"]))).app, "/reorder")).statusCode).toBe(200);
    expect((await post((await build(as(["staff"], ["ai.use", "inventory.purchases"]))).app, "/campaign/draft", { goal: "Pongal offer 10% on sarees" })).statusCode).toBe(403);
    expect((await post((await build(as(["staff"], ["ai.use", "whatsapp.manage"]))).app, "/campaign/draft", { goal: "Pongal offer 10% on sarees" })).statusCode).toBe(200);
    expect((await post((await build(as(["staff"], ["ai.use", "whatsapp.manage"]))).app, `/reviews/${REVIEW}/reply`)).statusCode).toBe(403);
    expect((await post((await build(as(["staff"], ["ai.use", "reviews.manage"]))).app, `/reviews/${REVIEW}/reply`)).statusCode).toBe(200);
    expect((await post((await build(as(["staff"], ["ai.use", "reviews.manage"]))).app, "/reviews/themes")).statusCode).toBe(200);
  });
  it("daily summary routes need ai.manage (and ai.use to spend)", async () => {
    const get = async (perms: string[]) => (await (await build(as(["staff"], perms))).app.inject({ method: "GET", url: "/v1/ai/insights/daily/latest" })).statusCode;
    expect(await get(["ai.use"])).toBe(403);
    expect(await get(["ai.manage"])).toBe(200);
    expect((await post((await build(as(["staff"], ["ai.manage"]))).app, "/daily/preview")).statusCode).toBe(403);
    expect((await post((await build(as(["staff"], ["ai.use"]))).app, "/daily/send")).statusCode).toBe(403);
  });
  it("the read-only demo role cannot spend credits on any of them", async () => {
    const { app, k } = await build(demo);
    for (const url of ["/reorder", "/campaign/draft", `/reviews/${REVIEW}/reply`, "/reviews/themes", "/daily/preview", "/daily/send"]) {
      expect((await post(app, url, { goal: "Pongal offer 10% on sarees" })).statusCode, url).toBe(403);
    }
    expect(k.spent()).toBe(0);
  });
});

describe("insight routes: AI off and credits", () => {
  it("reorder still returns the suggestions with standard wording when AI is off or credits are gone", async () => {
    for (const k of [kit({ settings: { enabled: false } }), kit({ remaining: 0 })]) {
      const { app } = await build(owner, k);
      const r = await post(app, "/reorder", { lang: "ta" });
      expect(r.statusCode).toBe(200);
      const body = r.json();
      expect(body.aiNote).toMatch(/ai_off|ai_credits_exhausted/);
      expect(body.groups[0].items[0].qty).toBeGreaterThan(0);
      expect(body.groups[0].reasonSource).toBe("template");
      expect(body.groups[0].reason).toMatch(/[஀-௿]/);
    }
  });
  it("campaign draft and review reply answer with the plain AI error", async () => {
    expect((await post((await build(owner, kit({ settings: { enabled: false } }))).app, "/campaign/draft", { goal: "Pongal offer 10% on sarees" })).json().error.code).toBe("ai_off");
    expect((await post((await build(owner, kit({ remaining: 0 }))).app, `/reviews/${REVIEW}/reply`)).json().error.code).toBe("ai_credits_exhausted");
    expect((await post((await build(owner, kit({ settings: { features: { "campaign-writer": false } } }))).app, "/campaign/draft", { goal: "Pongal offer 10% on sarees" })).json().error.code).toBe("ai_feature_off");
  });
  it("campaign draft returns the code-computed segment and a send time, and charges credits", async () => {
    const { app, k, p } = await build(owner);
    const r = await post(app, "/campaign/draft", { goal: "Pongal offer 10% on sarees" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.segment.members).toEqual([{ id: "c1", name: "Raja", phone: "+919876543210" }]);
    expect(body.sendAt).toMatchObject({ basis: "peak", hour: 17 });
    expect(k.spent()).toBeGreaterThan(0);
    expect(p.segment).toHaveBeenCalledOnce();
  });
  it("rejects a goal that is too short and an unknown review", async () => {
    expect((await post((await build(owner)).app, "/campaign/draft", { goal: "hi" })).statusCode).toBe(400);
    const p = ports();
    p.review = vi.fn(async () => null);
    expect((await post((await build(owner, kit(), p)).app, `/reviews/${REVIEW}/reply`)).statusCode).toBe(404);
  });
});
