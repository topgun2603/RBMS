import type { FeatureDef } from "@srirealtime/core";

export const DELIVERY_FEATURE = "delivery";
export const CARRIERS_FEATURE = "delivery.carriers";

export const DELIVERY_FEATURES: FeatureDef[] = [
  {
    key: DELIVERY_FEATURE,
    module: "delivery",
    label: "Delivery & shipping",
    description:
      "Shipping zones and rates (flat, by weight, free above an amount, COD fee), delivery quotes for the store, pincode lookup and manual shipments with tracking numbers.",
  },
  {
    key: CARRIERS_FEATURE,
    module: "delivery",
    label: "Courier integration (Shiprocket)",
    description: "Book couriers through the shop's Shiprocket account, print shipping labels and update orders from live tracking.",
    dependsOn: [DELIVERY_FEATURE],
    shopToggle: true,
  },
];

/** Permissions the delivery routes use; both are declared by other modules (orders, settings). */
export const DELIVERY_PERMISSIONS_KEYS = {
  shipments: "orders.manage",
  settings: "settings.manage",
} as const;
