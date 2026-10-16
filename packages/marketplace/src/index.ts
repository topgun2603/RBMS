import { defineModule } from "@srirealtime/core";
import { MARKETPLACE_FEATURES, MARKETPLACE_PERMISSIONS } from "./features";
import { marketplaceRoutes } from "./routes";
import { vendorLedger, vendorOrders, vendorPayouts, vendorProductReviews, vendors, vendorUsers } from "./schema";
import { MarketplaceService, type MarketplaceDeps } from "./service";

export * from "./schema";
export * from "./ports";
export * from "./features";
export * from "./settings";
export * from "./logic";
export * from "./payouts";
export * from "./crypto";
export * from "./service";
export { marketplaceRoutes, VENDOR_HEADER, vendorOrdersCsv, ledgerCsv, payoutsCsv } from "./routes";

/** Daily job: `service.settleDue()` — credits delivered sales whose return window is over. */
export const MARKETPLACE_SETTLE_JOB = "marketplace.settle";
/** Every 30 min: `service.refreshAllPayouts()` — settles Razorpay Route transfers still processing. */
export const MARKETPLACE_PAYOUT_REFRESH_JOB = "marketplace.payouts.refresh";

/**
 * Multi-vendor store: sellers (applications, approval, commission, KYC gate, encrypted payout accounts), per-seller
 * vendor orders split from each order, a signed seller ledger, and payout runs through manual / mock / Razorpay Route.
 */
export function createMarketplace(deps: MarketplaceDeps) {
  const service = new MarketplaceService(deps);
  const module = defineModule({
    id: "marketplace",
    tables: { vendors, vendorUsers, vendorOrders, vendorLedger, vendorPayouts, vendorProductReviews },
    routes: marketplaceRoutes(service),
    features: MARKETPLACE_FEATURES,
    permissions: MARKETPLACE_PERMISSIONS,
  });
  return { service, module };
}
