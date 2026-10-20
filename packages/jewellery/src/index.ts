import { defineModule } from "@srirealtime/core";
import { JEWELLERY_FEATURES, JEWELLERY_PERMISSIONS } from "./ports";
import { jewelleryRoutes } from "./routes";
import { jewelleryExchanges, jewelleryPieces, jewelleryRates } from "./schema";
import { JewelleryService, type JewelleryDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export {
  JewelleryService,
  ratesInput,
  rateEntryInput,
  ratesQuery,
  pieceInput,
  piecePatch,
  pieceListQuery,
  repriceInput,
  exchangeInput,
  exchangeLineInput,
  exchangeListQuery,
  applyInput,
  PIECE_SORT,
  EXCHANGE_SORT,
} from "./service";
export type {
  EffectiveRate,
  ExchangeInput,
  ExchangeListQuery,
  ExchangeSummary,
  ExchangeView,
  JewelleryDeps,
  PieceInput,
  PieceListQuery,
  PiecePatch,
  PiecePrice,
  PieceView,
  RatesInput,
  RatesView,
  RepriceResult,
  TodayRates,
} from "./service";
export { jewelleryRoutes } from "./routes";

/**
 * Jewellery back end: the day's metal rates (gold 24K/22K/18K/14K, silver 999/925, platinum 950; other purities derived
 * from 24K / 999), pieces with weight, purity, making, wastage, stones and HUID, and old-gold exchange against a bill.
 * Saving a rate (or a piece) recomputes the GST-exclusive price of the affected in-stock pieces and writes it to the
 * catalogue through the `CatalogPort`, so the counter, bills and the store use ordinary item prices.
 */
export function createJewellery(deps: JewelleryDeps) {
  const service = new JewelleryService(deps);
  const module = defineModule({
    id: "jewellery",
    tables: { jewelleryRates, jewelleryPieces, jewelleryExchanges },
    routes: jewelleryRoutes(service),
    features: JEWELLERY_FEATURES,
    permissions: JEWELLERY_PERMISSIONS,
  });
  return { service, module };
}
