import { defineModule } from "@rbms/core";
import { LOYALTY_FEATURES, LOYALTY_PERMISSIONS } from "./features";
import { createLoyaltyHooks } from "./hooks";
import { loyaltyRoutes } from "./routes";
import { loyaltyLedger, loyaltyMembers } from "./schema";
import { LoyaltyService, type LoyaltyDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./ports";
export * from "./service";
export * from "./features";
export * from "./hooks";
export { membersCsv, toCsv } from "./csv";
export { loyaltyRoutes } from "./routes";

/**
 * Loyalty points at `/v1/loyalty` (docs/batch3.md §A5): earn on paid bills and delivered orders, redeem as a discount,
 * tiers by lifetime spend, FIFO expiry at IST month ends. `hooks` are the event handlers the kit wires
 * (see `LOYALTY_EVENT_WIRING`); run `service.expireDue()` from a daily job.
 */
export function createLoyalty(deps: LoyaltyDeps) {
  const service = new LoyaltyService(deps);
  const module = defineModule({
    id: "loyalty",
    tables: { loyaltyMembers, loyaltyLedger },
    routes: loyaltyRoutes(service),
    features: LOYALTY_FEATURES,
    permissions: LOYALTY_PERMISSIONS,
  });
  const hooks = createLoyaltyHooks({ service, featureGate: deps.featureGate, log: deps.log });
  return { service, module, hooks };
}
