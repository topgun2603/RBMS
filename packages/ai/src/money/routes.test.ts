import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { kit, T } from "../assist/test-kit";
import { RateLimiter } from "../assist/routes";
import { addDays } from "./dates";
import { PackStore, packView } from "./packs";
import { moneyRoutes, type MoneyPorts } from "./routes";
import type { RiskBill } from "./risk";
import type { LoanPackInput } from "./loanpack";

const tenant = { id: T, slug: "kumar", planId: "bl-starter", appId: "BL" };
const as = (roles: string[], permissions: string[]): Partial<RequestContext> => ({
  tenant,
  user: { id: "u1", sessionId: "s", platformRoles: [], tenantRoles: roles, permissions } as RequestContext["user"],
});
const owner = as(["owner"], ["*"]);
const manager = as(["staff"], ["invoices.credit-book", "reports.view", "ai.use"]);
const viewer = as(["staff"], ["invoices.credit-book", "reports.view"]);
const demo: Partial<RequestContext> = { tenant, user: { id: "d", sessionId: "s", platformRoles: ["demo"], tenantRoles: ["staff", "role:demo"], permissions: ["*.view", "invoices.credit-book"] } as RequestContext["user"] };
const CUST = "44444444-4444-4444-8444-444444444444";
const TODAY = "2026-10-26";

const bills = (): RiskBill[] =>
  Array.from({ length: 6 }, (_, i) => {
    const date = addDays(TODAY, -(6 - i) * 30 + 5);
    const dueDate = addDays(date, 15);
    return { id: `b${i}`, date, dueDate, total: 500_000, credited: 0, payments: [{ date: dueDate, amount: 500_000 }] };
  });

const loan: LoanPackInput & { shopName: string } = {
  today: TODAY,
  shopName: "Kumar Stores",
  months: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, sales: 1_000_000, taxable: 900_000, bills: 50, gstOutput: 100_000, purchasesTaxable: 600_000, gstr1Filed: true })),
  customers: [{ name: "Murugan Mess", total: 3_000_000, bills: 20 }],
  receivables: { buckets: [{ key: "current", amount: 100_000, count: 1 }], total: 100_000, customers: 1 },
  payables: { total: 50_000, overdue: 0 },
  stockValue: 1_000_000,
  averageBalance: null,
  averageDailyCollections: 30_000,
  showNames: false,
};

function ports(): MoneyPorts {
  return {
    today: () => TODAY,
    now: () => new Date("2026-10-26T05:00:00Z"),
    aiSettings: vi.fn(async () => ({ enabled: true, features: {}, maskGstin: false, storePrompts: false })),
    risk: {
      all: vi.fn(async () => [{ customerId: CUST, name: "Murugan Mess", input: { today: TODAY, bills: bills(), creditLimit: 2_000_000 } }]),
      one: vi.fn(async (_t, id) => (id === CUST ? { customerId: CUST, name: "Murugan Mess", input: { today: TODAY, bills: bills(), creditLimit: 2_000_000 } } : null)),
    },
    cashflow: {
      data: vi.fn(async () => ({ today: TODAY, receipts: { [addDays(TODAY, -1)]: 100_000 }, firstSaleDate: addDays(TODAY, -30), opening: { amount: 500_000, source: "entered" as const, asOf: TODAY }, threshold: 0, dues: [], payables: [], expenses: [], pos: [] })),
      settings: vi.fn(async () => ({ openingBalance: 500_000, asOf: TODAY, asOfAt: null, minBalance: 0 })),
      saveSettings: vi.fn(async () => undefined),
    },
    loan: vi.fn(async () => loan),
    reco2b: vi.fn(async (_t, month) => ({ month, imported: true, rows: [{ group: "missing_in_2b" as const, supplier: "Sri Traders", number: "ST-1", tax: 90_000, date: "2026-09-30" }], totals: { missing_in_2b: { count: 1, tax: 90_000 } } })),
    pdf: vi.fn(async () => ({ pdf: Buffer.from("%PDF-1.4 test"), filename: "loan-pack.pdf" })),
  };
}

// An in-memory PackStore (the real one is covered with the database in the API tests).
function memoryPacks() {
  const rows = new Map<string, import("./schema").AiMoneyPackRow>();
  const s = new PackStore({} as never, () => new Date("2026-10-26T05:00:00Z"));
  s.create = vi.fn(async (tenantId, v) => {
    const row = { id: "55555555-5555-4555-8555-555555555555", tenantId, kind: "loan-pack", facts: v.facts, cover: v.cover, showNames: v.showNames, shopName: v.shopName, credits: v.credits, createdBy: v.userId, shareToken: null, shareExpiresAt: null, sharedAt: null, revokedAt: null, createdAt: new Date(), updatedAt: new Date() } as import("./schema").AiMoneyPackRow;
    rows.set(row.id, row);
    return row;
  });
  s.get = vi.fn(async (t, id) => (rows.get(id)?.tenantId === t ? rows.get(id)! : null));
  s.list = vi.fn(async () => [...rows.values()]);
  s.share = vi.fn(async (t, id, days) => {
    const r = rows.get(id);
    if (!r || r.tenantId !== t) return null;
    r.shareToken = "tok_abcdefghijklmnopqrstuvwxyz0123";
    r.shareExpiresAt = new Date(new Date("2026-10-26T05:00:00Z").getTime() + days * 86_400_000);
    r.revokedAt = null;
    return r;
  });
  s.revoke = vi.fn(async (t, id) => {
    const r = rows.get(id);
    if (!r || r.tenantId !== t) return null;
    r.shareToken = null;
    r.revokedAt = new Date();
    return r;
  });
  s.byToken = vi.fn(async (token) => [...rows.values()].find((r) => r.shareToken === token && !r.revokedAt && r.shareExpiresAt && r.shareExpiresAt > new Date("2026-10-26T05:00:00Z")) ?? null);
  return { s, rows };
}

async function build(ctx: Partial<RequestContext>, k = kit(), p = ports()) {
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    return reply.status(500).send({ error: { code: "other", message: String(err) } });
  });
  const packs = memoryPacks();
  await app.register(async (a) => moneyRoutes({ ai: k.service, packs: packs.s, ports: p, limiter: new RateLimiter(), riskTtlMs: 0 })(a), { prefix: "/v1/ai/money" });
  return { app, k, p, packs };
}
const get = (app: Awaited<ReturnType<typeof build>>["app"], url: string) => app.inject({ method: "GET", url: `/v1/ai/money${url}` });
const post = (app: Awaited<ReturnType<typeof build>>["app"], url: string, payload: unknown = {}) => app.inject({ method: "POST", url: `/v1/ai/money${url}`, payload: payload as object });

describe("money routes: permissions", () => {
  it("credit risk needs the credit book permission", async () => {
    expect((await get((await build({})).app, "/credit-risk")).statusCode).toBe(401);
    expect((await get((await build(as(["staff"], ["reports.view"]))).app, "/credit-risk")).statusCode).toBe(403);
    const ok = await get((await build(viewer)).app, "/credit-risk");
    expect(ok.statusCode).toBe(200);
    expect(ok.json().items[0]).toMatchObject({ customerId: CUST, band: "A" });
    expect((await get((await build(viewer)).app, `/credit-risk/${CUST}`)).json()).toMatchObject({ band: "A", enough: true });
    expect((await get((await build(viewer)).app, "/credit-risk/44444444-4444-4444-8444-444444444445")).statusCode).toBe(404);
  }, 30_000);
  it("cash flow needs reports.view", async () => {
    expect((await get((await build(as(["staff"], ["invoices.credit-book"]))).app, "/cashflow")).statusCode).toBe(403);
    expect((await get((await build(viewer)).app, "/cashflow")).statusCode).toBe(200);
  });
  it("the loan pack is for owners and admins only", async () => {
    for (const ctx of [manager, viewer, as(["staff"], ["*"]), demo]) {
      const { app } = await build(ctx);
      expect((await get(app, "/loan-pack/consent")).statusCode).toBe(403);
      expect((await post(app, "/loan-pack", { consent: true })).statusCode).toBe(403);
      expect((await get(app, "/loan-pack")).statusCode).toBe(403);
    }
    expect((await get((await build(as(["admin"], []))).app, "/loan-pack/consent")).statusCode).toBe(200);
    expect((await get((await build(owner)).app, "/loan-pack/consent")).json().sections).toHaveLength(8);
  }, 30_000);
  it("settings can be saved by the owner only", async () => {
    expect((await app_put(await build(manager))).statusCode).toBe(403);
    const { app, p } = await build(owner);
    const r = await app.inject({ method: "PUT", url: "/v1/ai/money/cashflow/settings", payload: { openingBalance: 1_200_000, minBalance: 200_000 } });
    expect(r.statusCode).toBe(200);
    expect(p.cashflow.saveSettings).toHaveBeenCalledWith(T, { openingBalance: 1_200_000, asOf: TODAY, asOfAt: "2026-10-26T05:00:00.000Z", minBalance: 200_000 });
  });
});
const app_put = (b: Awaited<ReturnType<typeof build>>) => b.app.inject({ method: "PUT", url: "/v1/ai/money/cashflow/settings", payload: { openingBalance: 1, minBalance: 0 } });

describe("money routes: credits and AI off", () => {
  it("a person without ai.use gets the template and spends nothing; the demo role cannot spend anywhere", async () => {
    const v = await build(viewer);
    const r = await post(v.app, "/cashflow/explain", { lang: "ta" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ source: "template", credits: 0 });
    expect(r.json().explanation).toMatch(/[஀-௿]/);
    expect((await post(v.app, `/credit-risk/${CUST}/explain`, {})).json()).toMatchObject({ source: "template", credits: 0 });
    expect((await post(v.app, "/gst-2b/2026-09/explain", {})).json().groups[0]).toMatchObject({ source: "template" });
    expect(v.k.spent()).toBe(0);
    const d = await build(demo);
    for (const [method, url] of [["POST", "/cashflow/explain"], ["POST", "/loan-pack"], ["POST", `/credit-risk/${CUST}/explain`], ["POST", "/gst-2b/2026-09/explain"]]) {
      const res = await d.app.inject({ method: method as "POST", url: `/v1/ai/money${url}`, payload: { consent: true } });
      // Either refused outright or answered with the template: never a charge.
      expect([200, 403]).toContain(res.statusCode);
    }
    expect(d.k.spent()).toBe(0);
  }, 30_000);
  it("a manager with ai.use spends credits on the explanation; AI off or no credits still shows the template", async () => {
    const m = await build(manager);
    const ok = await post(m.app, "/cashflow/explain", { lang: "en" });
    expect(ok.statusCode).toBe(200);
    expect(m.k.spent()).toBeGreaterThan(0);
    for (const k of [kit({ settings: { enabled: false } }), kit({ remaining: 0 }), kit({ settings: { features: { "cashflow-forecast": false } } })]) {
      const r = await post((await build(manager, k)).app, "/cashflow/explain", { lang: "en" });
      if (r.statusCode === 403) expect(r.json().error.code).toBe("ai_feature_off");
      else expect(r.json()).toMatchObject({ source: "template", credits: 0 });
    }
  }, 30_000);
  it("the helper switch hides credit risk entirely", async () => {
    const p = ports();
    p.aiSettings = vi.fn(async () => ({ enabled: true, features: { "credit-risk": false }, maskGstin: false, storePrompts: false }));
    const { app } = await build(viewer, kit(), p);
    expect((await get(app, "/credit-risk")).json().error.code).toBe("ai_feature_off");
    expect((await get(app, `/credit-risk/${CUST}`)).statusCode).toBe(403);
  });
  it("credit risk scores cost no credits", async () => {
    const { app, k } = await build(manager);
    await get(app, "/credit-risk");
    await get(app, `/credit-risk/${CUST}`);
    expect(k.spent()).toBe(0);
  });
  it("2B explanation needs an imported month", async () => {
    const p = ports();
    p.reco2b = vi.fn(async () => null);
    expect((await post((await build(viewer, kit(), p)).app, "/gst-2b/2026-09/explain", {})).json().error.code).toBe("gstr2b_not_imported");
    expect((await post((await build(viewer)).app, "/gst-2b/2026-13/explain", {})).statusCode).toBe(400);
  });
});

describe("loan pack flow", () => {
  it("consent is required; the pack masks names, links expire and can be revoked, and nothing is sent anywhere", async () => {
    const { app, packs, p } = await build(owner);
    expect((await post(app, "/loan-pack", {})).statusCode).toBe(400);
    expect((await post(app, "/loan-pack", { consent: false })).statusCode).toBe(400);
    const made = await post(app, "/loan-pack", { consent: true, lang: "en" });
    expect(made.statusCode).toBe(200);
    const pack = made.json();
    expect(p.loan).toHaveBeenCalledWith(T, { showNames: false });
    expect(pack.facts.concentration.top[0].label).toBe("Customer 1");
    expect(JSON.stringify(pack)).not.toMatch(/Murugan/);
    expect(pack.cover.en).toMatch(/not a credit decision/);
    expect(pack.share.active).toBe(false);
    const shared = await post(app, `/loan-pack/${pack.id}/share`, { days: 3 });
    expect(shared.statusCode).toBe(200);
    expect(shared.json().path).toMatch(/^\/v1\/ai\/money\/public\/loan-pack\/tok_/);
    expect(new Date(shared.json().expiresAt).getTime() - new Date("2026-10-26T05:00:00Z").getTime()).toBe(3 * 86_400_000);
    // The public link needs no sign-in.
    const anon = await (await build({})).app.inject({ method: "GET", url: "/v1/ai/money/public/loan-pack/tok_abcdefghijklmnopqrstuvwxyz0123.pdf" });
    expect(anon.statusCode).toBe(404); // no sign-in needed to ask; another store has no such link
    const link = await app.inject({ method: "GET", url: shared.json().path });
    expect(link.statusCode).toBe(200);
    expect(link.headers["content-type"]).toBe("application/pdf");
    expect(link.headers["x-robots-tag"]).toBe("noindex");
    expect(link.body).toContain("%PDF");
    // Revoked: the link stops working.
    expect((await app.inject({ method: "DELETE", url: `/v1/ai/money/loan-pack/${pack.id}/share` })).statusCode).toBe(200);
    const dead = await app.inject({ method: "GET", url: shared.json().path });
    expect(dead.statusCode).toBe(404);
    expect(dead.json().error.code).toBe("link_expired");
    expect(packs.s.revoke).toHaveBeenCalled();
  });
  it("an expired link is refused", async () => {
    const { app, packs } = await build(owner);
    const pack = (await post(app, "/loan-pack", { consent: true })).json();
    const shared = (await post(app, `/loan-pack/${pack.id}/share`, { days: 1 })).json();
    packs.rows.get(pack.id)!.shareExpiresAt = new Date("2026-10-25T00:00:00Z");
    expect((await app.inject({ method: "GET", url: shared.path })).statusCode).toBe(404);
    expect(packView(packs.rows.get(pack.id)!, new Date("2026-10-26T05:00:00Z")).share.active).toBe(false);
  });
  it("the share days are bounded", async () => {
    const { app } = await build(owner);
    const pack = (await post(app, "/loan-pack", { consent: true })).json();
    expect((await post(app, `/loan-pack/${pack.id}/share`, { days: 90 })).statusCode).toBe(400);
  });
});
