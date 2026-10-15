import { defineModule } from "@srirealtime/core";
import { CATALOGUE_FEATURES } from "./features";
import { catalogueRoutes } from "./routes";
import { catalogCategories, catalogCollections, catalogProducts, catalogVariants } from "./schema";
import { CatalogueService, type CatalogueDeps } from "./service";
import { billingItemSource, inventoryItemCatalog } from "./adapters";

export * from "./schema";
export * from "./types";
export * from "./logic";
export * from "./search";
export * from "./collections";
export * from "./csv";
export * from "./service";
export * from "./features";
export * from "./adapters";
export { catalogueRoutes, PRODUCT_CSV_COLUMNS } from "./routes";

/** HTTP module id: routes are mounted at `/v1/catalog`. Feature keys use "catalogue" (`catalogue`, `catalogue.*`). */
export const CATALOGUE_MODULE_ID = "catalog";

/**
 * The one product list for store, billing and POS: categories, products with variants (the sellable units), staff
 * lookups, the public storefront with search (facets, suggestions) and collections, and ready-made adapters for invoices' ItemSourcePort and inventory's ItemCatalogPort.
 */
export function createCatalogue(deps: CatalogueDeps) {
  const service = new CatalogueService(deps);
  const module = defineModule({
    id: CATALOGUE_MODULE_ID,
    tables: { catalogCategories, catalogProducts, catalogVariants, catalogCollections },
    routes: catalogueRoutes(service),
    features: CATALOGUE_FEATURES,
  });
  return {
    service,
    module,
    /** Pass as `items` to createInvoices: `/v1/invoices/items*` become a facade over the catalogue. */
    itemSource: billingItemSource(service),
    /** Pass as `catalog` to createInventory. */
    itemCatalog: inventoryItemCatalog(service),
  };
}
