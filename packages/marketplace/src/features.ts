import type { FeatureDef, PermissionDef } from "@srirealtime/core";

export const MARKETPLACE_FEATURE = "marketplace";
export const PAYOUTS_FEATURE = "marketplace.payouts";

export const MARKETPLACE_FEATURES: FeatureDef[] = [
  {
    key: MARKETPLACE_FEATURE,
    module: "marketplace",
    label: "Marketplace (multiple sellers)",
    description:
      "Let other sellers list products in your store: seller applications and approval, per-seller orders, commission and a seller ledger.",
  },
  {
    key: PAYOUTS_FEATURE,
    module: "marketplace",
    label: "Seller payouts",
    description: "Pay sellers what they earned after the return window, by bank transfer or Razorpay Route, with a minimum payout.",
    dependsOn: [MARKETPLACE_FEATURE],
  },
];

export const MARKETPLACE_PERMISSIONS_KEYS = {
  manage: "marketplace.manage",
} as const;

export const MARKETPLACE_PERMISSIONS: PermissionDef[] = [
  {
    key: MARKETPLACE_PERMISSIONS_KEYS.manage,
    module: "marketplace",
    label: "Manage sellers and payouts",
    description: "Approve or suspend sellers, set commission, view seller orders, run payouts and adjust seller ledgers.",
  },
];
