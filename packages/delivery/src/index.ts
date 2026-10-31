import { defineModule } from "@rbms/core";
import { DELIVERY_FEATURES } from "./features";
import { deliveryRoutes } from "./routes";
import { deliveryAccounts, deliveryRates, deliveryZones, pincodeCache, shipments } from "./schema";
import { DeliveryService, type DeliveryDeps } from "./service";

export * from "./schema";
export * from "./ports";
export * from "./features";
export * from "./states";
export * from "./pincode";
export * from "./zones";
export * from "./crypto";
export * from "./service";
export * from "./carriers/types";
export * from "./carriers/status";
export * from "./carriers/simple";
export * from "./carriers/shiprocket";
export { deliveryRoutes } from "./routes";

/** Job name the host schedules every 2 h; its handler is `service.trackOpenShipments()`. */
export const DELIVERY_TRACK_JOB = "delivery.track";

/**
 * Shipping zones + rates, quotes for the storefront, pincode lookup, and shipments through manual entry, a mock carrier
 * (dev) or the shop's Shiprocket account, with tracking pushed to orders via `OrderFulfillmentPort`.
 */
export function createDelivery(deps: DeliveryDeps) {
  const service = new DeliveryService(deps);
  const module = defineModule({
    id: "delivery",
    tables: { deliveryZones, deliveryRates, deliveryAccounts, shipments, pincodeCache },
    routes: deliveryRoutes(service),
    features: DELIVERY_FEATURES,
    // Uses orders.manage and settings.manage, declared by orders / the host; nothing new to declare.
    permissions: [],
  });
  return { service, module };
}
