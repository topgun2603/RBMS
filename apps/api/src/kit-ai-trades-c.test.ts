import { AI_SETTINGS_DEFAULTS, AiService, MockProvider, resolveAiConfig, type AiSettings, type CreditBalance, type CreditsPort } from "@srirealtime/ai";
import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createAiTradesC } from "./kit-ai-trades-c";

const T = "11111111-1111-4111-8111-111111111111";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]).toString("base64");
const photo = { images: [{ mediaType: "image/jpeg", data: JPEG }] };
const GOOD = "490154203237518";

function setup(o: { features?: string[]; settings?: Partial<AiSettings>; remaining?: number; label?: Record<string, unknown> } = {}) {
  const rows: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({ values: async (r: Record<string, unknown>) => void rows.push(r) }),
    execute: async () => [],
  } as unknown as Db;
  const mock = new MockProvider();
  mock.respond((req) => {
    if (!req.jsonSchema) return null;
    if (req.system.includes("device's identity"))
      return JSON.stringify({ readable: true, notes: "", kind: "box_label", brand: "Redmi", model: "Note 12", serial: "R58M30ABCDE", imeis: [GOOD, "490154203237519"], confidence: { brand: "high", model: "high", serial: "high", imei: "high" }, ...o.label });
    if (req.system.includes("tailor's measurement card"))
      return JSON.stringify({ readable: true, notes: "", unit: "in", garment: "blouse", rows: [{ field: "bust", label: "Bust", value: 36, confidence: "high" }, { field: "waist", label: "Waist", value: 30, confidence: "low" }] });
    if (req.system.includes("intake note")) return JSON.stringify({ summary: "Screen cracked", causes: ["Display may be damaged"], checks: ["Check touch"], needs: [{ kind: "part", keyword: "display" }] });
    return null;
  });
  const config = resolveAiConfig({ NODE_ENV: "test" }, { mock });
  const remaining = o.remaining ?? 500;
  const balance = async (): Promise<CreditBalance> => ({ period: "2026-10", unlimited: false, allowance: 500, allowanceUsed: 500 - remaining, topUp: 0, remaining });
  const credits: CreditsPort = { balance, charge: vi.fn(async (_t, c: number) => c) };
  const settings: AiSettings = { ...AI_SETTINGS_DEFAULTS, enabled: true, ...o.settings };
  const ai = new AiService({ db, config, settings: { get: async () => settings }, featureOn: async () => true, credits, log: { warn: vi.fn(), error: vi.fn() }, now: () => new Date("2026-10-24T06:00:00Z") });
  const on = new Set(o.features ?? ["jobcards", "serials", "memberships", "bookings", "invoices.quotations"]);
  const mod = createAiTradesC({
    ai,
    db,
    items: { listItems: async (_t, q) => ({ items: [{ id: "i1", name: "Display unit (OEM)", hsn: "8517", unit: "pcs", rate: 450_000, gstRate: 18 }].filter((i) => !q.q || i.name.toLowerCase().includes(q.q.toLowerCase().split(" ").at(-1)!)) }) },
    isEnabled: async (_t, k) => on.has(k),
    shopName: async () => "QuickFix",
    now: () => new Date("2026-10-24T06:00:00Z"),
  });
  return { mod, mock, rows, credits };
}

async function build(s: ReturnType<typeof setup>, ctx: Partial<RequestContext>) {
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "invalid_input" } });
    return reply.status(500).send({ error: { code: "other", message: String((err as Error).message) } });
  });
  await app.register(async (a) => s.mod.routes!(a), { prefix: "/v1/ai/trades-c" });
  return app;
}
const tenant = { id: T, slug: "quickfix", planId: "sv-starter", appId: "SV" };
const as = (roles: string[], permissions: string[], platformRoles: string[] = []): Partial<RequestContext> => ({ tenant, user: { id: "u1", sessionId: "s", platformRoles, tenantRoles: roles, permissions } as RequestContext["user"] });
const owner = as(["owner"], ["*"]);
const tech = as(["staff"], ["ai.use", "jobcards.manage"]);
const post = (app: Awaited<ReturnType<typeof build>>, path: string, payload: unknown) => app.inject({ method: "POST", url: `/v1/ai/trades-c/${path}`, payload: payload as object });

describe("trades C routes", () => {
  it("fault note: a technician with ai.use + jobcards.manage gets a draft with catalogue prices only", async () => {
    const s = setup();
    const res = await post(await build(s, tech), "fault-note", { complaint: "screen udanjiduchu, touch work aagala", language: "en" });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.draft.needs[0].matches[0]).toMatchObject({ id: "i1", rate: 450_000 });
    expect(b.draft.estimate).toMatchObject({ low: 450_000, high: 450_000 });
    expect(b.credits).toBeGreaterThanOrEqual(1);
    expect(s.credits.charge).toHaveBeenCalledTimes(1);
  });
  it("needs ai.use AND the module permission; the demo-style read-only role is refused and spends nothing", async () => {
    const s = setup();
    const noAi = await post(await build(s, as(["staff"], ["jobcards.manage"])), "fault-note", { complaint: "screen broken" });
    expect(noAi.statusCode).toBe(403);
    const noJob = await post(await build(s, as(["staff"], ["ai.use"])), "fault-note", { complaint: "screen broken" });
    expect(noJob.statusCode).toBe(403);
    const demo = await post(await build(s, as(["staff"], ["jobcards.view"], ["demo"])), "fault-note", { complaint: "screen broken" });
    expect(demo.statusCode).toBe(403);
    const anon = await post(await build(s, { tenant }), "fault-note", { complaint: "screen broken" });
    expect(anon.statusCode).toBe(401);
    expect(s.credits.charge).not.toHaveBeenCalled();
    expect(s.mock.calls).toHaveLength(0);
  });
  it("a shop without the module is refused before any model call", async () => {
    const s = setup({ features: ["memberships"] });
    const res = await post(await build(s, owner), "fault-note", { complaint: "screen broken" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("feature_unavailable");
    expect(s.mock.calls).toHaveLength(0);
  });
  it("AI off, helper off and no credits give the usual codes", async () => {
    expect((await post(await build(setup({ settings: { enabled: false } }), owner), "fault-note", { complaint: "screen broken" })).json().error.code).toBe("ai_off");
    expect((await post(await build(setup({ settings: { features: { "fault-note": false } } }), owner), "fault-note", { complaint: "screen broken" })).json().error.code).toBe("ai_feature_off");
    const none = await post(await build(setup({ remaining: 0 }), owner), "fault-note", { complaint: "screen broken" });
    expect(none.statusCode).toBe(402);
  });
  it("device label: the failing IMEI is not filled, the serial is; no serials module means no warranty lookup", async () => {
    const s = setup();
    const res = await post(await build(s, owner), "device-label", { ...photo, for: "jobcard" });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.draft.fill).toMatchObject({ serial: "R58M30ABCDE", imei1: GOOD, imei2: null });
    expect(b.draft.flags.some((f: { code: string }) => f.code === "imei_luhn_failed")).toBe(true);
    expect(b.warranty).toMatchObject({ found: false, state: "not_found" });
    const bad = await post(await build(setup(), owner), "device-label", { images: [{ mediaType: "image/jpeg", data: Buffer.from("<html>" + " ".repeat(100)).toString("base64") }] });
    expect(bad.json().error.code).toBe("ai_bad_image");
  });
  it("serial entry needs serials.manage, not jobcards.manage", async () => {
    const s = setup();
    const res = await post(await build(s, tech), "device-label", { ...photo, for: "serial" });
    expect(res.statusCode).toBe(403);
  });
  it("measurements: low confidence is shown but never in fill", async () => {
    const res = await post(await build(setup(), owner), "measurements", { ...photo, garment: "blouse" });
    expect(res.statusCode).toBe(200);
    const d = res.json().draft;
    expect(d.fill).toEqual({ bust: 36 });
    expect(d.rows.find((r: { key: string }) => r.key === "waist").autofill).toBe(false);
  });
  it("at-risk list is free to compute and needs a memberships or bookings manage permission", async () => {
    const s = setup();
    const ok = await (await build(s, as(["staff"], ["bookings.manage"]))).inject({ method: "GET", url: "/v1/ai/trades-c/at-risk" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().counts.total).toBe(0);
    const no = await (await build(s, as(["staff"], ["ai.use"]))).inject({ method: "GET", url: "/v1/ai/trades-c/at-risk" });
    expect(no.statusCode).toBe(403);
    expect(s.mock.calls).toHaveLength(0);
  });
  it("win-back for a person who is not on the list is a 404", async () => {
    const res = await post(await build(setup(), owner), "winback", { clientKey: "m:nope", language: "en" });
    expect(res.statusCode).toBe(404);
  });
});
