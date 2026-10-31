import { priceBandRuleForHsn } from "@rbms/gst";
import type { DemoProduct } from "./types";

/**
 * Apparel (HSN 61, 62, 63 made-ups) and footwear (6401–6405) are taxed by price from 22.09.2025 (5% up to ₹2,500 per
 * piece / pair before GST, 18% above; @rbms/gst rate-rule.ts): such demo products get the price-band rule, so each
 * size is billed at the band of its own price (and of the bill's discounts). Others are returned unchanged.
 */
export function withPriceBandGst(products: DemoProduct[]): DemoProduct[] {
  return products.map((p) => {
    const rule = priceBandRuleForHsn(p.hsn);
    return rule && p.gstRule === undefined ? { ...p, gstRule: { ...rule } } : p;
  });
}
