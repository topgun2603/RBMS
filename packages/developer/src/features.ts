import type { FeatureDef, PermissionDef } from "@srirealtime/core";

export const DEVELOPER_FEATURE = "developer";
export const DEVELOPER_MANAGE = "developer.manage";

export const DEVELOPER_FEATURES: FeatureDef[] = [
  {
    key: DEVELOPER_FEATURE,
    module: "developer",
    label: "API keys & webhooks",
    description: "API keys for connecting other software to the shop, and webhooks that notify your systems when orders, bills, payments and stock change.",
    shopToggle: true,
  },
];

export const DEVELOPER_PERMISSIONS: PermissionDef[] = [
  {
    key: DEVELOPER_MANAGE,
    module: "developer",
    label: "Manage API keys and webhooks",
    description: "Create and revoke API keys, add webhook endpoints and see their delivery log.",
  },
];
