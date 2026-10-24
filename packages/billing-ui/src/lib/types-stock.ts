/** Wire types of batches and expiry, stock audits and stock transfers (/v1/inventory/...). Money is paise, dates YYYY-MM-DD. */

export type ExpiryStatus = "expired" | "expiring" | "ok" | "none";
export type ExpiredPolicy = "block" | "warn" | "allow";
export type PickRule = "fefo" | "manual";

export interface Batch {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  batchNo: string;
  mfgDate: string | null;
  expiry: string | null;
  mrp: number | null;
  cost: number | null;
  supplierName: string | null;
  note: string | null;
  qty: number;
  status: ExpiryStatus;
  daysLeft: number | null;
  value: number;
  suggestedDiscount: number | null;
  createdAt: string;
  levels?: { locationId: string; qty: number }[];
}

export interface BatchSettings {
  trackAll: boolean;
  expiredPolicy: ExpiredPolicy;
  pickRule: PickRule;
  alertDays: number;
  discountLadder: { days: number; pct: number }[];
}

export interface BatchMovement {
  id: string;
  delta: number;
  qtyAfter: number;
  reason: string;
  refType: string | null;
  refNumber: string | null;
  note: string | null;
  locationId: string;
  createdAt: string;
}

export interface BatchBucket {
  batches: number;
  qty: number;
  value: number;
}

export interface ExpirySummary {
  today: string;
  alertDays: number;
  expired: BatchBucket;
  expiring: BatchBucket;
  buckets: ({ label: "0-30" | "31-60" | "61-90" } & BatchBucket)[];
  medicines: { expired: BatchBucket; expiring: BatchBucket } | null;
}

export interface PickOption {
  batchId: string;
  batchNo: string;
  expiry: string | null;
  mrp: number | null;
  qty: number;
  status: ExpiryStatus;
  daysLeft: number | null;
  suggestedDiscount: number | null;
}

export interface PickAnswer {
  itemId: string;
  tracked: boolean;
  rule: PickRule;
  expiredPolicy: ExpiredPolicy;
  batches: PickOption[];
  suggestion: { batchId: string; qty: number }[];
  short: number;
}

export interface BatchReceiveInput {
  itemId: string;
  batchNo: string;
  expiry?: string;
  mfgDate?: string;
  mrp?: number;
  cost?: number;
  qty: number;
  locationId?: string;
  mode?: "receive" | "assign";
  note?: string;
}

export interface BatchAdjustInput {
  mode: "add" | "remove" | "set";
  qty: number;
  reason: "adjustment" | "expired" | "damaged";
  note?: string;
}

// ---------------------------------------------------------------- stock audit

export type AuditStatus = "draft" | "counting" | "review" | "approved" | "cancelled";

export interface AuditTotals {
  lines: number;
  counted: number;
  varianceLines: number;
  surplusValue: number;
  shortageValue: number;
  netValue: number;
}

export interface StockAudit {
  id: string;
  number: string;
  status: AuditStatus;
  locationId: string;
  locationName: string;
  categoryIds: string[];
  title: string | null;
  note: string | null;
  snapshotAt: string;
  createdAt: string;
  startedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  totals: AuditTotals;
  counters: string[];
}

export interface AuditLine {
  id: string;
  itemId: string;
  batchId: string | null;
  itemName: string;
  unit: string | null;
  barcode: string | null;
  sku: string | null;
  batchNo: string | null;
  expiry: string | null;
  systemQty: number;
  countedQty: number | null;
  variance: number;
  unitCost: number | null;
  value: number;
  reason: string | null;
  note: string | null;
  applied: boolean;
}

export interface AuditCountEntry {
  lineId?: string;
  code?: string;
  itemId?: string;
  batchId?: string;
  qty?: number;
  mode?: "add" | "set";
}

export interface AuditCountResult {
  results: { lineId: string; itemName: string; batchNo: string | null; counted: number; created: boolean }[];
  unknown: string[];
}

// ---------------------------------------------------------------- transfers

export type TransferStatus = "draft" | "in_transit" | "partially_received" | "closed" | "cancelled";

export interface TransferBatchPart {
  batchId: string;
  batchNo: string;
  expiry: string | null;
  qty: number;
  received?: number;
  damaged?: number;
  short?: number;
}

export interface TransferLine {
  itemId: string;
  qty: number;
  itemName?: string;
  unit?: string;
  unitCost?: number | null;
  received?: number;
  damaged?: number;
  short?: number;
  reason?: string | null;
  batches?: TransferBatchPart[];
}

export interface Transfer {
  id: string;
  number: string | null;
  status: TransferStatus;
  fromLocationId: string;
  toLocationId: string;
  lines: TransferLine[];
  note: string | null;
  transport: string | null;
  receiveNote: string | null;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  closedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  fromName?: string;
  toName?: string;
  fromCode?: string;
  toCode?: string;
}

export interface TransferInput {
  fromLocationId: string;
  toLocationId: string;
  lines: { itemId: string; qty: number; batchId?: string }[];
  note?: string;
  transport?: string;
  send?: boolean;
}

export interface TransferReceiveInput {
  lines?: { itemId: string; received: number; damaged?: number; short?: number; reason?: string; batches?: { batchId: string; received: number; damaged?: number; short?: number }[] }[];
  all?: boolean;
  closeShort?: boolean;
  note?: string;
}

export interface InTransitRow {
  transferId: string;
  number: string | null;
  status: TransferStatus;
  fromLocationId: string;
  toLocationId: string;
  sentAt: string | null;
  itemId: string;
  itemName: string;
  unit: string;
  qty: number;
  value: number;
  batches: { batchNo: string; expiry: string | null; qty: number }[];
  days: number;
}

export interface InTransitReport {
  items: InTransitRow[];
  totals: { transfers: number; lines: number; value: number };
}

export interface StockLocationLite {
  id: string;
  name: string;
  code: string;
  isDefault?: boolean;
  active?: boolean;
}
