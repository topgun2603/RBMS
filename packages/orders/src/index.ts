import { defineModule } from "@srirealtime/core";
import { ORDER_FEATURES, ORDERS_PERMISSIONS } from "./features";
import { ordersRoutes } from "./routes";
import { orderEvents, orders, orderSeries } from "./schema";
import { OrdersService, type OrdersDeps } from "./service";

export * from "./schema";
export * from "./types";
export * from "./ports";
export * from "./logic";
export * from "./service";
export * from "./features";
export * from "./csv";
export { orderPurchaseStats } from "./stats";
export { ordersRoutes, requirePermission } from "./routes";

/**
 * Orders from the online store, manual entry and (later) POS: FY numbering, a fixed status flow with side effects
 * (stock reservation, coupons, GST invoice, customer messages), payments/refunds, timeline, summary and CSV.
 */
export function createOrders(deps: OrdersDeps) {
  const service = new OrdersService(deps);
  const module = Object.assign(
    defineModule({
      id: "orders",
      tables: { orders, orderEvents, orderSeries },
      routes: ordersRoutes(service),
      features: ORDER_FEATURES,
    }),
    // SrModule.permissions lands in core with the staff module; attached here so the host can read it.
    { permissions: ORDERS_PERMISSIONS },
  );
  return { service, module };
}
