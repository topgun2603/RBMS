import type { FeatureDef, PermissionDef } from "@srirealtime/core";

export const BRANCHES_MODULE = "branches";

/**
 * Feature keys (docs/batch3.md §B3). The base key is `multi-branch` (not `branches`), as the contract names it; it
 * belongs to the `branches` module, so a `branches.*` grant covers it too.
 */
export const BRANCHES_FEATURE_KEYS = { base: "multi-branch" } as const;

/** Inventory's multi-location feature key (the dependency; inventory declares it). */
export const INVENTORY_LOCATIONS_FEATURE = "inventory.locations";

export const BRANCHES_FEATURES: FeatureDef[] = [
  {
    key: BRANCHES_FEATURE_KEYS.base,
    module: BRANCHES_MODULE,
    label: "Multiple branches",
    description:
      "Run several shop branches under one account: each branch has its own bill numbers, GSTIN and address, stock location and staff, with per-branch and combined reports.",
    dependsOn: [INVENTORY_LOCATIONS_FEATURE],
    shopToggle: false,
  },
];

export const BRANCHES_PERMISSION_KEYS = { manage: "branches.manage" } as const;

export const BRANCHES_PERMISSIONS: PermissionDef[] = [
  {
    key: BRANCHES_PERMISSION_KEYS.manage,
    module: BRANCHES_MODULE,
    label: "Manage branches",
    description:
      "Add, edit and close branches, choose the main branch, assign staff to branches and see the branch-wise summary.",
  },
];
