import type { FeatureDef, PermissionDef } from "@srirealtime/core";

export const ACCOUNTING_FEATURE = "accounting";

/** Off until the owner switches it on (Settings > Features); the plan and app profile must also grant it. */
export const ACCOUNTING_FEATURES: FeatureDef[] = [
  {
    key: ACCOUNTING_FEATURE,
    module: "accounting",
    label: "Accounts and books",
    description:
      "Double-entry books for the shop: chart of accounts, journal entries, day book, ledgers, trial balance, profit and loss and balance sheet, built automatically from bills, purchases, payments and expenses.",
    dependsOn: ["invoices"],
    shopToggle: true,
    defaultOn: false,
  },
];

export const ACCOUNTING_PERMISSION_KEYS = {
  view: "accounting.view",
  post: "accounting.post",
  lock: "accounting.lock",
} as const;
export type AccountingPermission = (typeof ACCOUNTING_PERMISSION_KEYS)[keyof typeof ACCOUNTING_PERMISSION_KEYS];

export const ACCOUNTING_PERMISSIONS: PermissionDef[] = [
  {
    key: ACCOUNTING_PERMISSION_KEYS.view,
    module: "accounting",
    label: "View accounts and books",
    description: "See the chart of accounts, journal entries, day book, ledgers, trial balance, profit and loss and balance sheet.",
  },
  {
    key: ACCOUNTING_PERMISSION_KEYS.post,
    module: "accounting",
    label: "Post accounting entries",
    description: "Add and reverse journal, contra, payment and receipt vouchers; manage accounts, opening balances and the automatic posting.",
  },
  {
    key: ACCOUNTING_PERMISSION_KEYS.lock,
    module: "accounting",
    label: "Lock accounting periods",
    description: "Close the books up to a date so nothing can be posted or changed on or before it.",
  },
];
