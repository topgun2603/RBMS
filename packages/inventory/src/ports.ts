import type { DbOrTx } from "@srirealtime/db";
import type { SQL } from "drizzle-orm";
/** Saved item details; items are owned by the invoices module (apps/api wires the adapter). */
export interface CatalogItem {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  /** Selling rate, paise per unit. */
  rate: number;
  gstRate: number;
  /** Optional: the item's category (stock lists filter by it). */
  categoryId?: string | null;
  categoryName?: string | null;
  /** Optional: scan codes (stock audits match a scanned code against these). */
  sku?: string | null;
  barcode?: string | null;
  /** Optional: grams per unit (landed charges spread by weight). */
  weightGrams?: number | null;
}

export interface ItemCatalogPort {
  /** Items of the tenant with these ids (unknown or deleted ids are left out). */
  getItems(tenantId: string, ids: string[]): Promise<CatalogItem[]>;
  /** All saved items of the tenant, optionally filtered by name/HSN. */
  listItems(tenantId: string, q?: string): Promise<CatalogItem[]>;
}

/**
 * Expenses bought on credit from a supplier (packages/expenses, wired in apps/api): bills in the supplier's Payables,
 * paid through "Pay supplier" like purchase bills (docs/expenses-debit-notes.md). Only recorded expenses with payment
 * method "credit" and a supplier are bills.
 */
export interface ExpenseBill {
  id: string;
  supplierId: string;
  supplierName: string;
  /** The supplier's bill number (the expense reference) or the category name. */
  ref: string;
  category: string;
  date: string;
  dueDate: string | null;
  /** Paise including GST. */
  total: number;
  /** Paise paid through Payables. */
  amountPaid: number;
  createdAt: Date;
}

export interface ExpenseBillsPort {
  /** Credit expenses of one supplier (or of the given ids, or of every supplier); `lock` = select … for update. */
  bills(db: DbOrTx, tenantId: string, q: { supplierId?: string; ids?: string[]; lock?: boolean }): Promise<ExpenseBill[]>;
  /** Stores what has been paid on an expense (the sum of its live payment rows). */
  setPaid(db: DbOrTx, tenantId: string, expenseId: string, amountPaid: number): Promise<void>;
  /** SQL: paise still unpaid on the credit expenses of the supplier `supplierId` of shop `tenantId` (supplier list balances). */
  unpaidSql(tenantId: SQL, supplierId: SQL): SQL<string>;
}

/** The shop's own GST state code (from the billing seller profile). */
export interface SellerStatePort {
  stateCode(tenantId: string): Promise<string | null>;
}

/**
 * Outgoing domain events (the developer module's webhooks, wired in kit). Best effort: errors are logged and never
 * fail the stock operation. Emits `stock.low` `{ itemId, name, locationId, qty, reorderLevel, status }` (status
 * "low" | "out") when a tracked item at a location goes ok -> low/out or low -> out through applySale, commit, adjust
 * or a transfer out.
 */
export interface EventsPort {
  emit(tenantId: string, type: string, data: unknown): Promise<void>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

/**
 * The pharmacy module's batches (packages/medicines) stay where they are. Generic batches never take over an item
 * that already has medicine batches, and the expiry dashboard adds the medicine totals. apps/api wires the adapter.
 */
export interface LegacyBatchPort {
  /** True when Pharmacy manages the item: it has medicine details or medicine batches. */
  hasBatches(tenantId: string, itemId: string): Promise<boolean>;
  /** Expired and soon-expiring medicine stock; null when the shop does not use medicines. */
  expirySummary(
    tenantId: string,
    withinDays: number,
  ): Promise<{ expired: { batches: number; qty: number; value: number }; expiring: { batches: number; qty: number; value: number } } | null>;
}

/** Tells the receiving side of a transfer that goods are on the way (wired to notify / a push in apps/api). Best effort. */
export interface TransferNoticePort {
  sent(
    tenantId: string,
    e: { transferId: string; number: string; fromLocationId: string; toLocationId: string; fromName: string; toName: string; items: number },
  ): Promise<void>;
}
