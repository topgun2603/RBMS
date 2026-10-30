import { AppError, emptyContext, type RequestContext } from "@rbms/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { kit } from "../assist/test-kit";
import { WindowLimiter } from "../store/common";
import { AI_FEATURE_REGISTRY } from "../features";
import { counterRoutes } from "./routes";
import type { CounterService } from "./service";
import { COUNTER_REGISTRY } from "./registry";
import { index } from "./fixture";
import { CounterService as RealService } from "./service";

const T = "11111111-1111-4111-8111-111111111111";
const tenant = { id: T, slug: "kumar", planId: "bl-starter", appId: "BL" };
const as = (roles: string[], permissions: string[]): Partial<RequestContext> => ({
  tenant,
  user: { id: "u1", sessionId: "s", platformRoles: [], tenantRoles: roles, permissions } as RequestContext["user"],
});
const owner = as(["owner"], ["*"]);
const manager = as(["staff"], ["*.view", "reports.*", "invoices.*", "ai.use", "pos.*"]);
const cashier = as(["staff"], ["invoices.create", "invoices.credit-note", "pos.till", "payments.receive"]);
const cashierAi = as(["staff"], ["invoices.create", "pos.till", "ai.use"]);
const plainStaff = as(["staff"], ["*.view", "invoices.create", "ai.use"]);
const teamLead = as(["staff"], ["staff.manage"]);
const demo: Partial<RequestContext> = { tenant, user: { id: "d", sessionId: "s", platformRoles: ["demo"], tenantRoles: ["staff", "role:demo"], permissions: ["*.view", "invoices.credit-book"] } as RequestContext["user"] };

const fakeService = () =>
  ({
    voice: vi.fn(async () => ({ lines: [], ignored: [] })),
    noSale: vi.fn(async () => ({ recorded: true })),
    alerts: vi.fn(async () => ({ alerts: [], open: 0 })),
    drill: vi.fn(async () => []),
    review: vi.fn(async () => ({ reviewed: null })),
    coaching: vi.fn(async () => ({ people: [] })),
    generateCoaching: vi.fn(async () => ({ people: [] })),
    shifts: vi.fn(async () => ({ plan: {} })),
    settings: vi.fn(async () => ({})),
    saveSettings: vi.fn(async () => ({})),
  }) as unknown as CounterService & Record<string, ReturnType<typeof vi.fn>>;

async function build(ctx: Partial<RequestContext>, service = fakeService()) {
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    return reply.status(500).send({ error: { code: "other", message: String(err) } });
  });
  await app.register(async (a) => counterRoutes({ counter: service, limiter: new WindowLimiter() })(a), { prefix: "/v1/ai/counter" });
  return { app, service };
}
const code = async (ctx: Partial<RequestContext>, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => (await (await build(ctx)).app.inject({ method, url: `/v1/ai/counter${url}`, payload: payload as object })).statusCode;
const SAID = { transcript: "ரெண்டு கிலோ அரிசி" };
const ALERT_URLS: ["GET" | "POST" | "PUT", string, unknown?][] = [
  ["GET", "/alerts"],
  ["GET", `/alerts/drill?kind=voids&staff=u1&date=2026-10-24`],
  ["POST", "/alerts/review", { key: "voids:u1:2026-10-24" }],
  ["GET", "/coaching"],
  ["POST", "/coaching/generate", { lang: "ta" }],
  ["GET", "/shifts"],
  ["GET", "/settings"],
  ["PUT", "/settings", { billsPerStaffHour: 8 }],
];

describe("voice billing permissions", () => {
  it("needs a signed-in member, the POS billing permission and ai.use", { timeout: 30_000 }, async () => {
    expect(await code({}, "POST", "/voice/parse", SAID)).toBe(401);
    expect(await code(cashier, "POST", "/voice/parse", SAID)).toBe(403); // no ai.use
    expect(await code(as(["staff"], ["ai.use"]), "POST", "/voice/parse", SAID)).toBe(403); // no invoices.create
    expect(await code(cashierAi, "POST", "/voice/parse", SAID)).toBe(200);
    expect(await code(owner, "POST", "/voice/parse", SAID)).toBe(200);
    expect(await code(manager, "POST", "/voice/parse", SAID)).toBe(200);
  });
  it("the read-only demo role is refused, so it never spends", async () => {
    const { app, service } = await build(demo);
    expect((await app.inject({ method: "POST", url: "/v1/ai/counter/voice/parse", payload: SAID })).statusCode).toBe(403);
    expect(service.voice).not.toHaveBeenCalled();
  });
  it("validates the transcript", async () => {
    expect(await code(owner, "POST", "/voice/parse", {})).toBe(400);
    expect(await code(owner, "POST", "/voice/parse", { transcript: "" })).toBe(400);
    expect(await code(owner, "POST", "/voice/parse", { transcript: "x".repeat(5000) })).toBe(400);
  });
  it("a no-sale drawer press may be logged by the till holder", async () => {
    expect(await code(cashier, "POST", "/voice/no-sale", {})).toBe(200);
    expect(await code(as(["staff"], ["reports.view"]), "POST", "/voice/no-sale", {})).toBe(403);
    expect(await code(demo, "POST", "/voice/no-sale", {})).toBe(403);
  });
});

describe("alerts, coaching and shifts are for the owner and managers only", () => {
  it.each(ALERT_URLS)("%s %s", async (method, url, body) => {
    expect(await code(owner, method, url, body)).toBe(200);
    expect(await code(manager, method, url, body)).toBe(200);
    expect(await code(teamLead, method, url, body === undefined ? undefined : body)).toBeLessThan(500);
    if (url !== "/coaching/generate") expect(await code(teamLead, method, url, body)).toBe(200);
    // never visible to the cashier being measured, a plain staff member or the demo role
    expect(await code(cashier, method, url, body), "cashier").toBe(403);
    expect(await code(cashierAi, method, url, body), "cashier with ai.use").toBe(403);
    expect(await code(plainStaff, method, url, body), "plain staff").toBe(403);
    expect(await code(demo, method, url, body), "demo").toBe(403);
    expect(await code({}, method, url, body), "signed out").toBe(401);
  });
  it("generating notes also needs ai.use because it spends credits", async () => {
    expect(await code(teamLead, "POST", "/coaching/generate", { lang: "en" })).toBe(403);
    expect(await code(as(["staff"], ["reports.manage"]), "POST", "/coaching/generate", { lang: "en" })).toBe(403);
    expect(await code(as(["staff"], ["reports.manage", "ai.use"]), "POST", "/coaching/generate", { lang: "en" })).toBe(200);
  });
  it("checks the query and body", async () => {
    expect(await code(owner, "GET", "/alerts?days=99")).toBe(400);
    expect(await code(owner, "GET", "/alerts/drill?kind=nonsense&staff=u1&date=2026-10-24")).toBe(400);
    expect(await code(owner, "POST", "/alerts/review", { key: "x" })).toBe(400);
    expect(await code(owner, "PUT", "/settings", { billsPerStaffHour: 0 })).toBe(400);
    expect(await code(owner, "GET", "/shifts?week=later")).toBe(400);
  });
});

describe("registry and switches", () => {
  it("lists the four helpers once, with en and ta text", () => {
    expect(COUNTER_REGISTRY.map((f) => f.key)).toEqual(["voice-billing", "activity-alerts", "staff-coaching", "shift-planning"]);
    for (const f of COUNTER_REGISTRY) {
      expect(AI_FEATURE_REGISTRY.filter((x) => x.key === f.key)).toHaveLength(1);
      expect(f.status).toBe("live");
      expect(f.optIn).toBeUndefined();
      expect(/[஀-௿]/.test(f.labelTa) && /[஀-௿]/.test(f.descriptionTa)).toBe(true);
    }
  });
  it("each helper has its own switch (alerts and shifts answer ai_feature_off when switched off)", async () => {
    const k = kit({ settings: { features: { "activity-alerts": false, "shift-planning": false } } });
    const svc = new RealService({
      db: {} as never,
      ai: k.service,
      ports: { catalogue: async () => index(), facts: vi.fn(), drill: vi.fn(), week: vi.fn(), hours: vi.fn(), settings: async () => ({}), saveSettings: async () => undefined } as never,
      today: () => "2026-10-24",
    });
    await expect(svc.alerts(T)).rejects.toMatchObject({ code: "ai_feature_off" });
    await expect(svc.shifts(T)).rejects.toMatchObject({ code: "ai_feature_off" });
    const off = kit({ settings: { enabled: false } });
    const svc2 = new RealService({ db: {} as never, ai: off.service, ports: {} as never, today: () => "2026-10-24" });
    await expect(svc2.alerts(T)).rejects.toMatchObject({ code: "ai_off" });
    // and alerts / shifts never spend a credit
    expect(k.spent()).toBe(0);
  });
});
