import { AppError, emptyContext, type RequestContext } from "@rbms/core";
import type { Db } from "@rbms/db";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createWhatsApp } from "./index";
import { whatsappRoutes, type WhatsAppRouteService } from "./routes";

const TENANT = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CAMP = "33333333-3333-4333-8333-333333333333";

function stubService() {
  const ok = (v: unknown = { ok: true }) => vi.fn(async () => v);
  return {
    verifyWebhook: vi.fn(async (_t: string, q: Record<string, unknown>) => {
      if (q["hub.verify_token"] !== "tok") throw new AppError(403, "forbidden", "no");
      return String(q["hub.challenge"]);
    }),
    handleWebhook: ok({ ok: true, messages: 1, statuses: 0 }),
    getAccount: ok({ configured: false }),
    putAccount: ok({ configured: true }),
    deleteAccount: ok(undefined),
    testAccount: ok({ ok: true }),
    settingsFor: ok({ ratePerMinute: 60 }),
    putSettings: ok({ ratePerMinute: 30 }),
    listConversations: ok({ items: [], total: 0, unreadTotal: 0 }),
    getConversation: ok({ id: CONV }),
    startConversation: ok({ id: CONV }),
    listMessages: ok({ items: [], nextCursor: null }),
    sendText: ok({ id: "m1", type: "text" }),
    sendMedia: ok({ id: "m2", type: "image" }),
    sendTemplate: ok({ id: "m3", type: "template" }),
    markRead: ok({ id: CONV, unreadCount: 0 }),
    assign: ok({ id: CONV }),
    setTags: ok({ id: CONV }),
    updateContact: ok({ id: CONV }),
    listTags: ok({ items: [] }),
    addNote: ok({ id: "n1" }),
    deleteNote: ok(undefined),
    listTemplates: ok({ items: [], total: 0 }),
    syncTemplates: ok({ items: [], created: 1 }),
    setTemplateMapping: ok({ id: "t" }),
    audienceSources: ok({ items: ["wa_contacts"] }),
    previewAudience: ok({ sendable: 3 }),
    listCampaigns: ok({ items: [], total: 0 }),
    getCampaign: ok({ id: CAMP }),
    createCampaign: ok({ id: CAMP }),
    updateCampaign: ok({ id: CAMP }),
    deleteCampaign: ok(undefined),
    startCampaign: ok({ id: CAMP, status: "running" }),
    cancelCampaign: ok({ id: CAMP, status: "cancelled" }),
    listRecipients: vi.fn(async () => ({ items: [{ phone: "+919876543210", name: "Ravi, K", status: "read", error: null, sentAt: null }], total: 1 })),
  };
}
type Stub = ReturnType<typeof stubService>;

async function build(service: Stub, ctx: Partial<RequestContext> = {}) {
  const seen: { url: string; feature: unknown; permission: unknown; audit: unknown }[] = [];
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.addHook("preHandler", async (req) => {
    const c = req.routeOptions.config;
    seen.push({ url: req.url, feature: c.feature, permission: c.permission ?? null, audit: c.audit });
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "invalid_input" } });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.status(status).send({ error: { code: "other" } });
  });
  await app.register(async (scoped) => whatsappRoutes(service as unknown as WhatsAppRouteService)(scoped), { prefix: "/v1/whatsapp" });
  return { app, seen };
}

const tenant = { id: TENANT, slug: "sri", planId: "pro", appId: "BL" };
const as = (roles: string[], permissions: string[] = []): Partial<RequestContext> => ({
  tenant,
  user: { id: "44444444-4444-4444-8444-444444444444", sessionId: "s", platformRoles: [], tenantRoles: roles, permissions },
});

describe("webhooks", () => {
  it("answers Meta's verification challenge as plain text", async () => {
    const { app } = await build(stubService());
    const res = await app.inject({ method: "GET", url: `/v1/whatsapp/webhooks/${TENANT}?hub.mode=subscribe&hub.verify_token=tok&hub.challenge=987654` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toBe("987654");
    const bad = await app.inject({ method: "GET", url: `/v1/whatsapp/webhooks/${TENANT}?hub.mode=subscribe&hub.verify_token=no&hub.challenge=1` });
    expect(bad.statusCode).toBe(403);
  });

  it("passes the exact raw bytes and the signature header to the service", async () => {
    const service = stubService();
    const { app } = await build(service);
    const payload = '{ "object":"whatsapp_business_account",  "entry": [] }';
    const res = await app.inject({
      method: "POST",
      url: `/v1/whatsapp/webhooks/${TENANT}`,
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=abc" },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const [t, raw, sig] = service.handleWebhook.mock.calls[0] as unknown as [string, Buffer, string];
    expect(t).toBe(TENANT);
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(raw.toString()).toBe(payload);
    expect(sig).toBe("sha256=abc");
  });

  it("rejects a non-uuid tenant", async () => {
    const { app } = await build(stubService());
    const res = await app.inject({ method: "POST", url: "/v1/whatsapp/webhooks/nope", headers: { "content-type": "application/json" }, payload: "{}" });
    expect(res.statusCode).toBe(400);
  });
});

describe("access", () => {
  it("needs a signed-in staff member with whatsapp.manage", async () => {
    expect((await (await build(stubService())).app.inject({ method: "GET", url: "/v1/whatsapp/conversations" })).statusCode).toBe(401);
    expect((await (await build(stubService(), as(["member"]))).app.inject({ method: "GET", url: "/v1/whatsapp/conversations" })).statusCode).toBe(403);
    const denied = await (await build(stubService(), as(["staff"]))).app.inject({ method: "GET", url: "/v1/whatsapp/conversations" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("permission_denied");
    expect((await (await build(stubService(), as(["staff"], ["whatsapp.*"]))).app.inject({ method: "GET", url: "/v1/whatsapp/conversations" })).statusCode).toBe(200);
  });

  it("account routes are owner/admin only", async () => {
    const staff = await build(stubService(), as(["staff"], ["whatsapp.manage"]));
    expect((await staff.app.inject({ method: "GET", url: "/v1/whatsapp/account" })).statusCode).toBe(403);
    const owner = await build(stubService(), as(["owner"]));
    expect((await owner.app.inject({ method: "PUT", url: "/v1/whatsapp/account", payload: { provider: "mock" } })).statusCode).toBe(200);
  });

  it("declares features, permission and audit on routes", async () => {
    const { app, seen } = await build(stubService(), as(["owner"]));
    await app.inject({ method: "GET", url: "/v1/whatsapp/conversations" });
    await app.inject({ method: "POST", url: `/v1/whatsapp/campaigns/${CAMP}/start`, payload: {} });
    await app.inject({ method: "POST", url: `/v1/whatsapp/conversations/${CONV}/messages`, payload: { body: "hi" } });
    expect(seen[0]).toMatchObject({ feature: "whatsapp", permission: "whatsapp.manage", audit: false });
    expect(seen[1]).toMatchObject({ feature: ["whatsapp", "whatsapp.campaigns"], permission: "whatsapp.manage", audit: { action: "whatsapp.campaign.start" } });
    expect(seen[2]).toMatchObject({ audit: false });
  });
});

describe("inbox routes", () => {
  const manager = as(["staff"], ["whatsapp.manage"]);

  it("dispatches sends by type", async () => {
    const service = stubService();
    const { app } = await build(service, manager);
    const url = `/v1/whatsapp/conversations/${CONV}/messages`;
    expect((await app.inject({ method: "POST", url, payload: { body: "Hello" } })).json()).toMatchObject({ type: "text" });
    expect((await app.inject({ method: "POST", url, payload: { type: "image", link: "https://x/y.jpg" } })).json()).toMatchObject({ type: "image" });
    expect((await app.inject({ method: "POST", url, payload: { type: "template", name: "payment_reminder" } })).json()).toMatchObject({ type: "template" });
    expect(service.sendText).toHaveBeenCalledWith(TENANT, CONV, { type: "text", body: "Hello" }, "44444444-4444-4444-8444-444444444444");
    expect((await app.inject({ method: "POST", url, payload: { type: "sticker" } })).statusCode).toBe(400);
  });

  it("lists, reads, assigns, tags and notes", async () => {
    const service = stubService();
    const { app } = await build(service, manager);
    expect((await app.inject({ method: "GET", url: "/v1/whatsapp/conversations?filter=unread" })).statusCode).toBe(200);
    expect(service.listConversations).toHaveBeenCalledWith(TENANT, { filter: "unread" }, "44444444-4444-4444-8444-444444444444");
    expect((await app.inject({ method: "POST", url: `/v1/whatsapp/conversations/${CONV}/read` })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/v1/whatsapp/conversations/${CONV}/assign`, payload: { assigneeId: null } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: `/v1/whatsapp/conversations/${CONV}/tags`, payload: { tags: ["vip"] } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/v1/whatsapp/conversations/${CONV}/notes`, payload: { body: "Called back" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/v1/whatsapp/notes/${CONV}` })).statusCode).toBe(200);
    expect(service.deleteNote).toHaveBeenCalledWith(TENANT, CONV, "44444444-4444-4444-8444-444444444444", false);
    expect((await app.inject({ method: "GET", url: "/v1/whatsapp/conversations/not-a-uuid" })).statusCode).toBe(404);
  });

  it("exports campaign recipients as CSV", async () => {
    const { app } = await build(stubService(), manager);
    const res = await app.inject({ method: "GET", url: `/v1/whatsapp/campaigns/${CAMP}/recipients?format=csv` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toContain('+919876543210,"Ravi, K",read');
  });
});

describe("createWhatsApp", () => {
  it("declares the module, features, permissions and queue jobs", () => {
    const define = vi.fn();
    const { module, service } = createWhatsApp({ db: {} as Db, secretKey: "k", queue: { define, enqueue: vi.fn() } });
    expect(module.id).toBe("whatsapp");
    expect(module.features?.map((f) => f.key)).toEqual(["whatsapp", "whatsapp.campaigns"]);
    expect(module.features?.[1]?.dependsOn).toEqual(["whatsapp"]);
    expect(module.permissions?.map((p) => p.key)).toEqual(["whatsapp.manage"]);
    expect(Object.keys(module.tables ?? {})).toHaveLength(7);
    expect(define.mock.calls.map((c) => c[0])).toEqual(["whatsapp.campaign.start", "whatsapp.campaign.batch"]);
    const events: unknown[] = [];
    const off = service.onEvent((e) => void events.push(e));
    service.events.emit({ type: "status", tenantId: TENANT, contactId: CONV, messageId: "m", status: "read", error: null });
    off();
    service.events.emit({ type: "status", tenantId: TENANT, contactId: CONV, messageId: "m", status: "read", error: null });
    expect(events).toHaveLength(1);
  });
});
