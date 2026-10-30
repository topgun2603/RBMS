import type { FeatureDef } from "@rbms/core";

export const COUPONS_FEATURE = "coupons";

export const COUPON_FEATURES: FeatureDef[] = [
  {
    key: COUPONS_FEATURE,
    module: "coupons",
    label: "Coupons",
    description: "Discount codes for the online store and orders: percent, flat or free shipping, with limits and dates.",
    shopToggle: true,
  },
];

/** Same shape as core's PermissionDef (docs/commerce-batch1.md §5). */
export interface CouponPermissionDef {
  key: string;
  module: string;
  label: string;
  description: string;
}

export const COUPONS_PERMISSIONS: CouponPermissionDef[] = [
  {
    key: "coupons.manage",
    module: "coupons",
    label: "Manage coupons",
    description: "Create, edit, switch off and delete coupon codes.",
  },
];
