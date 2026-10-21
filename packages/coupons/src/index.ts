import { defineModule } from "@srirealtime/core";
import { COUPON_FEATURES, COUPONS_PERMISSIONS } from "./features";
import { couponsRoutes } from "./routes";
import { couponRedemptions, coupons, offerRedemptions, offers } from "./schema";
import { CouponsService, type CouponsDeps } from "./service";

export * from "./schema";
export * from "./logic";
export * from "./offers";
export * from "./offers-service";
export * from "./service";
export * from "./features";
export { couponsRoutes, requirePermission } from "./routes";

/**
 * Discount codes (percent, flat, free shipping) with date windows, channels, category/product targeting and
 * race-safe usage limits, plus automatic offers (buy X get Y, tiers, free gifts) and bundles priced by `priceCart`. The service's evaluate/redeem/release are what orders' CouponPort expects.
 */
export function createCoupons(deps: CouponsDeps) {
  const service = new CouponsService(deps);
  const module = Object.assign(
    defineModule({
      id: "coupons",
      tables: { coupons, couponRedemptions, offers, offerRedemptions },
      routes: couponsRoutes(service),
      features: COUPON_FEATURES,
    }),
    // SrModule.permissions lands in core with the staff module; attached here so the host can read it.
    { permissions: COUPONS_PERMISSIONS },
  );
  return { service, module };
}
