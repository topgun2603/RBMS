import type { GstRateRule } from "@srirealtime/gst";
/** API shapes of `/v1/pos` (docs/pos-terminals.md). Money in paise. */

export type TerminalRole = "pos" | "weighing";

export interface TerminalSettings {
  printerWidth: 58 | 80;
  autoPrint: boolean;
  /** 1..60, default 5. */
  lockAfterMinutes: number;
}

export interface TerminalDevice {
  platform: "web" | "android" | "ios";
  model: string | null;
  appVersion: string | null;
  name: string | null;
}

export interface Terminal {
  id: string;
  name: string;
  role: TerminalRole;
  branchId: string | null;
  locationId: string | null;
  settings: TerminalSettings;
  paired: boolean;
  device: TerminalDevice | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
  pairingPending: boolean;
  createdAt: string;
}

export interface Pairing {
  /** "ABCD-2345". */
  code: string;
  expiresAt: string;
  /** "srikit-pair:1:<apiOrigin>:<code>". */
  qr: string;
}

export interface PosShop {
  id: string;
  slug: string;
  name: string;
  appId: string | null;
}

export interface TerminalList {
  items: Terminal[];
  total: number;
  /** Plan limit of terminals (null = unlimited). */
  limit: number | null;
}

export interface PairResponse {
  deviceToken: string;
  terminal: Terminal;
  shop: PosShop;
}

export interface DeviceInfo {
  terminal: Terminal;
  shop: PosShop;
  features: string[];
}

export interface PinSession {
  token: string;
  expiresAt: string;
  user: { id: string; name: string | null };
  permissions: string[];
  tenantRoles: string[];
}

export interface StaffEntry {
  userId: string;
  /** Null when the member has no name on their profile. */
  name: string | null;
  hasPin: boolean;
}

export interface PinRow extends StaffEntry {
  updatedAt: string | null;
}

export interface PosItemStock {
  qty: number;
  status: "ok" | "low" | "out" | "untracked";
}

export interface PosItem {
  /** Variant id (or billing item id when the catalogue is off). */
  itemId: string;
  productId: string | null;
  name: string;
  variantTitle: string;
  sku: string | null;
  barcodes: string[];
  categoryId: string | null;
  price: number;
  mrp: number | null;
  taxInclusive: boolean;
  gstRate: number;
  /** Price-band GST (apparel / footwear); `gstRate` is the band at `price`. */
  gstRule?: GstRateRule | null;
  hsn: string | null;
  unit: string;
  soldBy: "unit" | "weight";
  plu: string | null;
  image: string | null;
  stock: PosItemStock | null;
  active: boolean;
  updatedAt: string;
}

export interface CatalogPage {
  items: PosItem[];
  removed: string[];
  cursor: string;
  next: string | null;
  /** "Replace your cache" (no `since`, or `since` too old). */
  full: boolean;
}

export interface PosCategory {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
}

export interface WeighTicketLine {
  itemId: string;
  name: string;
  unit: string;
  /** kg (3 decimals) for weighed items, a count otherwise. */
  qty: number;
  /** Paise per unit as the catalogue sells. */
  unitPrice: number;
  amount: number;
  taxInclusive: boolean;
  gstRate: number;
  hsn: string | null;
  tareKg?: number | null;
}

export type WeighTicketStatus = "open" | "used" | "cancelled";

export interface WeighTicket {
  id: string;
  /** "W" + 11 digits; also the Code 128 barcode text. */
  code: string;
  terminalId: string;
  status: WeighTicketStatus;
  lines: WeighTicketLine[];
  total: number;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  usedInvoiceId: string | null;
}
