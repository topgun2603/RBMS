import type { FeatureDef, FeatureGatePort, PermissionDef } from "@rbms/core";

export type { FeatureGatePort };

/**
 * Keeps the shop's stock totals (inventory) in step with units received or taken off the shelf here: receiving adds,
 * marking defective / written off removes, back in stock adds. Sales are not passed through: the bill moves stock itself.
 */
export interface StockPort {
  add(tenantId: string, itemId: string, qty: number, note: string, unitCost: number | null, userId: string | null): Promise<void>;
  remove(tenantId: string, itemId: string, qty: number, note: string, userId: string | null): Promise<void>;
}

/** Catalogue names for items (optional; used when settings are saved without a name). */
export interface CatalogPort {
  variants(tenantId: string, ids: string[]): Promise<{ id: string; name: string }[]>;
}

/** The part of a bill the sale hook reads; each line lists the serials sold on it (scanned at the counter). */
export interface SerialBill {
  id: string;
  number: string | null;
  date: string;
  customer: { name: string; phone: string | null };
  lines: { itemId?: string | null; qty: number; serials?: string[] | null }[];
}

/** A credit note's returned units. `restocked: false` (not put back for sale) marks them defective instead. */
export interface SerialReturn {
  invoiceId: string;
  serials: string[];
  creditNoteId?: string | null;
  creditNoteNumber?: string | null;
  restocked?: boolean;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export const SERIALS_FEATURE = "serials";
export const SERIALS_WARRANTY_FEATURE = "serials.warranty";

export const SERIALS_MANAGE = "serials.manage";
export const SERIALS_VIEW = "serials.view";

export const SERIALS_FEATURES: FeatureDef[] = [
  {
    key: SERIALS_FEATURE,
    module: "serials",
    label: "Serial numbers & IMEI",
    description: "Track every unit by serial number or IMEI: receive, sell from the bill, defective and written-off units.",
  },
  {
    key: SERIALS_WARRANTY_FEATURE,
    module: "serials",
    label: "Warranty",
    description: "Warranty from the sale date for each unit; look up by IMEI or serial and log warranty claims.",
    dependsOn: [SERIALS_FEATURE],
    shopToggle: true,
  },
];

export const SERIALS_PERMISSIONS: PermissionDef[] = [
  {
    key: SERIALS_MANAGE,
    module: "serials",
    label: "Manage serial numbers",
    description: "Receive units, mark them defective, written off or back in stock, and edit item serial settings.",
  },
  {
    key: SERIALS_VIEW,
    module: "serials",
    label: "Look up serial numbers",
    description: "See units and their history, look up warranty by IMEI or serial and log warranty claims.",
  },
];
