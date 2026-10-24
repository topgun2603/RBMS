import type { FeatureDef, FeatureGatePort, PermissionDef, TenantRef } from "@srirealtime/core";

export type { FeatureGatePort };

export interface BillLine {
  description: string;
  itemId: string | null;
  qty: number;
  rate: number;
  gstRate: number;
  hsn: string | null;
  unit: string | null;
}

export interface BillResult {
  id: string;
  number: string | null;
  total: number;
}

/** Makes the GST bill for an order (invoices). The bill is issued; payment is taken on it as usual. */
export interface BillingPort {
  createBill(
    tenant: TenantRef,
    input: { lines: BillLine[]; customer: { name: string; phone: string | null; customerId?: string; dueDate?: string } | null; notes: string | null; tillSessionId: string | null },
    opts: { branchId: string | null },
  ): Promise<BillResult>;
}

/** Billing items (catalogue variants) by id, for rate / GST / HSN when staff add them to an order. */
export interface MenuSourcePort {
  items(tenantId: string, ids: string[]): Promise<{ id: string; name: string; rate: number; gstRate: number; hsn: string | null; unit: string }[]>;
  /** Every active item for the guests' QR menu (optional: without it the QR menu is empty). */
  list?(tenantId: string): Promise<MenuEntry[]>;
}

export interface MenuEntry {
  id: string;
  name: string;
  /** GST-exclusive paise per unit (what the order line and bill use). */
  rate: number;
  gstRate: number;
  categoryId: string | null;
  image: string | null;
}

/** Tells listeners (the kitchen display) that something changed for a shop. Optional. */
export interface DiningEventsPort {
  changed(tenantId: string, e: { kind: "kot" | "order"; id: string }): void | Promise<void>;
}

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export const noopLogger: LoggerPort = { info() {}, warn() {}, error() {} };

export const DINING_FEATURE = "dining";
export const DINING_KDS_FEATURE = "dining.kitchen-display";
export const DINING_QR_FEATURE = "dining.qr-ordering";
/** Zomato / Swiggy / ONDC orders through an aggregator (routes in @srirealtime/aggregators). */
export const DINING_PLATFORMS_FEATURE = "dining.aggregators";

export const DINING_SERVE = "dining.serve";
export const DINING_KITCHEN = "dining.kitchen";
export const DINING_BILL = "dining.bill";
export const DINING_MANAGE = "dining.manage";

export const DINING_FEATURES: FeatureDef[] = [
  {
    key: DINING_FEATURE,
    module: "dining",
    label: "Tables & kitchen orders",
    description: "Tables and areas, running orders for dine-in and takeaway, kitchen order tickets (KOT) per station and bills from orders.",
  },
  {
    key: DINING_KDS_FEATURE,
    module: "dining",
    label: "Kitchen display",
    description: "A screen in the kitchen showing new, cooking and ready tickets, updated live.",
    dependsOn: [DINING_FEATURE],
    shopToggle: true,
  },
  {
    key: DINING_QR_FEATURE,
    module: "dining",
    label: "QR table ordering",
    description: "Guests scan the table's QR code, see the menu and send their order to the kitchen.",
    dependsOn: [DINING_FEATURE],
    shopToggle: true,
  },
  {
    key: DINING_PLATFORMS_FEATURE,
    module: "dining",
    label: "Zomato & Swiggy orders",
    description: "Delivery-platform orders (through an aggregator such as UrbanPiper) arrive on the kitchen display: accept, reject, mark ready.",
    dependsOn: [DINING_FEATURE],
    shopToggle: true,
  },
];

export const DINING_PERMISSIONS: PermissionDef[] = [
  { key: DINING_SERVE, module: "dining", label: "Take orders", description: "Open tables and takeaways, add items and send KOTs to the kitchen." },
  { key: DINING_KITCHEN, module: "dining", label: "Kitchen", description: "See the kitchen display and mark tickets cooking, ready or served." },
  { key: DINING_BILL, module: "dining", label: "Bill orders", description: "Make bills from orders (split or whole), cancel sent items and cancel orders." },
  { key: DINING_MANAGE, module: "dining", label: "Manage tables & menu", description: "Areas, tables and QR codes, kitchen stations and sold-out items." },
];
