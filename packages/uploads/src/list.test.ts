import Fastify from "fastify";
import { emptyContext, type RequestContext } from "@srirealtime/core";
import { describe, expect, it, vi } from "vitest";
import { byteRange, uploadsRoutes } from "./routes";
import { DEFAULT_MAX_BYTES, DEFAULT_VIDEO_MAX_BYTES, UploadsService, decodeCursor, encodeCursor, likeEscape } from "./service";
import type { StorageAdapter } from "./storage/types";

const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "anbu", planId: "pro", appId: "EC" };
const userWith = (tenantRoles: string[]) => ({ id: "22222222-2222-4222-8222-222222222222", sessionId: "s", platformRoles: [], tenantRoles });

async function build(ctx: Partial<RequestContext>) {
  const page = vi.fn(async () => ({ items: [], nextCursor: null }));
  const service = { storage: { driver: "s3" }, maxBytes: 16, page } as unknown as UploadsService;
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx } as RequestContext;
  });
  app.setErrorHandler((err: Error & { status?: number }, _req, reply) => reply.code(err.status ?? (err.name === "ZodError" ? 400 : 500)).send({ message: err.message }));
  await app.register(async (scoped) => uploadsRoutes(service)(scoped), { prefix: "/v1/uploads" });
  return { app, page };
}

describe("GET /v1/uploads (media library list)", () => {
  it("passes the filters through for staff", async () => {
    const { app, page } = await build({ tenant, user: userWith(["staff"]) });
    const res = await app.inject({ method: "GET", url: "/v1/uploads?kind=image&visibility=public&q=saree&limit=24&purpose=site&cursor=abc" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
    expect(page).toHaveBeenCalledWith({ tenantId: tenant.id, kind: "image", visibility: "public", q: "saree", limit: 24, offset: 0, purpose: "site", cursor: "abc" });
  });

  it("refuses signed-in customers (member role) and anonymous callers", async () => {
    const member = await build({ tenant, user: userWith(["member"]) });
    expect((await member.app.inject({ method: "GET", url: "/v1/uploads" })).statusCode).toBe(403);
    const anon = await build({ tenant });
    expect((await anon.app.inject({ method: "GET", url: "/v1/uploads" })).statusCode).toBe(401);
    expect(member.page).not.toHaveBeenCalled();
  });

  it("needs a tenant", async () => {
    const { app } = await build({ user: userWith(["owner"]) });
    expect((await app.inject({ method: "GET", url: "/v1/uploads" })).statusCode).toBe(403);
  });

  it("rejects unknown kinds and oversized pages", async () => {
    const { app, page } = await build({ tenant, user: userWith(["owner"]) });
    expect((await app.inject({ method: "GET", url: "/v1/uploads?kind=pdf" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/uploads?limit=500" })).statusCode).toBe(400);
    expect(page).not.toHaveBeenCalled();
  });
});

describe("cursors", () => {
  it("round-trips created-at and id", () => {
    const row = { createdAt: new Date("2026-10-19T03:41:06.145Z"), id: "c017fe20-4b2b-403f-a4fc-bac30c6d349a" };
    expect(decodeCursor(encodeCursor(row))).toEqual(row);
  });

  it("rejects garbage", () => {
    expect(decodeCursor("abc")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-01-01T00:00:00Z|not-a-uuid").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("nope|c017fe20-4b2b-403f-a4fc-bac30c6d349a").toString("base64url"))).toBeNull();
  });

  it("an invalid cursor is a 400, not a full scan", async () => {
    const service = new UploadsService({} as never, { storage: {} as StorageAdapter });
    await expect(service.page({ tenantId: tenant.id, cursor: "zzz" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("likeEscape", () => {
  it("escapes LIKE wildcards", () => {
    expect(likeEscape("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("video size limit", () => {
  function service(config: { maxBytes?: number; videoMaxBytes?: number } = {}) {
    const db = { insert: () => ({ values: async () => undefined }) };
    const storage = { presignPut: async () => ({ url: "http://x/put", headers: {} }) } as unknown as StorageAdapter;
    return new UploadsService(db as never, { storage, ...config });
  }

  it("lets a 40 MB mp4 / webm through but not a 40 MB image", async () => {
    const s = service();
    const size = 40 * 1024 * 1024;
    await expect(s.sign({ tenantId: tenant.id, userId: null, filename: "shop.mp4", contentType: "video/mp4", size })).resolves.toMatchObject({ upload: { method: "PUT" } });
    await expect(s.sign({ tenantId: tenant.id, userId: null, filename: "shop.webm", contentType: "video/webm", size })).resolves.toBeTruthy();
    await expect(s.sign({ tenantId: tenant.id, userId: null, filename: "big.jpg", contentType: "image/jpeg", size })).rejects.toMatchObject({ status: 400 });
    await expect(s.sign({ tenantId: tenant.id, userId: null, filename: "huge.mp4", contentType: "video/mp4", size: DEFAULT_VIDEO_MAX_BYTES + 1 })).rejects.toMatchObject({ status: 400 });
  });

  it("uses the video limit as the body limit, never below the file limit", () => {
    expect(service().maxBytes).toBe(DEFAULT_VIDEO_MAX_BYTES);
    expect(service().limitFor("image/png")).toBe(DEFAULT_MAX_BYTES);
    expect(service({ maxBytes: 80 * 1024 * 1024 }).limitFor("video/mp4")).toBe(80 * 1024 * 1024);
  });
});

describe("byteRange", () => {
  it("parses single ranges", () => {
    expect(byteRange(undefined, 100)).toBeNull();
    expect(byteRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(byteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(byteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("flags unsatisfiable ranges and ignores multi-ranges", () => {
    expect(byteRange("bytes=100-", 100)).toBe("invalid");
    expect(byteRange("bytes=20-10", 100)).toBe("invalid");
    expect(byteRange("bytes=0-1,5-6", 100)).toBeNull();
  });
});
