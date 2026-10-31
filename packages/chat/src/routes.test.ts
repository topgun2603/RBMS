import { AppError, emptyContext, type RequestContext } from "@rbms/core";
import type { Db } from "@rbms/db";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createChat } from "./index";
import type { Viewer } from "./logic";
import { chatRoutes, type ChatRouteService } from "./routes";
import { formatSseEvent, parseSse } from "./sse";
import { StreamTokens } from "./stream-token";

const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "EC" };
const shopperUser = { id: "33333333-3333-4333-8333-333333333333", sessionId: "s", platformRoles: [], tenantRoles: [] };
const managerUser = { id: "44444444-4444-4444-8444-444444444444", sessionId: "s", platformRoles: [], tenantRoles: ["staff"], permissions: ["chat.manage"] };
const convId = "22222222-2222-4222-8222-222222222222";
const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });

function stubService(tokens = new StreamTokens("s")) {
  const opened: { viewer: Viewer; lastEventId: string | null | undefined }[] = [];
  const closed = vi.fn();
  const service = {
    issueStreamToken: vi.fn((v: Viewer, t: typeof tenant) => tokens.issue(v, t)),
    redeemStreamToken: vi.fn(async (token: string) => {
      const p = await tokens.redeem(token);
      if (!p) throw new AppError(401, "unauthorized", "bad token");
      return p;
    }),
    assertFeature: vi.fn(async () => undefined),
    openStream: vi.fn(async (viewer: Viewer, write: (f: string) => void, lastEventId?: string | null) => {
      opened.push({ viewer, lastEventId });
      write(formatSseEvent({ event: "ready", data: { userId: viewer.userId } }));
      return { close: closed };
    }),
    listConversations: vi.fn(async () => ({ items: [], total: 0, unreadTotal: 0 })),
    getConversation: vi.fn(async () => ({ id: convId })),
    createConversation: vi.fn(async () => ({ conversation: { id: convId }, created: true })),
    setMuted: vi.fn(async () => ({ muted: true })),
    listMessages: vi.fn(async () => ({ items: [], nextCursor: null })),
    sendMessage: vi.fn(async () => ({ id: "m" })),
    editMessage: vi.fn(async () => ({ id: "m" })),
    deleteMessage: vi.fn(async () => ({ id: "m" })),
    markRead: vi.fn(async () => ({ conversationId: convId, readAt: "x" })),
    typing: vi.fn(async () => ({ ok: true, sent: true })),
  };
  return { service: service as unknown as ChatRouteService & typeof service, opened, closed };
}

async function build(reqCtx: RequestContext, svc = stubService()) {
  const seen: { url: string; feature: unknown; audit: unknown; permission: unknown }[] = [];
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req, reply) => {
    req.ctx = reqCtx;
    reply.header("access-control-allow-origin", "https://shop.example.com"); // what @fastify/cors does
  });
  app.addHook("preHandler", async (req) => {
    const c = req.routeOptions.config;
    seen.push({ url: req.url, feature: c.feature, audit: c.audit, permission: c.permission ?? null });
  });
  app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
    reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: true });
  });
  await app.register(chatRoutes(svc.service, { maxStreamMs: 30, heartbeatMs: 10 }), { prefix: "/v1/chat" });
  return { app, seen, ...svc };
}

describe("GET /stream", () => {
  it("hijacks the reply and writes SSE headers, a retry hint and the initial event", async () => {
    const { app, opened, closed } = await build(ctx({ tenant, user: managerUser }));
    const res = await app.inject({ url: "/v1/chat/stream", headers: { "last-event-id": "123_abc" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
    expect(res.headers["cache-control"]).toBe("no-cache, no-transform");
    expect(res.headers.connection).toBe("keep-alive");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    expect(res.headers["access-control-allow-origin"]).toBe("https://shop.example.com"); // CORS survives the hijack
    expect(res.body.startsWith("retry: 3000\n\n")).toBe(true);
    const events = parseSse(res.body);
    expect(events[0]).toEqual({ event: "message", data: "", retry: 3000 });
    expect(events[1]).toEqual({ event: "ready", data: JSON.stringify({ userId: managerUser.id }) });
    expect(res.body).toContain(": ping\n\n"); // heartbeat (10 ms here) before the 30 ms max lifetime ended it
    expect(opened).toEqual([{ viewer: { tenantId: tenant.id, userId: managerUser.id, isStaff: true, canManage: true }, lastEventId: "123_abc" }]);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("needs a session or a stream token", async () => {
    const { app, opened } = await build(ctx({ tenant }));
    expect((await app.inject({ url: "/v1/chat/stream" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/v1/chat/stream?token=not-a-real-token" })).statusCode).toBe(401);
    expect(opened).toHaveLength(0);
  });

  it("accepts a single-use stream token (no headers, no tenant) and checks the feature itself", async () => {
    const svc = stubService();
    const staff = await build(ctx({ tenant, user: shopperUser }), svc);
    const issued = await staff.app.inject({ method: "POST", url: "/v1/chat/stream-token" });
    expect(issued.statusCode).toBe(200);
    const { token, expiresAt } = issued.json() as { token: string; expiresAt: string };
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    // EventSource request: no Authorization, no x-tenant
    const anon = await build(ctx({}), svc);
    const res = await anon.app.inject({ url: `/v1/chat/stream?token=${encodeURIComponent(token)}&lastEventId=9_x` });
    expect(res.statusCode).toBe(200);
    expect(parseSse(res.body).map((e) => e.event)).toContain("ready");
    expect(svc.opened.at(-1)).toEqual({ viewer: { tenantId: tenant.id, userId: shopperUser.id, isStaff: false, canManage: false }, lastEventId: "9_x" });
    expect(svc.service.assertFeature).toHaveBeenCalledWith(tenant.id);
    // used once
    expect((await anon.app.inject({ url: `/v1/chat/stream?token=${encodeURIComponent(token)}` })).statusCode).toBe(401);

    // a token for another shop is refused when the request does carry a tenant
    const t2 = (await staff.app.inject({ method: "POST", url: "/v1/chat/stream-token" })).json() as { token: string };
    const elsewhere = await build(ctx({ tenant: { ...tenant, id: "99999999-9999-4999-8999-999999999999" } }), svc);
    expect((await elsewhere.app.inject({ url: `/v1/chat/stream?token=${encodeURIComponent(t2.token)}` })).statusCode).toBe(403);
  });

  it("writes an error event when the stream can't open", async () => {
    const svc = stubService();
    svc.service.openStream.mockRejectedValueOnce(new Error("db down"));
    const { app } = await build(ctx({ tenant, user: shopperUser }), svc);
    const res = await app.inject({ url: "/v1/chat/stream" });
    expect(res.statusCode).toBe(200);
    expect(parseSse(res.body).at(-1)?.event).toBe("error");
  });
});

describe("REST routes", () => {
  it("declare feature chat, no route permission and no audit; pass the viewer and inputs through", async () => {
    const { app, seen, service } = await build(ctx({ tenant, user: shopperUser }));
    const mid = "55555555-5555-4555-8555-555555555555";
    const cases: [string, string, unknown?][] = [
      ["GET", "/v1/chat/conversations?limit=5"],
      ["POST", "/v1/chat/conversations", { type: "support" }],
      ["GET", `/v1/chat/conversations/${convId}`],
      ["POST", `/v1/chat/conversations/${convId}/mute`, { muted: true }],
      ["GET", `/v1/chat/conversations/${convId}/messages?before=1_x`],
      ["POST", `/v1/chat/conversations/${convId}/messages`, { body: "hi" }],
      ["POST", `/v1/chat/conversations/${convId}/read`, {}],
      ["POST", `/v1/chat/conversations/${convId}/typing`, {}],
      ["PATCH", `/v1/chat/messages/${mid}`, { body: "edited" }],
      ["DELETE", `/v1/chat/messages/${mid}`],
      ["POST", "/v1/chat/stream-token", {}],
    ];
    for (const [method, url, payload] of cases) {
      seen.length = 0;
      const res = await app.inject({ method: method as "GET", url, ...(payload ? { payload: payload as object } : {}) });
      expect([method, url, res.statusCode]).toEqual([method, url, 200]);
      expect(seen[0]).toMatchObject({ feature: "chat", audit: false, permission: null });
    }
    const viewer = { tenantId: tenant.id, userId: shopperUser.id, isStaff: false, canManage: false };
    expect(service.listConversations).toHaveBeenCalledWith(viewer, { limit: "5" });
    expect(service.sendMessage).toHaveBeenCalledWith(viewer, convId, { body: "hi" });
    expect(service.listMessages).toHaveBeenCalledWith(viewer, convId, { before: "1_x" });
    expect(service.editMessage).toHaveBeenCalledWith(viewer, mid, { body: "edited" });
    expect((await app.inject({ method: "POST", url: "/v1/chat/conversations" , payload: { type: "support" } })).json()).toEqual({ id: convId, created: true });
  });

  it("401 without a user, 403 without a tenant, 400 on bad ids", async () => {
    expect((await (await build(ctx({ tenant }))).app.inject({ url: "/v1/chat/conversations" })).statusCode).toBe(401);
    expect((await (await build(ctx({ user: shopperUser }))).app.inject({ url: "/v1/chat/conversations" })).statusCode).toBe(403);
    const { app } = await build(ctx({ tenant, user: shopperUser }));
    expect((await app.inject({ method: "POST", url: "/v1/chat/conversations/nope/messages", payload: { body: "x" } })).statusCode).toBe(400);
  });
});

describe("createChat", () => {
  it("returns the service and the module with tables, feature and permission", () => {
    const { module, service } = createChat({ db: {} as Db });
    expect(module.id).toBe("chat");
    expect(Object.keys(module.tables ?? {}).sort()).toEqual(["chatConversations", "chatMessages", "chatParticipants"]);
    expect(module.features).toEqual([expect.objectContaining({ key: "chat", module: "chat" })]);
    expect(module.permissions).toEqual([expect.objectContaining({ key: "chat.manage", module: "chat" })]);
    expect(typeof module.start).toBe("function");
    expect(service.hub.connections).toBe(0);
  });

  it("send rate limit: 20 per minute per user, checked before touching the database", async () => {
    const { service } = createChat({ db: {} as Db });
    const v = { tenantId: tenant.id, userId: shopperUser.id, isStaff: false, canManage: false };
    // the fake db makes every allowed send fail after the limiter; the 21st is refused by the limiter itself
    for (let i = 0; i < 20; i++) await expect(service.sendMessage(v, convId, { body: "x" })).rejects.not.toMatchObject({ status: 429 });
    await expect(service.sendMessage(v, convId, { body: "x" })).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    await expect(service.sendMessage({ ...v, userId: managerUser.id }, convId, { body: "x" })).rejects.not.toMatchObject({ status: 429 });
  });
});
