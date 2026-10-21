import { defineModule } from "@srirealtime/core";
import { STOREFRONT_FEATURES } from "./features";
import { storefrontRoutes } from "./routes";
import { storeAddresses, storeCarts, storeCustomers, storeWishlist } from "./schema";
import { StorefrontService, type StorefrontDeps } from "./service";

export * from "./schema";
export * from "./ports";
export * from "./pricing";
export * from "./promotions";
export * from "./address";
export * from "./checkout";
export * from "./features";
export * from "./ratelimit";
export * from "./service";
export { storefrontRoutes, storeOf, shopperOf } from "./routes";

/**
 * The online store API (docs/commerce-batch2.md §1): store config, carts by token, shopper accounts (addresses,
 * orders, wishlist), checkout and public order tracking. Module id `store` → mounted at `/v1/store`.
 */
export function createStorefront(deps: StorefrontDeps) {
  const service = new StorefrontService(deps);
  const module = defineModule({
    id: "store",
    tables: { storeCustomers, storeAddresses, storeCarts, storeWishlist },
    routes: storefrontRoutes(service),
    features: STOREFRONT_FEATURES,
  });
  return { service, module };
}
