import { defineModule } from "@srirealtime/core";
import { DINING_FEATURES, DINING_PERMISSIONS } from "./ports";
import { diningRoutes } from "./routes";
import { diningAreas, diningKots, diningMenuItems, diningOrderItems, diningOrders, diningTables } from "./schema";
import { DiningService, type DiningDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export { DiningService, openInput, lineInput, billInput, tableInput, areaInput, menuItemInput } from "./service";
export type { BillInput, DiningDeps, ExternalExtra, ExternalOrderInput, FloorTable, KitchenTicket, LineInput, OpenInput, OrderLine, OrderView } from "./service";
export { diningRoutes } from "./routes";

/**
 * Restaurant back end: areas and tables (with QR codes), running orders for dine-in / takeaway / delivery / online,
 * kitchen order tickets per station for the kitchen display, guest ordering from the table's QR menu, and GST bills
 * from orders (whole or split) through the kit's `BillingPort`.
 */
export function createDining(deps: DiningDeps) {
  const service = new DiningService(deps);
  const module = defineModule({
    id: "dining",
    tables: { diningAreas, diningTables, diningMenuItems, diningOrders, diningOrderItems, diningKots },
    routes: diningRoutes(service),
    features: DINING_FEATURES,
    permissions: DINING_PERMISSIONS,
  });
  return { service, module };
}
