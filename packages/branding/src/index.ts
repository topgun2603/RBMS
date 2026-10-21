import { defineModule } from "@srirealtime/core";
import { brandingRoutes } from "./routes";
import { tenantBranding } from "./schema";
import { stockArtRoutes } from "./stock-routes";
import { BrandingService, type BrandingDeps } from "./service";

export * from "./schema";
export * from "./color";
export * from "./tokens";
export * from "./theme";
export { BrandingService, brandingPatchSchema } from "./service";
export type { Branding, BrandingDeps, BrandingPatch } from "./service";
export { brandingRoutes } from "./routes";
export { stockArtRoutes } from "./stock-routes";
export {
  STOCK_SIZES,
  STOCK_SLOTS,
  STOCK_TRADES,
  isStockSlot,
  isStockTrade,
  stockArtDataUrl,
  stockArtFor,
  stockArtPath,
  stockArtSvg,
  stockPalette,
  tradeColors,
  type StockColors,
  type StockSlot,
  type StockTrade,
} from "./stock-art";

export function createBranding(deps: BrandingDeps) {
  const service = new BrandingService(deps);
  const module = defineModule({
    id: "branding",
    tables: { tenantBranding },
    routes: async (app) => {
      await brandingRoutes(service)(app);
      await stockArtRoutes()(app);
    },
  });
  return { service, module };
}
