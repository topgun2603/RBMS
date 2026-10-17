import { defineModule } from "@srirealtime/core";
import { CMS_FEATURES, CMS_PERMISSIONS } from "./features";
import { cmsRoutes } from "./routes";
import { cmsHome, cmsMenus, cmsPages, cmsPosts } from "./schema";
import { CmsService, type CmsDeps } from "./service";

export * from "./schema";
export * from "./content";
export * from "./list";
export * from "./slug";
export * from "./ports";
export * from "./resolve";
export * from "./features";
export * from "./service";
export * from "./seo/jsonld";
export * from "./seo/sitemap";
export { cmsRoutes } from "./routes";

/**
 * Store content and SEO (`/v1/cms`): home sections (draft → publish), pages, blog posts, header/footer menus,
 * public reads for the storefront, sitemap.xml and robots.txt. Pure SEO helpers: `@srirealtime/cms/seo`.
 */
export function createCms(deps: CmsDeps) {
  const service = new CmsService(deps);
  const module = defineModule({
    id: "cms",
    tables: { cmsHome, cmsPages, cmsPosts, cmsMenus },
    routes: cmsRoutes(service),
    features: CMS_FEATURES,
    permissions: CMS_PERMISSIONS,
  });
  return { service, module };
}
