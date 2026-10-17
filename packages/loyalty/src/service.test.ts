import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { membersCsv } from "./csv";
import { createLoyaltyHooks, LOYALTY_EVENT_WIRING } from "./hooks";
import { createLoyalty } from "./index";
import { LOYALTY_SETTINGS_DEFAULTS } from "./logic";
import { loyaltyRoutes } from "./routes";
import {
  adjustInputSchema,
  dueMembersStatement,
  earnInputSchema,
  lockMemberStatement,
  LoyaltyService,
  memberListQuerySchema,
  memberSort,
  openLotsStatement,
  summaryStatement,
  redeemInputSchema,
} from "./service";

// Never connects: only used to render SQL (and any accidental query fails fast).
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const U = "33333333-3333-4333-8333-333333333333";

describe("module", () => {
  it("declares the feature, permission and tables", () => {
    const { module, hooks } = createLoyalty({ db });
    expect(module.id).toBe("loyalty");
    expect(module.features).toEqual([expect.objectContaining({ key: "loyalty", module: "loyalty", shopToggle: true })]);
    expect(module.permissions).toEqual([expect.objectContaining({ key: "loyalty.manage", module: "loyalty" })]);
    expect(Object.keys(module.tables ?? {})).toEqual(["loyaltyMembers", "loyaltyLedger"]);
    expect(Object.keys(hooks).sort()).toEqual(["invoiceCancelled", "invoicePaid", "orderCancelled", "orderCompleted"]);
    expect(LOYALTY_EVENT_WIRING.map((w) => w.hook)).toContain("orderCancelled");
  });
});

describe("validation", () => {
  it("normalises the member key to +91 and needs a ref", () => {
    expect(earnInputSchema.parse({ memberKey: "098765 43210", amount: 10_000, refType: "invoice", refId: "inv-1" }).memberKey).toBe("+919876543210");
    expect(() => earnInputSchema.parse({ memberKey: "12345", amount: 1, refType: "invoice", refId: "x" })).toThrow(ZodError);
    expect(() => earnInputSchema.parse({ memberKey: "9876543210", amount: 1.5, refType: "invoice", refId: "x" })).toThrow(ZodError);
    expect(() => earnInputSchema.parse({ memberKey: "9876543210", amount: 1, refType: "manual", refId: "x" })).toThrow(ZodError);
    expect(() => redeemInputSchema.parse({ memberKey: "9876543210", points: 0, refType: "order", refId: "o" })).toThrow(ZodError);
  });
  it("adjustments need non-zero points and a reason", () => {
    expect(() => adjustInputSchema.parse({ points: 0, reason: "goodwill" })).toThrow(ZodError);
    expect(() => adjustInputSchema.parse({ points: 10, reason: "" })).toThrow(ZodError);
    expect(adjustInputSchema.parse({ points: -10, reason: "  wrong bill " })).toEqual({ points: -10, reason: "wrong bill" });
  });
});

describe("SQL", () => {
  it("locks the member row by tenant and key", () => {
    const { sql, params } = lockMemberStatement(db, T, "+919876543210").toSQL();
    expect(sql).toContain('from "loyalty_members"');
    expect(sql).toContain('"loyalty_members"."tenant_id" = $1');
    expect(sql.trim().endsWith("for update")).toBe(true);
    expect(params).toEqual([T, "+919876543210"]);
  });
  it("locks only open lots of the member", () => {
    const { sql, params } = openLotsStatement(db, T, M).toSQL();
    expect(sql).toContain('"loyalty_ledger"."remaining" > $3');
    expect(sql).toContain("for update");
    expect(params).toEqual([T, M, 0]);
  });
  it("finds members with due lots, skipping switched-off shops", () => {
    const now = new Date("2026-11-01T00:05:00Z");
    const { sql, params } = dueMembersStatement(db, now, ["t-off"], 200).toSQL();
    expect(sql).toContain("select distinct");
    expect(sql).toContain('"loyalty_ledger"."expires_at" <= $2');
    expect(sql).toContain("not in");
    expect(params).toEqual(expect.arrayContaining([0, "t-off", 200]));
  });
  it("searches members by name or phone digits", () => {
    const svc = new LoyaltyService({ db });
    const byPhone = db.select().from(createLoyaltyTables().members).where(svc.listConditions(T, memberListQuerySchema.parse({ q: "+91 98765" }))).toSQL();
    expect(byPhone.params).toEqual([T, "%+91 98765%", "%9198765%"]);
    expect("+919876543210".includes("9198765")).toBe(true);
    const byName = db.select().from(createLoyaltyTables().members).where(svc.listConditions(T, memberListQuerySchema.parse({ q: "Meena", tier: "Gold" }))).toSQL();
    expect(byName.params).toEqual([T, "Gold", "%Meena%"]);
    const leadingZero = db.select().from(createLoyaltyTables().members).where(svc.listConditions(T, memberListQuerySchema.parse({ q: "098765" }))).toSQL();
    expect(leadingZero.params).toContain("%98765%");
  });
  it("takes tier comma lists; the tier facet ignores the tier filter", () => {
    const svc = new LoyaltyService({ db });
    const p = memberListQuerySchema.parse({ tier: "Gold,Silver", q: "Meena" });
    expect(p).toMatchObject({ tier: ["Gold", "Silver"], limit: 50, offset: 0 });
    const members = createLoyaltyTables().members;
    const withTier = db.select().from(members).where(svc.listConditions(T, p)).toSQL();
    expect(withTier.sql).toContain('"loyalty_members"."tier" in ($2, $3)');
    expect(withTier.params).toEqual([T, "Gold", "Silver", "%Meena%"]);
    const facet = db.select().from(members).where(svc.listConditions(T, p, false)).toSQL();
    expect(facet.params).toEqual([T, "%Meena%"]);
    expect(memberListQuerySchema.parse({ limit: "500" }).limit).toBe(500);
    expect(() => memberListQuerySchema.parse({ limit: "501" })).toThrow(ZodError);
  });
  it("sorts by whitelisted fields; tier by rank, last activity falling back to the join date", () => {
    const members = createLoyaltyTables().members;
    const tiers = [
      { name: "Gold", minSpend: 5_000_000 },
      { name: "Silver", minSpend: 0 },
    ];
    const render = (s?: string, t = tiers) => db.select().from(members).orderBy(...memberSort(t).orderBy(s)).toSQL();
    expect(render().sql).toContain('order by coalesce("loyalty_members"."last_activity_at", "loyalty_members"."joined_at") desc nulls last, "loyalty_members"."id" desc');
    expect(render("-points").sql).toContain('order by "loyalty_members"."points_balance" desc nulls last');
    expect(render("spend").sql).toContain('order by "loyalty_members"."lifetime_spend" asc nulls last');
    const byTier = render("-tier");
    expect(byTier.sql).toContain('(case "loyalty_members"."tier" when $1 then 0 when $2 then 1 else 2 end) desc nulls last');
    expect(byTier.params).toEqual(["Silver", "Gold"]);
    expect(render("tier", []).sql).toContain('lower("loyalty_members"."tier") asc');
    expect(memberSort().keys).toEqual(["points", "tier", "spend", "lastActivity", "name", "joined"]);
    expect(() => render("recent")).toThrow(AppError);
  });
  it("sums points over the whole shop", () => {
    const { sql, params } = summaryStatement(db, T).toSQL();
    expect(sql).toContain('coalesce(sum("points_balance"), 0) from "loyalty_members"');
    expect(sql).toContain("count(*)");
    expect(params).toEqual([T]);
  });
});

function createLoyaltyTables() {
  return { members: (createLoyalty({ db }).module.tables as Record<string, never>)["loyaltyMembers"]! };
}

describe("settings", () => {
  it("uses defaults without a port and refuses updates", async () => {
    const svc = new LoyaltyService({ db });
    expect(await svc.getSettings(T)).toEqual(LOYALTY_SETTINGS_DEFAULTS);
    await expect(svc.updateSettings(T, { earnPer100: 2 })).rejects.toMatchObject({ status: 400 });
  });
  it("validates the patch and the merged result before storing", async () => {
    const set = vi.fn(async () => ({}));
    const svc = new LoyaltyService({ db, settings: { get: async () => ({ maxRedeemPercent: 30 }), set } });
    expect(await svc.updateSettings(T, { earnPer100: 2 })).toEqual({ ...LOYALTY_SETTINGS_DEFAULTS, maxRedeemPercent: 30, earnPer100: 2 });
    expect(set).toHaveBeenCalledWith(T, { earnPer100: 2 });
    await expect(svc.updateSettings(T, { bogus: 1 })).rejects.toBeInstanceOf(ZodError);
    await expect(svc.updateSettings(T, { tiers: [{ name: "Gold", minSpend: 5, multiplier: 2 }] })).rejects.toBeInstanceOf(ZodError);
    expect(set).toHaveBeenCalledTimes(1);
  });
});

describe("CSV", () => {
  it("exports members with rupees and IST dates, phones kept as text", () => {
    const csv = membersCsv([
      {
        memberKey: "+919876543210",
        name: "Meena, R",
        tier: "Gold",
        pointsBalance: 420,
        pointsValue: 42_000,
        lifetimeSpend: 2_600_050,
        joinedAt: new Date("2026-10-15T06:00:00Z"),
        lastActivityAt: null,
      },
    ]);
    expect(csv.startsWith("﻿Mobile,Name,Tier,Points")).toBe(true);
    expect(csv).toContain(`'+919876543210,"Meena, R",Gold,420,420.00,26000.50,2026-10-15 11:30,\r\n`);
  });
});

describe("hooks", () => {
  const service = () => ({
    earn: vi.fn(async () => ({ created: true, entryId: "e", points: 5, balance: 5, memberId: M, tier: "Silver" })),
    reverse: vi.fn(async () => ({ reversed: true, entryId: "r", points: -5, earnReversed: 5, restored: 0, shortfall: 0, balance: 0 })),
  });
  it("earns on paid bills and completed orders with a normalised phone", async () => {
    const s = service();
    const hooks = createLoyaltyHooks({ service: s });
    await hooks.invoicePaid(T, { id: "inv-1", amount: 50_000, customerPhone: "98765 43210", customerName: "Meena" });
    expect(s.earn).toHaveBeenCalledWith(T, { memberKey: "+919876543210", name: "Meena", amount: 50_000, refType: "invoice", refId: "inv-1" });
    await hooks.orderCompleted(T, { id: "ord-1", amount: 20_000, customerPhone: "+91 98765 43210" });
    expect(s.earn).toHaveBeenLastCalledWith(T, expect.objectContaining({ refType: "order", refId: "ord-1", name: null }));
  });
  it("skips walk-ins without a mobile, zero amounts and shops with loyalty off", async () => {
    const s = service();
    const off = createLoyaltyHooks({ service: s, featureGate: { isEnabled: async () => false } });
    expect(await off.invoicePaid(T, { id: "i", amount: 100, customerPhone: "9876543210" })).toBeNull();
    const on = createLoyaltyHooks({ service: s });
    expect(await on.invoicePaid(T, { id: "i", amount: 100, customerPhone: null })).toBeNull();
    expect(await on.invoicePaid(T, { id: "i", amount: 100, customerPhone: "044 2345 6789" })).toBeNull();
    expect(await on.invoicePaid(T, { id: "i", amount: 0, customerPhone: "9876543210" })).toBeNull();
    expect(s.earn).not.toHaveBeenCalled();
  });
  it("reverses even with the feature off, and never throws", async () => {
    const s = service();
    const error = vi.fn();
    const hooks = createLoyaltyHooks({ service: s, featureGate: { isEnabled: async () => false }, log: { info() {}, warn() {}, error } });
    await hooks.orderCancelled(T, "ord-1");
    await hooks.invoiceCancelled(T, "inv-1");
    expect(s.reverse.mock.calls).toEqual([
      [T, "order", "ord-1"],
      [T, "invoice", "inv-1"],
    ]);
    s.earn.mockRejectedValueOnce(new Error("db down"));
    const on = createLoyaltyHooks({ service: s, log: { info() {}, warn() {}, error } });
    expect(await on.orderCompleted(T, { id: "o", amount: 100, customerPhone: "9876543210" })).toBeNull();
    expect(error).toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ routes

const tenant = { id: T, slug: "raja", planId: "pro", appId: "BL" };
const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });
const staffUser = { id: U, sessionId: "s", platformRoles: [], tenantRoles: ["staff"], permissions: ["loyalty.manage"] };
const cashier = { ...staffUser, permissions: ["invoices.*"] };
const shopper = { id: "shopper-1", sessionId: "s", platformRoles: [], tenantRoles: [], permissions: [] };

async function build(reqCtx: RequestContext) {
  const service = {
    me: vi.fn(async () => ({ enrolled: false })),
    quote: vi.fn(async () => ({ maxPoints: 0 })),
    shopperKey: vi.fn(async () => "+919876543210"),
    list: vi.fn(async () => ({ items: [], total: 0 })),
    summary: vi.fn(async () => ({ members: 0, points: 0, liability: 0 })),
    exportCsv: vi.fn(async () => "﻿Mobile\r\n"),
    get: vi.fn(async () => ({ member: { id: M } })),
    adjust: vi.fn(async () => ({ member: { id: M }, entry: { points: 50, note: "Goodwill" } })),
    getSettings: vi.fn(async () => LOYALTY_SETTINGS_DEFAULTS),
    updateSettings: vi.fn(async () => LOYALTY_SETTINGS_DEFAULTS),
  } as unknown as LoyaltyService & Record<string, ReturnType<typeof vi.fn>>;
  const configs: unknown[] = [];
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = reqCtx;
  });
  app.addHook("preHandler", async (req) => {
    configs.push(req.routeOptions.config);
  });
  app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
    const code = (err as { code?: unknown }).code;
    reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: typeof code === "string" ? code : true });
  });
  await app.register(loyaltyRoutes(service), { prefix: "/v1/loyalty" });
  return { app, service, configs };
}

describe("routes", () => {
  it("GET /me needs a signed-in shopper and returns their points", async () => {
    expect((await (await build(ctx({ tenant }))).app.inject({ url: "/v1/loyalty/me" })).statusCode).toBe(401);
    const { app, service } = await build(ctx({ tenant, user: shopper }));
    expect((await app.inject({ url: "/v1/loyalty/me" })).statusCode).toBe(200);
    expect(service.me).toHaveBeenCalledWith(T, "shopper-1");
  });

  it("POST /quote: staff quote any phone, shoppers only their own", async () => {
    const staff = await build(ctx({ tenant, user: cashier }));
    expect((await staff.app.inject({ method: "POST", url: "/v1/loyalty/quote", payload: { phone: "9876500000", amount: 100_000 } })).statusCode).toBe(200);
    expect(staff.service.quote).toHaveBeenCalledWith(T, "9876500000", 100_000);
    expect((await staff.app.inject({ method: "POST", url: "/v1/loyalty/quote", payload: { amount: 100_000 } })).statusCode).toBe(400);

    const shop = await build(ctx({ tenant, user: shopper }));
    await shop.app.inject({ method: "POST", url: "/v1/loyalty/quote", payload: { phone: "9876500000", amount: 5_000 } });
    expect(shop.service.quote).toHaveBeenCalledWith(T, "+919876543210", 5_000);
    expect((await shop.app.inject({ method: "POST", url: "/v1/loyalty/quote", payload: { amount: 1.5 } })).statusCode).toBe(400);
  });

  it("staff routes need loyalty.manage", async () => {
    expect((await (await build(ctx({ tenant, user: shopper }))).app.inject({ url: "/v1/loyalty/members" })).statusCode).toBe(403);
    const res = await (await build(ctx({ tenant, user: cashier }))).app.inject({ url: "/v1/loyalty/members" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "permission_denied" });
    const owner = { ...shopper, tenantRoles: ["owner"] };
    expect((await (await build(ctx({ tenant, user: owner }))).app.inject({ url: "/v1/loyalty/members" })).statusCode).toBe(200);
  });

  it("wires members, CSV, detail, adjust and settings with the loyalty feature", async () => {
    const { app, service, configs } = await build(ctx({ tenant, user: staffUser }));
    await app.inject({ url: "/v1/loyalty/members?q=meena&tier=Gold" });
    expect(service.list).toHaveBeenCalledWith(T, { q: "meena", tier: "Gold" });
    const csv = await app.inject({ url: "/v1/loyalty/members?format=csv&q=meena" });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toBe('attachment; filename="loyalty-members.csv"');
    expect(service.exportCsv).toHaveBeenCalledWith(T, { q: "meena" });
    expect((await app.inject({ url: "/v1/loyalty/summary" })).json()).toEqual({ members: 0, points: 0, liability: 0 });
    expect(service.summary).toHaveBeenCalledWith(T);
    await app.inject({ url: `/v1/loyalty/members/${M}?limit=10` });
    expect(service.get).toHaveBeenCalledWith(T, M, { limit: "10" });
    const adj = await app.inject({ method: "POST", url: `/v1/loyalty/members/${M}/adjust`, payload: { points: 50, reason: "Goodwill" } });
    expect(adj.statusCode).toBe(200);
    expect(service.adjust).toHaveBeenCalledWith(T, M, { points: 50, reason: "Goodwill" }, U);
    await app.inject({ url: "/v1/loyalty/settings" });
    await app.inject({ method: "PUT", url: "/v1/loyalty/settings", payload: { earnPer100: 2 } });
    expect(service.updateSettings).toHaveBeenCalledWith(T, { earnPer100: 2 });
    const all = configs as { feature?: string; permission?: string; audit?: unknown }[];
    expect(new Set(all.map((c) => c.feature))).toEqual(new Set(["loyalty"]));
    const writes = all.filter((c) => c.permission);
    expect(writes.map((c) => c.audit)).toEqual([
      { action: "loyalty.adjust", entity: "loyalty_member", idParam: "id" },
      { action: "loyalty.settings", entity: "settings" },
    ]);
    expect((await app.inject({ url: "/v1/loyalty/members/not-a-uuid" })).statusCode).toBe(404);
  });
});
