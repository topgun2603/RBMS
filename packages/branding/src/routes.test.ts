import { emptyContext, type RequestContext } from "@rbms/core";
import type { Db } from "@rbms/db";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { brandingRoutes, brandingSchema } from "./routes";
import { BrandingService } from "./service";

/** Chainable drizzle fake: every awaited query resolves to `rows`. */
function fakeDb(rows: unknown[]): Db {
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve(rows).then(res);
        return () => chain;
      },
    },
  );
  return chain as Db;
}

const TENANT = "11111111-1111-4111-8111-111111111111";

async function get(rows: unknown[], withTenant: boolean) {
  const app = Fastify();
  app.decorateRequest("ctx", null as never);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...(withTenant ? { tenant: { id: TENANT, slug: "sri", planId: "pro", appId: "EC" } } : {}) } as RequestContext;
  });
  await app.register(brandingRoutes(new BrandingService({ db: fakeDb(rows), defaultAppName: "Srikit" })), { prefix: "/v1/branding" });
  const res = await app.inject({ url: "/v1/branding" });
  await app.close();
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

describe("GET /v1/branding matches brandingSchema", () => {
  it("platform branding (no tenant)", async () => {
    const json = await get([], false);
    // Equality also catches fields the schema doesn't document (zod strips unknown keys).
    expect(brandingSchema.parse(json)).toEqual(json);
    expect(json.appName).toBe("Srikit");
  });

  it("a shop's branding with its own logo and token overrides", async () => {
    const row = {
      tenantId: TENANT,
      appName: "Sri Silks",
      logoUrl: "https://cdn.example/logo.png",
      logoDarkUrl: null,
      faviconUrl: "https://cdn.example/icon.png",
      tokens: { colors: { primary: "#7a1f3d", accent: "#d4a017" }, radius: 1, fontHeading: "Playfair Display", mode: "dark", preset: "silks" },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const json = await get([row], true);
    expect(brandingSchema.parse(json)).toEqual(json);
    expect(json.tokens.colors.primary).toBe("#7a1f3d");
  });
});
