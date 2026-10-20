/** Feature keys the jewellery UI uses (declared by @srirealtime/jewellery). */
export const JEWELLERY_FEATURES = {
  jewellery: "jewellery",
  exchange: "jewellery.exchange",
} as const;

/** Permissions of @srirealtime/jewellery. Owners and admins hold all of them. */
export const JEWELLERY_PERMISSIONS = {
  rates: "jewellery.rates",
  manage: "jewellery.manage",
  exchange: "jewellery.exchange",
} as const;

/** Any jewellery permission can read rates, pieces and prices. */
export const JEWELLERY_VIEW = [JEWELLERY_PERMISSIONS.rates, JEWELLERY_PERMISSIONS.manage, JEWELLERY_PERMISSIONS.exchange];
