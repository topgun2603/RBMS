import type { FeatureDef, PermissionDef } from "@rbms/core";

export const LOYALTY_MODULE = "loyalty";

export const LOYALTY_FEATURE_KEYS = { base: "loyalty" } as const;

export const LOYALTY_FEATURES: FeatureDef[] = [
  {
    key: LOYALTY_FEATURE_KEYS.base,
    module: LOYALTY_MODULE,
    label: "Loyalty points",
    description:
      "Customers earn points on counter bills and online orders (by mobile number), redeem them as a discount, move up tiers, and points expire after a set time.",
    shopToggle: true,
  },
];

export const LOYALTY_PERMISSION_KEYS = { manage: "loyalty.manage" } as const;

export const LOYALTY_PERMISSIONS: PermissionDef[] = [
  {
    key: LOYALTY_PERMISSION_KEYS.manage,
    module: LOYALTY_MODULE,
    label: "Manage loyalty points",
    description: "See loyalty members and their points history, add or remove points with a reason, export members and change the points rules.",
  },
];
