import { AppError, emptyContext } from "@rbms/core";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { clientInfo, compareVersions, createMobile, parseVersionList } from "./kit-mobile";

describe("mobile app versions", () => {
  it("parses version lists and compares versions", () => {
    expect(parseVersionList("business=1.2.0, shops=1.0.0,bad,x=1")).toEqual({ business: "1.2.0", shops: "1.0.0" });
    expect(parseVersionList(undefined)).toEqual({});
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBe(0);
  });

  it("reads the x-client header of srikit apps only", () => {
    expect(clientInfo("srikit-business/1.4.2 (android)")).toEqual({ app: "business", version: "1.4.2", platform: "android" });
    expect(clientInfo("srikit-shops/2.0.0")).toEqual({ app: "shops", version: "2.0.0", platform: null });
    expect(clientInfo("Mozilla/5.0")).toBeNull();
    expect(clientInfo("srikit-business/latest")).toBeNull();
    expect(clientInfo(undefined)).toBeNull();
  });

  async function server() {
    const mobile = createMobile({ min: { business: "1.2.0" }, latest: { business: "1.5.0" } });
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = emptyContext();
    });
    app.addHook("preHandler", mobile.updateGuard);
    app.setErrorHandler((err, _req, reply) =>
      reply.status(err instanceof AppError ? err.status : 500).send({ error: { code: err instanceof AppError ? err.code : "internal" } }),
    );
    await app.register(async (s) => mobile.module.routes!(s), { prefix: "/v1/mobile" });
    app.get("/v1/invoices", async () => ({ items: [] }));
    await app.ready();
    return app;
  }

  it("tells an app about updates and refuses versions below the minimum", async () => {
    const app = await server();
    const old = { "x-client": "srikit-business/1.1.9 (android)" };
    const cfg = await app.inject({ url: "/v1/mobile/config", headers: old });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json()).toMatchObject({
      apps: { business: { minVersion: "1.2.0", latestVersion: "1.5.0" } },
      updateRequired: true,
      updateAvailable: true,
    });
    const blocked = await app.inject({ url: "/v1/invoices", headers: old });
    expect(blocked.statusCode).toBe(426);
    expect(blocked.json().error.code).toBe("app_update_required");

    expect((await app.inject({ url: "/v1/invoices", headers: { "x-client": "srikit-business/1.2.0 (ios)" } })).statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/invoices" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/v1/invoices", headers: { "x-client": "srikit-shops/0.1.0" } })).statusCode).toBe(200);
    await app.close();
  });
});
