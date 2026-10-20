import { defineModule } from "@srirealtime/core";
import { SERIALS_FEATURES, SERIALS_PERMISSIONS } from "./ports";
import { serialsRoutes } from "./routes";
import { serialEvents, serialItems, serialUnits } from "./schema";
import { SerialsService, type SerialsDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export {
  SerialsService,
  MAX_RECEIVE,
  itemSettingsInput,
  receiveUnitsInput,
  statusInput,
  claimInput,
  unitListQuery,
  itemListQuery,
  UNIT_SORT,
  ITEM_SORT,
} from "./service";
export type {
  ClaimInput,
  ItemListQuery,
  ItemSettingsInput,
  ItemView,
  ReceiveResult,
  ReceiveUnitsInput,
  SerialsDeps,
  SerialsSummary,
  StatusInput,
  UnitListQuery,
  UnitView,
  WarrantyLookup,
} from "./service";
export { serialsRoutes } from "./routes";

/**
 * Serial number / IMEI tracking with warranty for electronics and mobile shops: receive units (pasted or scanned),
 * sell them from the bill, defective / written-off / back in stock, warranty lookup and claims. The kit wires the bill
 * hooks (`onInvoiceIssued` / `onInvoiceCancelled` / `onCreditNote`), the inventory `StockPort` and `resolveCode` for the
 * POS scanner.
 */
export function createSerials(deps: SerialsDeps) {
  const service = new SerialsService(deps);
  const module = defineModule({
    id: "serials",
    tables: { serialItems, serialUnits, serialEvents },
    routes: serialsRoutes(service),
    features: SERIALS_FEATURES,
    permissions: SERIALS_PERMISSIONS,
  });
  return { service, module };
}
