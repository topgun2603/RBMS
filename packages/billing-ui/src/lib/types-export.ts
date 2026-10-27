/** Export / SEZ / foreign-currency bills and the GSTIN lookup (docs/recurring-export-gstin.md); API shapes. */

export type SupplyType = "domestic" | "export_wpay" | "export_wopay" | "sez_wpay" | "sez_wopay";
export const SUPPLY_TYPES: SupplyType[] = ["domestic", "export_wopay", "export_wpay", "sez_wopay", "sez_wpay"];
export const isExportSupply = (t: SupplyType | null | undefined) => t === "export_wpay" || t === "export_wopay";
export const isSezSupply = (t: SupplyType | null | undefined) => t === "sez_wpay" || t === "sez_wopay";
export const withoutPayment = (t: SupplyType | null | undefined) => t === "export_wopay" || t === "sez_wopay";

/** Foreign figures stored on a bill (minor units). */
export interface ForeignAmounts {
  currency: string;
  exchangeRate: number;
  lines: { rate: number; discount: number; amount: number; taxable: number }[];
  subtotal: number;
  discount: number;
  taxable: number;
  tax: number;
  total: number;
}

export interface ExportDetails {
  shippingBillNo: string | null;
  shippingBillDate: string | null;
  portCode: string | null;
  lutNumber?: string | null;
  lutDate?: string | null;
}

/** What a bill input sends for an export / foreign-currency bill. */
export interface ForeignInput {
  currency: string;
  exchangeRate: number;
  lines: { rate: number; discount?: number }[];
}

export interface ForeignPaymentInput {
  amount: number;
  realisedRate: number;
  method: "cash" | "upi" | "card" | "bank" | "cheque" | "other";
  date: string;
  reference?: string | null;
}

export interface CurrencyDef {
  code: string;
  name: string;
  digits: 0 | 2 | 3;
  symbol: string;
}

export type GstinStatus = "active" | "cancelled" | "suspended" | "inactive" | "unknown";

export interface GstinDetails {
  legalName: string | null;
  tradeName: string | null;
  address: string | null;
  pincode: string | null;
  stateCode: string | null;
  status: GstinStatus;
  registrationType: string | null;
  constitution: string | null;
  registeredOn: string | null;
  cancelledOn: string | null;
}

/** GET /v1/gstin/:gstin */
export interface GstinLookupResult {
  gstin: string;
  valid: boolean;
  problem: "format" | "checksum" | null;
  stateCode: string | null;
  stateName: string | null;
  pan: string | null;
  panHolder: string | null;
  entityNumber: string | null;
  expectedCheck: string | null;
  online: {
    available: boolean;
    source: "cache" | "provider" | null;
    found: boolean | null;
    details: GstinDetails | null;
    fetchedAt: string | null;
    reason: "not_configured" | "invalid" | "rate_limited" | "provider_error" | null;
  };
}
