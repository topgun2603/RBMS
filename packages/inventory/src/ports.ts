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
}

export interface ItemCatalogPort {
  /** Items of the tenant with these ids (unknown or deleted ids are left out). */
  getItems(tenantId: string, ids: string[]): Promise<CatalogItem[]>;
  /** All saved items of the tenant, optionally filtered by name/HSN. */
  listItems(tenantId: string, q?: string): Promise<CatalogItem[]>;
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
