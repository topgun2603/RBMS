import type { FeatureDef } from "@srirealtime/core";

export const STOREFRONT_FEATURES_KEYS = {
  base: "storefront",
  wishlist: "storefront.wishlist",
} as const;

export const STOREFRONT_FEATURES: FeatureDef[] = [
  {
    key: STOREFRONT_FEATURES_KEYS.base,
    module: "storefront",
    label: "Online store",
    description: "Your own branded online store: cart, checkout with UPI or cash on delivery, order tracking and shopper accounts.",
  },
  {
    key: STOREFRONT_FEATURES_KEYS.wishlist,
    module: "storefront",
    label: "Wishlist",
    description: "Shoppers can save products to a wishlist.",
    dependsOn: [STOREFRONT_FEATURES_KEYS.base],
    shopToggle: true,
  },
];
