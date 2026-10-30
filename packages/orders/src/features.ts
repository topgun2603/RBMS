import type { FeatureDef } from "@rbms/core";

export const ORDER_FEATURES_KEYS = {
  base: "orders",
  returns: "orders.returns",
} as const;

export const ORDER_FEATURES: FeatureDef[] = [
  {
    key: ORDER_FEATURES_KEYS.base,
    module: "orders",
    label: "Orders",
    description: "Online-store and manual orders with status tracking, stock reservation, GST invoices and customer messages.",
  },
  {
    key: ORDER_FEATURES_KEYS.returns,
    module: "orders",
    label: "Returns",
    description: "Mark delivered orders as returned: stock goes back and the invoice is cancelled.",
    dependsOn: [ORDER_FEATURES_KEYS.base],
    shopToggle: true,
  },
];

/** Same shape as core's PermissionDef (docs/commerce-batch1.md §5). */
export interface OrderPermissionDef {
  key: string;
  module: string;
  label: string;
  description: string;
}

export const ORDER_PERMISSIONS_KEYS = {
  manage: "orders.manage",
  cancel: "orders.cancel",
  refund: "orders.refund",
  ship: "orders.ship",
  deliver: "orders.deliver",
} as const;

export const ORDERS_PERMISSIONS: OrderPermissionDef[] = [
  {
    key: ORDER_PERMISSIONS_KEYS.manage,
    module: "orders",
    label: "Manage orders",
    description: "Create orders, change their status, add notes, shipping details and payments.",
  },
  {
    key: ORDER_PERMISSIONS_KEYS.cancel,
    module: "orders",
    label: "Cancel orders",
    description: "Cancel orders (releases stock and coupons, cancels the invoice).",
  },
  {
    key: ORDER_PERMISSIONS_KEYS.refund,
    module: "orders",
    label: "Record refunds",
    description: "Record money refunded to customers.",
  },
  {
    key: ORDER_PERMISSIONS_KEYS.ship,
    module: "orders",
    label: "Mark orders shipped",
    description: "Move packed orders to shipped (with tracking details).",
  },
  {
    key: ORDER_PERMISSIONS_KEYS.deliver,
    module: "orders",
    label: "Mark orders delivered",
    description: "Move shipped orders to delivered.",
  },
];
