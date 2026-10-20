import { defineModule } from "@srirealtime/core";
import { SCALES_FEATURES, SCALES_PERMISSIONS } from "./ports";
import { scalesRoutes } from "./routes";
import { scaleItems } from "./schema";
import { ScalesService, type ScalesDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export * from "./barcode";
export { ScalesService, scaleItemInput, priceListInput, scaleItemListQuery, labelQuery, SCALE_ITEM_SORT } from "./service";
export type { PriceListInput, ResolvedScaleCode, ScaleItemInput, ScaleItemListQuery, ScaleItemView, ScaleLabelPreview, ScalesDeps } from "./service";
export { scalesRoutes } from "./routes";

/**
 * Selling by weight: PLU codes for the shop's weighing scales, the daily price list (prices live on the catalogue
 * variants), the PLU file for the scale software and reading the scale's EAN-13 labels at the counter
 * (`service.resolveCode`). The kit wires the `CatalogPort` (catalogue) and the `scales` settings namespace.
 */
export function createScales(deps: ScalesDeps) {
  const service = new ScalesService(deps);
  const module = defineModule({
    id: "scales",
    tables: { scaleItems },
    routes: scalesRoutes(service),
    features: SCALES_FEATURES,
    permissions: SCALES_PERMISSIONS,
  });
  return { service, module };
}
