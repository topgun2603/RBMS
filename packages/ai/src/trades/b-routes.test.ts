import { AppError, emptyContext, type RequestContext } from "@rbms/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../assist/routes";
import { kit } from "../assist/test-kit";
import { tradesBRoutes, type TradesBPorts } from "./b-routes";
import type { PhotoBatchService } from "./catalogue/service";
import type { BreakupFacts } from "./jewellery/breakup";
import type { TagService } from "./textiles/service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const PIECE = "33333333-3333-4333-8333-333333333333";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(120)]).toString("base64");
const tenant = { id: TENANT, slug: "kumar", planId: "p", appId: "BL" };
const as = (roles: string[], permissions: string[] = []): Partial<RequestContext> => ({
  tenant,
  user: { id: "u1", sessionId: "s", platformRoles: [], tenantRoles: roles, permissions } as RequestContext["user"],
});
const owner = as(["owner"], ["*"]);
const cashier = as(["staff"], ["ai.use", "invoices.create"]);
const noAi = as(["staff"], ["catalogue.manage"]);
const manager = as(["staff"], ["ai.use", "catalogue.manage", "jewellery.manage"]);
const demo: Partial<RequestContext> = { tenant, user: { id: "d", sessionId: "s", platformRoles: ["demo"], tenantRoles: ["staff", "role:demo"], permissions: ["*.view"] } as RequestContext["user"] };

const facts: BreakupFacts = {
  name: "Chain",
  metal: "gold",
  purity: "22K",
  grossWeight: 5,
  stoneWeight: 0,
  netWeight: 5,
  wastagePct: 0,
  makingType: "flat",
  makingValue: 100000,
  huid: null,
  rate: { ratePerGram: 1000000, date: "2026-10-25" },
  breakdown: { metalValue: 5000000, wastage: 0, making: 100000, stones: 0, subtotal: 5100000, rounding: 0, total: 5100000, gstRate: 3, gst: 153000, totalWithGst: 5253000 },
};

function setup(over: { fashion?: boolean; piece?: unknown } = {}) {
  const k = kit({
    responders: [
      (req) => (req.system.includes("hallmark") ? JSON.stringify({ readable: true, ignoredInstructions: false, huid: "K7M2X9", purityMark: "22K916", bisLogo: true, centreMark: "", jewellerMark: "", confidence: "high", notes: "" }) : null),
      (req) => (req.system.includes("price") && req.system.includes("customer") ? JSON.stringify({ en: "Total ₹52,530.", ta: "மொத்தம் ₹52,530." }) : null),
    ],
  });
  const photos = {
    estimate: vi.fn(async () => ({ count: 2, credits: 80, perPhoto: 40, remaining: 100, enough: true })),
    start: vi.fn(async () => ({ batchId: "b" })),
    get: vi.fn(async () => ({ id: "b", status: "done", drafts: [] })),
  };
  const tags = {
    estimate: vi.fn(async () => ({ count: 1 })),
    start: vi.fn(async () => ({ batchId: "t" })),
    list: vi.fn(async () => []),
    waiting: vi.fn(async () => 2),
    approve: vi.fn(async () => ({ view: { id: "x" }, result: { applied: { fabric: ["Silk"] }, skipped: [] } })),
    reject: vi.fn(async () => ({ id: "x" })),
    approveBatch: vi.fn(async () => ({ approved: 1, skippedFields: 0 })),
  };
  const ports: TradesBPorts = {
    categories: async () => [],
    trade: async () => "fashion",
    isFashion: async () => over.fashion ?? true,
    existing: { find: async () => null },
    shopName: async () => "Lakshmi Jewellers",
    jewellery: {
      piece: vi.fn(async (_t: string, id: string) => (id === PIECE ? ((over.piece as never) ?? { facts, piece: { id: PIECE, name: "Chain", metal: "gold", purity: "22K", huid: null } }) : null)),
      huidOwner: vi.fn(async (_t: string, h: string) => (h === "K7M2X9" ? { id: "other", name: "Ring" } : null)),
    },
  };
  return { k, photos, tags, ports };
}

async function build(s: ReturnType<typeof setup>, ctx: Partial<RequestContext>) {
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    return reply.status(500).send({ error: { code: "other", message: String(err) } });
  });
  await app.register(
    async (a) =>
      tradesBRoutes({ ai: s.k.service, photos: s.photos as unknown as PhotoBatchService, tags: s.tags as unknown as TagService, ports: s.ports, limiter: new RateLimiter() })(a),
    { prefix: "/v1/ai/trade" },
  );
  return app;
}
const post = (app: Awaited<ReturnType<typeof build>>, url: string, payload: unknown = {}) => app.inject({ method: "POST", url: `/v1/ai/trade${url}`, payload: payload as object });
const code = (r: { json(): unknown }) => (r.json() as { error?: { code?: string } }).error?.code;
const img = { mediaType: "image/jpeg", data: JPEG };

describe("permissions: ai.use plus the permission of what is being drafted", () => {
  it("catalogue from photos needs ai.use and catalogue.manage; the read-only demo role never spends", async () => {
    const s = setup();
    expect((await post(await build(s, owner), "/catalogue-photos/estimate", { count: 2 })).statusCode).toBe(200);
    expect((await post(await build(s, manager), "/catalogue-photos", { images: [img] })).statusCode).toBe(200);
    expect((await post(await build(s, cashier), "/catalogue-photos", { images: [img] })).statusCode).toBe(403);
    expect((await post(await build(s, noAi), "/catalogue-photos", { images: [img] })).statusCode).toBe(403);
    expect((await post(await build(s, demo), "/catalogue-photos", { images: [img] })).statusCode).toBe(403);
    expect(s.photos.start).toHaveBeenCalledTimes(1);
    expect(s.k.mock.calls).toHaveLength(0);
  });
  it("the counter pack photo uses the same permission as adding an item at the counter (catalogue.manage)", async () => {
    const s = setup();
    expect((await post(await build(s, cashier), "/pack", { image: img })).statusCode).toBe(403);
    expect((await post(await build(s, demo), "/pack", { image: img })).statusCode).toBe(403);
    expect(s.k.mock.calls).toHaveLength(0);
  });
  it("a bad file is refused before any model call", async () => {
    const s = setup();
    const r = await post(await build(s, owner), "/pack", { image: { mediaType: "image/jpeg", data: Buffer.alloc(100, 1).toString("base64") } });
    expect(r.statusCode).toBe(400);
    expect(code(r)).toBe("ai_bad_image");
    expect(s.k.mock.calls).toHaveLength(0);
  });
  it("20 photos at most", async () => {
    const s = setup();
    const r = await post(await build(s, owner), "/catalogue-photos", { images: Array.from({ length: 21 }, () => img) });
    expect(r.statusCode).toBe(400);
  });
});

describe("textile tags are for clothing shops only", () => {
  it("a grocery shop gets 403 ai_not_for_trade and status says not eligible", async () => {
    const s = setup({ fashion: false });
    const app = await build(s, owner);
    const r = await post(app, "/product-tags", { productIds: [PIECE] });
    expect(r.statusCode).toBe(403);
    expect(code(r)).toBe("ai_not_for_trade");
    const st = await app.inject({ method: "GET", url: "/v1/ai/trade/product-tags/status" });
    expect(st.json()).toEqual({ eligible: false, waiting: 0 });
    expect(s.tags.start).not.toHaveBeenCalled();
  });
  it("a fashion shop can start, list, approve (with the owner's choices) and reject", async () => {
    const s = setup();
    const app = await build(s, manager);
    expect((await post(app, "/product-tags", { productIds: [PIECE] })).statusCode).toBe(200);
    expect((await post(app, "/product-tags/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/approve", { choices: { fabric: { values: ["Silk"], replace: true }, colour: { skip: true } } })).statusCode).toBe(200);
    expect(s.tags.approve).toHaveBeenCalledWith(TENANT, "u1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", { fabric: { values: ["Silk"], replace: true }, colour: { skip: true } });
    expect((await post(app, "/product-tags/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/reject")).statusCode).toBe(200);
    expect((await post(app, "/product-tags/batches/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1/approve")).statusCode).toBe(200);
    expect((await post(await build(s, cashier), "/product-tags", { productIds: [PIECE] })).statusCode).toBe(403);
  });
});

describe("jewellery", () => {
  it("HUID: needs jewellery.manage; a HUID another piece has is flagged; never says verified", async () => {
    const s = setup();
    expect((await post(await build(s, cashier), "/jewellery/huid", { image: img })).statusCode).toBe(403);
    const r = await post(await build(s, manager), "/jewellery/huid", { image: img, pieceId: PIECE });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { draft: { huid: string; flags: string[]; notVerified: boolean }; verifyNote: string };
    expect(body.draft.huid).toBe("K7M2X9");
    expect(body.draft.flags).toContain("taken");
    expect(body.draft.notVerified).toBe(true);
    expect(body.verifyNote).toBe("bis_care");
    expect((await post(await build(s, manager), "/jewellery/huid", { image: img, pieceId: "99999999-9999-4999-8999-999999999999" })).statusCode).toBe(404);
  });
  it("breakup: the module's numbers, en and ta share text; asks for the rate when none is set; 404 for another shop's piece", async () => {
    const s = setup();
    const r = await post(await build(s, manager), "/jewellery/breakup", { pieceId: PIECE });
    expect(r.statusCode).toBe(200);
    const b = r.json() as { breakup: { totalWithGst: number }; share: { en: string; ta: string }; source: string; shop: string };
    expect(b.breakup.totalWithGst).toBe(5253000);
    expect(b.share.en).toContain("*Lakshmi Jewellers*");
    expect(b.share.ta).toContain("மொத்தம்");
    expect(b.source).toBe("ai");
    expect(code(await post(await build(setup({ piece: { facts: null, piece: { id: PIECE, name: "x", metal: "gold", purity: "22K", huid: null } } }), manager), "/jewellery/breakup", { pieceId: PIECE }))).toBe("no_rate");
    expect((await post(await build(s, manager), "/jewellery/breakup", { pieceId: "99999999-9999-4999-8999-999999999999" })).statusCode).toBe(404);
    expect((await post(await build(s, demo), "/jewellery/breakup", { pieceId: PIECE })).statusCode).toBe(403);
  });
  it("AI switched off: the breakup says so (402/403 from the service), it does not silently use the template", async () => {
    const s = setup();
    s.k.service.run = vi.fn(async () => {
      throw new AppError(403, "ai_off", "off");
    }) as never;
    const r = await post(await build(s, manager), "/jewellery/breakup", { pieceId: PIECE });
    expect(r.statusCode).toBe(403);
    expect(code(r)).toBe("ai_off");
  });
});
