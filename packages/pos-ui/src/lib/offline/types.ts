import type { Invoice } from "../types";

/**
 * Offline billing on the counter (docs/offline-billing.md). A sale made while the internet is down becomes a
 * `QueuedBill` in IndexedDB; the sync engine posts it to POST /v1/pos/offline/sync with its `clientId` (a UUID, the
 * idempotency key), so a retry can never bill twice.
 */

export type QueuedStatus = "queued" | "syncing" | "synced" | "failed" | "voided";

export type OfflineFlagCode =
  | "stock_negative"
  | "price_changed"
  | "tax_changed"
  | "item_missing"
  | "customer_missing"
  | "number_reassigned"
  | "till_closed"
  | "payment_failed"
  | "late_sync";

export interface OfflineFlag {
  code: OfflineFlagCode;
  line?: number;
  detail?: Record<string, unknown>;
}

/** What is POSTed for one bill (the server's `offlineBillBody`). */
export interface OfflineBillPayload {
  clientId: string;
  deviceId: string;
  billedAt: string;
  date: string;
  number?: { blockId: string; seq: number };
  provisionalNumber?: string;
  customerId?: string;
  customer?: { name: string; phone?: string };
  lines: Record<string, unknown>[];
  snapshots?: { itemId: string; price: number; gstRate: number }[];
  payments: { method: "cash" | "upi" | "card"; amount: number; reference?: string }[];
  tillSessionId?: string;
  notes?: string;
  voided?: { reason: string };
}

/** What the pending-bills list shows without recomputing the bill. */
export interface BillDisplay {
  total: number;
  itemCount: number;
  customerName: string;
  cashier: string;
  /** Money received at the counter (cash applied + UPI + card). */
  received: number;
}

export interface QueuedError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface SyncedInfo {
  invoiceId: string | null;
  number: string | null;
  flags: OfflineFlag[];
  syncedAt: number;
}

export interface QueuedBill {
  clientId: string;
  /** Local order (the order bills were made in; they are synced oldest first). */
  order: number;
  status: QueuedStatus;
  /** ms epoch of the sale. */
  createdAt: number;
  payload: OfflineBillPayload;
  display: BillDisplay;
  /** The bill as an invoice (without id and number), to print and reprint the slip from the device. */
  receipt?: Omit<Invoice, "id" | "number">;
  /** The number on the slip: a legal invoice number from a reserved block, or "OFF-…" when none was left. */
  number: string;
  numberKind: "reserved" | "provisional";
  attempts: number;
  /** Earliest time the engine retries a failed bill by itself (ms); absent = only by hand. */
  nextTryAt?: number;
  /** ms when the current sync attempt started (to recover from a tab closed mid-sync). */
  syncingSince?: number;
  error?: QueuedError;
  result?: SyncedInfo;
}

/** A block of invoice numbers reserved from the server for this device. */
export interface LocalBlock {
  id: string;
  fy: string;
  prefix: string;
  fromSeq: number;
  toSeq: number;
  /** The next number to use; > toSeq = used up. */
  nextSeq: number;
  branchId: string | null;
  createdAt: number;
}

/** A customer remembered from an online search, for offline lookups. */
export interface CachedCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  stateCode: string | null;
  creditLimit: number | null;
  outstanding: number;
  advance: number;
  /** ms of the last time it was seen (recent first, oldest dropped). */
  seenAt: number;
}

export interface NumberingState {
  blocks: LocalBlock[];
  /** Last provisional number given out on this device. */
  counter: number;
  /** Last local order number given to a queued bill. */
  order: number;
}

/** Server answer for one bill (POST /pos/offline/sync). */
export interface SyncResultDto {
  clientId: string;
  status: "synced" | "voided" | "failed" | "in_progress";
  duplicate: boolean;
  invoiceId: string | null;
  number: string | null;
  total: number | null;
  paid: number | null;
  balance: number | null;
  flags: OfflineFlag[];
  error?: QueuedError;
}

export interface BlockDto {
  id: string;
  fy: string;
  prefix: string;
  fromSeq: number;
  toSeq: number;
  branchId: string | null;
  status: "open" | "closed";
}

export interface OfflineApi {
  sync(bills: OfflineBillPayload[]): Promise<SyncResultDto[]>;
  reserveBlock(count: number): Promise<BlockDto>;
  closeBlock(id: string): Promise<{ released: number[] }>;
}
