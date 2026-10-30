import type { FeatureDef, PermissionDef } from "@rbms/core";

export const CMS_FEATURE_KEYS = {
  base: "cms",
  blog: "cms.blog",
  seo: "seo",
} as const;

export const CMS_FEATURES: FeatureDef[] = [
  {
    key: CMS_FEATURE_KEYS.base,
    module: "cms",
    label: "Store content",
    description: "Edit the online store's home page sections, content pages and header/footer menus.",
  },
  {
    key: CMS_FEATURE_KEYS.blog,
    module: "cms",
    label: "Blog",
    description: "Publish blog posts on the online store.",
    dependsOn: [CMS_FEATURE_KEYS.base],
    shopToggle: true,
  },
  {
    // Its own module key so plans/app profiles can grant it with the storefront; declared by the cms package.
    key: CMS_FEATURE_KEYS.seo,
    module: "cms",
    label: "SEO",
    description: "Sitemap, robots.txt and search-engine metadata for the online store.",
  },
];

export const CMS_PERMISSION_KEYS = {
  manage: "cms.manage",
} as const;

export const CMS_PERMISSIONS: PermissionDef[] = [
  {
    key: CMS_PERMISSION_KEYS.manage,
    module: "cms",
    label: "Manage store content",
    description: "Edit and publish the store home page, pages, blog posts and menus.",
  },
];
