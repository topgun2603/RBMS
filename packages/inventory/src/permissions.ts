/**
 * Permissions this module will check (docs/commerce-batch1.md section 5). Shape matches core's planned
 * `PermissionDef { key, module, label, description }`; the integration step registers them on the module and
 * annotates routes with `config.permission` once core has it.
 */
export const INVENTORY_PERMISSION_KEYS = {
  adjust: "inventory.adjust",
  transfer: "inventory.transfer",
  purchases: "inventory.purchases",
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
    description: "Record and cancel purchase bills, manage suppliers.",
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
  "POST /purchases/:id/paid": "inventory.purchases",
};
