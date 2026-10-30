import Fastify from "fastify";
import { emptyContext } from "@rbms/core";
import { describe, expect, it, vi } from "vitest";
import { uploadsRoutes } from "./routes";
import type { UploadsService } from "./service";

function stubService() {
  return {
    storage: { driver: "local" },
    maxBytes: 16,
    localUploadHandler: vi.fn(async () => undefined),
    localFileHandler: vi.fn(async () => ({ body: Buffer.from("PNGDATA"), contentType: "image/png", downloadName: "a.png" })),
  } as unknown as UploadsService & { localUploadHandler: ReturnType<typeof vi.fn>; localFileHandler: ReturnType<typeof vi.fn> };
}

async function build(service: UploadsService) {
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = emptyContext();
  });
  await app.register(async (scoped) => uploadsRoutes(service)(scoped), { prefix: "/v1/uploads" });
  return app;
}

describe("local driver routes", () => {
  it("buffers any content type and decodes the key", async () => {
    const service = stubService();
    const app = await build(service);
    const key = "t/x/misc/2026/01/id-a.json";
    const res = await app.inject({
      method: "PUT",
      url: `/v1/uploads/local/${encodeURIComponent(key)}?exp=1&sig=abc`,
      headers: { "content-type": "application/json" },
      payload: '{"a":1}',
    });
    expect(res.statusCode).toBe(200);
    const [k, q, body] = service.localUploadHandler.mock.calls[0]!;
    expect(k).toBe(key);
    expect(q).toEqual({ exp: "1", sig: "abc" });
    expect(Buffer.isBuffer(body) && body.toString()).toBe('{"a":1}');
  });

  it("enforces the body limit", async () => {
    const app = await build(stubService());
    const res = await app.inject({
      method: "PUT",
      url: "/v1/uploads/local/t%2Fa.png?exp=1&sig=x",
      headers: { "content-type": "image/png" },
      payload: Buffer.alloc(32),
    });
    expect(res.statusCode).toBe(413);
  });

  it("serves files with their content type", async () => {
    const service = stubService();
    const app = await build(service);
    const res = await app.inject({ method: "GET", url: "/v1/uploads/files/t/x/a.png" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-disposition"]).toContain('filename="a.png"');
    expect(res.body).toBe("PNGDATA");
    expect(service.localFileHandler.mock.calls[0]![0]).toBe("t/x/a.png");
  });

  it("answers byte ranges with 206 (video seeking)", async () => {
    const app = await build(stubService());
    const res = await app.inject({ method: "GET", url: "/v1/uploads/files/t/x/a.png", headers: { range: "bytes=3-5" } });
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 3-5/7");
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.body).toBe("DAT");
    const bad = await app.inject({ method: "GET", url: "/v1/uploads/files/t/x/a.png", headers: { range: "bytes=50-" } });
    expect(bad.statusCode).toBe(416);
  });

  it("does not register local routes for other drivers", async () => {
    const service = stubService();
    (service.storage as { driver: string }).driver = "s3";
    const app = await build(service);
    const res = await app.inject({ method: "PUT", url: "/v1/uploads/local/t%2Fa.png", payload: "x", headers: { "content-type": "text/plain" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("shop membership", () => {
  const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "anbu", planId: null, appId: null };
  const fileId = "22222222-2222-4222-8222-222222222222";
  type Who = { roles?: string[]; platformRoles?: string[]; userId?: string } | null;

  async function buildAs(who: Who, file: { visibility: "public" | "private"; ownerUserId: string }, isUploader = false) {
    const service = {
      storage: { driver: "s3" },
      maxBytes: 16,
      sign: vi.fn(async () => ({ fileId })),
      complete: vi.fn(async () => ({ id: fileId })),
      get: vi.fn(async () => ({ id: fileId, ...file })),
      remove: vi.fn(async () => undefined),
    } as unknown as UploadsService & { sign: ReturnType<typeof vi.fn> };
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.setErrorHandler((err: { status?: number }, _req, reply) => reply.code(err.status ?? 500).send({ error: String(err) }));
    app.addHook("onRequest", async (req) => {
      req.ctx = emptyContext();
      req.ctx.tenant = tenant;
      if (who) req.ctx.user = { id: who.userId ?? "u-1", sessionId: "s1", platformRoles: who.platformRoles ?? [], tenantRoles: who.roles ?? [] };
    });
    const access = { isUploader: vi.fn(async () => isUploader) };
    await app.register(async (scoped) => uploadsRoutes(service, access)(scoped), { prefix: "/v1/uploads" });
    return { app, service };
  }
  const sign = (app: Awaited<ReturnType<typeof buildAs>>["app"]) =>
    app.inject({ method: "POST", url: "/v1/uploads/sign", payload: { filename: "a.png", contentType: "image/png", size: 10 } });
  const complete = (app: Awaited<ReturnType<typeof buildAs>>["app"]) => app.inject({ method: "POST", url: `/v1/uploads/${fileId}/complete` });
  const read = (app: Awaited<ReturnType<typeof buildAs>>["app"]) => app.inject({ method: "GET", url: `/v1/uploads/${fileId}` });
  const priv = { visibility: "private" as const, ownerUserId: "owner-9" };
  const pub = { visibility: "public" as const, ownerUserId: "owner-9" };

  it("a signed-in non-member can't sign or complete uploads for the shop", async () => {
    const { app, service } = await buildAs({ roles: [] }, priv);
    expect((await sign(app)).statusCode).toBe(403);
    expect((await complete(app)).statusCode).toBe(403);
    expect(service.sign).not.toHaveBeenCalled();
  });

  it("members, the shop's sellers and super-admins can", async () => {
    expect((await sign((await buildAs({ roles: ["staff"] }, priv)).app)).statusCode).toBe(200);
    expect((await complete((await buildAs({ roles: ["staff"] }, priv)).app)).statusCode).toBe(200);
    expect((await sign((await buildAs({ roles: [] }, priv, true)).app)).statusCode).toBe(200);
    expect((await sign((await buildAs({ platformRoles: ["superadmin"] }, priv)).app)).statusCode).toBe(200);
  });

  it("non-members read public files only; private ones need membership (or being the uploader)", async () => {
    expect((await read((await buildAs({ roles: [] }, priv)).app)).statusCode).toBe(403);
    expect((await read((await buildAs(null, priv)).app)).statusCode).toBe(401);
    expect((await read((await buildAs({ roles: [] }, pub)).app)).statusCode).toBe(200);
    expect((await read((await buildAs(null, pub)).app)).statusCode).toBe(200);
    expect((await read((await buildAs({ roles: ["cashier"] }, priv)).app)).statusCode).toBe(200);
    expect((await read((await buildAs({ roles: [], userId: "owner-9" }, priv)).app)).statusCode).toBe(200);
  });
});
