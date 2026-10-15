import { defineModule } from "@srirealtime/core";
import { INVENTORY_FEATURES } from "./features";
import { inventoryRoutes } from "./routes";
import { purchases, stockItems, stockLocations, stockMovements, stockReservations, stockTransfers, suppliers } from "./schema";
import { InventoryService, type InventoryDeps } from "./service";

export * from "./schema";
export * from "./ports";
export * from "./logic";
export * from "./levels";
export * from "./permissions";
export * from "./csv";
export * from "./service";
export * from "./features";
export { inventoryRoutes, PURCHASE_CSV_COLUMNS, STOCK_CSV_COLUMNS } from "./routes";

/** Stock per saved item and location, transfers, reservations, suppliers and purchase bills (with input tax credit). */
export function createInventory(deps: InventoryDeps) {
  const service = new InventoryService(deps);
  const module = defineModule({
    id: "inventory",
    tables: { stockItems, stockMovements, suppliers, purchases, stockLocations, stockTransfers, stockReservations },
    routes: inventoryRoutes(service),
    features: INVENTORY_FEATURES,
  });
  return { service, module };
}
