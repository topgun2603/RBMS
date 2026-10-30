import { defineModule } from "@rbms/core";
import { CATALOGUE_FEATURES } from "./features";
import { catalogueRoutes } from "./routes";
import { catalogCategories, catalogCollections, catalogItemUnits, catalogProducts, catalogVariants } from "./schema";
import { CatalogueService, type CatalogueDeps } from "./service";
import { billingItemSource, inventoryItemCatalog } from "./adapters";

export * from "./schema";
export * from "./types";
export * from "./logic";
export * from "./search";
export * from "./collections";
export * from "./recommend";
export * from "./csv";
export * from "./service";
export * from "./features";
export * from "./adapters";
export * from "./units";
export {
  catalogueRoutes,
  PRODUCT_CSV_COLUMNS,
  CATALOGUE_ROUTE_PREFIX,
  CATALOGUE_VENDOR_ROUTES,
  CATALOGUE_VENDOR_ROUTE_KEYS,
  isCatalogueStaff,
  isCatalogueVendorCandidate,
  isCatalogueVendorRoute,
  vendorIdOf,
  categoryListSchema,
  categorySchema,
  productListSchema,
  productSchema,
  productSummarySchema,
  variantLookupSchema,
  variantSchema,
  variantSearchResultSchema,
  itemUnitSchema,
  itemUnitsSchema,
  type CatalogueRouteOptions,
} from "./routes";

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
    tables: { catalogCategories, catalogProducts, catalogVariants, catalogCollections, catalogItemUnits },
    routes: catalogueRoutes(service, { vendorScope: deps.vendorScope }),
    features: CATALOGUE_FEATURES,
  });
  return {
    service,
    module,
    /** Pass as `items` to createInvoices: `/v1/invoices/items*` become a facade over the catalogue. */
    itemSource: billingItemSource(service),
    /** Pass as `catalog` to createInventory. */
    itemCatalog: inventoryItemCatalog(service),
    /** Pass as `products` to createMarketplace (its `VendorProductsPort`). */
    vendorProducts: {
      count: (tenantId: string, vendorId: string, opts?: { publicOnly?: boolean }) => service.vendorProductCount(tenantId, vendorId, opts),
      list: (tenantId: string, vendorId: string, opts: { limit: number; offset: number; publicOnly?: boolean; q?: string }) =>
        service.vendorProducts(tenantId, vendorId, opts),
      variants: (tenantId: string, vendorId: string, opts: { productIds?: string[]; variantIds?: string[] }) =>
        service.vendorVariants(tenantId, vendorId, opts),
    },
  };
}
