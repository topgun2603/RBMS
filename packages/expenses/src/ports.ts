import type { FeatureDef, PermissionDef } from "@rbms/core";
import type { GstTotals } from "./logic";

/** Sales GST totals for a period (invoices gst-summary). Dates are IST "YYYY-MM-DD", inclusive. */
export interface SalesReportPort {
  gstTotals(tenantId: string, from: string, to: string): Promise<GstTotals>;
}

/** Purchase ITC totals for a period (inventory purchases report). */
export interface PurchasesReportPort {
  itcTotals(tenantId: string, from: string, to: string): Promise<GstTotals>;
}

/** A supplier (inventory `suppliers`) as an expense needs it. */
export interface SupplierRef {
  id: string;
  name: string;
  gstin: string | null;
}

/** Suppliers (packages/inventory), wired in apps/api. Without it expenses can't be linked to a supplier. */
export interface SuppliersPort {
  /** The supplier, or null when it does not exist (or was deleted). */
  get(tenantId: string, id: string): Promise<SupplierRef | null>;
}

/** Branches of the shop (packages/branches), for names in the expense report. */
export interface BranchesPort {
  list(tenantId: string): Promise<{ id: string; name: string }[]>;
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
