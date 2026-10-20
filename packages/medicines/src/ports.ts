import type { FeatureDef, FeatureGatePort, PermissionDef } from "@srirealtime/core";

export type { FeatureGatePort };

/**
 * Keeps the shop's stock totals (inventory) in step with batch changes made here: receiving a batch adds stock, a
 * write-off removes it. Sales are not passed through: the bill already moves inventory stock itself.
 */
export interface StockPort {
  add(tenantId: string, itemId: string, qty: number, note: string, unitCost: number | null, userId: string | null): Promise<void>;
  remove(tenantId: string, itemId: string, qty: number, note: string, userId: string | null): Promise<void>;
}

/** The part of a bill the batch hooks read (invoices' `Invoice` is assignable to it). */
export interface SoldBill {
  id: string;
  number: string | null;
  date: string;
  customer: { name: string; phone: string | null };
  lines: { itemId?: string | null; qty: number; description: string }[];
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export const MEDICINES_FEATURE = "medicines";
export const MEDICINES_RX_FEATURE = "medicines.prescriptions";
export const MEDICINES_REGISTER_FEATURE = "medicines.register";

export const MEDICINES_MANAGE = "medicines.manage";
export const MEDICINES_DISPENSE = "medicines.dispense";

export const MEDICINES_FEATURES: FeatureDef[] = [
  {
    key: MEDICINES_FEATURE,
    module: "medicines",
    label: "Medicines & batches",
    description: "Composition, schedule and pack details for each medicine; batches with expiry and MRP, sold first-expiry-first-out.",
  },
  {
    key: MEDICINES_RX_FEATURE,
    module: "medicines",
    label: "Prescriptions",
    description: "Record the doctor and patient for prescription (Schedule H, H1, X) medicines on the bill.",
    dependsOn: [MEDICINES_FEATURE],
    shopToggle: true,
  },
  {
    key: MEDICINES_REGISTER_FEATURE,
    module: "medicines",
    label: "Schedule H1 register",
    description: "The register of Schedule H1, X and narcotic sales with batch, prescriber and patient.",
    dependsOn: [MEDICINES_RX_FEATURE],
    shopToggle: true,
  },
];

export const MEDICINES_PERMISSIONS: PermissionDef[] = [
  {
    key: MEDICINES_MANAGE,
    module: "medicines",
    label: "Manage medicines and batches",
    description: "Edit medicine details, receive batches, adjust or write off batch stock, see expiry reports.",
  },
  {
    key: MEDICINES_DISPENSE,
    module: "medicines",
    label: "Dispense",
    description: "See batches and medicine details at the counter and record prescriptions; see the H1 register.",
  },
];
