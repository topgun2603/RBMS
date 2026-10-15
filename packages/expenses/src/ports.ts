import type { FeatureDef, PermissionDef } from "@srirealtime/core";
import type { GstTotals } from "./logic";

/** Sales GST totals for a period (invoices gst-summary). Dates are IST "YYYY-MM-DD", inclusive. */
export interface SalesReportPort {
  gstTotals(tenantId: string, from: string, to: string): Promise<GstTotals>;
}

/** Purchase ITC totals for a period (inventory purchases report). */
export interface PurchasesReportPort {
  itcTotals(tenantId: string, from: string, to: string): Promise<GstTotals>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const EXPENSES_FEATURE = "expenses";
export const EXPENSES_PERMISSION = "expenses.manage";

export const EXPENSES_FEATURES: FeatureDef[] = [
  {
    key: EXPENSES_FEATURE,
    module: "expenses",
    label: "Expenses",
    description: "Record shop expenses (rent, salaries, electricity…) with GST input credit, and see a profit report.",
    shopToggle: true,
  },
];

export const EXPENSES_PERMISSIONS: PermissionDef[] = [
  {
    key: EXPENSES_PERMISSION,
    module: "expenses",
    label: "Manage expenses",
    description: "Record, edit and cancel expenses and categories; view the expense summary and profit report.",
  },
];
