export const MEDICINE_SCHEDULES = ["otc", "G", "H", "H1", "X", "narcotic"] as const;
export type MedicineSchedule = (typeof MEDICINE_SCHEDULES)[number];

export const BATCH_STATUSES = ["in_stock", "expiring", "expired", "empty"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export type ExpiryStatus = "expired" | "expiring" | "ok";

export interface Medicine {
  id: string;
  itemId: string;
  name: string;
  composition: string | null;
  manufacturer: string | null;
  schedule: MedicineSchedule;
  packSize: number;
  packUnit: string;
  rack: string | null;
  note: string | null;
  prescriptionRequired: boolean;
  inRegister: boolean;
  updatedAt: string;
}

export interface Batch {
  id: string;
  itemId: string;
  itemName: string;
  batchNo: string;
  expiry: string;
  mrp: number | null;
  purchaseRate: number | null;
  qty: number;
  supplier: string | null;
  status: ExpiryStatus;
  daysLeft: number;
  createdAt: string;
}

export const MOVEMENT_REASONS = ["receive", "sale", "sale_cancel", "adjust", "expired", "damaged", "return_to_supplier"] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

export interface Movement {
  id: string;
  delta: number;
  qtyAfter: number;
  reason: MovementReason;
  refType: string | null;
  refId: string | null;
  refNumber: string | null;
  note: string | null;
  createdAt: string;
}

export interface Prescription {
  id: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  patientName: string;
  patientAge: number | null;
  patientPhone: string | null;
  patientAddress: string | null;
  doctorName: string;
  doctorRegNo: string | null;
  doctorAddress: string | null;
  rxDate: string;
  imageUrl: string | null;
  note: string | null;
  createdAt: string;
}

export interface RegisterEntry {
  movementId: string;
  date: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  itemId: string;
  itemName: string;
  composition: string | null;
  schedule: MedicineSchedule;
  batchNo: string;
  expiry: string;
  qty: number;
  prescription: Pick<
    Prescription,
    "id" | "patientName" | "patientAge" | "patientPhone" | "patientAddress" | "doctorName" | "doctorRegNo" | "rxDate"
  > | null;
}

export interface ExpirySummary {
  within: number;
  expired: { batches: number; qty: number; value: number };
  expiring: { batches: number; qty: number; value: number };
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

/** A bill from `GET /invoices` (only what the prescription picker shows). */
export interface BillSummary {
  id: string;
  number: string | null;
  date: string;
  customer?: { name: string } | null;
  customerName?: string | null;
  total: number;
}
