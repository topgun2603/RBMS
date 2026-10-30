import { requirePermission, requireTenant, type RequestContext } from "@rbms/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { menuBodySchema, menuKeySchema } from "./content";
import { CMS_FEATURE_KEYS, CMS_PERMISSION_KEYS } from "./features";
import type { CmsService } from "./service";

const idParam = z.object({ id: z.string().uuid() });
const slugParam = z.object({ slug: z.string().trim().toLowerCase().min(1).max(120) });
const keyParam = z.object({ key: menuKeySchema });
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

const MANAGE = CMS_PERMISSION_KEYS.manage;
const staff = (feature: string) => ({ config: { feature, permission: MANAGE } });
const mut = (feature: string, action: string, entity: string, idParam?: string) => ({
  config: { feature, permission: MANAGE, audit: { action, entity, ...(idParam ? { idParam } : {}) } },
});
const CMS = CMS_FEATURE_KEYS.base;
const BLOG = CMS_FEATURE_KEYS.blog;
const SEO = CMS_FEATURE_KEYS.seo;
const PUBLIC_CMS = { config: { feature: CMS } };
const PUBLIC_BLOG = { config: { feature: BLOG } };
const PUBLIC_SEO = { config: { feature: SEO } };

/** The staff gate (the host's preHandler checks `config.permission` too; owners/admins always pass). */
const guard = (req: { ctx: RequestContext }) => {
  requirePermission(req.ctx, MANAGE);
  return tid(req);
};

const sendText = (reply: FastifyReply, type: string, body: string) =>
  reply.header("content-type", type).header("cache-control", "public, max-age=3600").send(body);

/**
 * Routes under /v1/cms. Staff routes need `cms.manage`; `/public/*` need only a tenant (host / `x-tenant`).
 * Features: `cms` (home, pages, menus), `cms.blog` (posts), `seo` (sitemap, robots).
 */
export function cmsRoutes(service: CmsService) {
  return async (app: FastifyInstance) => {
    // ---- staff: home
    app.get("/home", staff(CMS), async (req) => service.getHome(guard(req)));
    app.get("/home/preview", staff(CMS), async (req) => service.previewHome(guard(req)));
    app.put("/home", mut(CMS, "cms.home.save", "cms_home"), async (req) => service.saveHomeDraft(guard(req), req.body));
    app.post("/home/publish", mut(CMS, "cms.home.publish", "cms_home"), async (req) => service.publishHome(guard(req)));

    // ---- staff: pages
    app.get("/pages", staff(CMS), async (req) => service.listPages(guard(req), req.query));
    app.post("/pages", mut(CMS, "cms.page.create", "cms_page"), async (req) => service.createPage(guard(req), req.body));
    app.get("/pages/:id", staff(CMS), async (req) => {
      const t = guard(req);
      return service.getPage(t, idParam.parse(req.params).id);
    });
    app.patch("/pages/:id", mut(CMS, "cms.page.update", "cms_page", "id"), async (req) => {
      const t = guard(req);
      return service.updatePage(t, idParam.parse(req.params).id, req.body);
    });
    app.delete("/pages/:id", mut(CMS, "cms.page.delete", "cms_page", "id"), async (req) => {
      const t = guard(req);
      return service.deletePage(t, idParam.parse(req.params).id);
    });
    app.post("/pages/:id/publish", mut(CMS, "cms.page.publish", "cms_page", "id"), async (req) => {
      const t = guard(req);
      return service.setPageStatus(t, idParam.parse(req.params).id, "published");
    });
    app.post("/pages/:id/unpublish", mut(CMS, "cms.page.unpublish", "cms_page", "id"), async (req) => {
      const t = guard(req);
      return service.setPageStatus(t, idParam.parse(req.params).id, "draft");
    });

    // ---- staff: posts
    app.get("/posts", staff(BLOG), async (req) => service.listPosts(guard(req), req.query));
    app.post("/posts", mut(BLOG, "cms.post.create", "cms_post"), async (req) => service.createPost(guard(req), req.body));
    app.get("/posts/:id", staff(BLOG), async (req) => {
      const t = guard(req);
      return service.getPost(t, idParam.parse(req.params).id);
    });
    app.patch("/posts/:id", mut(BLOG, "cms.post.update", "cms_post", "id"), async (req) => {
      const t = guard(req);
      return service.updatePost(t, idParam.parse(req.params).id, req.body);
    });
    app.delete("/posts/:id", mut(BLOG, "cms.post.delete", "cms_post", "id"), async (req) => {
      const t = guard(req);
      return service.deletePost(t, idParam.parse(req.params).id);
    });
    app.post("/posts/:id/publish", mut(BLOG, "cms.post.publish", "cms_post", "id"), async (req) => {
      const t = guard(req);
      return service.setPostStatus(t, idParam.parse(req.params).id, "published");
    });
    app.post("/posts/:id/unpublish", mut(BLOG, "cms.post.unpublish", "cms_post", "id"), async (req) => {
      const t = guard(req);
      return service.setPostStatus(t, idParam.parse(req.params).id, "draft");
    });

    // ---- staff: menus
    app.get("/menus/:key", staff(CMS), async (req) => {
      const t = guard(req);
      return service.getMenu(t, keyParam.parse(req.params).key);
    });
    app.put("/menus/:key", mut(CMS, "cms.menu.save", "cms_menu", "key"), async (req) => {
      const t = guard(req);
      const { key } = keyParam.parse(req.params);
      const { items } = menuBodySchema.parse(req.body ?? {});
      return service.saveMenu(t, key, items);
    });

    // ---- public (storefront SSR)
    app.get("/public/home", PUBLIC_CMS, async (req) => service.publicHome(tid(req)));
    app.get("/public/pages/:slug", PUBLIC_CMS, async (req) => service.publicPage(tid(req), slugParam.parse(req.params).slug));
    app.get("/public/posts", PUBLIC_BLOG, async (req) => service.publicPosts(tid(req), req.query));
    app.get("/public/posts/:slug", PUBLIC_BLOG, async (req) => service.publicPost(tid(req), slugParam.parse(req.params).slug));
    app.get("/public/menus", PUBLIC_CMS, async (req) => service.publicMenus(tid(req)));

    // ---- public SEO files
    app.get("/public/seo/sitemap.xml", PUBLIC_SEO, async (req, reply) =>
      sendText(reply, "application/xml; charset=utf-8", await service.sitemapXml(tid(req))),
    );
    app.get("/public/seo/robots.txt", PUBLIC_SEO, async (req, reply) =>
      sendText(reply, "text/plain; charset=utf-8", await service.robotsTxt(tid(req))),
    );
  };
}
