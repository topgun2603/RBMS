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
