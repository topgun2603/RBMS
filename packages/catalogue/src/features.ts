import type { FeatureDef } from "@rbms/core";

/** The feature module name (feature keys and `catalogue.*` grants). The HTTP module id is "catalog" (`/v1/catalog`). */
export const CATALOGUE_MODULE = "catalogue";

/** Feature keys declared by this module (docs/features.md). */
export const CATALOGUE_FEATURE_KEYS = {
  base: "catalogue",
  variants: "catalogue.variants",
} as const;

export const CATALOGUE_FEATURES: FeatureDef[] = [
  {
    key: CATALOGUE_FEATURE_KEYS.base,
    module: CATALOGUE_MODULE,
    label: "Product catalogue",
    description: "One product list for the online store, billing and POS: categories, products, prices, images and SEO.",
  },
  {
    key: CATALOGUE_FEATURE_KEYS.variants,
    module: CATALOGUE_MODULE,
    label: "Variants and options",
    description: "Products with options such as size and colour, each variant with its own SKU, barcode and price.",
    dependsOn: [CATALOGUE_FEATURE_KEYS.base],
    shopToggle: true,
  },
];

/** Permission keys declared by this module. Core has no PermissionDef yet; apps/api registers these with staff. */
export const CATALOGUE_PERMISSIONS = [
  {
    key: "catalogue.manage",
    label: "Manage the product catalogue",
    description: "Create, edit and delete categories, products, variants and prices.",
  },
] as const satisfies readonly { key: string; label: string; description: string }[];
