import type { AuditPort, FeatureDef, PermissionDef, TenantRef } from "@srirealtime/core";
import type { DbOrTx } from "@srirealtime/db";
import type { OfflineFlag } from "./schema";

/** One sellable line of the POS catalogue (docs/pos-terminals.md `PosItem`). Money in paise. */
export interface PosItem {
  /** Catalogue variant id (billing items are catalogue variants too). */
  itemId: string;
  /** Null when the shop's catalogue feature is off (plain billing items). */
  productId: string | null;
  name: string;
  variantTitle: string;
  sku: string | null;
  barcodes: string[];
  categoryId: string | null;
  /** As the catalogue sells it (incl. GST when `taxInclusive`); per kg for weighed items. */
  price: number;
  mrp: number | null;
  taxInclusive: boolean;
  /** The rate at `price` (a price-band product's band before any discount). */
  gstRate: number;
  /** Price-band GST (apparel / footwear: 5% up to ₹2,500 taxable per piece, 18% above); bills re-band after discounts. */
  gstRule?: { kind: "price-band"; threshold: number; below: number; above: number } | null;
  hsn: string | null;
  unit: string;
  soldBy: "unit" | "weight";
  /** The scales PLU, as text. */
  plu: string | null;
  image: string | null;
  stock: { qty: number; status: "ok" | "low" | "out" | "untracked" } | null;
  active: boolean;
  updatedAt: Date;
  /**
   * Alternate units (docs/price-lists-units.md): 1 box = `factor` × `unit`. `price` is for one of the unit (its own
   * price, else factor × price); a unit barcode adds one of that unit. Absent = sold in `unit` only.
   */
  units?: { unit: string; factor: number; barcode: string | null; price: number; ownPrice: number | null; mrp: number | null }[];
  /** Packaging weight of the scale PLU (kg); internal (weigh-ticket pricing), never sent to clients. */
  tareKg?: number | null;
}

export interface PosCategory {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
}

/**
 * The host's view of the catalogue for the POS (apps/api kit-pos.ts). Rows are ordered by item id; `afterId` is the
 * keyset. `since` null = every sellable item (`item` always set); a `since` time = every item changed after it,
 * `item: null` for those no longer sellable (deleted, archived, store-only, …).
 */
export interface PosCatalogPort {
  rows(tenantId: string, q: { since: Date | null; afterId: string | null; limit: number }): Promise<{ id: string; item: PosItem | null }[]>;
  categories(tenantId: string): Promise<PosCategory[]>;
  /** Sellable items by id (weigh-ticket pricing); unknown or unsellable ids are left out. */
  items(tenantId: string, ids: string[]): Promise<PosItem[]>;
}

/** PIN sessions (auth). */
export interface PosSessionsPort {
  create(userId: string, input: { terminalId: string; ttlMinutes: number; ip: string | null; userAgent: string | null }): Promise<{ token: string; expiresAt: Date; sessionId: string }>;
  /** Revokes every PIN session of the terminal. */
  revokeTerminal(terminalId: string): Promise<number>;
  /** Revokes one session if it is a PIN session of this terminal; false otherwise. */
  revokeOne(sessionId: string, terminalId: string): Promise<boolean>;
}

/** Shop members (tenancy + staff + auth). */
export interface PosMembersPort {
  /** Active members with their roles. */
  list(tenantId: string): Promise<{ userId: string; roles: string[] }[]>;
  /** Roles of an active member; [] when not a member. */
  rolesFor(tenantId: string, userId: string): Promise<string[]>;
  permissionsFor(tenantId: string, roles: string[]): Promise<string[]>;
  /** Display names of active users (unknown / inactive users are left out). */
  users(userIds: string[]): Promise<{ id: string; name: string | null }[]>;
}

export interface PosShop {
  id: string;
  slug: string;
  name: string;
  appId: string | null;
}

export interface PosTenantsPort {
  /** The tenant for a device's terminal; throws 403 for a suspended shop, null when it doesn't exist. */
  ref(tenantId: string): Promise<TenantRef | null>;
  shop(tenantId: string): Promise<PosShop | null>;
}

/** Plan limits (plans). `limit` -1 = unlimited; `consume` throws 402 `plan_limit`. */
export interface PosQuotaPort {
  limit(tenant: TenantRef, key: string): Promise<number>;
  consume(tenant: TenantRef, key: string, amount?: number): Promise<unknown>;
  release(tenant: TenantRef, key: string, amount?: number): Promise<void>;
}

export interface PosFeaturesPort {
  isEnabled(tenantId: string, key: string): Promise<boolean>;
  /** Keys of every feature that is on for the shop. */
  enabled(tenantId: string): Promise<string[]>;
}

export interface PosBranchesPort {
  /** The branch with its stock location; null when unknown. */
  get(tenantId: string, branchId: string): Promise<{ id: string; locationId: string | null; active: boolean } | null>;
}

export interface PosBillsPort {
  exists(tenantId: string, invoiceId: string): Promise<boolean>;
}

/** A block of consecutive invoice numbers taken from a (branch, FY) series. */
export interface PosSeqBlock {
  branchId: string | null;
  fy: string;
  prefix: string;
  fromSeq: number;
  toSeq: number;
}

export interface PosOfflineIssueInput {
  /** Bill date (IST day the cashier made it). */
  date: string;
  branchId: string | null;
  customerId?: string;
  customer?: { name: string; phone?: string };
  /** Invoice API lines, exactly as the counter built them (rate, gstRate, discount, itemId ...). */
  lines: Record<string, unknown>[];
  notes?: string;
  tillSessionId?: string;
  userId: string;
  /** A reserved number to issue with (FY, prefix and sequence). */
  preset?: { fy: string; prefix: string; seq: number };
}

export interface PosOfflineIssued {
  invoiceId: string;
  number: string;
  fy: string;
  seq: number;
  total: number;
  paid: number;
  balance: number;
  /** customer_missing / till_closed noticed while issuing. */
  flags: OfflineFlag[];
}

export interface PosBillInfo {
  invoiceId: string;
  number: string | null;
  total: number;
  paid: number;
  balance: number;
}

/** The host's view of the invoices module for offline bills (apps/api kit-pos.ts). */
export interface PosInvoicesPort {
  /** Takes `count` numbers; `inTx` runs in the same transaction (records the block atomically with the numbers). */
  reserveBlock(
    tenant: TenantRef,
    q: { branchId: string | null; count: number },
    inTx: (tx: DbOrTx, block: PosSeqBlock) => Promise<void>,
  ): Promise<PosSeqBlock>;
  /** Issues the bill (customer fallback, till fallback); throws AppError for refusals. */
  issue(tenant: TenantRef, input: PosOfflineIssueInput): Promise<PosOfflineIssued>;
  /** Records the payments taken at the counter; a payment that is refused is reported as a flag, never thrown. */
  pay(
    tenant: TenantRef,
    invoiceId: string,
    input: { date: string; payments: { method: "cash" | "upi" | "card"; amount: number; reference?: string }[]; tillSessionId?: string; userId: string },
  ): Promise<{ paid: number; balance: number; flags: OfflineFlag[] }>;
  get(tenant: TenantRef, invoiceId: string): Promise<PosBillInfo | null>;
  /** The bill that holds a reserved number, if any. */
  findBySeq(tenant: TenantRef, q: { branchId: string | null; fy: string; seq: number }): Promise<PosBillInfo | null>;
}

export interface LoggerPort {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface PosConfig {
  /** Key for PIN lookups (derive it from APP_SECRET; never the raw secret). */
  pinKey: string;
  /** Public API origin for the pairing QR, e.g. "https://api.srikit.in". */
  apiOrigin: string;
}

export const PLAN_LIMIT_KEY = "pos_terminals";

export const POS_FEATURE_KEYS = { terminals: "pos.terminals", weighing: "pos.weighing" } as const;
export const POS_PERMISSION_KEYS = { devices: "pos.devices", weigh: "pos.weigh" } as const;

export const POS_FEATURES: FeatureDef[] = [
  {
    key: POS_FEATURE_KEYS.terminals,
    module: "pos",
    label: "POS terminals",
    description: "Pair counters and phones as POS terminals, unlock them with staff PINs and keep the full item list on the device.",
    shopToggle: true,
  },
  {
    key: POS_FEATURE_KEYS.weighing,
    module: "pos",
    label: "Weighing station",
    description: "A weighing terminal weighs loose goods and prints a ticket; the counter scans it at the server's prices.",
    dependsOn: [POS_FEATURE_KEYS.terminals, "scales"],
    shopToggle: true,
    defaultOn: false,
  },
];

export const POS_PERMISSIONS: PermissionDef[] = [
  { key: POS_PERMISSION_KEYS.devices, module: "pos", label: "Manage POS terminals", description: "Add terminals, pair and unpair devices and reset staff PINs." },
  { key: POS_PERMISSION_KEYS.weigh, module: "pos", label: "Use the weighing station", description: "Weigh goods and issue weigh tickets on a weighing terminal." },
];

export type { AuditPort };
