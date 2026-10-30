import { defineModule } from "@rbms/core";
import { CMS_FEATURES, CMS_PERMISSIONS } from "./features";
import { cmsRoutes } from "./routes";
import { CmsPreview } from "./preview";
import { withPreviewRoutes } from "./preview-routes";
import { cmsHome, cmsMenus, cmsPages, cmsPosts } from "./schema";
import { CmsService, type CmsDeps } from "./service";

export * from "./schema";
export * from "./content";
export * from "./localize";
export * from "./list";
export * from "./slug";
export * from "./ports";
export * from "./resolve";
export * from "./features";
export * from "./service";
export * from "./seo/jsonld";
export * from "./seo/sitemap";
export { cmsRoutes } from "./routes";
export * from "./preview";
export { cmsPreviewRoutes, withPreviewRoutes } from "./preview-routes";

/**
 * Store content and SEO (`/v1/cms`): home sections (draft → publish), pages, blog posts, header/footer menus,
 * public reads for the storefront, sitemap.xml and robots.txt. Pure SEO helpers: `@rbms/cms/seo`.
 */
export function createCms(deps: CmsDeps) {
  const service = new CmsService(deps);
  // Live preview tokens + unsaved drafts for the visual editor (preview.ts).
  const preview = new CmsPreview(service, { catalog: deps.catalog, shop: deps.shop, log: deps.log });
  const module = defineModule({
    id: "cms",
    tables: { cmsHome, cmsPages, cmsPosts, cmsMenus },
    routes: withPreviewRoutes(cmsRoutes(service), preview),
    features: CMS_FEATURES,
    permissions: CMS_PERMISSIONS,
  });
  return { service, preview, module };
}
