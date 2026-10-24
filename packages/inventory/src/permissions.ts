/**
 * Permissions this module will check (docs/commerce-batch1.md section 5). Shape matches core's planned
 * `PermissionDef { key, module, label, description }`; the integration step registers them on the module and
 * annotates routes with `config.permission` once core has it.
 */
export const INVENTORY_PERMISSION_KEYS = {
  adjust: "inventory.adjust",
  transfer: "inventory.transfer",
  purchases: "inventory.purchases",
  /** Pay suppliers, record part-payments and reverse them. */
  purchasesPay: "inventory.purchases.pay",
} as const;

export type InventoryPermission = (typeof INVENTORY_PERMISSION_KEYS)[keyof typeof INVENTORY_PERMISSION_KEYS];

export const INVENTORY_PERMISSIONS = [
  {
    key: INVENTORY_PERMISSION_KEYS.adjust,
    module: "inventory",
    label: "Adjust stock",
    description: "Add, remove or set stock, change reorder levels and tracking.",
  },
  {
    key: INVENTORY_PERMISSION_KEYS.transfer,
    module: "inventory",
    label: "Transfer stock",
    description: "Move stock between locations and manage locations.",
  },
  {
    key: INVENTORY_PERMISSION_KEYS.purchases,
    module: "inventory",
    label: "Purchases and suppliers",
    description: "Record and cancel purchase bills, purchase orders, goods receipts and debit notes, manage suppliers.",
  },
  {
    key: INVENTORY_PERMISSION_KEYS.purchasesPay,
    module: "inventory",
    label: "Pay suppliers",
    description: "Record payments to suppliers (part or full), reverse them, and mark purchase bills paid.",
  },
] as const satisfies readonly { key: string; module: string; label: string; description: string }[];

/**
 * Which permission each mutating route needs, for the integration step to copy into `config.permission`.
 * Keys are `<METHOD> <path under /v1/inventory>`.
 */
export const INVENTORY_ROUTE_PERMISSIONS: Record<string, InventoryPermission> = {
  "PATCH /stock/:itemId": "inventory.adjust",
  "POST /stock/:itemId/adjust": "inventory.adjust",
  "POST /locations": "inventory.transfer",
  "PATCH /locations/:id": "inventory.transfer",
  "DELETE /locations/:id": "inventory.transfer",
  "POST /transfers": "inventory.transfer",
  "POST /suppliers": "inventory.purchases",
  "PATCH /suppliers/:id": "inventory.purchases",
  "DELETE /suppliers/:id": "inventory.purchases",
  "POST /purchases": "inventory.purchases",
  "POST /purchases/:id/cancel": "inventory.purchases",
  "POST /purchases/:id/paid": "inventory.purchases.pay",
  "POST /purchases/:id/payments": "inventory.purchases.pay",
  "POST /suppliers/:id/payments": "inventory.purchases.pay",
  "POST /payments/:id/reverse": "inventory.purchases.pay",
  "POST /payments/group/:groupId/reverse": "inventory.purchases.pay",
  "PATCH /purchases/:id": "inventory.purchases",
  "POST /purchase-orders": "inventory.purchases",
  "PATCH /purchase-orders/:id": "inventory.purchases",
  "POST /purchase-orders/:id/send": "inventory.purchases",
  "POST /purchase-orders/:id/cancel": "inventory.purchases",
  "POST /purchase-orders/:id/close": "inventory.purchases",
  "POST /purchase-orders/:id/receive": "inventory.purchases",
  "POST /purchase-orders/:id/convert": "inventory.purchases",
  "POST /goods-receipts/:id/bill": "inventory.purchases",
  "POST /debit-notes": "inventory.purchases",
  "POST /debit-notes/:id/cancel": "inventory.purchases",
};
