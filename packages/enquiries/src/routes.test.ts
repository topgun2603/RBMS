import { emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { enquiriesRoutes } from "./routes";
import type { EnquiriesService } from "./service";

const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "thamarai", planId: "pro", appId: "SV" };
const staffUser = { id: "44444444-4444-4444-8444-444444444444", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"], permissions: ["enquiries.manage"] };
const id = "22222222-2222-4222-8222-222222222222";
const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });

async function build(reqCtx: RequestContext) {
  const ok = (v: unknown = { id }) => vi.fn(async () => v);
  const service = {
    submit: ok({ ok: true, number: "ENQ-0001" }),
    list: ok({ items: [], total: 0, limit: 25, offset: 0, facets: { status: {} }, topics: [] }),
    get: ok(),
    update: ok(),
    remove: ok(undefined),
    summary: ok({ open: 0, today: 0, last7Days: 0, converted30Days: 0 }),
  };
  const seen: { feature: unknown; permission: unknown; audit: unknown }[] = [];
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = reqCtx;
  });
  app.addHook("preHandler", async (req) => {
    const c = req.routeOptions.config;
    seen.push({ feature: c.feature, permission: c.permission ?? null, audit: c.audit ?? null });
  });
  app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
    reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: true });
  });
  await app.register(enquiriesRoutes(service as unknown as EnquiriesService), { prefix: "/v1/enquiries" });
  return { app, service, seen };
}

const P = "/v1/enquiries";

describe("enquiries routes", () => {
  it("the website form needs only a shop, no audit entry, and passes the IP for the limiter", async () => {
    const { app, service, seen } = await build(ctx({ tenant, ip: "203.0.113.9" }));
    const res = await app.inject({ method: "POST", url: `${P}/public`, payload: { name: "Meena", phone: "9876543210" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, number: "ENQ-0001" });
    expect(seen[0]).toEqual({ feature: "enquiries", permission: null, audit: false });
    expect(service.submit).toHaveBeenCalledWith(tenant.id, { name: "Meena", phone: "9876543210" }, { ip: "203.0.113.9" });
    // No shop on the host: refused.
    const none = await build(ctx({}));
    expect((await none.app.inject({ method: "POST", url: `${P}/public`, payload: {} })).statusCode).toBe(403);
  });

  it("every staff route needs feature `enquiries` and `enquiries.manage`", async () => {
    const { app, seen } = await build(ctx({ tenant, user: staffUser }));
    const cases: [string, string][] = [
      ["GET", `${P}/enquiries?status=new`],
      ["GET", `${P}/enquiries/${id}`],
      ["PATCH", `${P}/enquiries/${id}`],
      ["DELETE", `${P}/enquiries/${id}`],
      ["GET", `${P}/summary`],
    ];
    for (const [method, url] of cases) {
      seen.length = 0;
      const res = await app.inject({ method: method as "GET", url, payload: method === "PATCH" ? { status: "contacted" } : undefined });
      expect([method, url, res.statusCode]).toEqual([method, url, 200]);
      expect([url, seen[0]?.feature, seen[0]?.permission]).toEqual([url, "enquiries", "enquiries.manage"]);
    }
  });

  it("shoppers (no shop role) and anonymous visitors can't read enquiries", async () => {
    const shopper = { id: "33333333-3333-4333-8333-333333333333", sessionId: "s", platformRoles: [], tenantRoles: [] };
    for (const c of [ctx({ tenant }), ctx({ tenant, user: shopper })]) {
      const { app, service } = await build(c);
      const res = await app.inject({ url: `${P}/enquiries` });
      expect([401, 403]).toContain(res.statusCode);
      expect(service.list).not.toHaveBeenCalled();
    }
  });
});
