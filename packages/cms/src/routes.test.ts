import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { createCms } from "./index";
import { cmsRoutes } from "./routes";
import type { CmsService } from "./service";

const T = "11111111-1111-4111-8111-111111111111";
const tenant = { id: T, slug: "raja", planId: null, appId: null };

const stubService = () =>
  ({
    getHome: vi.fn(async () => ({ draft: null })),
    saveHomeDraft: vi.fn(async (_t: string, body: unknown) => ({ draft: body })),
    publicHome: vi.fn(async () => ({ sections: [], isDefault: true })),
    sitemapXml: vi.fn(async () => "<urlset/>"),
    robotsTxt: vi.fn(async () => "User-agent: *\n"),
    saveMenu: vi.fn(async (_t: string, key: string, items: unknown) => ({ key, items })),
  }) as unknown as CmsService & Record<string, ReturnType<typeof vi.fn>>;

let app: FastifyInstance | undefined;
afterEach(async () => app?.close());

async function build(service: CmsService, ctx: Partial<RequestContext>) {
  app = Fastify();
  const configs: Record<string, unknown> = {};
  app.addHook("onRoute", (r) => {
    configs[`${r.method} ${r.url}`] = r.config;
  });
  app.decorateRequest("ctx", null as unknown as RequestContext);
  app.addHook("onRequest", async (req) => {
    req.ctx = { ...emptyContext(), ...ctx };
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ code: "validation" });
    if (err instanceof AppError) return reply.code(err.status).send({ code: err.code });
    return reply.code(500).send({ code: "internal" });
  });
  await app.register(cmsRoutes(service), { prefix: "/v1/cms" });
  await app.ready();
  return { app, configs };
}

const owner = { id: "u1", sessionId: "s", platformRoles: [], tenantRoles: ["owner"], permissions: ["*"] };
const shopper = { id: "u2", sessionId: "s", platformRoles: [], tenantRoles: [], permissions: [] };

describe("routes", () => {
  it("declares features and the cms.manage permission", async () => {
    const { configs } = await build(stubService(), { tenant });
    expect(configs["PUT /v1/cms/home"]).toMatchObject({ feature: "cms", permission: "cms.manage" });
    expect(configs["POST /v1/cms/posts"]).toMatchObject({ feature: "cms.blog", permission: "cms.manage" });
    expect(configs["GET /v1/cms/public/home"]).toEqual({ feature: "cms" });
    expect(configs["GET /v1/cms/public/posts"]).toEqual({ feature: "cms.blog" });
    expect(configs["GET /v1/cms/public/seo/sitemap.xml"]).toEqual({ feature: "seo" });
    const staffRoutes = Object.entries(configs).filter(([k]) => !k.includes("/public/") && !k.startsWith("HEAD"));
    expect(staffRoutes.length).toBeGreaterThan(15);
    for (const [, c] of staffRoutes) expect(c).toMatchObject({ permission: "cms.manage" });
  });

  it("staff routes need cms.manage", async () => {
    const service = stubService();
    const { app } = await build(service, { tenant, user: shopper });
    const res = await app.inject({ method: "PUT", url: "/v1/cms/home", payload: { sections: [] } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: "permission_denied" });
    expect(service.saveHomeDraft).not.toHaveBeenCalled();
  });

  it("owners save drafts; menus validate the key and body", async () => {
    const service = stubService();
    const { app } = await build(service, { tenant, user: owner });
    expect((await app.inject({ method: "PUT", url: "/v1/cms/home", payload: { sections: [] } })).statusCode).toBe(200);
    expect(service.saveHomeDraft).toHaveBeenCalledWith(T, { sections: [] });
    expect((await app.inject({ method: "PUT", url: "/v1/cms/menus/sidebar", payload: { items: [] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/v1/cms/menus/header", payload: { items: [{ label: "x", type: "page" }] } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "PUT", url: "/v1/cms/menus/header", payload: { items: [{ label: "About", type: "page", ref: "about" }] } });
    expect(ok.statusCode).toBe(200);
    expect(service.saveMenu).toHaveBeenCalledWith(T, "header", [{ label: "About", type: "page", ref: "about" }]);
  });

  it("public routes need only a tenant and serve XML / text", async () => {
    const service = stubService();
    const { app } = await build(service, { tenant });
    expect((await app.inject("/v1/cms/public/home")).json()).toEqual({ sections: [], isDefault: true });
    const xml = await app.inject("/v1/cms/public/seo/sitemap.xml");
    expect(xml.headers["content-type"]).toBe("application/xml; charset=utf-8");
    expect(xml.body).toBe("<urlset/>");
    const robots = await app.inject("/v1/cms/public/seo/robots.txt");
    expect(robots.headers["content-type"]).toBe("text/plain; charset=utf-8");

    await app.close();
    const { app: noTenant } = await build(stubService(), {});
    expect((await noTenant.inject("/v1/cms/public/home")).statusCode).toBe(403);
  });
});

describe("createCms", () => {
  it("declares tables, features and permissions", () => {
    const { module } = createCms({
      db: {} as never,
      catalog: {} as never,
      shop: {} as never,
      storeUrl: { baseUrl: () => "https://x.in" },
    });
    expect(module.id).toBe("cms");
    expect(Object.keys(module.tables ?? {})).toEqual(["cmsHome", "cmsPages", "cmsPosts", "cmsMenus"]);
    expect(module.features?.map((f) => [f.key, f.shopToggle ?? false])).toEqual([
      ["cms", false],
      ["cms.blog", true],
      ["seo", false],
    ]);
    expect(module.permissions?.map((p) => p.key)).toEqual(["cms.manage"]);
  });
});
