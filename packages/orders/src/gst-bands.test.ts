import { APPAREL_FOOTWEAR_GST_RULE as RULE, exclusiveOf } from "@rbms/gst";
import { describe, expect, it } from "vitest";
import { buildBaseLines, computeOrderTotals } from "./logic";
import type { CatalogItem } from "./ports";

/** Price-band GST (apparel / footwear: 5% up to ₹2,500 taxable per piece, 18% above) on store orders. */
const shoe = (patch: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "v1",
  productId: "p1",
  name: "Running shoes – UK 8",
  sku: null,
  barcode: null,
  hsn: "6404",
  unit: "pair",
  price: 299_000,
  rate: exclusiveOf(299_000, 18, true),
  taxInclusive: true,
  gstRate: 18,
  gstRule: RULE,
  image: null,
  ...patch,
});
const opts = { shipping: 0, sellerState: "33", placeOfSupply: "33" };
const base = (items: CatalogItem[], qty = 1, price?: number) => {
  const r = buildBaseLines(items, items.map((i) => ({ variantId: i.id, qty, price })), { allowPriceOverride: price !== undefined });
  if (!r.ok) throw new Error("bad lines");
  return r.lines;
};

describe("orders with price-band GST", () => {
  it("bands each line at its own price", () => {
    const lines = base([shoe(), shoe({ id: "v2", price: 249_000, rate: exclusiveOf(249_000, 5, true), gstRate: 5 })]);
    const { lines: l, totals } = computeOrderTotals(lines, opts);
    expect(l.map((x) => x.gstRate)).toEqual([18, 5]);
    expect(l[0]).toMatchObject({ total: 299_000, taxable: 253_390 });
    expect(l[1]).toMatchObject({ total: 249_000, taxable: 237_143 });
    expect(totals.total).toBe(548_000);
  });

  it("a coupon that takes the pair to ₹2,625 or less incl. GST makes it 5%", () => {
    const { lines: l } = computeOrderTotals(base([shoe()]), { ...opts, lineDiscounts: [40_000] });
    // ₹2,990 − ₹400 = ₹2,590 charged → ₹2,466.67 taxable at 5%.
    expect(l[0]).toMatchObject({ gstRate: 5, total: 259_000, taxable: 246_667, rate: exclusiveOf(299_000, 5, true) });
  });

  it("a coupon that leaves it in the dead band keeps 18%", () => {
    const { lines: l } = computeOrderTotals(base([shoe()]), { ...opts, lineDiscounts: [10_000] });
    expect(l[0]).toMatchObject({ gstRate: 18, total: 289_000 });
  });

  it("loyalty points re-band an exclusive-priced line", () => {
    const item = shoe({ taxInclusive: false, price: 260_000, rate: 260_000, gstRate: 18 });
    // ₹2,600 + 18%; ₹200 of points (charged money) → ₹169.49 off the exclusive basis at 18% → ₹2,430.51: 5%.
    const { lines: l } = computeOrderTotals(base([item]), { ...opts, loyaltyDiscounts: [20_000], loyaltyPoints: 200 });
    expect(l[0]!.gstRate).toBe(5);
    expect(l[0]!.taxable).toBeLessThanOrEqual(250_000);
  });

  it("a staff price override is banded at the price charged", () => {
    const [line] = base([shoe()], 1, 199_900);
    expect(line).toMatchObject({ gstRate: 5, rate: exclusiveOf(199_900, 5, true), gstRule: RULE });
  });

  it("products without a rule are unchanged", () => {
    const item = shoe({ gstRule: null, hsn: "5007", gstRate: 5, price: 1_850_000, rate: exclusiveOf(1_850_000, 5, true) });
    const { lines: l } = computeOrderTotals(base([item]), opts);
    expect(l[0]).toMatchObject({ gstRate: 5, total: 1_850_000 });
  });
});
