export const SERIAL_STATUSES = ["in_stock", "sold", "returned", "defective", "written_off"] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];

/** Statuses staff can set by hand (POST /units/:id/status). */
export const MANUAL_STATUSES = ["in_stock", "defective", "written_off"] as const;
export type ManualStatus = (typeof MANUAL_STATUSES)[number];

export const EVENT_TYPES = ["received", "sold", "sale_cancelled", "returned", "defective", "written_off", "back_in_stock", "warranty_claim", "note"] as const;
export type SerialEventType = (typeof EVENT_TYPES)[number];

export type WarrantyStatus = "active" | "expired" | "none";

export interface SerialUnit {
  id: string;
  itemId: string;
  itemName: string;
  serial: string;
  serial2: string | null;
  status: SerialStatus;
  purchaseRef: string | null;
  supplier: string | null;
  costPaise: number | null;
  receivedAt: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  soldAt: string | null;
  soldOn: string | null;
  customerName: string | null;
  customerPhone: string | null;
  warrantyMonths: number;
  warrantyEnd: string | null;
  note: string | null;
  warrantyStatus: WarrantyStatus;
  warrantyDaysLeft: number | null;
}

export interface SerialEvent {
  id: string;
  unitId: string;
  type: SerialEventType;
  refType: string | null;
  refId: string | null;
  refNumber: string | null;
  note: string | null;
  userId: string | null;
  createdAt: string;
}

export interface SerialItem {
  id: string;
  itemId: string;
  name: string;
  tracked: boolean;
  warrantyMonths: number;
  dualImei: boolean;
  inStock: number;
  updatedAt: string;
}

export interface WarrantyLookup {
  unit: SerialUnit;
  item: Omit<SerialItem, "inStock"> | null;
  events: SerialEvent[];
}

export interface SerialsSummary {
  inStock: number;
  defective: number;
  warrantyEndingThisMonth: number;
}

/** A row the receive call rejected (400 `details.rows`). */
export interface RejectedRow {
  index: number;
  field: "serial" | "serial2";
  value: string;
  code: "empty" | "format" | "imei_check" | "duplicate_in_batch" | "same_as_imei1" | "exists";
  message: string;
}

/** A billing item (catalogue variant) from `GET /invoices/items`. */
export interface ShopItem {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  rate: number;
  gstRate: number;
}
