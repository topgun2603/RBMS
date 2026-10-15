/**
 * Ports the host (apps/api/src/kit.ts) wires to other modules. This package never imports them.
 */

/** The shop's billing seller profile (invoices `SellerProfile`, partial is fine). Seeds the default branch. */
export interface ShopProfile {
  legalName?: string | null;
  gstin?: string | null;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  stateCode?: string | null;
  phone?: string | null;
  invoicePrefix?: string | null;
}

/** Kit: `{ get: (t) => invoices.service.sellerProfile(t) }`. */
export interface ShopProfilePort {
  get(tenantId: string): Promise<ShopProfile | null>;
}

/** An inventory stock location. */
export interface LocationRef {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

/**
 * Inventory stock locations. Kit: `defaultLocation` = `inventory.ensureDefaultLocation`, `getLocation` =
 * `inventory.getLocation` (null on 404), `createLocation` = `inventory.createLocation({ name, code, type: "store", address })`.
 */
export interface LocationsPort {
  defaultLocation(tenantId: string): Promise<LocationRef>;
  /** Null when unknown. */
  getLocation(tenantId: string, id: string): Promise<LocationRef | null>;
  createLocation(tenantId: string, input: { name: string; code: string; address: string | null }): Promise<LocationRef>;
}

/** Sales of one branch in a date range. `branchId: null` = bills without a branch (issued before branches). */
export interface BranchSales {
  branchId: string | null;
  /** Paise, issued (non-cancelled) bills. */
  sales: number;
  bills: number;
}

/**
 * Numbers for `GET /summary`. Kit: `sales` from the invoices reports grouped by `invoices.branch_id` (issued,
 * not cancelled, bill date within from..to inclusive, IST); `stockValue` = `inventory.summary(t, { locationId }).stockValue`.
 */
export interface SummaryPort {
  sales(tenantId: string, range: { from: string; to: string }): Promise<BranchSales[]>;
  /** Paise, stock value at one location. */
  stockValue(tenantId: string, locationId: string): Promise<number>;
}

/** Optional check that a user is an active member of the shop before assigning them (kit: tenancy `getMember`). */
export interface MembersPort {
  isMember(tenantId: string, userId: string): Promise<boolean>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };
