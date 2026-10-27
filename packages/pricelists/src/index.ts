import { defineModule } from "@srirealtime/core";
import { PRICE_LISTS_FEATURES } from "./features";
import { priceListsRoutes } from "./routes";
import { customerGroups, customerPricing, priceListItems, priceLists } from "./schema";
import { PriceListsService, type PriceListsDeps } from "./service";

export * from "./schema";
export * from "./resolve";
export * from "./service";
export * from "./features";
export { priceListsRoutes } from "./routes";

/** HTTP module id: routes are mounted at `/v1/pricelists`. */
export const PRICE_LISTS_MODULE_ID = "pricelists";

/**
 * Price lists (Retail, Wholesale, Dealer …) with per-item / per-unit prices, quantity slabs, % rules and validity
 * dates; customer groups and per-customer lists; one pure resolver (`resolvePrice`) shared by the API and the POS.
 */
export function createPriceLists(deps: PriceListsDeps) {
  const service = new PriceListsService(deps);
  const module = defineModule({
    id: PRICE_LISTS_MODULE_ID,
    tables: { priceLists, priceListItems, customerGroups, customerPricing },
    routes: priceListsRoutes(service),
    features: PRICE_LISTS_FEATURES,
  });
  return { service, module };
}
