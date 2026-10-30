import { emptyContext, type RequestContext } from "@rbms/core";
import { createDb } from "@rbms/db";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createSupport } from "./index";
import { supportRoutes } from "./routes";
import type { SupportService } from "./service";

// Never connects.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "EC" };
const shopper = { id: "33333333-3333-4333-8333-333333333333", sessionId: "s", platformRoles: [], tenantRoles: [] };
const staffUser = { id: "44444444-4444-4444-8444-444444444444", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"], permissions: ["support.manage"] };
const id = "22222222-2222-4222-8222-222222222222";
const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });

type Seen = { url: string; feature: unknown; permission: unknown; audit: unknown };

async function build(reqCtx: RequestContext) {
  const ok = (v: unknown = { id }) => vi.fn(async () => v);
  const service = {
    createPublicTicket: ok({ ticket: { id }, items: [] }),
    listOwn: ok({ items: [], total: 0 }),
    publicThread: ok({ ticket: { id }, items: [] }),
    replyAsRequester: ok({ ticket: { id }, items: [] }),
    faqIndex: ok({ items: [], total: 0 }),
    faqSearch: ok({ items: [], total: 0 }),
    faqArticle: ok({ article: { slug: "returns" }, category: null }),
    faqHelpful: ok({ helpfulYes: 1, helpfulNo: 0 }),
    list: ok({ items: [], total: 0, counts: { open: 0, pending: 0, resolved: 0, closed: 0 }, overdue: 0 }),
    createStaffTicket: ok(),
    get: ok({ ticket: { id }, messages: [] }),
    assign: ok(),
    setStatus: ok(),
    setPriority: ok(),
    setTags: ok(),
    addStaffMessage: ok(),
    merge: ok(),
    listCategories: ok({ items: [] }),
    createCategory: ok(),
    updateCategory: ok(),
    deleteCategory: ok(undefined),
    listArticles: ok({ items: [], total: 0 }),
    createArticle: ok(),
    getArticle: ok(),
    updateArticle: ok(),
    publishArticle: ok(),
    unpublishArticle: ok(),
    deleteArticle: ok(undefined),
  };
  const seen: Seen[] = [];
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = reqCtx;
  });
  app.addHook("preHandler", async (req) => {
    const c = req.routeOptions.config;
    seen.push({ url: req.url, feature: c.feature, permission: c.permission ?? null, audit: c.audit ?? null });
  });
  app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
    reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: true });
  });
  await app.register(supportRoutes(service as unknown as SupportService), { prefix: "/v1/support" });
  return { app, service, seen };
}

const P = "/v1/support";

describe("routes: features and permissions", () => {
  it("declares `support` on tickets, `support.faq` on FAQ, and `support.manage` on every staff route", async () => {
    const { app, seen } = await build(ctx({ tenant, user: { ...staffUser, tenantRoles: ["owner"] } }));
    const cases: [string, string, string, boolean][] = [
      ["POST", `${P}/public/tickets`, "support", false],
      ["GET", `${P}/public/tickets`, "support", false],
      ["GET", `${P}/public/tickets/${id}/messages`, "support", false],
      ["POST", `${P}/public/tickets/${id}/messages`, "support", false],
      ["GET", `${P}/public/faq`, "support.faq", false],
      ["GET", `${P}/public/faq/search?q=refund`, "support.faq", false],
      ["GET", `${P}/public/faq/returns`, "support.faq", false],
      ["POST", `${P}/public/faq/returns/helpful`, "support.faq", false],
      ["GET", `${P}/tickets`, "support", true],
      ["POST", `${P}/tickets`, "support", true],
      ["GET", `${P}/tickets/${id}`, "support", true],
      ["POST", `${P}/tickets/${id}/assign`, "support", true],
      ["POST", `${P}/tickets/${id}/status`, "support", true],
      ["POST", `${P}/tickets/${id}/priority`, "support", true],
      ["PUT", `${P}/tickets/${id}/tags`, "support", true],
      ["POST", `${P}/tickets/${id}/messages`, "support", true],
      ["POST", `${P}/tickets/${id}/merge`, "support", true],
      ["GET", `${P}/faq/categories`, "support.faq", true],
      ["POST", `${P}/faq/categories`, "support.faq", true],
      ["PATCH", `${P}/faq/categories/${id}`, "support.faq", true],
      ["DELETE", `${P}/faq/categories/${id}`, "support.faq", true],
      ["GET", `${P}/faq/articles`, "support.faq", true],
      ["POST", `${P}/faq/articles`, "support.faq", true],
      ["GET", `${P}/faq/articles/${id}`, "support.faq", true],
      ["PATCH", `${P}/faq/articles/${id}`, "support.faq", true],
      ["POST", `${P}/faq/articles/${id}/publish`, "support.faq", true],
      ["POST", `${P}/faq/articles/${id}/unpublish`, "support.faq", true],
      ["DELETE", `${P}/faq/articles/${id}`, "support.faq", true],
    ];
    for (const [method, url, feature, isStaff] of cases) {
      seen.length = 0;
      const res = await app.inject({ method: method as "GET", url, payload: ["POST", "PUT", "PATCH"].includes(method) ? {} : undefined });
      expect([method, url, res.statusCode]).toEqual([method, url, 200]);
      expect([url, seen[0]?.feature, seen[0]?.permission]).toEqual([url, feature, isStaff ? "support.manage" : null]);
      if (!isStaff) expect([url, seen[0]?.audit]).toEqual([url, false]);
    }
  }, 30_000);

  it("staff writes record audit actions", async () => {
    const { app, seen } = await build(ctx({ tenant, user: staffUser }));
    await app.inject({ method: "POST", url: `${P}/tickets/${id}/merge`, payload: { intoId: id } });
    expect(seen[0]?.audit).toEqual({ action: "support.ticket.merge", entity: "support_ticket", idParam: "id" });
    seen.length = 0;
    await app.inject({ method: "POST", url: `${P}/faq/articles/${id}/publish` });
    expect(seen[0]?.audit).toEqual({ action: "support.faq_article.publish", entity: "faq_article", idParam: "id" });
  });
});

describe("routes: requester auth", () => {
  it("ticket routes need a signed-in user or a guest token", async () => {
    const anon = await build(ctx({ tenant }));
    for (const [method, url] of [
      ["POST", `${P}/public/tickets`],
      ["GET", `${P}/public/tickets`],
      ["GET", `${P}/public/tickets/${id}/messages`],
      ["POST", `${P}/public/tickets/${id}/messages`],
    ] as const) {
      expect([url, (await anon.app.inject({ method, url, payload: method === "POST" ? {} : undefined })).statusCode]).toEqual([url, 401]);
    }
    expect(anon.service.createPublicTicket).not.toHaveBeenCalled();
    // Without a tenant: 403.
    const none = await build(ctx({}));
    expect((await none.app.inject({ url: `${P}/public/tickets`, headers: { "x-guest-token": "t" } })).statusCode).toBe(403);
  });

  it("passes the signed-in user, or the guest token, to the service", async () => {
    const user = await build(ctx({ tenant, user: shopper }));
    await user.app.inject({ method: "POST", url: `${P}/public/tickets`, payload: { subject: "Late", body: "Hi" } });
    expect(user.service.createPublicTicket).toHaveBeenCalledWith(tenant.id, { userId: shopper.id }, { subject: "Late", body: "Hi" });
    await user.app.inject({ url: `${P}/public/tickets?limit=5` });
    expect(user.service.listOwn).toHaveBeenCalledWith(tenant.id, { userId: shopper.id }, { limit: "5" });

    const guest = await build(ctx({ tenant }));
    const res = await guest.app.inject({ method: "POST", url: `${P}/public/tickets/${id}/messages`, headers: { "x-guest-token": " tok-123 " }, payload: { body: "Any update?" } });
    expect(res.statusCode).toBe(200);
    expect(guest.service.replyAsRequester).toHaveBeenCalledWith(tenant.id, { guestToken: "tok-123" }, id, { body: "Any update?" });
    expect((await guest.app.inject({ url: `${P}/public/tickets/not-a-uuid/messages`, headers: { "x-guest-token": "t" } })).statusCode).toBe(400);
  });

  it("FAQ reads need only a tenant", async () => {
    const { app, service } = await build(ctx({ tenant }));
    expect((await app.inject({ url: `${P}/public/faq/search?q=refund&limit=3` })).statusCode).toBe(200);
    expect(service.faqSearch).toHaveBeenCalledWith(tenant.id, { q: "refund", limit: "3" });
    await app.inject({ url: `${P}/public/faq/Returns` });
    expect(service.faqArticle).toHaveBeenCalledWith(tenant.id, "returns");
    await app.inject({ method: "POST", url: `${P}/public/faq/returns/helpful`, payload: { helpful: true } });
    expect(service.faqHelpful).toHaveBeenCalledWith(tenant.id, "returns", { helpful: true });
    expect(service.faqArticle).not.toHaveBeenCalledWith(tenant.id, "search");
  });
});

describe("routes: staff", () => {
  it("shoppers and staff without support.manage are refused", async () => {
    const asShopper = await build(ctx({ tenant, user: shopper }));
    expect((await asShopper.app.inject({ url: `${P}/tickets` })).statusCode).toBe(403);
    const without = await build(ctx({ tenant, user: { ...staffUser, permissions: ["orders.manage"] } }));
    const denied = await without.app.inject({ method: "POST", url: `${P}/tickets/${id}/messages`, payload: { kind: "note", body: "x" } });
    expect(denied.statusCode).toBe(403);
    expect(without.service.addStaffMessage).not.toHaveBeenCalled();
    const anon = await build(ctx({ tenant }));
    expect((await anon.app.inject({ url: `${P}/tickets` })).statusCode).toBe(401);
  });

  it("passes the viewer and author through; replies and notes share one route", async () => {
    const { app, service } = await build(ctx({ tenant, user: staffUser }));
    await app.inject({ url: `${P}/tickets?status=open,pending&assignee=me` });
    expect(service.list).toHaveBeenCalledWith(tenant.id, { status: "open,pending", assignee: "me" }, staffUser.id);
    await app.inject({ method: "POST", url: `${P}/tickets/${id}/messages`, payload: { kind: "note", body: "Call courier" } });
    expect(service.addStaffMessage).toHaveBeenCalledWith(tenant.id, id, staffUser.id, { kind: "note", body: "Call courier" });
    await app.inject({ method: "POST", url: `${P}/tickets/${id}/assign`, payload: { assigneeId: null } });
    expect(service.assign).toHaveBeenCalledWith(tenant.id, id, { assigneeId: null }, staffUser.id);
    expect((await app.inject({ method: "DELETE", url: `${P}/faq/articles/${id}` })).json()).toEqual({ ok: true });
  });

  it("exports CSV with format=csv", async () => {
    const { app, service } = await build(ctx({ tenant, user: staffUser }));
    (service.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      items: [
        {
          id,
          number: "TKT-0001",
          subject: "Late",
          status: "open",
          priority: "high",
          channel: "web",
          requester: { userId: null, name: "Priya", phone: "+919876543210", email: null },
          assigneeId: null,
          tags: ["delivery"],
          related: null,
          firstResponseAt: null,
          resolvedAt: null,
          closedAt: null,
          slaDueAt: null,
          overdue: false,
          slaBreached: false,
          mergedIntoId: null,
          lastMessageAt: new Date(0),
          createdAt: new Date("2026-10-15T00:00:00Z"),
          updatedAt: new Date(0),
        },
      ],
      total: 1,
      counts: {},
      overdue: 0,
    });
    const res = await app.inject({ url: `${P}/tickets?format=csv&from=2026-10-01&to=2026-10-31` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="tickets-2026-10-01-2026-10-31.csv"');
    expect(res.body).toContain("TKT-0001,2026-10-15 05:30,Late,open,high");
    expect(service.list).toHaveBeenCalledWith(tenant.id, { from: "2026-10-01", to: "2026-10-31", limit: 500, offset: 0 }, staffUser.id);
  });
});

describe("createSupport", () => {
  it("returns the service and the module with tables, features and permission", () => {
    const { module } = createSupport({ db });
    expect(module.id).toBe("support");
    expect(Object.keys(module.tables ?? {}).sort()).toEqual(["faqArticles", "faqCategories", "supportMessages", "supportTicketSeries", "supportTickets"]);
    expect(module.features).toEqual([
      expect.objectContaining({ key: "support", module: "support", shopToggle: true }),
      expect.objectContaining({ key: "support.faq", module: "support", shopToggle: true, dependsOn: ["support"] }),
    ]);
    expect(module.permissions).toEqual([expect.objectContaining({ key: "support.manage", module: "support" })]);
  });

  it("resolves requesters without the database", async () => {
    const guestVerifier = { verify: vi.fn(async (_t: string, token: string) => (token === "good" ? { phone: "98765 43210", name: " Priya " } : null)) };
    const { service } = createSupport({ db, guestVerifier });
    expect(await service.resolveRequester(tenant.id, { userId: shopper.id })).toEqual({ kind: "user", userId: shopper.id });
    expect(await service.resolveRequester(tenant.id, { guestToken: "good" })).toEqual({ kind: "guest", phone: "+919876543210", name: "Priya" });
    expect(guestVerifier.verify).toHaveBeenCalledWith(tenant.id, "good");
    await expect(service.resolveRequester(tenant.id, { guestToken: "bad" })).rejects.toMatchObject({ status: 401 });
    await expect(service.resolveRequester(tenant.id, null)).rejects.toMatchObject({ status: 401 });

    const noGuests = createSupport({ db, guestVerifier, settings: { get: async () => ({ allowGuests: false }) } });
    await expect(noGuests.service.resolveRequester(tenant.id, { guestToken: "good" })).rejects.toMatchObject({ status: 403 });
    // No verifier → guests can't raise tickets.
    await expect(createSupport({ db }).service.resolveRequester(tenant.id, { guestToken: "good" })).rejects.toMatchObject({ status: 401 });
  });

  it("validates input before touching the database", async () => {
    const { service } = createSupport({ db });
    await expect(service.createPublicTicket(tenant.id, { userId: shopper.id }, { subject: "x", body: "" })).rejects.toBeInstanceOf(ZodError);
    await expect(service.addStaffMessage(tenant.id, id, staffUser.id, { kind: "secret" as never, body: "x" })).rejects.toBeInstanceOf(ZodError);
    await expect(service.merge(tenant.id, id, { intoId: id })).rejects.toMatchObject({ status: 400 });
    expect(await service.faqSearch(tenant.id, { q: "  " })).toEqual({ items: [], total: 0 });
  });

  it("settings fall back to defaults when the port fails", async () => {
    const { service } = createSupport({ db, settings: { get: async () => Promise.reject(new Error("down")) } });
    expect((await service.settings(tenant.id)).firstResponseHours).toEqual({ low: 72, normal: 24, high: 8, urgent: 2 });
  });
});
