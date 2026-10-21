export const ORDER_TYPES = ["dine_in", "takeaway", "delivery", "online"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];
export type OrderStatus = "open" | "billed" | "cancelled";
export type OrderSource = "staff" | "qr" | "online" | "aggregator";
/** Delivery platforms of aggregator orders. */
export const PLATFORMS = ["zomato", "swiggy", "ondc", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type LineStatus = "pending" | "sent" | "cancelled";
export const KOT_STATUSES = ["new", "preparing", "ready", "served", "cancelled"] as const;
export type KotStatus = (typeof KOT_STATUSES)[number];

export interface Area {
  id: string;
  name: string;
  sort: number;
}

export interface DiningTable {
  id: string;
  areaId: string | null;
  name: string;
  seats: number;
  sort: number;
  active: boolean;
  qrToken: string;
}

export interface FloorTable extends DiningTable {
  order: { id: string; number: number; guests: number | null; amount: number; openedAt: string; activeKots: number; readyKots: number } | null;
}

export interface OrderSummary {
  id: string;
  number: number;
  type: OrderType;
  source: OrderSource;
  status: OrderStatus;
  tableId: string | null;
  tableName: string | null;
  guests: number | null;
  customerName: string | null;
  customerPhone: string | null;
  note: string | null;
  amount: number;
  activeKots: number;
  readyKots: number;
  pendingCount: number;
  createdAt: string;
  /** Aggregator orders: the platform and the time the food must be ready. */
  platform?: Platform | null;
  dueAt?: string | null;
  /** GST paid by the platform (section 9(5)): settled from Online orders, never billed. */
  taxByOperator?: boolean;
}

export interface Floor {
  areas: Area[];
  tables: FloorTable[];
  orders: OrderSummary[];
}

export interface OrderLine {
  id: string;
  itemId: string | null;
  name: string;
  qty: number;
  rate: number;
  gstRate: number;
  note: string | null;
  station: string;
  status: LineStatus;
  kotId: string | null;
  cancelReason: string | null;
  amount: number;
  createdAt: string;
}

export interface Kot {
  id: string;
  orderId: string;
  number: number;
  station: string;
  status: KotStatus;
  hasVoids: boolean;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
}

export interface Order extends Omit<OrderSummary, "activeKots" | "readyKots"> {
  items: OrderLine[];
  kots: Kot[];
  invoiceIds: string[];
  closedAt: string | null;
}

export interface KitchenTicket extends Kot {
  orderNumber: number;
  orderType: OrderType;
  orderSource: OrderSource;
  platform: Platform | null;
  dueAt: string | null;
  tableName: string | null;
  customerName: string | null;
  orderNote: string | null;
  items: { id: string; name: string; qty: number; note: string | null; status: LineStatus; cancelReason: string | null }[];
}

export interface MenuSetting {
  itemId: string;
  station: string;
  veg: boolean | null;
  available: boolean;
}

/** A billing item (catalogue variant) from `GET /invoices/items`. */
export interface ShopItem {
  id: string;
  name: string;
  unit: string;
  rate: number;
  gstRate: number;
}

export interface BillResult {
  id: string;
  number: string | null;
  total: number;
}
