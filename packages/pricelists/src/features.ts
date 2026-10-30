import type { FeatureDef } from "@rbms/core";

/**
 * Price lists ride on the catalogue module's feature tree (`catalogue.*` plans grant it), docs/price-lists-units.md.
 * Alternate units themselves are part of the base catalogue (no switch).
 */
export const PRICE_LISTS_FEATURE = "catalogue.price-lists";

export const PRICE_LISTS_FEATURES: FeatureDef[] = [
  {
    key: PRICE_LISTS_FEATURE,
    module: "catalogue",
    label: "Price lists and wholesale prices",
    description: "Retail, wholesale and dealer price lists with quantity slabs, customer groups and per-customer prices.",
    dependsOn: ["catalogue"],
    shopToggle: true,
  },
];

/** Writes to lists and groups need the catalogue permission; a customer's list needs the customer permission. */
export const PRICE_LISTS_PERMISSIONS = { manage: "catalogue.manage", customers: "customers.create" } as const;
