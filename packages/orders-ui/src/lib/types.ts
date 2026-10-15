/** API shapes used by the orders UI (mirrors @srirealtime/orders, coupons, delivery and catalogue; dates arrive as ISO strings). */

export type ISODate = string;

export interface Paged<T> {
  items: T[];
  total: number;
}

// ------------------------------------------------------------------ orders

export const ORDER_STATUSES = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled", "returned"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_CHANNELS = ["store", "manual", "pos", "marketplace"] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const PAYMENT_STATUSES = ["unpaid", "pending", "paid", "cod", "refunded", "partially_refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const ORDER_PAYMENT_METHODS = ["cash", "upi", "card", "online", "cod", "other"] as const;
export type OrderPaymentMethod = (typeof ORDER_PAYMENT_METHODS)[number];

/** Methods for a manual payment (POST /orders/:id/payments). */
export const MANUAL_PAYMENT_METHODS = ["cash", "upi", "card", "bank", "cheque", "other"] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export const REFUND_METHODS = ["cash", "upi", "card", "bank", "online", "other"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export type OrderEventType = "status" | "payment" | "note" | "fulfillment" | "refund";

export interface OrderCustomer {
  name: string;
  phone: string | null;
  email: string | null;
  customerId?: string | null;
  accountId?: string | null;
  locale?: string | null;
}

export interface Address {
  name?: string | null;
  phone?: string | null;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  city: string;
  district?: string | null;
  stateCode: string;
  pincode: string;
  country?: string;
}

export interface Fulfillment {
  carrier?: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  shipmentId?: string | null;
}

export interface OrderLine {
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  image: string | null;
  qty: number;
  unit: string;
  price: number;
  rate: number;
  gstRate: number;
  hsn: string | null;
  taxInclusive: boolean;
  discount: number;
  amount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface OrderTotals {
  subtotal: number;
  discount: number;
  shipping: number;
  shippingWaived: number;
  codFee?: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  sellerState: string;
  placeOfSupply: string;
  interState: boolean;
}

export interface OrderEvent {
  id: string;
  type: OrderEventType;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  message: string | null;
  actorUserId: string | null;
  data: Record<string, unknown>;
  createdAt: ISODate;
}

export interface OrderSummary {
  id: string;
  number: string;
  channel: OrderChannel;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: OrderPaymentMethod;
  customerName: string;
  customerPhone: string | null;
  itemCount: number;
  total: number;
  paid: number;
  placedAt: ISODate;
}

export interface OrderListResult extends Paged<OrderSummary> {
  counts: Record<OrderStatus, number>;
}

export interface Order {
  id: string;
  number: string;
  channel: OrderChannel;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: OrderPaymentMethod;
  customer: OrderCustomer;
  shippingAddress: Address | null;
  billingAddress: Address | null;
  lines: OrderLine[];
  totals: OrderTotals;
  total: number;
  paid: number;
  refunded: number;
  balance: number;
  currency: string;
  fulfillment: Fulfillment;
  stockState: string;
  couponCode: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  notes: string | null;
  customerNote: string | null;
  cancelReason: string | null;
  accessToken: string;
  placedAt: ISODate;
  confirmedAt: ISODate | null;
  shippedAt: ISODate | null;
  deliveredAt: ISODate | null;
  cancelledAt: ISODate | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  events: OrderEvent[];
  nextStatuses: OrderStatus[];
}

export interface OrdersSummary {
  today: { count: number; total: number };
  pending: { placed: number; confirmed: number; packed: number };
  month: { count: number; total: number };
}

export interface OrderListFilters {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  channel?: OrderChannel;
  q?: string;
  from?: string;
  to?: string;
}

export interface ManualOrderInput {
  channel?: "manual" | "pos" | "marketplace";
  customer: { name: string; phone?: string | null; email?: string | null };
  shippingAddress?: Address | null;
  lines: { variantId: string; qty: number; price?: number | null }[];
  couponCode?: string | null;
  paymentMethod: OrderPaymentMethod;
  shipping?: number;
  notes?: string | null;
  customerNote?: string | null;
  markPaid?: boolean;
  paymentReference?: string | null;
}

export interface StatusInput {
  status: OrderStatus;
  note?: string | null;
  fulfillment?: Fulfillment;
}

export interface OrderSettings {
  prefix: string;
  invoiceOn: "confirmed" | "delivered";
  allowBackorder: boolean;
  autoConfirm: boolean;
  notifyOwner: boolean;
}

// ------------------------------------------------------------------ coupons

export const COUPON_TYPES = ["percent", "flat", "free_shipping"] as const;
export type CouponType = (typeof COUPON_TYPES)[number];
export const COUPON_APPLIES_TO = ["all", "categories", "products"] as const;
export type CouponAppliesTo = (typeof COUPON_APPLIES_TO)[number];
export const COUPON_CHANNELS = ["store", "manual", "pos", "marketplace", "billing"] as const;
export type CouponChannel = (typeof COUPON_CHANNELS)[number];

export const COUPON_REASONS = [
  "not_found",
  "inactive",
  "not_started",
  "expired",
  "min_order",
  "usage_limit",
  "customer_limit",
  "first_order_only",
  "not_applicable",
  "wrong_channel",
] as const;
export type CouponReason = (typeof COUPON_REASONS)[number];

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  type: CouponType;
  value: number;
  maxDiscount: number | null;
  minOrder: number;
  startsAt: ISODate | null;
  endsAt: ISODate | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  firstOrderOnly: boolean;
  appliesTo: CouponAppliesTo;
  targetIds: string[];
  channels: CouponChannel[];
  active: boolean;
  usedCount: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface CouponInput {
  code: string;
  description?: string | null;
  type: CouponType;
  value: number;
  maxDiscount?: number | null;
  minOrder?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  firstOrderOnly?: boolean;
  appliesTo?: CouponAppliesTo;
  targetIds?: string[];
  channels?: CouponChannel[];
  active?: boolean;
}

export interface Redemption {
  id: string;
  couponId: string;
  refType: "order" | "invoice";
  refId: string;
  customerKey: string | null;
  amount: number;
  status: "active" | "released";
  createdAt: ISODate;
}

export type CouponEvaluation =
  | { valid: true; couponId: string; code: string; type: CouponType; discount: number; freeShipping: boolean; shippingDiscount: number }
  | { valid: false; reason: CouponReason; message: string };

// ------------------------------------------------------------------ delivery

export const RATE_TYPES = ["flat", "weight", "free_above"] as const;
export type RateType = (typeof RATE_TYPES)[number];

export const SHIPMENT_STATUSES = ["created", "pickup_scheduled", "in_transit", "out_for_delivery", "delivered", "rto", "cancelled"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];
export type CarrierProvider = "manual" | "shiprocket" | "mock";

export interface WeightSlab {
  upToGrams: number;
  amount: number;
}

export interface Rate {
  id: string;
  zoneId: string;
  name: string;
  type: RateType;
  amount: number;
  freeAbove: number | null;
  weightSlabs: WeightSlab[];
  etaMinDays: number;
  etaMaxDays: number;
  codAllowed: boolean;
  codFee: number;
  active: boolean;
  sort: number;
}

export type RateInput = Omit<Rate, "id">;

export interface Zone {
  id: string;
  name: string;
  states: string[];
  pincodePrefixes: string[];
  pincodes: string[];
  active: boolean;
  sort: number;
  rates: Rate[];
}

export type ZoneInput = Pick<Zone, "name" | "states" | "pincodePrefixes" | "pincodes" | "active"> & { sort?: number };

export interface ZoneList extends Paged<Zone> {
  /** No active zones: checkout uses the implicit "All India" ₹0 flat rate. */
  implicitDefault: boolean;
}

export interface DeliveryOption {
  id: string;
  name: string;
  amount: number;
  etaDays: [number, number];
  codAllowed: boolean;
  codFee: number;
}

export interface Quote {
  serviceable: boolean;
  options: DeliveryOption[];
  zone?: { id: string; name: string } | null;
}

export interface PincodeInfo {
  pincode: string;
  city: string;
  district: string;
  state: string;
  stateCode: string | null;
  approximate?: boolean;
}

export interface PackageDims {
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  weightGrams: number;
}

export interface CarrierAccount {
  configured: boolean;
  provider: "shiprocket";
  email: string | null;
  pickupLocation: string | null;
  enabled: boolean;
  defaultPackage: PackageDims | null;
  webhookTokenSet: boolean;
  webhookUrl: string;
  webhookHeader: string;
  /** Only in the response that created or rotated it. */
  newWebhookToken?: string;
}

export interface CarrierAccountInput {
  email: string;
  password?: string;
  pickupLocation: string;
  enabled: boolean;
  defaultPackage?: PackageDims | null;
  rotateWebhookToken?: boolean;
}

export interface ShipmentEvent {
  at: ISODate;
  status: ShipmentStatus | null;
  label: string;
  location?: string | null;
  source: string;
}

export interface Shipment {
  id: string;
  orderId: string;
  provider: CarrierProvider;
  awb: string | null;
  courier: string | null;
  status: ShipmentStatus;
  statusLabel: string;
  trackingUrl: string | null;
  labelUrl: string | null;
  events: ShipmentEvent[];
  cost: number | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface ShipmentInput {
  provider: CarrierProvider;
  courier?: string | null;
  awb?: string | null;
  trackingUrl?: string | null;
  package?: PackageDims | null;
}

// ------------------------------------------------------------------ catalogue (pickers)

export interface VariantLookup {
  id: string;
  productId: string;
  name: string;
  productName: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  price: number;
  mrp: number | null;
  gstRate: number;
  taxInclusive: boolean;
  image: string | null;
  weightGrams: number | null;
  status: string;
}

export interface CategoryLite {
  id: string;
  parentId: string | null;
  name: string;
  productCount?: number;
}

export interface ProductLite {
  id: string;
  name: string;
  image: string | null;
  priceMin?: number;
  priceMax?: number;
}
