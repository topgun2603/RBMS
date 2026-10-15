import type { FeatureDef, PermissionDef } from "@srirealtime/core";

export const SUPPORT_MODULE = "support";

export const SUPPORT_FEATURE_KEYS = { base: "support", faq: "support.faq" } as const;

export const SUPPORT_FEATURES: FeatureDef[] = [
  {
    key: SUPPORT_FEATURE_KEYS.base,
    module: SUPPORT_MODULE,
    label: "Help desk",
    description: "Customers raise support tickets from the store; staff assign, reply, add internal notes and track response times.",
    shopToggle: true,
  },
  {
    key: SUPPORT_FEATURE_KEYS.faq,
    module: SUPPORT_MODULE,
    label: "FAQ / help articles",
    description: "A public FAQ with categories, search and \"was this helpful?\" votes.",
    dependsOn: [SUPPORT_FEATURE_KEYS.base],
    shopToggle: true,
  },
];

export const SUPPORT_PERMISSION_KEYS = { manage: "support.manage" } as const;

export const SUPPORT_PERMISSIONS: PermissionDef[] = [
  {
    key: SUPPORT_PERMISSION_KEYS.manage,
    module: SUPPORT_MODULE,
    label: "Handle support tickets",
    description: "See and answer every support ticket (replies, internal notes, assign, status, merge) and edit FAQ articles.",
  },
];
