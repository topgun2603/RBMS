import type { FeatureDef, PermissionDef } from "@rbms/core";

export const REVIEWS_MODULE = "reviews";

export const REVIEW_FEATURE_KEYS = { base: "reviews" } as const;

export const REVIEW_FEATURES: FeatureDef[] = [
  {
    key: REVIEW_FEATURE_KEYS.base,
    module: REVIEWS_MODULE,
    label: "Product reviews",
    description: "Shoppers rate and review products (verified buyers marked), with moderation, shop replies and helpful votes.",
    shopToggle: true,
  },
];

export const REVIEW_PERMISSION_KEYS = { manage: "reviews.manage" } as const;

export const REVIEW_PERMISSIONS: PermissionDef[] = [
  {
    key: REVIEW_PERMISSION_KEYS.manage,
    module: REVIEWS_MODULE,
    label: "Moderate reviews",
    description: "See all product reviews, approve or reject them, reply publicly, delete them, add or import reviews customers gave elsewhere and ask customers for a review.",
  },
];
