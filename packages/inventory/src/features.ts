import type { FeatureDef } from "@srirealtime/core";

/** Feature keys declared by this module (docs/features.md). */
export const INVENTORY_FEATURE_KEYS = {
  stock: "inventory",
  purchases: "inventory.purchases",
  locations: "inventory.locations",
} as const;

export const INVENTORY_FEATURES: FeatureDef[] = [
  {
    key: INVENTORY_FEATURE_KEYS.stock,
    module: "inventory",
    label: "Stock tracking",
    description: "Stock levels per item, adjustments, low-stock alerts and the stock report. Bills reduce stock.",
    dependsOn: ["invoices"],
    shopToggle: true,
  },
  {
    key: INVENTORY_FEATURE_KEYS.purchases,
    module: "inventory",
    label: "Purchases and suppliers",
    description: "Suppliers and purchase bills with input tax credit (ITC); purchases add to stock.",
    dependsOn: [INVENTORY_FEATURE_KEYS.stock],
    shopToggle: true,
  },
  {
    key: INVENTORY_FEATURE_KEYS.locations,
    module: "inventory",
    label: "Multiple stock locations",
    description: "Stores and warehouses with their own stock, and transfers between them.",
    dependsOn: [INVENTORY_FEATURE_KEYS.stock],
    shopToggle: false,
  },
];
