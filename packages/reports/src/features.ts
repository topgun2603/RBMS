import type { FeatureDef, PermissionDef } from "@srirealtime/core";

export const REPORTS_FEATURE = "reports.advanced";

export const REPORTS_FEATURES: FeatureDef[] = [
  {
    key: REPORTS_FEATURE,
    module: "reports",
    label: "Report builder",
    description: "Build your own reports from sales, payments, orders, stock, expenses and customers; save them and email them on a schedule.",
  },
];

export const REPORTS_PERMISSION_KEYS = {
  /** Declared by apps/api (module "invoices"); reports only references it. */
  view: "reports.view",
  manage: "reports.manage",
} as const;

/** `reports.view` already exists (apps/api permissions), so only `reports.manage` is declared here. */
export const REPORTS_PERMISSIONS: PermissionDef[] = [
  {
    key: REPORTS_PERMISSION_KEYS.manage,
    module: "reports",
    label: "Save and schedule reports",
    description: "Save reports (private or shared with the team) and email them on a daily, weekly or monthly schedule.",
  },
];
